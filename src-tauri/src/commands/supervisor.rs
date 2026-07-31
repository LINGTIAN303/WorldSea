//! # Supervisor 命令层 — Tauri 命令封装
//!
//! 阶段 2.1 新增。本模块把 `agent_runtime::supervisor::SupervisorNode` 的能力
//! 通过 Tauri 命令暴露给前端，与 `commands::agent` 并列存在。
//!
//! ## 命令一览
//! | 命令 | 说明 |
//! |------|------|
//! | `cmd_supervisor_create`            | 创建 SupervisorNode 实例并注册 |
//! | `cmd_supervisor_run`               | 提交任务，触发 Supervisor 执行（任务分配 → 子 Agent run → 收集输出） |
//! | `cmd_supervisor_abort`             | 中断当前运行（设置 abort_flag，NodeContext.is_aborted() 命中） |
//! | `cmd_supervisor_destroy`           | 销毁实例（abort_all tool_bridge + 移除注册） |
//! | `cmd_supervisor_get_state`         | 获取共享 OrchestratorState 快照 |
//! | `cmd_supervisor_set_state`         | 写回 state（用于断点恢复） |
//! | `cmd_supervisor_list_sessions`     | 列出所有已注册的 Supervisor session_id |
//! | `cmd_supervisor_clear_agent_pool`  | 清空子 Agent 实例池（reset 场景） |
//!
//! ## 事件流
//! 事件通过 `app.emit("supervisor:event:{session_id}", SupervisorEventPayload)` 推送，
//! 前端通过 `listen("supervisor:event:" + sessionId, handler)` 监听。
//!
//! Supervisor 执行期间触发的事件序列（成功路径）：
//!   `SupervisorTaskAssigned` → `SubAgentStarted` → `SubAgentCompleted`
//!
//! 失败路径：
//!   - 任务分配失败：`SupervisorError` (stage="assign")
//!   - 子 Agent 执行失败：`SubAgentError`
//!   - spec 查找失败：`SupervisorError` (stage="spec_lookup")
//!
//! ## 与 Agent 命令层的差异
//! - **独立 Registry**：SupervisorNode 不是 AgentLoop，使用 `SupervisorRegistry` 独立管理
//! - **独立事件名**：`supervisor:event:*` vs `agent:event:*`，前端可分别订阅
//! - **共享 state**：通过 `Arc<RwLock<OrchestratorState>>` 跨命令访问
//! - **共享 backend/tool_bus**：SupervisorNode 内部子 Agent 共用同一 backend 与 tool_bus
//! - **无 message_id 轮换**：Supervisor 事件不含 message_id（与流式事件无关），无需轮换

use std::sync::Arc;
use std::time::Duration;

use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventListener, OrchestratorEvent};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::node::{NodeContext, NodeResult, NodeStatus, OrchestratorNode};
use agent_runtime::supervisor::{
    AssignmentPromptTemplate, LlmAssignmentStrategy, SubAgentSpec, SupervisorConfig,
    SupervisorNode,
};
use agent_runtime::tool::SimpleToolBus;
use agent_runtime::types::OrchestratorState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, info, warn};

use crate::agent_bridge::supervisor_registry::{
    SupervisorAbortCheck, SupervisorEmitter, SupervisorEntry, SupervisorRegistryError,
};
use crate::agent_bridge::tool_bridge::FrontendToolBridge;
use crate::state::AppState;

// ─── 事件名约定 ────────────────────────────────────────────

/// Supervisor 会话事件名前缀
///
/// 完整事件名：`supervisor:event:{session_id}`
/// 前端：`listen(\`supervisor:event:${sessionId}\`, ...)`
const fn event_name_prefix() -> &'static str {
    "supervisor:event:"
}

/// 构造单个 session 的事件名
fn session_event_name(session_id: &str) -> String {
    format!("{}{}", event_name_prefix(), session_id)
}

// ─── Supervisor 事件 Payload ────────────────────────────────────────────

