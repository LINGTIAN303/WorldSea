//! # Multi-Agent 命令层 — Tauri 命令封装
//!
//! 阶段 2.3 新增。本模块把 `agent_runtime::multi_agent::MultiAgentNode` 的能力
//! 通过 Tauri 命令暴露给前端，与 `commands::supervisor` / `commands::router` /
//! `commands::tot` / `commands::got` 并列存在。
//!
//! ## 命令一览
//! | 命令 | 说明 |
//! |------|------|
//! | `cmd_multi_agent_create`           | 创建 MultiAgentNode 实例并注册 |
//! | `cmd_multi_agent_run`              | 提交任务，触发协作（多轮 Agent 执行 + 黑板共享 + 消息传递） |
//! | `cmd_multi_agent_abort`            | 中断当前运行（设置 abort_flag） |
//! | `cmd_multi_agent_destroy`          | 销毁实例（abort_all tool_bridge + 移除注册） |
//! | `cmd_multi_agent_get_state`        | 获取共享 OrchestratorState 快照 |
//! | `cmd_multi_agent_set_state`        | 写回 state（用于断点恢复） |
//! | `cmd_multi_agent_list_sessions`    | 列出所有已注册的 Multi-Agent session_id |
//! | `cmd_multi_agent_get_blackboard`   | 获取最后一次 execute 的黑板快照 |
//!
//! ## 事件流
//! 事件通过 `app.emit("multi_agent:event:{session_id}", MultiAgentEventPayload)` 推送，
//! 前端通过 `listen("multi_agent:event:" + sessionId, handler)` 监听。
//!
//! Multi-Agent 执行期间触发的事件序列（成功路径）：
//!   `MultiAgentRoundStarted` → `MultiAgentMessageSent`（每个 Agent 接收消息时）
//!   → `MultiAgentBlackboardUpdated`（Agent 写入黑板时） → `MultiAgentRoundCompleted`
//!   →（继续下一轮 或 `MultiAgentConverged`）
//!
//! 失败路径：
//!   - Agent 执行失败：`MultiAgentError`（agent_id=失败 Agent）
//!   - 收敛检查失败：`MultiAgentError`（agent_id="system"）
//!
//! ## 与 Supervisor 命令层的差异
//! - **去中心化**：MultiAgentNode 内部 N 个 Agent 对等协作，无中心调度者
//! - **拓扑结构**：支持 Mesh/Ring/Star/Pipeline/Custom 多种通信拓扑
//! - **黑板共享**：Agent 间通过 SharedBlackboard 共享全局状态，可通过 `cmd_multi_agent_get_blackboard` 读取
//! - **消息传递**：Agent 间通过 mpsc 通道直接通信（Supervisor 无此机制）
//! - **收敛策略**：MaxRounds/GoalReached/AllAgentsIdle/Hybrid（Supervisor 仅 max_rounds）
//! - **无 clear_agent_pool 命令**：Multi-Agent 的 Agent 池由每次 execute 内部管理，
//!   不像 Supervisor 那样跨命令持久化（如需清空，destroy 后重建即可）

use std::sync::Arc;
use std::time::Duration;

use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventListener, OrchestratorEvent};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::multi_agent::{
    AgentSpec, ConvergenceStrategy, GoalCheckMAPromptTemplate, LlmGoalCheckStrategyMA,
    LlmSynthesisStrategy, MultiAgentConfig, MultiAgentNode, SharedBlackboard, SynthesisPromptTemplate,
    SynthesisStrategy, Topology,
};
use agent_runtime::node::{NodeContext, NodeResult, NodeStatus, OrchestratorNode};
use agent_runtime::tool::SimpleToolBus;
use agent_runtime::types::OrchestratorState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, info, warn};

use crate::agent_bridge::ma_registry::{
    MultiAgentAbortCheck, MultiAgentEmitter, MultiAgentEntry, MultiAgentRegistryError,
};
use crate::agent_bridge::tool_bridge::FrontendToolBridge;
use crate::state::AppState;

// ─── 事件名约定 ────────────────────────────────────────────

/// Multi-Agent 会话事件名前缀
///
/// 完整事件名：`multi_agent:event:{session_id}`
/// 前端：`listen(\`multi_agent:event:${sessionId}\`, ...)`
const fn event_name_prefix() -> &'static str {
    "multi_agent:event:"
}

/// 构造单个 session 的事件名
fn session_event_name(session_id: &str) -> String {
    format!("{}{}", event_name_prefix(), session_id)
}

// ─── Multi-Agent 事件 Payload ────────────────────────────────────────────

