//! # ToT 命令层 — Tauri 命令封装
//!
//! 阶段 2.1 新增。本模块把 `agent_runtime::tree_of_thoughts::ToTNode` 的能力
//! 通过 Tauri 命令暴露给前端，与 `commands::agent` / `commands::supervisor` /
//! `commands::router` 并列存在。
//!
//! ## 命令一览
//! | 命令 | 说明 |
//! |------|------|
//! | `cmd_tot_create`         | 创建 ToTNode 实例并注册 |
//! | `cmd_tot_run`            | 提交问题，触发思维树探索（Beam Search + LLM 评分） |
//! | `cmd_tot_abort`          | 中断当前运行（设置 abort_flag） |
//! | `cmd_tot_destroy`        | 销毁实例（移除注册） |
//! | `cmd_tot_get_state`      | 获取共享 OrchestratorState 快照 |
//! | `cmd_tot_set_state`      | 写回 state（用于断点恢复） |
//! | `cmd_tot_list_sessions`  | 列出所有已注册的 ToT session_id |
//! | `cmd_tot_get_tree`       | 获取思维树快照（前端展示用） |
//!
//! ## 事件流
//! 事件通过 `app.emit("tot:event:{session_id}", ToTEventPayload)` 推送，
//! 前端通过 `listen("tot:event:" + sessionId, handler)` 监听。
//!
//! ToT 执行期间触发的事件序列（成功路径）：
//!   `ThoughtNodeCreated`（根）→ `ThoughtNodeScored`（根）
//!   → 每层循环：
//!     `ThoughtNodeCreated`（多个子）→ `ThoughtNodeScored`（多个子）
//!     → `ThoughtBranchExplored`（层扩展完成）
//!   → `ToTGoalReached`（目标达成）或 `ToTTerminated`（其他终止）
//!
//! 失败路径：
//!   - 探索失败：`ToTError` (stage="expand")
//!   - 评分失败：`ToTError` (stage="score")
//!   - 目标检查失败：`ToTError` (stage="goal_check")
//!   - 初始化失败：`ToTError` (stage="init")
//!
//! ## 与 Supervisor/Router 命令层的差异
//! - **无 tool_bus / tool_bridge**：ToT 是纯探索节点，只调用 LLM
//! - **无 agent_pool**：ToT 不创建子 Agent
//! - **思维树状态查询**：新增 `cmd_tot_get_tree` 命令，返回思维树快照
//! - **事件种类**：6 个 ToT 专用事件（ThoughtNodeCreated / ThoughtNodeScored /
//!   ThoughtBranchExplored / ToTGoalReached / ToTTerminated / ToTError）

use std::sync::Arc;

use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventListener, OrchestratorEvent};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::node::{NodeContext, NodeResult, NodeStatus, OrchestratorNode};
use agent_runtime::tree_of_thoughts::{
    BeamSearchStrategy, ExplorationPromptTemplate, ExplorationStrategy, GoalCheckPromptTemplate,
    GoalCheckStrategy, LlmGoalCheckStrategy, LlmScoringStrategy, ScoringPromptTemplate,
    ScoringStrategy, ToTConfig, ToTNode,
};
use agent_runtime::types::OrchestratorState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, info, warn};

use crate::agent_bridge::tot_registry::{
    ToTAbortCheck, ToTEmitter, ToTEntry, ToTRegistryError, ToTTreeSnapshot,
};
use crate::state::AppState;

// ─── 事件名约定 ────────────────────────────────────────────

/// ToT 会话事件名前缀
///
/// 完整事件名：`tot:event:{session_id}`
/// 前端：`listen(\`tot:event:${sessionId}\`, ...)`
const fn event_name_prefix() -> &'static str {
    "tot:event:"
}

/// 构造单个 session 的事件名
fn session_event_name(session_id: &str) -> String {
    format!("{}{}", event_name_prefix(), session_id)
}

// ─── ToT 事件 Payload ────────────────────────────────────────────