/// Supervisor 事件 Payload — 前端友好的扁平化事件结构
///
/// 与 `AgentEventPayload` 并列存在。处理 `OrchestratorEvent` 中
/// Supervisor 相关变体（SupervisorTaskAssigned / SubAgentStarted 等），
/// 其他事件（基础 Agent 事件、Plan/Reflection 事件）暂不映射（返回 None）。
///
/// ## 序列化
/// 使用 `#[serde(tag = "type")]` 内部标签模式，匹配前端 discriminated union：
/// ```json
/// {"type":"supervisor_task_assigned","node_id":"sup","sub_agent_id":"coder",...}
/// ```
///
/// 注意：`#[serde(tag = "type", rename_all = "snake_case")]` 只对变体名重命名，
/// 变体内部字段保持 Rust 原生 snake_case（与前端 `RustSupervisorEventPayload` 类型一致）。
/// 前端通过 `rustEventToTsEvent` 转换为 camelCase 供 UI 使用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SupervisorEventPayload {
    /// Supervisor 任务分配完成
    SupervisorTaskAssigned {
        session_id: String,
        node_id: String,
        sub_agent_id: String,
        sub_agent_name: String,
        task_description: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
    },
    /// 子 Agent 开始执行
    SubAgentStarted {
        session_id: String,
        node_id: String,
        sub_agent_id: String,
        sub_agent_name: String,
        task_description: String,
    },
    /// 子 Agent 执行完成
    SubAgentCompleted {
        session_id: String,
        node_id: String,
        sub_agent_id: String,
        sub_agent_name: String,
        output_chars: usize,
        duration_ms: u64,
    },
    /// 子 Agent 执行失败
    SubAgentError {
        session_id: String,
        node_id: String,
        sub_agent_id: String,
        sub_agent_name: String,
        error: String,
    },
    /// Supervisor 任务分配阶段失败
    SupervisorError {
        session_id: String,
        node_id: String,
        stage: String,
        error: String,
    },
}

impl SupervisorEventPayload {
    /// 从 `OrchestratorEvent` 转换为前端 Payload
    ///
    /// 只处理 Supervisor 相关变体，其他变体返回 `None`。
    /// `session_id` 由外部注入（Rust 端事件不携带 session_id）。
    pub fn from_orchestrator_event(
        event: &OrchestratorEvent,
        session_id: &str,
    ) -> Option<Self> {
        let session_id = session_id.to_string();
        Some(match event {
            OrchestratorEvent::SupervisorTaskAssigned {
                node_id,
                sub_agent_id,
                sub_agent_name,
                task_description,
                reasoning,
            } => Self::SupervisorTaskAssigned {
                session_id,
                node_id: node_id.clone(),
                sub_agent_id: sub_agent_id.clone(),
                sub_agent_name: sub_agent_name.clone(),
                task_description: task_description.clone(),
                reasoning: reasoning.clone(),
            },

            OrchestratorEvent::SubAgentStarted {
                node_id,
                sub_agent_id,
                sub_agent_name,
                task_description,
            } => Self::SubAgentStarted {
                session_id,
                node_id: node_id.clone(),
                sub_agent_id: sub_agent_id.clone(),
                sub_agent_name: sub_agent_name.clone(),
                task_description: task_description.clone(),
            },

            OrchestratorEvent::SubAgentCompleted {
                node_id,
                sub_agent_id,
                sub_agent_name,
                output_chars,
                duration_ms,
            } => Self::SubAgentCompleted {
                session_id,
                node_id: node_id.clone(),
                sub_agent_id: sub_agent_id.clone(),
                sub_agent_name: sub_agent_name.clone(),
                output_chars: *output_chars,
                duration_ms: *duration_ms,
            },

            OrchestratorEvent::SubAgentError {
                node_id,
                sub_agent_id,
                sub_agent_name,
                error,
            } => Self::SubAgentError {
                session_id,
                node_id: node_id.clone(),
                sub_agent_id: sub_agent_id.clone(),
                sub_agent_name: sub_agent_name.clone(),
                error: error.clone(),
            },

            OrchestratorEvent::SupervisorError {
                node_id,
                stage,
                error,
            } => Self::SupervisorError {
                session_id,
                node_id: node_id.clone(),
                stage: stage.clone(),
                error: error.clone(),
            },

            // 其他事件（Agent/Plan/Reflection/Memory/WorkingMemory）暂不映射
            _ => return None,
        })
    }
}

// ─── SupervisorTauriEventListener ────────────────────────────────────────────