/// Multi-Agent 事件 Payload — 前端友好的扁平化事件结构
///
/// 与 `SupervisorEventPayload` 并列存在。处理 `OrchestratorEvent` 中
/// Multi-Agent 相关变体（MultiAgentRoundStarted / MultiAgentMessageSent 等），
/// 其他事件（基础 Agent 事件、Supervisor 事件等）暂不映射（返回 None）。
///
/// ## 序列化
/// 使用 `#[serde(tag = "type")]` 内部标签模式，匹配前端 discriminated union：
/// ```json
/// {"type":"multi_agent_round_started","node_id":"ma","round":1,"agent_count":3,...}
/// ```
///
/// 注意：`#[serde(tag = "type", rename_all = "snake_case")]` 只对变体名重命名，
/// 变体内部字段保持 Rust 原生 snake_case（与前端 `RustMultiAgentEventPayload` 类型一致）。
/// 前端通过 `rustEventToTsEvent` 转换为 camelCase 供 UI 使用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MultiAgentEventPayload {
    /// 协作轮次开始
    MultiAgentRoundStarted {
        session_id: String,
        node_id: String,
        round: usize,
        agent_count: usize,
    },
    /// Agent 间消息已发送
    MultiAgentMessageSent {
        session_id: String,
        node_id: String,
        from: String,
        to: String,
        message_type: String,
        content_preview: String,
    },
    /// 共享黑板已更新
    MultiAgentBlackboardUpdated {
        session_id: String,
        node_id: String,
        key: String,
        by: String,
    },
    /// 协作轮次完成
    MultiAgentRoundCompleted {
        session_id: String,
        node_id: String,
        round: usize,
        outputs: Vec<String>,
    },
    /// 协作收敛
    MultiAgentConverged {
        session_id: String,
        node_id: String,
        reason: String,
        final_result: String,
    },
    /// 执行失败
    MultiAgentError {
        session_id: String,
        node_id: String,
        agent_id: String,
        error: String,
    },
}

impl MultiAgentEventPayload {
    /// 从 `OrchestratorEvent` 转换为前端 Payload
    ///
    /// 只处理 Multi-Agent 相关变体，其他变体返回 `None`。
    /// `session_id` 由外部注入（Rust 端事件不携带 session_id）。
    pub fn from_orchestrator_event(
        event: &OrchestratorEvent,
        session_id: &str,
    ) -> Option<Self> {
        let session_id = session_id.to_string();
        Some(match event {
            OrchestratorEvent::MultiAgentRoundStarted {
                node_id,
                round,
                agent_count,
            } => Self::MultiAgentRoundStarted {
                session_id,
                node_id: node_id.clone(),
                round: *round,
                agent_count: *agent_count,
            },

            OrchestratorEvent::MultiAgentMessageSent {
                node_id,
                from,
                to,
                message_type,
                content_preview,
            } => Self::MultiAgentMessageSent {
                session_id,
                node_id: node_id.clone(),
                from: from.clone(),
                to: to.clone(),
                message_type: message_type.clone(),
                content_preview: content_preview.clone(),
            },

            OrchestratorEvent::MultiAgentBlackboardUpdated { node_id, key, by } => {
                Self::MultiAgentBlackboardUpdated {
                    session_id,
                    node_id: node_id.clone(),
                    key: key.clone(),
                    by: by.clone(),
                }
            }

            OrchestratorEvent::MultiAgentRoundCompleted {
                node_id,
                round,
                outputs,
            } => Self::MultiAgentRoundCompleted {
                session_id,
                node_id: node_id.clone(),
                round: *round,
                outputs: outputs.clone(),
            },

            OrchestratorEvent::MultiAgentConverged {
                node_id,
                reason,
                final_result,
            } => Self::MultiAgentConverged {
                session_id,
                node_id: node_id.clone(),
                reason: reason.clone(),
                final_result: final_result.clone(),
            },

            OrchestratorEvent::MultiAgentError {
                node_id,
                agent_id,
                error,
            } => Self::MultiAgentError {
                session_id,
                node_id: node_id.clone(),
                agent_id: agent_id.clone(),
                error: error.clone(),
            },

            // 其他事件（Agent/Supervisor/Router/ToT/GoT/Plan/Reflection/Memory）暂不映射
            _ => return None,
        })
    }
}

// ─── MultiAgentTauriEventListener ────────────────────────────────────────────

/// 把 `OrchestratorEvent` 转为 `MultiAgentEventPayload` 并通过 `app.emit` 推送到前端
///
/// 每个 `MultiAgentNode` 实例对应一个监听器，在 `cmd_multi_agent_create` 时
/// 通过 `entry.subscribe(Arc::new(...))` 注入到 `EventBroadcaster`。
///
/// # 设计
/// - `app: AppHandle`：可克隆，跨任务安全
/// - `session_id: String`：用于事件名和 payload 中的 session_id 字段
/// - **无 message_id**：与 Supervisor 监听器一致，事件本身是编排层级的
///
/// # 锁竞争
/// `EventBroadcaster` 用 `tokio::sync::RwLock`，`MultiAgentEmitter::emit` 用 `try_read`
/// 避免阻塞节点执行。本监听器在 `on_event` 同步方法中只做 `app.emit`，不涉及 RwLock。
struct MultiAgentTauriEventListener {
    /// Tauri 应用句柄
    app: AppHandle,
    /// 会话 ID
    session_id: String,
}