/// ToT 事件 Payload — 前端友好的扁平化事件结构
///
/// 与 `AgentEventPayload` / `SupervisorEventPayload` / `RouterEventPayload` 并列存在。
/// 处理 `OrchestratorEvent` 中 ToT 相关变体（6 个），其他事件返回 None。
///
/// ## 序列化
/// 使用 `#[serde(tag = "type")]` 内部标签模式，匹配前端 discriminated union：
/// ```json
/// {"type":"thought_node_created","node_id":"tot","thought_id":"thought_1",...}
/// ```
///
/// 注意：`#[serde(tag = "type", rename_all = "snake_case")]` 只对变体名重命名，
/// 变体内部字段保持 Rust 原生 snake_case（与前端 `RustToTEventPayload` 类型一致）。
/// 前端通过 `rustEventToTsEvent` 转换为 camelCase 供 UI 使用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToTEventPayload {
    /// 思维节点已创建
    ThoughtNodeCreated {
        session_id: String,
        node_id: String,
        thought_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_id: Option<String>,
        depth: usize,
        content_preview: String,
    },
    /// 思维节点已评分
    ThoughtNodeScored {
        session_id: String,
        node_id: String,
        thought_id: String,
        score: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
    },
    /// 一层分支扩展完成
    ThoughtBranchExplored {
        session_id: String,
        node_id: String,
        parent_id: String,
        child_count: usize,
        depth: usize,
        kept_count: usize,
    },
    /// ToT 目标达成
    ToTGoalReached {
        session_id: String,
        node_id: String,
        thought_id: String,
        depth: usize,
        content: String,
        score: u8,
    },
    /// ToT 终止（非目标达成）
    ToTTerminated {
        session_id: String,
        node_id: String,
        reason: String,
        total_nodes: usize,
        max_depth_reached: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        best_thought_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        best_score: Option<u8>,
    },
    /// ToT 执行失败
    ToTError {
        session_id: String,
        node_id: String,
        stage: String,
        error: String,
    },
}

impl ToTEventPayload {
    /// 从 `OrchestratorEvent` 转换为前端 Payload
    ///
    /// 只处理 ToT 相关变体，其他变体返回 `None`。
    /// `session_id` 由外部注入（Rust 端事件不携带 session_id）。
    pub fn from_orchestrator_event(event: &OrchestratorEvent, session_id: &str) -> Option<Self> {
        let session_id = session_id.to_string();
        Some(match event {
            OrchestratorEvent::ThoughtNodeCreated {
                node_id,
                thought_id,
                parent_id,
                depth,
                content_preview,
            } => Self::ThoughtNodeCreated {
                session_id,
                node_id: node_id.clone(),
                thought_id: thought_id.clone(),
                parent_id: parent_id.clone(),
                depth: *depth,
                content_preview: content_preview.clone(),
            },

            OrchestratorEvent::ThoughtNodeScored {
                node_id,
                thought_id,
                score,
                reasoning,
            } => Self::ThoughtNodeScored {
                session_id,
                node_id: node_id.clone(),
                thought_id: thought_id.clone(),
                score: *score,
                reasoning: reasoning.clone(),
            },

            OrchestratorEvent::ThoughtBranchExplored {
                node_id,
                parent_id,
                child_count,
                depth,
                kept_count,
            } => Self::ThoughtBranchExplored {
                session_id,
                node_id: node_id.clone(),
                parent_id: parent_id.clone(),
                child_count: *child_count,
                depth: *depth,
                kept_count: *kept_count,
            },

            OrchestratorEvent::ToTGoalReached {
                node_id,
                thought_id,
                depth,
                content,
                score,
            } => Self::ToTGoalReached {
                session_id,
                node_id: node_id.clone(),
                thought_id: thought_id.clone(),
                depth: *depth,
                content: content.clone(),
                score: *score,
            },

            OrchestratorEvent::ToTTerminated {
                node_id,
                reason,
                total_nodes,
                max_depth_reached,
                best_thought_id,
                best_score,
            } => Self::ToTTerminated {
                session_id,
                node_id: node_id.clone(),
                reason: reason.clone(),
                total_nodes: *total_nodes,
                max_depth_reached: *max_depth_reached,
                best_thought_id: best_thought_id.clone(),
                best_score: *best_score,
            },

            OrchestratorEvent::ToTError {
                node_id,
                stage,
                error,
            } => Self::ToTError {
                session_id,
                node_id: node_id.clone(),
                stage: stage.clone(),
                error: error.clone(),
            },

            // 其他事件（Agent/Plan/Reflection/Memory/Supervisor/Router）暂不映射
            _ => return None,
        })
    }
}