/// 把 `OrchestratorEvent` 转为 `SupervisorEventPayload` 并通过 `app.emit` 推送到前端
///
/// 每个 `SupervisorNode` 实例对应一个监听器，在 `cmd_supervisor_create` 时
/// 通过 `entry.subscribe(Arc::new(...))` 注入到 `EventBroadcaster`。
///
/// # 设计
/// - `app: AppHandle`：可克隆，跨任务安全
/// - `session_id: String`：用于事件名和 payload 中的 session_id 字段
/// - **无 message_id**：与 Agent 监听器不同，Supervisor 事件不含 message_id
///   （事件本身是编排层级的，不与流式 message 关联）
///
/// # 锁竞争
/// `EventBroadcaster` 用 `tokio::sync::RwLock`，`SupervisorEmitter::emit` 用 `try_read`
/// 避免阻塞节点执行。本监听器在 `on_event` 同步方法中只做 `app.emit`，不涉及 RwLock。
struct SupervisorTauriEventListener {
    /// Tauri 应用句柄
    app: AppHandle,
    /// 会话 ID
    session_id: String,
}

impl EventListener for SupervisorTauriEventListener {
    fn on_event(&self, event: &OrchestratorEvent) {
        let Some(payload) = SupervisorEventPayload::from_orchestrator_event(event, &self.session_id)
        else {
            // 未映射的事件直接丢弃（如基础 Agent 事件、Plan/Reflection 事件）
            return;
        };

        let event_name = session_event_name(&self.session_id);
        match self.app.emit(&event_name, &payload) {
            Ok(()) => {
                debug!(
                    "supervisor event emitted: session={} event={}",
                    self.session_id, event_name
                );
            }
            Err(e) => {
                warn!(
                    "supervisor event emit 失败: session={} err={}",
                    self.session_id, e
                );
            }
        }
    }
}

// ─── 命令参数与返回类型 ────────────────────────────────────────────

/// `cmd_supervisor_create` 的可选配置
///
/// 包装 `SupervisorConfig`，让前端通过 camelCase 字段传递，
/// 内部转换为 Rust 端 snake_case 字段。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSupervisorOptions {
    /// 最大协调轮次（默认 5）
    ///
    /// 注意：阶段 2.1 SupervisorNode::execute 只执行 1 轮，
    /// 多轮留待阶段 2.3 Multi-Agent 扩展。
    #[serde(default)]
    pub max_rounds: Option<u32>,
    /// 是否在最后汇总子 Agent 输出（生成 summary）
    #[serde(default)]
    pub require_summary: Option<bool>,
    /// 子 Agent 共享的 AgentLoop 配置（系统提示词/温度/最大 token 等）
    ///
    /// 注意：`system_prompt` 和 `max_iterations` 会被 `SubAgentSpec` 的对应字段覆盖。
    #[serde(default)]
    pub agent_loop_config: Option<AgentLoopConfigOptions>,
    /// 自定义任务分配提示词模板（None=用默认 LlmAssignmentStrategy 模板）
    #[serde(default)]
    pub assignment_prompt_template: Option<AssignmentPromptTemplateOptions>,
}

impl Default for CreateSupervisorOptions {
    fn default() -> Self {
        Self {
            max_rounds: None,
            require_summary: None,
            agent_loop_config: None,
            assignment_prompt_template: None,
        }
    }
}

/// AgentLoopConfig 的可选配置（与 `commands::agent::CreateAgentOptions` 字段对齐）
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

/// 任务分配提示词模板（自定义 LLM 决策提示词）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentPromptTemplateOptions {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{task}` 和 `{agents}` 占位符）
    pub user_template: String,
}

/// `cmd_supervisor_run` 的返回结果
///
/// 序列化为前端 JSON，包含节点执行状态、错误信息、摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorRunResult {
    /// 节点执行状态
    pub status: String,
    /// 下一节点 ID（阶段 2.1 暂不使用，预留）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_node_id: Option<String>,
    /// 错误信息（status=error 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 摘要（如 "Supervisor: 任务已由子 Agent 'X' 处理（输出 N 字符）"）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