impl EventListener for MultiAgentTauriEventListener {
    fn on_event(&self, event: &OrchestratorEvent) {
        let Some(payload) = MultiAgentEventPayload::from_orchestrator_event(event, &self.session_id)
        else {
            // 未映射的事件直接丢弃（如基础 Agent 事件、Supervisor 事件等）
            return;
        };

        let event_name = session_event_name(&self.session_id);
        match self.app.emit(&event_name, &payload) {
            Ok(()) => {
                debug!(
                    "multi_agent event emitted: session={} event={}",
                    self.session_id, event_name
                );
            }
            Err(e) => {
                warn!(
                    "multi_agent event emit 失败: session={} err={}",
                    self.session_id, e
                );
            }
        }
    }
}

// ─── 命令参数与返回类型 ────────────────────────────────────────────

/// `cmd_multi_agent_create` 的可选配置
///
/// 包装 `MultiAgentConfig`，让前端通过 camelCase 字段传递，
/// 内部转换为 Rust 端 snake_case 字段。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMultiAgentOptions {
    /// 最大协作轮次（默认 10）
    #[serde(default)]
    pub max_rounds: Option<usize>,
    /// 单轮最大并发 Agent 数（默认 5）
    #[serde(default)]
    pub max_concurrency: Option<usize>,
    /// 拓扑结构（默认 Mesh）
    ///
    /// 前端传递格式（serde tag = "kind"）：
    /// - `{"kind":"mesh"}`
    /// - `{"kind":"ring"}`
    /// - `{"kind":"star","hub_id":"agent1"}`
    /// - `{"kind":"pipeline"}`
    /// - `{"kind":"custom","peers":{"agent1":["agent2"],"agent2":["agent1"]}}`
    #[serde(default)]
    pub topology: Option<Topology>,
    /// 是否启用共享黑板（默认 true）
    #[serde(default)]
    pub blackboard_enabled: Option<bool>,
    /// 是否启用消息传递（默认 true）
    #[serde(default)]
    pub message_passing_enabled: Option<bool>,
    /// 收敛策略（默认 Hybrid: goal_check + max_rounds=10）
    #[serde(default)]
    pub convergence_strategy: Option<ConvergenceStrategy>,
    /// mpsc 通道容量（默认 32）
    #[serde(default)]
    pub channel_capacity: Option<usize>,
    /// 子 Agent 共享的 AgentLoop 配置
    #[serde(default)]
    pub agent_loop_config: Option<AgentLoopConfigOptions>,
    /// 是否在最后综合所有 Agent 输出（默认 true）
    #[serde(default)]
    pub require_synthesis: Option<bool>,
    /// 自定义综合提示词模板（None=用默认 LlmSynthesisStrategy 模板）
    #[serde(default)]
    pub synthesis_prompt_template: Option<PromptTemplateOptions>,
    /// 自定义目标检查提示词模板（None=用默认 LlmGoalCheckStrategyMA 模板）
    #[serde(default)]
    pub goal_check_prompt_template: Option<PromptTemplateOptions>,
}

impl Default for CreateMultiAgentOptions {
    fn default() -> Self {
        Self {
            max_rounds: None,
            max_concurrency: None,
            topology: None,
            blackboard_enabled: None,
            message_passing_enabled: None,
            convergence_strategy: None,
            channel_capacity: None,
            agent_loop_config: None,
            require_synthesis: None,
            synthesis_prompt_template: None,
            goal_check_prompt_template: None,
        }
    }
}

/// AgentLoopConfig 的可选配置（与 `commands::supervisor::AgentLoopConfigOptions` 字段对齐）
///
/// 复用相同字段集，但作为独立类型避免跨模块依赖。
/// 未提供者使用 `AgentLoopConfig::default()` 保守策略。
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoopConfigOptions {
    /// 系统提示词
    #[serde(default)]
    pub system_prompt: Option<String>,
    /// 最大迭代次数（默认 25）
    #[serde(default)]
    pub max_iterations: Option<u32>,
    /// 温度
    #[serde(default)]
    pub temperature: Option<f32>,
    /// 最大输出 token
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// 是否并行执行工具调用
    #[serde(default)]
    pub parallel_tool_calls: Option<bool>,
    /// 思考级别
    #[serde(default)]
    pub thinking_level: Option<agent_runtime::backend::ThinkingLevel>,
    // ─── Loop Engineering 参数 ───
    #[serde(default)]
    pub llm_max_retries: Option<u32>,
    #[serde(default)]
    pub llm_retry_base_delay_ms: Option<u64>,
    #[serde(default)]
    pub llm_timeout_ms: Option<u64>,
    #[serde(default)]
    pub tool_max_retries: Option<u32>,
    #[serde(default)]
    pub tool_retry_base_delay_ms: Option<u64>,
    #[serde(default)]
    pub tool_timeout_ms: Option<u64>,
    #[serde(default)]
    pub min_interval_between_calls_ms: Option<u64>,
}