// ─── ToTTauriEventListener ────────────────────────────────────────────

/// 把 `OrchestratorEvent` 转为 `ToTEventPayload` 并通过 `app.emit` 推送到前端
///
/// 每个 `ToTNode` 实例对应一个监听器，在 `cmd_tot_create` 时
/// 通过 `entry.subscribe(Arc::new(...))` 注入到 `EventBroadcaster`。
///
/// # 设计
/// - `app: AppHandle`：可克隆，跨任务安全
/// - `session_id: String`：用于事件名和 payload 中的 session_id 字段
/// - **无 message_id**：与 Supervisor/Router 监听器一致，ToT 事件不与流式 message 关联
struct ToTTauriEventListener {
    app: AppHandle,
    session_id: String,
}

impl EventListener for ToTTauriEventListener {
    fn on_event(&self, event: &OrchestratorEvent) {
        let Some(payload) = ToTEventPayload::from_orchestrator_event(event, &self.session_id)
        else {
            // 未映射的事件直接丢弃
            return;
        };

        let event_name = session_event_name(&self.session_id);
        match self.app.emit(&event_name, &payload) {
            Ok(()) => {
                debug!(
                    "tot event emitted: session={} event={}",
                    self.session_id, event_name
                );
            }
            Err(e) => {
                warn!(
                    "tot event emit 失败: session={} err={}",
                    self.session_id, e
                );
            }
        }
    }
}

// ─── 命令参数与返回类型 ────────────────────────────────────────────

/// `cmd_tot_create` 的可选配置
///
/// 包装 `ToTConfig` + 自定义提示词模板，让前端通过 camelCase 字段传递，
/// 内部转换为 Rust 端 snake_case 字段。
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateToTOptions {
    /// ToT 配置（不传则使用默认值）
    #[serde(default)]
    pub config: Option<ToTConfigOptions>,
    /// 自定义探索提示词模板（不传则使用默认 BeamSearchStrategy）
    #[serde(default)]
    pub exploration_template: Option<ExplorationPromptTemplateOptions>,
    /// 自定义评分提示词模板（不传则使用默认 LlmScoringStrategy）
    #[serde(default)]
    pub scoring_template: Option<ScoringPromptTemplateOptions>,
    /// 自定义目标检查提示词模板（不传则使用默认 LlmGoalCheckStrategy）
    #[serde(default)]
    pub goal_check_template: Option<GoalCheckPromptTemplateOptions>,
}

/// ToT 配置（前端 camelCase 字段）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToTConfigOptions {
    /// 最大深度（默认 5）
    pub max_depth: usize,
    /// 最大节点数（默认 50）
    pub max_thoughts: usize,
    /// Beam 宽度 — 每层保留的 top-K 节点数（默认 3）
    pub beam_width: usize,
    /// 分支因子 — 每个节点生成的候选数（默认 3）
    pub branch_factor: usize,
    /// 评分收敛阈值 — top-K 评分差距小于此值则收敛（默认 5）
    pub score_convergence_threshold: u8,
    /// 是否在最后汇总最优思维（默认 true）
    #[serde(default = "default_true")]
    pub require_summary: bool,
    /// 是否在根节点就检查目标（默认 false）
    #[serde(default)]
    pub check_goal_at_root: bool,
}

fn default_true() -> bool {
    true
}

impl Default for ToTConfigOptions {
    fn default() -> Self {
        let cfg = ToTConfig::default();
        Self {
            max_depth: cfg.max_depth,
            max_thoughts: cfg.max_thoughts,
            beam_width: cfg.beam_width,
            branch_factor: cfg.branch_factor,
            score_convergence_threshold: cfg.score_convergence_threshold,
            require_summary: cfg.require_summary,
            check_goal_at_root: cfg.check_goal_at_root,
        }
    }
}

/// 探索提示词模板（自定义 LLM 思维生成提示词）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorationPromptTemplateOptions {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{context}` `{parent}` `{branch_factor}` 占位符）
    pub user_template: String,
}

/// 评分提示词模板
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoringPromptTemplateOptions {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{context}` `{content}` 占位符）
    pub user_template: String,
}

/// 目标检查提示词模板
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalCheckPromptTemplateOptions {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{context}` `{content}` 占位符）
    pub user_template: String,
}