impl From<NodeResult> for SupervisorRunResult {
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

/// 创建 Supervisor 实例并注册到 registry
///
/// # 参数
/// - `session_id`：会话 ID（前端生成）
/// - `provider_config`：LLM Provider 配置（共享给所有子 Agent）
/// - `specs`：子 Agent 规格列表
/// - `options`：可选 Supervisor 配置
///
/// # 行为
/// 1. 创建 `GenaiBackend`（持有 provider_config）
/// 2. 创建 `SimpleToolBus` + `FrontendToolBridge`，注册 native + frontend 工具
/// 3. 创建 `SupervisorNode`（默认 LlmAssignmentStrategy 或自定义提示词模板）
/// 4. 创建 `SupervisorEntry`（含共享 state / abort_flag / broadcaster）
/// 5. 注册到 `SupervisorRegistry`
/// 6. 创建 `SupervisorTauriEventListener` 并订阅 broadcaster
///
/// # 错误
/// - `AlreadyExists`：session_id 已存在
/// - `LockError`：registry 锁竞争失败
#[tauri::command]
pub async fn cmd_supervisor_create(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    provider_config: ProviderConfig,
    specs: Vec<SubAgentSpec>,
    options: Option<CreateSupervisorOptions>,
) -> Result<(), SupervisorRegistryError> {
    let options = options.unwrap_or_default();

    info!(
        "cmd_supervisor_create: session={} provider_mode={:?} model={} specs_count={}",
        session_id,
        std::mem::discriminant(&provider_config),
        provider_config.model_id(),
        specs.len(),
    );

    if specs.is_empty() {
        return Err(SupervisorRegistryError::SupervisorError {
            message: "子 Agent 规格列表不能为空".into(),
        });
    }

    // 1. 创建 backend + tool_bus
    let backend = Arc::new(GenaiBackend::new(provider_config));
    let tool_bus: Arc<dyn agent_runtime::tool::ToolBus> = Arc::new(SimpleToolBus::new());

    // 2. 创建 FrontendToolBridge（与子 Agent 共享）
    let tool_bridge = Arc::new(FrontendToolBridge::new(app.clone(), session_id.clone()));

    // 3. 注册 native + frontend 工具（与 cmd_agent_create 一致）
    crate::agent_bridge::register_default_tools(&tool_bus, &tool_bridge).await;

    // 4. 构造 SupervisorConfig
    let config = build_supervisor_config(&options);

    // 5. 创建 SupervisorNode
    let supervisor = if let Some(tpl_opts) = &options.assignment_prompt_template {
        // 自定义提示词模板
        let template = AssignmentPromptTemplate {
            system: tpl_opts.system.clone(),
            user_template: tpl_opts.user_template.clone(),
        };
        let strategy = Arc::new(LlmAssignmentStrategy::with_template(template));
        Arc::new(SupervisorNode::new(
            "supervisor",
            "Supervisor",
            specs,
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus.clone(),
            config,
        ))
    } else {
        // 默认 LLM 策略
        Arc::new(SupervisorNode::with_default_strategy(
            "supervisor",
            "Supervisor",
            specs,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus.clone(),
            config,
        ))
    };

    // 6. 创建 SupervisorEntry（含初始空 state）
    let initial_state = OrchestratorState::new(String::new());
    let entry = SupervisorEntry::new(
        supervisor,
        Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
        tool_bus.clone(),
        tool_bridge,
        initial_state,
    );

    // 7. 注册到 registry
    state
        .supervisor_registry
        .register(session_id.clone(), entry)
        .await?;

    // 8. 取出 entry，订阅 TauriEventListener
    let entry_after = state.supervisor_registry.get(&session_id).await?;
    let listener = Arc::new(SupervisorTauriEventListener {
        app: app.clone(),
        session_id: session_id.clone(),
    });
    entry_after.subscribe(listener).await;

    info!(
        "cmd_supervisor_create: 成功创建 supervisor session={}",
        session_id
    );
    Ok(())
}

/// 提交任务并执行 Supervisor 模式
///
/// # 参数
/// - `session_id`：会话 ID
/// - `task`：用户任务文本
///
/// # 行为
/// 1. 获取 entry（含 supervisor / state / abort_flag / backend / tool_bridge）
/// 2. 重置 abort_flag = false（新一轮 run）
/// 3. 获取 state 写锁，更新 `state.input = task`
/// 4. 构造 NodeContext（注入 SupervisorAbortCheck + SupervisorEmitter + backend + state）
/// 5. 调用 `supervisor.execute(ctx)` 执行任务分配 + 子 Agent run
/// 6. 返回 `SupervisorRunResult`（含 status / summary / error）
///
/// # 事件流
/// 期间通过 `app.emit("supervisor:event:{session_id}", ...)` 推送：
/// - `SupervisorTaskAssigned`（任务分配成功后）
/// - `SubAgentStarted` / `SubAgentCompleted`（子 Agent 执行前后）
/// - `SubAgentError` / `SupervisorError`（失败时）
///
/// # 错误
/// - `NotFound`：session 不存在
/// - `SupervisorError`：执行过程中错误（已通过事件推送，命令层只返回错误码）
#[tauri::command]
pub async fn cmd_supervisor_run(
    state: State<'_, AppState>,
    session_id: String,
    task: String,
) -> Result<SupervisorRunResult, SupervisorRegistryError> {
    debug!(
        "cmd_supervisor_run: session={} task_len={}",
        session_id,
        task.len()
    );

    // 获取 entry
    let entry = state.supervisor_registry.get(&session_id).await?;

    // 重置中断标志
    entry.reset_abort();

    // 取出 backend 与 supervisor 的 Arc 引用（避免在 await 期间持有 entry 的借用）
    let backend = entry.backend.clone();
    let supervisor = entry.supervisor.clone();

    // 获取 state 写锁（execute 期间独占）
    // 注意：必须在构造 NodeContext 之前获取，且持有至 execute 完成
    let mut state_guard = entry.state.write().await;
    state_guard.input = task.clone();

    // 构造适配器
    let abort_check = SupervisorAbortCheck::new(entry.abort_flag.clone());
    let emitter = SupervisorEmitter::new(entry.broadcaster.clone());

    // 构造 NodeContext 并执行
    // 注意：NodeContext 持有 state_guard 的借用，需在 state_guard 释放前完成 execute
    let ctx = NodeContext {
        state: &mut *state_guard,
        backend: &*backend,
        memory: None, // 阶段 2.1 不注入 memory，SupervisorNode 应优雅降级
        emitter: &emitter,
        abort_check: &abort_check,
    };

    let result = supervisor.execute(ctx).await;

    debug!(
        "cmd_supervisor_run: session={} status={:?}",
        session_id, result.status
    );

    Ok(SupervisorRunResult::from(result))
}

/// 中断当前运行
///
/// 设置 `abort_flag = true`，SupervisorNode 在下次中断检查点（任务分配前/子 Agent 执行前后）
/// 命中并返回 `NodeResult::aborted()`。
///
/// # 注意
/// 中断是**协作式**的：依赖 SupervisorNode 主动检查 `ctx.is_aborted()`。
/// 若子 Agent 正在执行 `agent.run(...)`，需子 Agent 自身的 abort 机制生效
/// （阶段 2.1 不向下传播 abort，子 Agent 会执行到自然结束）。
#[tauri::command]
pub async fn cmd_supervisor_abort(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), SupervisorRegistryError> {
    state.supervisor_registry.abort(&session_id).await?;
    info!("cmd_supervisor_abort: session={}", session_id);
    Ok(())
}

/// 销毁 Supervisor 实例
///
/// 1. 调用 `tool_bridge.abort_all()` 取消所有 pending 工具调用
/// 2. 从 registry 移除
#[tauri::command]
pub async fn cmd_supervisor_destroy(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), SupervisorRegistryError> {
    // 先取 entry，abort 所有 pending 工具调用
    let entry = state.supervisor_registry.get(&session_id).await?;
    entry.tool_bridge.abort_all().await;

    // 从 registry 移除
    state.supervisor_registry.remove(&session_id).await?;
    info!(
        "cmd_supervisor_destroy: 已销毁 supervisor session={}",
        session_id
    );
    Ok(())
}

/// 获取共享 OrchestratorState 快照
///
/// 用于前端展示当前任务进度、消息历史、子 Agent 输出等。
/// 返回完整 state 的 JSON 序列化（OrchestratorState 已派生 Serialize）。
#[tauri::command]
pub async fn cmd_supervisor_get_state(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<OrchestratorState, SupervisorRegistryError> {
    let entry = state.supervisor_registry.get(&session_id).await?;
    let state_snapshot = entry.state.read().await.clone();
    Ok(state_snapshot)
}

/// 写回 OrchestratorState（用于断点恢复）
///
/// # 注意
/// 此命令会覆盖整个 state，调用方需确保传入完整 state（不可部分更新）。
/// 持久化场景：前端通过 `cmd_supervisor_get_state` 拿快照 → 序列化保存 →
/// 恢复时反序列化 → 通过本命令写回。
#[tauri::command]
pub async fn cmd_supervisor_set_state(
    state: State<'_, AppState>,
    session_id: String,
    new_state: OrchestratorState,
) -> Result<(), SupervisorRegistryError> {
    let entry = state.supervisor_registry.get(&session_id).await?;
    let mut state_guard = entry.state.write().await;
    *state_guard = new_state;
    Ok(())
}

/// 列出所有已注册的 Supervisor session_id
#[tauri::command]
pub async fn cmd_supervisor_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<String>, SupervisorRegistryError> {
    Ok(state.supervisor_registry.list().await)
}

/// 清空子 Agent 实例池（reset 场景）
///
/// 销毁所有缓存的子 AgentLoop 实例，下次 run 时重新创建。
/// 不影响 state 与消息历史。
///
/// # 使用场景
/// - 切换 Provider 后（子 Agent 持有的 backend 已过期）
/// - 长时间运行后清理内存（避免子 Agent 池累积过多实例）
/// - 测试场景下的 reset
#[tauri::command]
pub async fn cmd_supervisor_clear_agent_pool(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), SupervisorRegistryError> {
    let entry = state.supervisor_registry.get(&session_id).await?;
    entry.supervisor.clear_agent_pool().await;
    debug!(
        "cmd_supervisor_clear_agent_pool: session={}",
        session_id
    );
    Ok(())
}

// ─── 辅助函数 ────────────────────────────────────────────

/// 从 `CreateSupervisorOptions` 构造 `SupervisorConfig`
///
/// 未提供的字段使用 `SupervisorConfig::default()` 保守策略。
/// `agent_loop_config` 字段按 `AgentLoopConfigOptions` 转换。
fn build_supervisor_config(options: &CreateSupervisorOptions) -> SupervisorConfig {
    let mut config = SupervisorConfig::default();

    if let Some(max_rounds) = options.max_rounds {
        config.max_rounds = max_rounds;
    }
    if let Some(require_summary) = options.require_summary {
        config.require_summary = require_summary;
    }
    if let Some(loop_opts) = &options.agent_loop_config {
        config.agent_loop_config = build_agent_loop_config(loop_opts);
    }

    config
}

/// 从 `AgentLoopConfigOptions` 构造 `agent_runtime::AgentLoopConfig`
///
/// 与 `commands::agent::cmd_agent_create` 中的逻辑对齐，
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
        let name = session_event_name("sup_abc");
        assert_eq!(name, "supervisor:event:sup_abc");
    }