/// 提示词模板（综合策略 / 目标检查策略共用）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplateOptions {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{task}` / `{outputs}` 等占位符）
    pub user_template: String,
}

/// `cmd_multi_agent_run` 的返回结果
///
/// 序列化为前端 JSON，包含节点执行状态、错误信息、摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentRunResult {
    /// 节点执行状态
    pub status: String,
    /// 下一节点 ID（阶段 2.3 暂不使用，预留）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_node_id: Option<String>,
    /// 错误信息（status=error 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 摘要（如 "Multi-Agent: 3 个 Agent 协作 5 轮完成"）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

impl From<NodeResult> for MultiAgentRunResult {
    fn from(r: NodeResult) -> Self {
        let status = match r.status {
            NodeStatus::Continue => "continue",
            NodeStatus::Done => "done",
            NodeStatus::Aborted => "aborted",
            NodeStatus::Error => "error",
        };
        Self {
            status: status.to_string(),
            next_node_id: r.next_node_id,
            error: r.error,
            summary: r.summary,
        }
    }
}

// ─── Tauri 命令 ────────────────────────────────────────────

/// 创建 Multi-Agent 实例并注册到 registry
///
/// # 参数
/// - `session_id`：会话 ID（前端生成）
/// - `provider_config`：LLM Provider 配置（共享给所有子 Agent）
/// - `specs`：Agent 规格列表（定义参与协作的 Agent 角色、提示词等）
/// - `options`：可选 Multi-Agent 配置
///
/// # 行为
/// 1. 创建 `GenaiBackend`（持有 provider_config）
/// 2. 创建 `SimpleToolBus` + `FrontendToolBridge`，注册 native + frontend 工具
/// 3. 创建 `MultiAgentNode`（默认 LlmSynthesisStrategy + LlmGoalCheckStrategyMA，
///    或自定义提示词模板）
/// 4. 创建 `MultiAgentEntry`（含共享 state / abort_flag / broadcaster）
/// 5. 注册到 `MultiAgentRegistry`
/// 6. 创建 `MultiAgentTauriEventListener` 并订阅 broadcaster
///
/// # 错误
/// - `AlreadyExists`：session_id 已存在
/// - `MultiAgentError`：specs 为空或其他配置错误
#[tauri::command]
pub async fn cmd_multi_agent_create(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    provider_config: ProviderConfig,
    specs: Vec<AgentSpec>,
    options: Option<CreateMultiAgentOptions>,
) -> Result<(), MultiAgentRegistryError> {
    let options = options.unwrap_or_default();

    info!(
        "cmd_multi_agent_create: session={} provider_mode={:?} model={} specs_count={}",
        session_id,
        std::mem::discriminant(&provider_config),
        provider_config.model_id(),
        specs.len(),
    );

    if specs.is_empty() {
        return Err(MultiAgentRegistryError::MultiAgentError {
            message: "Agent 规格列表不能为空".into(),
        });
    }

    // 1. 创建 backend + tool_bus
    let backend = Arc::new(GenaiBackend::new(provider_config));
    let tool_bus: Arc<dyn agent_runtime::tool::ToolBus> = Arc::new(SimpleToolBus::new());

    // 2. 创建 FrontendToolBridge（与子 Agent 共享）
    let tool_bridge = Arc::new(FrontendToolBridge::new(app.clone(), session_id.clone()));

    // 3. 注册 native + frontend 工具（与 cmd_agent_create 一致）
    crate::agent_bridge::register_default_tools(&tool_bus, &tool_bridge).await;

    // 4. 构造 MultiAgentConfig
    let config = build_multi_agent_config(&options);

    // 5. 创建 MultiAgentNode
    let multi_agent = if options.synthesis_prompt_template.is_some()
        || options.goal_check_prompt_template.is_some()
    {
        // 自定义提示词模板：使用 with_strategies
        let synthesis_strategy: Arc<dyn SynthesisStrategy> =
            if let Some(tpl_opts) = &options.synthesis_prompt_template {
                Arc::new(LlmSynthesisStrategy::with_template(SynthesisPromptTemplate {
                    system: tpl_opts.system.clone(),
                    user_template: tpl_opts.user_template.clone(),
                }))
            } else {
                Arc::new(LlmSynthesisStrategy::new())
            };

        let goal_check_strategy = if let Some(tpl_opts) = &options.goal_check_prompt_template {
            Arc::new(LlmGoalCheckStrategyMA::with_template(GoalCheckMAPromptTemplate {
                system: tpl_opts.system.clone(),
                user_template: tpl_opts.user_template.clone(),
            }))
        } else {
            Arc::new(LlmGoalCheckStrategyMA::new())
        };

        Arc::new(MultiAgentNode::with_strategies(
            "multi_agent",
            "MultiAgent",
            specs,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus.clone(),
            config,
            synthesis_strategy,
            goal_check_strategy,
        ))
    } else {
        // 默认策略
        Arc::new(MultiAgentNode::new(
            "multi_agent",
            "MultiAgent",
            specs,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus.clone(),
            config,
        ))
    };

    // 6. 创建 MultiAgentEntry（含初始空 state）
    let initial_state = OrchestratorState::new(String::new());
    let entry = MultiAgentEntry::new(
        multi_agent,
        Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
        tool_bus.clone(),
        tool_bridge,
        initial_state,
    );

    // 7. 注册到 registry
    state
        .ma_registry
        .register(session_id.clone(), entry)
        .await?;

    // 8. 取出 entry，订阅 TauriEventListener
    let entry_after = state.ma_registry.get(&session_id).await?;
    let listener = Arc::new(MultiAgentTauriEventListener {
        app: app.clone(),
        session_id: session_id.clone(),
    });
    entry_after.subscribe(listener).await;

    info!(
        "cmd_multi_agent_create: 成功创建 multi_agent session={}",
        session_id
    );
    Ok(())
}