/// `cmd_tot_run` 的返回结果
///
/// 序列化为前端 JSON，包含节点执行状态、最优思维内容、错误信息、摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToTRunResult {
    /// 节点执行状态（"continue" / "done" / "aborted" / "error"）
    pub status: String,
    /// 最优思维内容（执行完成后写入 state.messages，此处也返回一份供前端直接展示）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub best_thought: Option<String>,
    /// 错误信息（status=error 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 摘要（如 "ToT: 已找到最优思维（深度 3，评分 92）"）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

impl From<NodeResult> for ToTRunResult {
    fn from(r: NodeResult) -> Self {
        let status = match r.status {
            NodeStatus::Continue => "continue",
            NodeStatus::Done => "done",
            NodeStatus::Aborted => "aborted",
            NodeStatus::Error => "error",
        };
        Self {
            status: status.to_string(),
            // best_thought 由 cmd_tot_run 在转换后从 state.messages 提取
            best_thought: None,
            error: r.error,
            summary: r.summary,
        }
    }
}

// ─── Tauri 命令 ────────────────────────────────────────────

/// 创建 ToT 实例并注册到 registry
///
/// # 参数
/// - `session_id`：会话 ID（前端生成）
/// - `provider_config`：LLM Provider 配置（用于 LLM 思维生成/评分/目标检查）
/// - `options`：可选 ToT 配置（含 config / 自定义提示词模板）
///
/// # 行为
/// 1. 创建 `GenaiBackend`（持有 provider_config）
/// 2. 构造 `ToTConfig`（从 options.config 或默认值）
/// 3. 创建 `ToTNode`（按是否传入自定义模板选择 with_default_strategies 或 new）
/// 4. 创建 `ToTEntry`（含共享 state / abort_flag / broadcaster）
/// 5. 注册到 `ToTRegistry`
/// 6. 创建 `ToTTauriEventListener` 并订阅 broadcaster
///
/// # 错误
/// - `AlreadyExists`：session_id 已存在
/// - `ToTError`：参数错误（如 branch_factor=0）
#[tauri::command]
pub async fn cmd_tot_create(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    provider_config: ProviderConfig,
    options: Option<CreateToTOptions>,
) -> Result<(), ToTRegistryError> {
    let options = options.unwrap_or_default();

    info!(
        "cmd_tot_create: session={} provider_mode={:?} model={} has_custom_templates={}",
        session_id,
        std::mem::discriminant(&provider_config),
        provider_config.model_id(),
        options.exploration_template.is_some()
            || options.scoring_template.is_some()
            || options.goal_check_template.is_some(),
    );

    // 1. 创建 backend
    let backend = Arc::new(GenaiBackend::new(provider_config));

    // 2. 构造 ToTConfig
    let config = build_tot_config(options.config.as_ref());

    // 3. 创建 ToTNode（按是否传入自定义模板选择构造方式）
    let tot = if options.exploration_template.is_some()
        || options.scoring_template.is_some()
        || options.goal_check_template.is_some()
    {
        // 自定义策略组合
        let exploration: Arc<dyn ExplorationStrategy> = match options.exploration_template {
            Some(tpl) => {
                let template = ExplorationPromptTemplate {
                    system: tpl.system,
                    user_template: tpl.user_template,
                };
                Arc::new(BeamSearchStrategy::with_template(template))
            }
            None => Arc::new(BeamSearchStrategy::new()),
        };
        let scoring: Arc<dyn ScoringStrategy> = match options.scoring_template {
            Some(tpl) => {
                let template = ScoringPromptTemplate {
                    system: tpl.system,
                    user_template: tpl.user_template,
                };
                Arc::new(LlmScoringStrategy::with_template(template))
            }
            None => Arc::new(LlmScoringStrategy::new()),
        };
        let goal_check: Arc<dyn GoalCheckStrategy> = match options.goal_check_template {
            Some(tpl) => {
                let template = GoalCheckPromptTemplate {
                    system: tpl.system,
                    user_template: tpl.user_template,
                };
                Arc::new(LlmGoalCheckStrategy::with_template(template))
            }
            None => Arc::new(LlmGoalCheckStrategy::new()),
        };
        Arc::new(ToTNode::new(
            "tot",
            "Tree of Thoughts",
            exploration,
            scoring,
            goal_check,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            config,
        ))
    } else {
        // 全部默认策略
        Arc::new(ToTNode::with_default_strategies(
            "tot",
            "Tree of Thoughts",
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            config,
        ))
    };

    // 4. 创建 ToTEntry（含初始空 state）
    let initial_state = OrchestratorState::new(String::new());
    let entry = ToTEntry::new(
        tot,
        Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
        initial_state,
    );

    // 5. 注册到 registry
    state
        .tot_registry
        .register(session_id.clone(), entry)
        .await?;

    // 6. 取出 entry，订阅 TauriEventListener
    let entry_after = state.tot_registry.get(&session_id).await?;
    let listener = Arc::new(ToTTauriEventListener {
        app: app.clone(),
        session_id: session_id.clone(),
    });
    entry_after.subscribe(listener).await;

    info!("cmd_tot_create: 成功创建 tot session={}", session_id);
    Ok(())
}