    #[test]
    fn event_name_prefix_should_be_constant() {
        assert_eq!(event_name_prefix(), "supervisor:event:");
    }

    #[test]
    fn payload_supervisor_task_assigned_should_serialize_to_snake_case() {
        let payload = SupervisorEventPayload::SupervisorTaskAssigned {
            session_id: "sup_1".into(),
            node_id: "sup".into(),
            sub_agent_id: "coder".into(),
            sub_agent_name: "代码专家".into(),
            task_description: "写函数".into(),
            reasoning: Some("代码任务".into()),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"supervisor_task_assigned\""));
        assert!(json.contains("\"sessionId\":\"sup_1\""));
        assert!(json.contains("\"nodeId\":\"sup\""));
        assert!(json.contains("\"subAgentId\":\"coder\""));
        assert!(json.contains("\"subAgentName\":\"代码专家\""));
        assert!(json.contains("\"taskDescription\":\"写函数\""));
        assert!(json.contains("\"reasoning\":\"代码任务\""));
    }

    #[test]
    fn payload_sub_agent_completed_should_serialize_duration_and_chars() {
        let payload = SupervisorEventPayload::SubAgentCompleted {
            session_id: "sup_1".into(),
            node_id: "sup".into(),
            sub_agent_id: "coder".into(),
            sub_agent_name: "代码专家".into(),
            output_chars: 42,
            duration_ms: 1500,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"sub_agent_completed\""));
        assert!(json.contains("\"outputChars\":42"));
        assert!(json.contains("\"durationMs\":1500"));
    }

    #[test]
    fn payload_supervisor_error_should_serialize_stage() {
        let payload = SupervisorEventPayload::SupervisorError {
            session_id: "sup_1".into(),
            node_id: "sup".into(),
            stage: "assign".into(),
            error: "LLM 调用失败".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"supervisor_error\""));
        assert!(json.contains("\"stage\":\"assign\""));
    }

    #[test]
    fn from_orchestrator_event_should_map_supervisor_variants() {
        let event = OrchestratorEvent::SupervisorTaskAssigned {
            node_id: "sup".into(),
            sub_agent_id: "coder".into(),
            sub_agent_name: "代码专家".into(),
            task_description: "写函数".into(),
            reasoning: Some("代码任务".into()),
        };
        let payload = SupervisorEventPayload::from_orchestrator_event(&event, "sup_1");
        assert!(payload.is_some());
        match payload.unwrap() {
            SupervisorEventPayload::SupervisorTaskAssigned { sub_agent_id, .. } => {
                assert_eq!(sub_agent_id, "coder");
            }
            _ => panic!("应转换为 SupervisorTaskAssigned"),
        }
    }

    #[test]
    fn from_orchestrator_event_should_skip_unmapped_variants() {
        // PlanCreated 事件不在 Supervisor 处理范围
        let event = OrchestratorEvent::PlanCreated { items: Vec::new() };
        let payload = SupervisorEventPayload::from_orchestrator_event(&event, "sup_1");
        assert!(payload.is_none());
    }

    #[test]
    fn from_orchestrator_event_should_skip_agent_event() {
        use agent_runtime::event::AgentEvent;
        let event = OrchestratorEvent::Agent(AgentEvent::AgentStart {
            model: "test".into(),
        });
        let payload = SupervisorEventPayload::from_orchestrator_event(&event, "sup_1");
        assert!(payload.is_none());
    }

    #[test]
    fn run_result_from_continue_should_serialize_status_string() {
        let result = NodeResult {
            status: NodeStatus::Continue,
            next_node_id: None,
            error: None,
            summary: Some("done".into()),
        };
        let s = SupervisorRunResult::from(result);
        assert_eq!(s.status, "continue");
        assert_eq!(s.summary.as_deref(), Some("done"));
    }

    #[test]
    fn run_result_from_error_should_include_error_message() {
        let result = NodeResult::error("执行失败");
        let s = SupervisorRunResult::from(result);
        assert_eq!(s.status, "error");
        assert_eq!(s.error.as_deref(), Some("执行失败"));
    }

    #[test]
    fn build_supervisor_config_should_use_defaults_when_none() {
        let options = CreateSupervisorOptions::default();
        let config = build_supervisor_config(&options);
        assert_eq!(config.max_rounds, 5);
        assert!(config.require_summary);
    }

    #[test]
    fn build_supervisor_config_should_override_when_some() {
        let options = CreateSupervisorOptions {
            max_rounds: Some(10),
            require_summary: Some(false),
            agent_loop_config: Some(AgentLoopConfigOptions {
                max_iterations: Some(50),
                llm_timeout_ms: Some(600_000),
                ..Default::default()
            }),
            assignment_prompt_template: None,
        };
        let config = build_supervisor_config(&options);
        assert_eq!(config.max_rounds, 10);
        assert!(!config.require_summary);
        assert_eq!(config.agent_loop_config.max_iterations, 50);
        assert_eq!(
            config.agent_loop_config.llm_timeout,
            Some(Duration::from_secs(600))
        );
    }

    #[test]
    fn build_agent_loop_config_should_apply_loop_engineering_params() {
        let opts = AgentLoopConfigOptions {
            llm_max_retries: Some(5),
            llm_retry_base_delay_ms: Some(2000),
            llm_timeout_ms: Some(600_000),
            tool_max_retries: Some(2),
            tool_timeout_ms: Some(30_000),
            min_interval_between_calls_ms: Some(1000),
            ..Default::default()
        };
        let config = build_agent_loop_config(&opts);
        assert_eq!(config.llm_max_retries, 5);
        assert_eq!(config.llm_retry_base_delay, Duration::from_millis(2000));
        assert_eq!(config.llm_timeout, Some(Duration::from_secs(600)));
        assert_eq!(config.tool_max_retries, 2);
        assert_eq!(config.tool_timeout, Some(Duration::from_secs(30)));
        assert_eq!(
            config.min_interval_between_calls,
            Some(Duration::from_secs(1))
        );
    }
}