/// 提交任务并执行 Multi-Agent 协作
///
/// # 参数
/// - `session_id`：会话 ID
/// - `task`：用户任务文本
///
/// # 行为
/// 1. 获取 entry（含 multi_agent / state / abort_flag / backend / tool_bridge）
/// 2. 重置 abort_flag = false（新一轮 run）
/// 3. 获取 state 写锁，更新 `state.input = task`
/// 4. 构造 NodeContext（注入 MultiAgentAbortCheck + MultiAgentEmitter + backend + state）
/// 5. 调用 `multi_agent.execute(ctx)` 执行多轮协作
/// 6. 返回 `MultiAgentRunResult`（含 status / summary / error）
///
/// # 事件流
/// 期间通过 `app.emit("multi_agent:event:{session_id}", ...)` 推送：
/// - `MultiAgentRoundStarted` / `MultiAgentRoundCompleted`（每轮开始/结束）
/// - `MultiAgentMessageSent`（Agent 间消息传递）
/// - `MultiAgentBlackboardUpdated`（黑板写入）
/// - `MultiAgentConverged`（协作收敛）
/// - `MultiAgentError`（失败时）
///
/// # 错误
/// - `NotFound`：session 不存在
/// - `MultiAgentError`：执行过程中错误
#[tauri::command]
pub async fn cmd_multi_agent_run(
    state: State<'_, AppState>,
    session_id: String,
    task: String,
) -> Result<MultiAgentRunResult, MultiAgentRegistryError> {
    debug!(
        "cmd_multi_agent_run: session={} task_len={}",
        session_id,
        task.len()
    );

    // 获取 entry
    let entry = state.ma_registry.get(&session_id).await?;

    // 重置中断标志
    entry.reset_abort();

    // 取出 backend 与 multi_agent 的 Arc 引用（避免在 await 期间持有 entry 的借用）
    let backend = entry.backend.clone();
    let multi_agent = entry.multi_agent.clone();

    // 获取 state 写锁（execute 期间独占）
    // 注意：必须在构造 NodeContext 之前获取，且持有至 execute 完成
    let mut state_guard = entry.state.write().await;
    state_guard.input = task.clone();

    // 构造适配器
    let abort_check = MultiAgentAbortCheck::new(entry.abort_flag.clone());
    let emitter = MultiAgentEmitter::new(entry.broadcaster.clone());

    // 构造 NodeContext 并执行
    // 注意：NodeContext 持有 state_guard 的借用，需在 state_guard 释放前完成 execute
    let ctx = NodeContext {
        state: &mut *state_guard,
        backend: &*backend,
        memory: None, // 阶段 2.3 不注入 memory，MultiAgentNode 应优雅降级
        emitter: &emitter,
        abort_check: &abort_check,
    };

    let result = multi_agent.execute(ctx).await;

    debug!(
        "cmd_multi_agent_run: session={} status={:?}",
        session_id, result.status
    );

    Ok(MultiAgentRunResult::from(result))
}