/// 提交问题并执行思维树探索
///
/// # 参数
/// - `session_id`：会话 ID
/// - `task`：用户输入问题/任务（作为思维树根节点 content）
///
/// # 行为
/// 1. 获取 entry（含 tot / state / abort_flag / backend）
/// 2. 重置 abort_flag = false（新一轮 run）
/// 3. 获取 state 写锁，更新 `state.input = task`
/// 4. 构造 NodeContext（注入 ToTAbortCheck + ToTEmitter + backend + state）
/// 5. 调用 `tot.execute(ctx)` 执行思维树探索
/// 6. 从 state.messages 提取最优思维内容
/// 7. 返回 `ToTRunResult`（含 status / best_thought / summary / error）
///
/// # 事件流
/// 期间通过 `app.emit("tot:event:{session_id}", ...)` 推送：
/// - `ThoughtNodeCreated`（每个生成的思维节点）
/// - `ThoughtNodeScored`（每个评分完成的节点）
/// - `ThoughtBranchExplored`（每层扩展完成）
/// - `ToTGoalReached`（目标达成，提前终止）
/// - `ToTTerminated`（其他终止条件触发）
/// - `ToTError`（执行失败）
///
/// # 错误
/// - `NotFound`：session 不存在
/// - `ToTError`：执行过程中错误（已通过事件推送，命令层只返回错误码）
#[tauri::command]
pub async fn cmd_tot_run(
    state: State<'_, AppState>,
    session_id: String,
    task: String,
) -> Result<ToTRunResult, ToTRegistryError> {
    debug!(
        "cmd_tot_run: session={} task_len={}",
        session_id,
        task.len()
    );

    // 获取 entry
    let entry = state.tot_registry.get(&session_id).await?;

    // 重置中断标志
    entry.reset_abort();

    // 取出 backend 与 tot 的 Arc 引用（避免在 await 期间持有 entry 的借用）
    let backend = entry.backend.clone();
    let tot = entry.tot.clone();

    // 获取 state 写锁（execute 期间独占）
    let mut state_guard = entry.state.write().await;
    state_guard.input = task.clone();

    // 构造适配器
    let abort_check = ToTAbortCheck::new(entry.abort_flag.clone());
    let emitter = ToTEmitter::new(entry.broadcaster.clone());

    // 构造 NodeContext 并执行
    let ctx = NodeContext {
        state: &mut *state_guard,
        backend: &*backend,
        memory: None, // ToT 不需要记忆访问，优雅降级
        emitter: &emitter,
        abort_check: &abort_check,
    };

    let result = tot.execute(ctx).await;

    // 从 state.messages 提取最优思维（ToTNode 把最优思维写入最后一条 assistant 消息）
    let best_thought = state_guard
        .messages
        .iter()
        .rev()
        .find(|m| m.role == agent_runtime::types::MessageRole::Assistant)
        .map(|m| m.content.clone());

    debug!(
        "cmd_tot_run: session={} status={:?} has_best={}",
        session_id,
        result.status,
        best_thought.is_some()
    );

    let mut run_result = ToTRunResult::from(result);
    run_result.best_thought = best_thought;
    Ok(run_result)
}