/// 中断当前运行
///
/// 设置 `abort_flag = true`，MultiAgentNode 在下次中断检查点（每轮开始/收敛检查）命中
/// 并返回 `NodeResult::aborted()`。
///
/// # 注意
/// 中断是**协作式**的：依赖 MultiAgentNode 主动检查 `ctx.is_aborted()`。
/// 若子 Agent 正在执行 `agent.run(...)`，需子 Agent 自身的 abort 机制生效
/// （阶段 2.3 不向下传播 abort，子 Agent 会执行到自然结束）。
#[tauri::command]
pub async fn cmd_multi_agent_abort(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), MultiAgentRegistryError> {
    state.ma_registry.abort(&session_id).await?;
    info!("cmd_multi_agent_abort: session={}", session_id);
    Ok(())
}

/// 销毁 Multi-Agent 实例
///
/// 1. 调用 `tool_bridge.abort_all()` 取消所有 pending 工具调用
/// 2. 从 registry 移除
#[tauri::command]
pub async fn cmd_multi_agent_destroy(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), MultiAgentRegistryError> {
    // 先取 entry，abort 所有 pending 工具调用
    let entry = state.ma_registry.get(&session_id).await?;
    entry.tool_bridge.abort_all().await;

    // 从 registry 移除
    state.ma_registry.remove(&session_id).await?;
    info!(
        "cmd_multi_agent_destroy: 已销毁 multi_agent session={}",
        session_id
    );
    Ok(())
}

/// 获取共享 OrchestratorState 快照
///
/// 用于前端展示当前任务进度、消息历史、协作结果等。
/// 返回完整 state 的 JSON 序列化（OrchestratorState 已派生 Serialize）。
#[tauri::command]
pub async fn cmd_multi_agent_get_state(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<OrchestratorState, MultiAgentRegistryError> {
    let entry = state.ma_registry.get(&session_id).await?;
    let state_snapshot = entry.state.read().await.clone();
    Ok(state_snapshot)
}

/// 写回 OrchestratorState（用于断点恢复）
///
/// # 注意
/// 此命令会覆盖整个 state，调用方需确保传入完整 state（不可部分更新）。
/// 持久化场景：前端通过 `cmd_multi_agent_get_state` 拿快照 → 序列化保存 →
/// 恢复时反序列化 → 通过本命令写回。
#[tauri::command]
pub async fn cmd_multi_agent_set_state(
    state: State<'_, AppState>,
    session_id: String,
    new_state: OrchestratorState,
) -> Result<(), MultiAgentRegistryError> {
    let entry = state.ma_registry.get(&session_id).await?;
    let mut state_guard = entry.state.write().await;
    *state_guard = new_state;
    Ok(())
}

/// 列出所有已注册的 Multi-Agent session_id
#[tauri::command]
pub async fn cmd_multi_agent_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<String>, MultiAgentRegistryError> {
    Ok(state.ma_registry.list().await)
}

/// 获取最后一次 execute 的黑板快照
///
/// 返回 `Option<SharedBlackboard>`：
/// - `Some(bb)`：已执行过 execute，返回最后一次的黑板快照
/// - `None`：尚未执行 execute
///
/// 前端可据此展示：
/// - 原始任务（`bb.task`）
/// - 共享上下文 KV（`bb.shared_context`）
/// - 各 Agent 输出历史（`bb.agent_outputs`）
/// - 最终综合结果（`bb.final_result`）
/// - 完成轮次（`bb.rounds_completed`）
#[tauri::command]
pub async fn cmd_multi_agent_get_blackboard(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SharedBlackboard>, MultiAgentRegistryError> {
    let entry = state.ma_registry.get(&session_id).await?;
    let blackboard = entry.last_blackboard().await;
    Ok(blackboard)
}

// ─── 辅助函数 ────────────────────────────────────────────

/// 从 `CreateMultiAgentOptions` 构造 `MultiAgentConfig`
///
/// 未提供的字段使用 `MultiAgentConfig::default()` 保守策略。
/// `agent_loop_config` 字段按 `AgentLoopConfigOptions` 转换。
fn build_multi_agent_config(options: &CreateMultiAgentOptions) -> MultiAgentConfig {
    let mut config = MultiAgentConfig::default();

    if let Some(max_rounds) = options.max_rounds {
        config.max_rounds = max_rounds;
    }
    if let Some(max_concurrency) = options.max_concurrency {
        config.max_concurrency = max_concurrency;
    }
    if let Some(topology) = options.topology.clone() {
        config.topology = topology;
    }
    if let Some(blackboard_enabled) = options.blackboard_enabled {
        config.blackboard_enabled = blackboard_enabled;
    }
    if let Some(message_passing_enabled) = options.message_passing_enabled {
        config.message_passing_enabled = message_passing_enabled;
    }
    if let Some(convergence_strategy) = options.convergence_strategy.clone() {
        config.convergence_strategy = convergence_strategy;
    }
    if let Some(channel_capacity) = options.channel_capacity {
        config.channel_capacity = channel_capacity;
    }
    if let Some(loop_opts) = &options.agent_loop_config {
        config.agent_loop_config = build_agent_loop_config(loop_opts);
    }
    if let Some(require_synthesis) = options.require_synthesis {
        config.require_synthesis = require_synthesis;
    }

    config
}

/// 从 `AgentLoopConfigOptions` 构造 `agent_runtime::AgentLoopConfig`
///
/// 与 `commands::supervisor::build_agent_loop_config` 逻辑对齐，
/// 未提供者使用 `AgentLoopConfig::default()` 保守策略。
fn build_agent_loop_config(opts: &AgentLoopConfigOptions) -> agent_runtime::AgentLoopConfig {
    agent_runtime::AgentLoopConfig {
        max_iterations: opts.max_iterations.unwrap_or(25),
        system_prompt: opts.system_prompt.clone(),
        temperature: opts.temperature,
        max_tokens: opts.max_tokens,
        parallel_tool_calls: opts.parallel_tool_calls.unwrap_or(false),
        thinking_level: opts.thinking_level,
        llm_max_retries: opts.llm_max_retries.unwrap_or(3),
        llm_retry_base_delay: Duration::from_millis(opts.llm_retry_base_delay_ms.unwrap_or(1000)),
        llm_timeout: opts
            .llm_timeout_ms
            .map(Duration::from_millis)
            .or_else(|| Some(Duration::from_secs(300))),
        tool_max_retries: opts.tool_max_retries.unwrap_or(0),
        tool_retry_base_delay: Duration::from_millis(opts.tool_retry_base_delay_ms.unwrap_or(1000)),
        tool_timeout: opts.tool_timeout_ms.map(Duration::from_millis),
        min_interval_between_calls: opts
            .min_interval_between_calls_ms
            .map(Duration::from_millis),
    }
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_event_name_should_format_correctly() {
        let name = session_event_name("ma_abc");
        assert_eq!(name, "multi_agent:event:ma_abc");
    }

    #[test]
    fn event_name_prefix_should_be_constant() {
        assert_eq!(event_name_prefix(), "multi_agent:event:");
    }

    #[test]
    fn payload_round_started_should_serialize_to_snake_case() {
        let payload = MultiAgentEventPayload::MultiAgentRoundStarted {
            session_id: "ma_1".into(),
            node_id: "multi_agent".into(),
            round: 3,
            agent_count: 5,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"multi_agent_round_started\""));
        assert!(json.contains("\"session_id\":\"ma_1\""));
        assert!(json.contains("\"node_id\":\"multi_agent\""));
        assert!(json.contains("\"round\":3"));
        assert!(json.contains("\"agent_count\":5"));
    }

    #[test]
    fn payload_message_sent_should_serialize_fields() {
        let payload = MultiAgentEventPayload::MultiAgentMessageSent {
            session_id: "ma_1".into(),
            node_id: "multi_agent".into(),
            from: "agent_a".into(),
            to: "agent_b".into(),
            message_type: "task".into(),
            content_preview: "请分析需求".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"multi_agent_message_sent\""));
        assert!(json.contains("\"from\":\"agent_a\""));
        assert!(json.contains("\"to\":\"agent_b\""));
        assert!(json.contains("\"message_type\":\"task\""));
        assert!(json.contains("\"content_preview\":\"请分析需求\""));
    }

    #[test]
    fn payload_blackboard_updated_should_serialize_key_and_by() {
        let payload = MultiAgentEventPayload::MultiAgentBlackboardUpdated {
            session_id: "ma_1".into(),
            node_id: "multi_agent".into(),
            key: "agent_output:agent_a".into(),
            by: "agent_a".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"multi_agent_blackboard_updated\""));
        assert!(json.contains("\"key\":\"agent_output:agent_a\""));
        assert!(json.contains("\"by\":\"agent_a\""));
    }

    #[test]
    fn payload_round_completed_should_serialize_outputs_array() {
        let payload = MultiAgentEventPayload::MultiAgentRoundCompleted {
            session_id: "ma_1".into(),
            node_id: "multi_agent".into(),
            round: 2,
            outputs: vec!["输出1".into(), "输出2".into()],
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"multi_agent_round_completed\""));
        assert!(json.contains("\"round\":2"));
        assert!(json.contains("\"outputs\":[\"输出1\",\"输出2\"]"));
    }

    #[test]
    fn payload_converged_should_serialize_reason_and_final_result() {
        let payload = MultiAgentEventPayload::MultiAgentConverged {
            session_id: "ma_1".into(),
            node_id: "multi_agent".into(),
            reason: "GoalReached".into(),
            final_result: "最终答案".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"multi_agent_converged\""));
        assert!(json.contains("\"reason\":\"GoalReached\""));
        assert!(json.contains("\"final_result\":\"最终答案\""));
    }

    #[test]
    fn payload_error_should_serialize_agent_id_and_error() {
        let payload = MultiAgentEventPayload::MultiAgentError {
            session_id: "ma_1".into(),
            node_id: "multi_agent".into(),
            agent_id: "agent_b".into(),
            error: "LLM 调用失败".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"multi_agent_error\""));
        assert!(json.contains("\"agent_id\":\"agent_b\""));
        assert!(json.contains("\"error\":\"LLM 调用失败\""));
    }

    #[test]
    fn from_orchestrator_event_should_map_multi_agent_variants() {
        let event = OrchestratorEvent::MultiAgentRoundStarted {
            node_id: "multi_agent".into(),
            round: 1,
            agent_count: 3,
        };
        let payload = MultiAgentEventPayload::from_orchestrator_event(&event, "ma_1");
        assert!(payload.is_some());
        match payload.unwrap() {
            MultiAgentEventPayload::MultiAgentRoundStarted { round, agent_count, .. } => {
                assert_eq!(round, 1);
                assert_eq!(agent_count, 3);
            }
            _ => panic!("应转换为 MultiAgentRoundStarted"),
        }
    }

    #[test]
    fn from_orchestrator_event_should_skip_unmapped_variants() {
        // PlanCreated 事件不在 Multi-Agent 处理范围
        let event = OrchestratorEvent::PlanCreated { items: Vec::new() };
        let payload = MultiAgentEventPayload::from_orchestrator_event(&event, "ma_1");
        assert!(payload.is_none());
    }

    #[test]
    fn from_orchestrator_event_should_skip_supervisor_event() {
        let event = OrchestratorEvent::SupervisorTaskAssigned {
            node_id: "sup".into(),
            sub_agent_id: "coder".into(),
            sub_agent_name: "代码专家".into(),
            task_description: "写函数".into(),
            reasoning: None,
        };
        let payload = MultiAgentEventPayload::from_orchestrator_event(&event, "ma_1");
        assert!(payload.is_none());
    }

    #[test]
    fn run_result_from_done_should_serialize_status_string() {
        let result = NodeResult {
            status: NodeStatus::Done,
            next_node_id: None,
            error: None,
            summary: Some("协作完成".into()),
        };
        let s = MultiAgentRunResult::from(result);
        assert_eq!(s.status, "done");
        assert_eq!(s.summary.as_deref(), Some("协作完成"));
    }

    #[test]
    fn run_result_from_error_should_include_error_message() {
        let result = NodeResult::error("执行失败");
        let s = MultiAgentRunResult::from(result);
        assert_eq!(s.status, "error");
        assert_eq!(s.error.as_deref(), Some("执行失败"));
    }

    #[test]
    fn build_multi_agent_config_should_use_defaults_when_none() {
        let options = CreateMultiAgentOptions::default();
        let config = build_multi_agent_config(&options);
        assert_eq!(config.max_rounds, 10);
        assert_eq!(config.max_concurrency, 5);
        assert!(config.blackboard_enabled);
        assert!(config.message_passing_enabled);
        assert_eq!(config.channel_capacity, 32);
        assert!(config.require_synthesis);
    }

    #[test]
    fn build_multi_agent_config_should_override_when_some() {
        let options = CreateMultiAgentOptions {
            max_rounds: Some(20),
            max_concurrency: Some(10),
            topology: Some(Topology::Ring),
            blackboard_enabled: Some(false),
            message_passing_enabled: Some(false),
            convergence_strategy: Some(ConvergenceStrategy::MaxRounds),
            channel_capacity: Some(64),
            agent_loop_config: Some(AgentLoopConfigOptions {
                max_iterations: Some(50),
                llm_timeout_ms: Some(600_000),
                ..Default::default()
            }),
            require_synthesis: Some(false),
            synthesis_prompt_template: None,
            goal_check_prompt_template: None,
        };
        let config = build_multi_agent_config(&options);
        assert_eq!(config.max_rounds, 20);
        assert_eq!(config.max_concurrency, 10);
        assert!(matches!(config.topology, Topology::Ring));
        assert!(!config.blackboard_enabled);
        assert!(!config.message_passing_enabled);
        assert!(matches!(
            config.convergence_strategy,
            ConvergenceStrategy::MaxRounds
        ));
        assert_eq!(config.channel_capacity, 64);
        assert!(!config.require_synthesis);
        assert_eq!(config.agent_loop_config.max_iterations, 50);
        assert_eq!(
            config.agent_loop_config.llm_timeout,
            Some(Duration::from_secs(600))
        );
    }
}