/// 中断当前运行
///
/// 设置 `abort_flag = true`，ToTNode 在中断检查点命中并返回 `NodeResult::aborted()`。
///
/// # 注意
/// 中断是**协作式**的：依赖 ToTNode 主动检查 `ctx.is_aborted()`。
/// ToTNode 在每层扩展前检查一次，所以若已开始 LLM 调用，
/// 需等当前层所有 LLM 调用返回后才能命中中断。
#[tauri::command]
pub async fn cmd_tot_abort(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), ToTRegistryError> {
    state.tot_registry.abort(&session_id).await?;
    info!("cmd_tot_abort: session={}", session_id);
    Ok(())
}

/// 销毁 ToT 实例
///
/// ToT 是纯探索节点，无需 abort 工具调用或子 Agent。
/// 直接从 registry 移除即可。
#[tauri::command]
pub async fn cmd_tot_destroy(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), ToTRegistryError> {
    state.tot_registry.remove(&session_id).await?;
    info!("cmd_tot_destroy: 已销毁 tot session={}", session_id);
    Ok(())
}

/// 获取共享 OrchestratorState 快照
///
/// 用于前端展示当前输入、消息历史等。
#[tauri::command]
pub async fn cmd_tot_get_state(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<OrchestratorState, ToTRegistryError> {
    let entry = state.tot_registry.get(&session_id).await?;
    let state_snapshot = entry.state.read().await.clone();
    Ok(state_snapshot)
}

/// 写回 OrchestratorState（用于断点恢复）
///
/// # 注意
/// 此命令会覆盖整个 state，调用方需确保传入完整 state（不可部分更新）。
#[tauri::command]
pub async fn cmd_tot_set_state(
    state: State<'_, AppState>,
    session_id: String,
    new_state: OrchestratorState,
) -> Result<(), ToTRegistryError> {
    let entry = state.tot_registry.get(&session_id).await?;
    let mut state_guard = entry.state.write().await;
    *state_guard = new_state;
    Ok(())
}

/// 列出所有已注册的 ToT session_id
#[tauri::command]
pub async fn cmd_tot_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<String>, ToTRegistryError> {
    Ok(state.tot_registry.list().await)
}

/// 获取思维树快照（前端展示用）
///
/// 返回完整思维树（节点列表）与最优节点 ID，
/// 前端可据此渲染树形探索过程与高亮最优路径。
///
/// # 用途
/// - 执行中：展示当前探索进度（已生成多少节点、最大深度）
/// - 执行后：高亮最优路径（从根节点到 best_node_id 的路径）
/// - 调试：检查 ToT 是否按预期探索（剪枝是否过激、收敛是否过早）
#[tauri::command]
pub async fn cmd_tot_get_tree(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<ToTTreeSnapshot, ToTRegistryError> {
    let entry = state.tot_registry.get(&session_id).await?;
    let nodes = entry.tot.tree_snapshot().await;
    let best_node_id = entry.tot.best_node_id().await;
    Ok(ToTTreeSnapshot::from_nodes(nodes, best_node_id))
}

// ─── 辅助函数 ────────────────────────────────────────────

/// 从 `Option<ToTConfigOptions>` 构造 `ToTConfig`
///
/// - `Some(opts)`：使用前端传入的配置
/// - `None`：使用默认值（ToTConfig::default()）
fn build_tot_config(opts: Option<&ToTConfigOptions>) -> ToTConfig {
    match opts {
        Some(o) => ToTConfig {
            max_depth: o.max_depth,
            max_thoughts: o.max_thoughts,
            beam_width: o.beam_width,
            branch_factor: o.branch_factor,
            score_convergence_threshold: o.score_convergence_threshold,
            require_summary: o.require_summary,
            check_goal_at_root: o.check_goal_at_root,
        },
        None => ToTConfig::default(),
    }
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_event_name_should_format_correctly() {
        let name = session_event_name("tot_abc");
        assert_eq!(name, "tot:event:tot_abc");
    }

    #[test]
    fn event_name_prefix_should_be_constant() {
        assert_eq!(event_name_prefix(), "tot:event:");
    }

    #[test]
    fn payload_thought_node_created_should_serialize_to_snake_case() {
        let payload = ToTEventPayload::ThoughtNodeCreated {
            session_id: "tot_1".into(),
            node_id: "tot".into(),
            thought_id: "thought_1".into(),
            parent_id: Some("thought_0".into()),
            depth: 1,
            content_preview: "考虑从用户角度思考".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"thought_node_created\""));
        assert!(json.contains("\"node_id\":\"tot\""));
        assert!(json.contains("\"thought_id\":\"thought_1\""));
        assert!(json.contains("\"parent_id\":\"thought_0\""));
        assert!(json.contains("\"depth\":1"));
        assert!(json.contains("\"content_preview\":\"考虑从用户角度思考\""));
    }

    #[test]
    fn payload_thought_node_scored_should_serialize_score() {
        let payload = ToTEventPayload::ThoughtNodeScored {
            session_id: "tot_1".into(),
            node_id: "tot".into(),
            thought_id: "thought_1".into(),
            score: 85,
            reasoning: Some("思路清晰".into()),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"thought_node_scored\""));
        assert!(json.contains("\"score\":85"));
        assert!(json.contains("\"reasoning\":\"思路清晰\""));
    }

    #[test]
    fn payload_thought_branch_explored_should_serialize_counts() {
        let payload = ToTEventPayload::ThoughtBranchExplored {
            session_id: "tot_1".into(),
            node_id: "tot".into(),
            parent_id: "thought_0".into(),
            child_count: 3,
            depth: 1,
            kept_count: 2,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"thought_branch_explored\""));
        assert!(json.contains("\"child_count\":3"));
        assert!(json.contains("\"kept_count\":2"));
    }

    #[test]
    fn payload_tot_goal_reached_should_serialize_content() {
        let payload = ToTEventPayload::ToTGoalReached {
            session_id: "tot_1".into(),
            node_id: "tot".into(),
            thought_id: "thought_5".into(),
            depth: 3,
            content: "完整解决方案：...".into(),
            score: 95,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"tot_goal_reached\""));
        assert!(json.contains("\"thought_id\":\"thought_5\""));
        assert!(json.contains("\"score\":95"));
    }

    #[test]
    fn payload_tot_terminated_should_serialize_reason() {
        let payload = ToTEventPayload::ToTTerminated {
            session_id: "tot_1".into(),
            node_id: "tot".into(),
            reason: "max_depth_exceeded".into(),
            total_nodes: 50,
            max_depth_reached: 5,
            best_thought_id: Some("thought_42".into()),
            best_score: Some(92),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"tot_terminated\""));
        assert!(json.contains("\"reason\":\"max_depth_exceeded\""));
        assert!(json.contains("\"total_nodes\":50"));
        assert!(json.contains("\"best_thought_id\":\"thought_42\""));
    }

    #[test]
    fn payload_tot_error_should_serialize_stage() {
        let payload = ToTEventPayload::ToTError {
            session_id: "tot_1".into(),
            node_id: "tot".into(),
            stage: "expand".into(),
            error: "LLM 调用失败".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"tot_error\""));
        assert!(json.contains("\"stage\":\"expand\""));
    }

    #[test]
    fn from_orchestrator_event_should_map_tot_variants() {
        let event = OrchestratorEvent::ThoughtNodeCreated {
            node_id: "tot".into(),
            thought_id: "thought_1".into(),
            parent_id: None,
            depth: 0,
            content_preview: "根".into(),
        };
        let payload = ToTEventPayload::from_orchestrator_event(&event, "tot_1");
        assert!(payload.is_some());
        match payload.unwrap() {
            ToTEventPayload::ThoughtNodeCreated { thought_id, .. } => {
                assert_eq!(thought_id, "thought_1");
            }
            _ => panic!("应转换为 ThoughtNodeCreated"),
        }
    }

    #[test]
    fn from_orchestrator_event_should_skip_unmapped_variants() {
        // PlanCreated 事件不在 ToT 处理范围
        let event = OrchestratorEvent::PlanCreated { items: Vec::new() };
        let payload = ToTEventPayload::from_orchestrator_event(&event, "tot_1");
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
        let payload = ToTEventPayload::from_orchestrator_event(&event, "tot_1");
        assert!(payload.is_none());
    }

    #[test]
    fn from_orchestrator_event_should_skip_router_event() {
        let event = OrchestratorEvent::RouterDecisionMade {
            node_id: "router".into(),
            target_id: "coder".into(),
            target_name: "代码专家".into(),
            reason: None,
            is_fallback: false,
        };
        let payload = ToTEventPayload::from_orchestrator_event(&event, "tot_1");
        assert!(payload.is_none());
    }

    #[test]
    fn run_result_from_continue_should_serialize_status_string() {
        let result = NodeResult {
            status: NodeStatus::Done,
            next_node_id: None,
            error: None,
            summary: Some("ToT: 已找到最优思维".into()),
        };
        let s = ToTRunResult::from(result);
        assert_eq!(s.status, "done");
        assert_eq!(s.summary.as_deref(), Some("ToT: 已找到最优思维"));
        assert!(s.best_thought.is_none()); // 默认 None，由 cmd_tot_run 填充
    }

    #[test]
    fn run_result_from_error_should_include_error_message() {
        let result = NodeResult::error("探索失败");
        let s = ToTRunResult::from(result);
        assert_eq!(s.status, "error");
        assert_eq!(s.error.as_deref(), Some("探索失败"));
    }

    #[test]
    fn build_tot_config_should_use_defaults_when_none() {
        let config = build_tot_config(None);
        let default = ToTConfig::default();
        assert_eq!(config.max_depth, default.max_depth);
        assert_eq!(config.max_thoughts, default.max_thoughts);
        assert_eq!(config.beam_width, default.beam_width);
        assert_eq!(config.branch_factor, default.branch_factor);
    }

    #[test]
    fn build_tot_config_should_use_provided_values() {
        let opts = ToTConfigOptions {
            max_depth: 10,
            max_thoughts: 100,
            beam_width: 5,
            branch_factor: 4,
            score_convergence_threshold: 3,
            require_summary: false,
            check_goal_at_root: true,
        };
        let config = build_tot_config(Some(&opts));
        assert_eq!(config.max_depth, 10);
        assert_eq!(config.max_thoughts, 100);
        assert_eq!(config.beam_width, 5);
        assert_eq!(config.branch_factor, 4);
        assert_eq!(config.score_convergence_threshold, 3);
        assert!(!config.require_summary);
        assert!(config.check_goal_at_root);
    }

    #[test]
    fn create_tot_options_should_deserialize_camel_case() {
        let json = r#"{
            "config": {
                "maxDepth": 8,
                "maxThoughts": 80,
                "beamWidth": 4,
                "branchFactor": 3,
                "scoreConvergenceThreshold": 4,
                "requireSummary": true,
                "checkGoalAtRoot": false
            },
            "explorationTemplate": {
                "system": "你是探索者",
                "userTemplate": "问题：{context}\n父思维：{parent}"
            }
        }"#;
        let opts: CreateToTOptions = serde_json::from_str(json).unwrap();
        let cfg = opts.config.unwrap();
        assert_eq!(cfg.max_depth, 8);
        assert_eq!(cfg.max_thoughts, 80);
        assert_eq!(cfg.beam_width, 4);
        assert_eq!(cfg.branch_factor, 3);
        assert_eq!(cfg.score_convergence_threshold, 4);
        assert!(cfg.require_summary);
        assert!(!cfg.check_goal_at_root);

        let tpl = opts.exploration_template.unwrap();
        assert_eq!(tpl.system, "你是探索者");
        assert_eq!(tpl.user_template, "问题：{context}\n父思维：{parent}");
    }

    #[test]
    fn create_tot_options_default_should_be_all_none() {
        let opts = CreateToTOptions::default();
        assert!(opts.config.is_none());
        assert!(opts.exploration_template.is_none());
        assert!(opts.scoring_template.is_none());
        assert!(opts.goal_check_template.is_none());
    }

    #[test]
    fn tot_config_options_default_should_match_tot_config_default() {
        let opts = ToTConfigOptions::default();
        let cfg = ToTConfig::default();
        assert_eq!(opts.max_depth, cfg.max_depth);
        assert_eq!(opts.max_thoughts, cfg.max_thoughts);
        assert_eq!(opts.beam_width, cfg.beam_width);
        assert_eq!(opts.branch_factor, cfg.branch_factor);
        assert_eq!(opts.score_convergence_threshold, cfg.score_convergence_threshold);
        assert_eq!(opts.require_summary, cfg.require_summary);
        assert_eq!(opts.check_goal_at_root, cfg.check_goal_at_root);
    }
}
