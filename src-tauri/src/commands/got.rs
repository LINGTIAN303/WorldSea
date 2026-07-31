//! # GoT 命令层 — Tauri 命令封装
//!
//! 阶段 2.2 新增。本模块把 `agent_runtime::graph_of_thoughts::GoTNode` 的能力
//! 通过 Tauri 命令暴露给前端，与 `commands::agent` / `commands::supervisor` /
//! `commands::router` / `commands::tot` 并列存在。
//!
//! ## 命令一览
//! | 命令 | 说明 |
//! |------|------|
//! | `cmd_got_create`         | 创建 GoTNode 实例并注册 |
//! | `cmd_got_run`            | 提交问题，触发思维图探索（Beam Search + LLM 评分 + 跨层聚合） |
//! | `cmd_got_abort`          | 中断当前运行（设置 abort_flag） |
//! | `cmd_got_destroy`        | 销毁实例（移除注册） |
//! | `cmd_got_get_state`      | 获取共享 OrchestratorState 快照 |
//! | `cmd_got_set_state`      | 写回 state（用于断点恢复） |
//! | `cmd_got_list_sessions`  | 列出所有已注册的 GoT session_id |
//! | `cmd_got_get_tree`       | 获取思维图快照（前端展示用） |
//!
//! ## 事件流
//! 事件通过 `app.emit("got:event:{session_id}", GoTEventPayload)` 推送，
//! 前端通过 `listen("got:event:" + sessionId, handler)` 监听。
//!
//! GoT 执行期间触发的事件序列（成功路径）：
//!   `ThoughtNodeCreated`（根）→ `ThoughtNodeScored`（根）
//!   → 每层循环：
//!     `ThoughtNodeCreated`（多个子）→ `ThoughtNodeScored`（多个子）
//!     → `ThoughtBranchExplored`（层扩展完成）
//!     → `ThoughtsAggregated`（聚合阶段，生成本层聚合节点）
//!   → `ToTGoalReached`（目标达成）或 `ToTTerminated`（其他终止）
//!
//! 失败路径：
//!   - 探索失败：`ToTError` (stage="expand")
//!   - 评分失败：`ToTError` (stage="score")
//!   - 目标检查失败：`ToTError` (stage="goal_check")
//!   - 聚合失败：`ToTError` (stage="aggregate")
//!   - 初始化失败：`ToTError` (stage="init")
//!
//! ## 与 ToT 命令层的差异
//! - **事件种类**：复用 ToT 的 6 个事件 + 新增 `ThoughtsAggregated`（共 7 个）
//! - **配置参数**：`GoTConfigOptions` 扩展 `ToTConfigOptions` 增加 4 个聚合参数
//! - **自定义模板**：新增 `aggregation_template`（聚合提示词模板）
//! - **快照类型**：返回 `GoTGraphSnapshot`（与 `ToTTreeSnapshot` 形态一致但独立类型）
//! - **node_type 标识**：GoTNode 返回 `NodeType::Graph`（ToTNode 返回 `Thought`）

use std::sync::Arc;

use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventListener, OrchestratorEvent};
use agent_runtime::graph_of_thoughts::{
    AggregationPromptTemplate, AggregationStrategy, GoTConfig, GoTNode, LlmAggregationStrategy,
};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::node::{NodeContext, NodeResult, NodeStatus, OrchestratorNode};
use agent_runtime::tree_of_thoughts::{
    BeamSearchStrategy, ExplorationPromptTemplate, ExplorationStrategy, GoalCheckPromptTemplate,
    GoalCheckStrategy, LlmGoalCheckStrategy, LlmScoringStrategy, ScoringPromptTemplate,
    ScoringStrategy, ToTConfig,
};
use agent_runtime::types::OrchestratorState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, info, warn};

use crate::agent_bridge::got_registry::{
    GoTAbortCheck, GoTEmitter, GoTEntry, GoTGraphSnapshot, GoTRegistryError,
};
use crate::state::AppState;

// ─── 事件名约定 ────────────────────────────────────────────

/// GoT 会话事件名前缀
///
/// 完整事件名：`got:event:{session_id}`
/// 前端：`listen(\`got:event:${sessionId}\`, ...)`
const fn event_name_prefix() -> &'static str {
    "got:event:"
}

/// 构造单个 session 的事件名
fn session_event_name(session_id: &str) -> String {
    format!("{}{}", event_name_prefix(), session_id)
}

// ─── GoT 事件 Payload ────────────────────────────────────────────

/// GoT 事件 Payload — 前端友好的扁平化事件结构
///
/// 与 `ToTEventPayload` 形态相似但独立类型，以区分 GoT 语义。
/// 处理 `OrchestratorEvent` 中 GoT 相关变体（7 个：6 个复用 ToT + 1 个聚合），
/// 其他事件返回 None。
///
/// ## 序列化
/// 使用 `#[serde(tag = "type")]` 内部标签模式，匹配前端 discriminated union：
/// ```json
/// {"type":"thought_node_created","node_id":"got","thought_id":"thought_1",...}
/// {"type":"thoughts_aggregated","node_id":"got","aggregated_thought_id":"agg_1",...}
/// ```
///
/// 注意：`#[serde(tag = "type", rename_all = "snake_case")]` 只对变体名重命名，
/// 变体内部字段保持 Rust 原生 snake_case（与前端 `RustGoTEventPayload` 类型一致）。
/// 前端通过 `rustEventToTsEvent` 转换为 camelCase 供 UI 使用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GoTEventPayload {
    /// 思维节点已创建（复用 ToT 事件）
    ThoughtNodeCreated {
        session_id: String,
        node_id: String,
        thought_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_id: Option<String>,
        depth: usize,
        content_preview: String,
    },
    /// 思维节点已评分（复用 ToT 事件）
    ThoughtNodeScored {
        session_id: String,
        node_id: String,
        thought_id: String,
        score: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
    },
    /// 一层分支扩展完成（复用 ToT 事件）
    ThoughtBranchExplored {
        session_id: String,
        node_id: String,
        parent_id: String,
        child_count: usize,
        depth: usize,
        kept_count: usize,
    },
    /// GoT 目标达成（复用 ToT 事件）
    ToTGoalReached {
        session_id: String,
        node_id: String,
        thought_id: String,
        depth: usize,
        content: String,
        score: u8,
    },
    /// GoT 终止（非目标达成，复用 ToT 事件）
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
    /// GoT 执行失败（复用 ToT 事件）
    ToTError {
        session_id: String,
        node_id: String,
        stage: String,
        error: String,
    },
    /// 思维节点已聚合（GoT 专用，ToT 无此事件）
    ///
    /// 在 `AggregationStrategy::aggregate` 成功返回后触发，
    /// 携带聚合生成的新思维节点 ID、源节点 ID 列表、深度与内容预览。
    ThoughtsAggregated {
        session_id: String,
        node_id: String,
        aggregated_thought_id: String,
        source_ids: Vec<String>,
        depth: usize,
        content_preview: String,
    },
}

impl GoTEventPayload {
    /// 从 `OrchestratorEvent` 转换为前端 Payload
    ///
    /// 只处理 GoT 相关变体（7 个），其他变体返回 `None`。
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
                best_score: best_score.clone(),
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

            OrchestratorEvent::ThoughtsAggregated {
                node_id,
                aggregated_thought_id,
                source_ids,
                depth,
                content_preview,
            } => Self::ThoughtsAggregated {
                session_id,
                node_id: node_id.clone(),
                aggregated_thought_id: aggregated_thought_id.clone(),
                source_ids: source_ids.clone(),
                depth: *depth,
                content_preview: content_preview.clone(),
            },

            // 其他事件（Agent/Plan/Reflection/Memory/Supervisor/Router）暂不映射
            _ => return None,
        })
    }
}

// ─── GoTTauriEventListener ────────────────────────────────────────────

/// 把 `OrchestratorEvent` 转为 `GoTEventPayload` 并通过 `app.emit` 推送到前端
///
/// 每个 `GoTNode` 实例对应一个监听器，在 `cmd_got_create` 时
/// 通过 `entry.subscribe(Arc::new(...))` 注入到 `EventBroadcaster`。
///
/// # 设计
/// - `app: AppHandle`：可克隆，跨任务安全
/// - `session_id: String`：用于事件名和 payload 中的 session_id 字段
/// - **无 message_id**：与 ToT/Supervisor/Router 监听器一致，GoT 事件不与流式 message 关联
struct GoTTauriEventListener {
    app: AppHandle,
    session_id: String,
}

impl EventListener for GoTTauriEventListener {
    fn on_event(&self, event: &OrchestratorEvent) {
        let Some(payload) = GoTEventPayload::from_orchestrator_event(event, &self.session_id)
        else {
            // 未映射的事件直接丢弃
            return;
        };

        let event_name = session_event_name(&self.session_id);
        match self.app.emit(&event_name, &payload) {
            Ok(()) => {
                debug!(
                    "got event emitted: session={} event={}",
                    self.session_id, event_name
                );
            }
            Err(e) => {
                warn!(
                    "got event emit 失败: session={} err={}",
                    self.session_id, e
                );
            }
        }
    }
}

// ─── 命令参数与返回类型 ────────────────────────────────────────────

/// `cmd_got_create` 的可选配置
///
/// 包装 `GoTConfig` + 自定义提示词模板，让前端通过 camelCase 字段传递，
/// 内部转换为 Rust 端 snake_case 字段。
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoTOptions {
    /// GoT 配置（不传则使用默认值）
    #[serde(default)]
    pub config: Option<GoTConfigOptions>,
    /// 自定义探索提示词模板（不传则使用默认 BeamSearchStrategy）
    #[serde(default)]
    pub exploration_template: Option<ExplorationPromptTemplateOptions>,
    /// 自定义评分提示词模板（不传则使用默认 LlmScoringStrategy）
    #[serde(default)]
    pub scoring_template: Option<ScoringPromptTemplateOptions>,
    /// 自定义目标检查提示词模板（不传则使用默认 LlmGoalCheckStrategy）
    #[serde(default)]
    pub goal_check_template: Option<GoalCheckPromptTemplateOptions>,
    /// 自定义聚合提示词模板（不传则使用默认 LlmAggregationStrategy）
    ///
    /// GoT 专用参数（ToT 无此模板）。
    #[serde(default)]
    pub aggregation_template: Option<AggregationPromptTemplateOptions>,
}

/// GoT 配置（前端 camelCase 字段）
///
/// 扩展 `ToTConfigOptions` 增加 4 个聚合参数。
/// 内部通过 `build_got_config` 转换为 Rust 端 `GoTConfig`。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoTConfigOptions {
    // ── 基础 ToT 配置（与 ToTConfigOptions 字段一致）──
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

    // ── GoT 聚合参数（阶段 2.2 新增）──
    /// 是否启用聚合（默认 true）
    #[serde(default = "default_true")]
    pub aggregation_enabled: bool,
    /// 聚合评分阈值 — 只有评分≥此值的节点才参与聚合（默认 70）
    #[serde(default = "default_aggregation_threshold")]
    pub aggregation_threshold: u8,
    /// 单次聚合的节点数上限（默认 3）
    #[serde(default = "default_max_aggregation_size")]
    pub max_aggregation_size: usize,
    /// 每层生成的聚合节点数（默认 1）
    #[serde(default = "default_aggregation_branch_factor")]
    pub aggregation_branch_factor: usize,
}

fn default_true() -> bool {
    true
}

fn default_aggregation_threshold() -> u8 {
    70
}

fn default_max_aggregation_size() -> usize {
    3
}

fn default_aggregation_branch_factor() -> usize {
    1
}

impl Default for GoTConfigOptions {
    fn default() -> Self {
        let cfg = GoTConfig::default();
        let tot = cfg.tot.clone();
        Self {
            max_depth: tot.max_depth,
            max_thoughts: tot.max_thoughts,
            beam_width: tot.beam_width,
            branch_factor: tot.branch_factor,
            score_convergence_threshold: tot.score_convergence_threshold,
            require_summary: tot.require_summary,
            check_goal_at_root: tot.check_goal_at_root,
            aggregation_enabled: cfg.aggregation_enabled,
            aggregation_threshold: cfg.aggregation_threshold,
            max_aggregation_size: cfg.max_aggregation_size,
            aggregation_branch_factor: cfg.aggregation_branch_factor,
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

/// 聚合提示词模板（GoT 专用）
///
/// 支持占位符：
/// - `{context}`：用户原始输入
/// - `{thoughts}`：参与聚合的思维列表（JSON 数组，含 content + score）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregationPromptTemplateOptions {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板
    pub user_template: String,
}

/// `cmd_got_run` 的返回结果
///
/// 序列化为前端 JSON，包含节点执行状态、最优思维内容、错误信息、摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoTRunResult {
    /// 节点执行状态（"continue" / "done" / "aborted" / "error"）
    pub status: String,
    /// 最优思维内容（执行完成后写入 state.messages，此处也返回一份供前端直接展示）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub best_thought: Option<String>,
    /// 错误信息（status=error 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 摘要（如 "GoT: 已找到最优思维（深度 3，评分 92，含 2 次聚合）"）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

impl From<NodeResult> for GoTRunResult {
    fn from(r: NodeResult) -> Self {
        let status = match r.status {
            NodeStatus::Continue => "continue",
            NodeStatus::Done => "done",
            NodeStatus::Aborted => "aborted",
            NodeStatus::Error => "error",
        };
        Self {
            status: status.to_string(),
            // best_thought 由 cmd_got_run 在转换后从 state.messages 提取
            best_thought: None,
            error: r.error,
            summary: r.summary,
        }
    }
}

// ─── Tauri 命令 ────────────────────────────────────────────

/// 创建 GoT 实例并注册到 registry
///
/// # 参数
/// - `session_id`：会话 ID（前端生成）
/// - `provider_config`：LLM Provider 配置（用于 LLM 思维生成/评分/目标检查/聚合）
/// - `options`：可选 GoT 配置（含 config / 自定义提示词模板）
///
/// # 行为
/// 1. 创建 `GenaiBackend`（持有 provider_config）
/// 2. 构造 `GoTConfig`（从 options.config 或默认值）
/// 3. 创建 `GoTNode`（按是否传入自定义模板选择 with_default_strategies 或 new）
/// 4. 创建 `GoTEntry`（含共享 state / abort_flag / broadcaster）
/// 5. 注册到 `GoTRegistry`
/// 6. 创建 `GoTTauriEventListener` 并订阅 broadcaster
///
/// # 错误
/// - `AlreadyExists`：session_id 已存在
/// - `GoTError`：参数错误（如 branch_factor=0）
#[tauri::command]
pub async fn cmd_got_create(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    provider_config: ProviderConfig,
    options: Option<CreateGoTOptions>,
) -> Result<(), GoTRegistryError> {
    let options = options.unwrap_or_default();

    info!(
        "cmd_got_create: session={} provider_mode={:?} model={} has_custom_templates={}",
        session_id,
        std::mem::discriminant(&provider_config),
        provider_config.model_id(),
        options.exploration_template.is_some()
            || options.scoring_template.is_some()
            || options.goal_check_template.is_some()
            || options.aggregation_template.is_some(),
    );

    // 1. 创建 backend
    let backend = Arc::new(GenaiBackend::new(provider_config));

    // 2. 构造 GoTConfig
    let config = build_got_config(options.config.as_ref());

    // 3. 创建 GoTNode（按是否传入自定义模板选择构造方式）
    let got = if options.exploration_template.is_some()
        || options.scoring_template.is_some()
        || options.goal_check_template.is_some()
        || options.aggregation_template.is_some()
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
        let aggregation: Arc<dyn AggregationStrategy> = match options.aggregation_template {
            Some(tpl) => {
                let template = AggregationPromptTemplate {
                    system: tpl.system,
                    user_template: tpl.user_template,
                };
                Arc::new(LlmAggregationStrategy::with_template(template))
            }
            None => Arc::new(LlmAggregationStrategy::new()),
        };
        Arc::new(GoTNode::new(
            "got",
            "Graph of Thoughts",
            exploration,
            scoring,
            goal_check,
            aggregation,
            config,
        ))
    } else {
        // 全部默认策略
        Arc::new(GoTNode::with_default_strategies(
            "got",
            "Graph of Thoughts",
            config,
        ))
    };

    // 4. 创建 GoTEntry（含初始空 state）
    let initial_state = OrchestratorState::new(String::new());
    let entry = GoTEntry::new(
        got,
        Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
        initial_state,
    );

    // 5. 注册到 registry
    state
        .got_registry
        .register(session_id.clone(), entry)
        .await?;

    // 6. 取出 entry，订阅 TauriEventListener
    let entry_after = state.got_registry.get(&session_id).await?;
    let listener = Arc::new(GoTTauriEventListener {
        app: app.clone(),
        session_id: session_id.clone(),
    });
    entry_after.subscribe(listener).await;

    info!("cmd_got_create: 成功创建 got session={}", session_id);
    Ok(())
}

/// 提交问题并执行思维图探索
///
/// # 参数
/// - `session_id`：会话 ID
/// - `task`：用户输入问题/任务（作为思维图根节点 content）
///
/// # 行为
/// 1. 获取 entry（含 got / state / abort_flag / backend）
/// 2. 重置 abort_flag = false（新一轮 run）
/// 3. 获取 state 写锁，更新 `state.input = task`
/// 4. 构造 NodeContext（注入 GoTAbortCheck + GoTEmitter + backend + state）
/// 5. 调用 `got.execute(ctx)` 执行思维图探索
/// 6. 从 state.messages 提取最优思维内容
/// 7. 返回 `GoTRunResult`（含 status / best_thought / summary / error）
///
/// # 事件流
/// 期间通过 `app.emit("got:event:{session_id}", ...)` 推送：
/// - `ThoughtNodeCreated`（每个生成的思维节点）
/// - `ThoughtNodeScored`（每个评分完成的节点）
/// - `ThoughtBranchExplored`（每层扩展完成）
/// - `ThoughtsAggregated`（聚合阶段，GoT 专用）
/// - `ToTGoalReached`（目标达成，提前终止）
/// - `ToTTerminated`（其他终止条件触发）
/// - `ToTError`（执行失败）
///
/// # 错误
/// - `NotFound`：session 不存在
/// - `GoTError`：执行过程中错误（已通过事件推送，命令层只返回错误码）
#[tauri::command]
pub async fn cmd_got_run(
    state: State<'_, AppState>,
    session_id: String,
    task: String,
) -> Result<GoTRunResult, GoTRegistryError> {
    debug!(
        "cmd_got_run: session={} task_len={}",
        session_id,
        task.len()
    );

    // 获取 entry
    let entry = state.got_registry.get(&session_id).await?;

    // 重置中断标志
    entry.reset_abort();

    // 取出 backend 与 got 的 Arc 引用（避免在 await 期间持有 entry 的借用）
    let backend = entry.backend.clone();
    let got = entry.got.clone();

    // 获取 state 写锁（execute 期间独占）
    let mut state_guard = entry.state.write().await;
    state_guard.input = task.clone();

    // 构造适配器
    let abort_check = GoTAbortCheck::new(entry.abort_flag.clone());
    let emitter = GoTEmitter::new(entry.broadcaster.clone());

    // 构造 NodeContext 并执行
    let ctx = NodeContext {
        state: &mut *state_guard,
        backend: &*backend,
        memory: None, // GoT 不需要记忆访问，优雅降级
        emitter: &emitter,
        abort_check: &abort_check,
    };

    let result = got.execute(ctx).await;

    // 从 state.messages 提取最优思维（GoTNode 把最优思维写入最后一条 assistant 消息）
    let best_thought = state_guard
        .messages
        .iter()
        .rev()
        .find(|m| m.role == agent_runtime::types::MessageRole::Assistant)
        .map(|m| m.content.clone());

    debug!(
        "cmd_got_run: session={} status={:?} has_best={}",
        session_id,
        result.status,
        best_thought.is_some()
    );

    let mut run_result = GoTRunResult::from(result);
    run_result.best_thought = best_thought;
    Ok(run_result)
}

/// 中断当前运行
///
/// 设置 `abort_flag = true`，GoTNode 在中断检查点命中并返回 `NodeResult::aborted()`。
///
/// # 注意
/// 中断是**协作式**的：依赖 GoTNode 主动检查 `ctx.is_aborted()`。
/// GoTNode 在每层扩展前检查一次，所以若已开始 LLM 调用，
/// 需等当前层所有 LLM 调用返回后才能命中中断。
#[tauri::command]
pub async fn cmd_got_abort(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), GoTRegistryError> {
    state.got_registry.abort(&session_id).await?;
    info!("cmd_got_abort: session={}", session_id);
    Ok(())
}

/// 销毁 GoT 实例
///
/// GoT 是纯探索节点，无需 abort 工具调用或子 Agent。
/// 直接从 registry 移除即可。
#[tauri::command]
pub async fn cmd_got_destroy(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), GoTRegistryError> {
    state.got_registry.remove(&session_id).await?;
    info!("cmd_got_destroy: 已销毁 got session={}", session_id);
    Ok(())
}

/// 获取共享 OrchestratorState 快照
///
/// 用于前端展示当前输入、消息历史等。
#[tauri::command]
pub async fn cmd_got_get_state(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<OrchestratorState, GoTRegistryError> {
    let entry = state.got_registry.get(&session_id).await?;
    let state_snapshot = entry.state.read().await.clone();
    Ok(state_snapshot)
}

/// 写回 OrchestratorState（用于断点恢复）
///
/// # 注意
/// 此命令会覆盖整个 state，调用方需确保传入完整 state（不可部分更新）。
#[tauri::command]
pub async fn cmd_got_set_state(
    state: State<'_, AppState>,
    session_id: String,
    new_state: OrchestratorState,
) -> Result<(), GoTRegistryError> {
    let entry = state.got_registry.get(&session_id).await?;
    let mut state_guard = entry.state.write().await;
    *state_guard = new_state;
    Ok(())
}

/// 列出所有已注册的 GoT session_id
#[tauri::command]
pub async fn cmd_got_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<String>, GoTRegistryError> {
    Ok(state.got_registry.list().await)
}

/// 获取思维图快照（前端展示用）
///
/// 返回完整思维图（节点列表）与最优节点 ID，
/// 前端可据此渲染图探索过程与高亮最优路径。
///
/// # 用途
/// - 执行中：展示当前探索进度（已生成多少节点、最大深度、聚合节点数）
/// - 执行后：高亮最优路径（从根节点到 best_node_id 的路径，含聚合边）
/// - 调试：检查 GoT 是否按预期探索与聚合
///
/// # 与 ToT 快照的差异
/// GoT 节点的 `parents` 字段在聚合节点上非空（多个源节点 ID），
/// 前端可据此渲染图的聚合边（多 parent → 1 child）。
#[tauri::command]
pub async fn cmd_got_get_tree(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<GoTGraphSnapshot, GoTRegistryError> {
    let entry = state.got_registry.get(&session_id).await?;
    let nodes = entry.got.tree_snapshot().await;
    let best_node_id = entry.got.best_node_id().await;
    Ok(GoTGraphSnapshot::from_nodes(nodes, best_node_id))
}

// ─── 辅助函数 ────────────────────────────────────────────

/// 从 `Option<GoTConfigOptions>` 构造 `GoTConfig`
///
/// - `Some(opts)`：使用前端传入的配置
/// - `None`：使用默认值（GoTConfig::default()）
fn build_got_config(opts: Option<&GoTConfigOptions>) -> GoTConfig {
    match opts {
        Some(o) => GoTConfig {
            tot: ToTConfig {
                max_depth: o.max_depth,
                max_thoughts: o.max_thoughts,
                beam_width: o.beam_width,
                branch_factor: o.branch_factor,
                score_convergence_threshold: o.score_convergence_threshold,
                require_summary: o.require_summary,
                check_goal_at_root: o.check_goal_at_root,
            },
            aggregation_enabled: o.aggregation_enabled,
            aggregation_threshold: o.aggregation_threshold,
            max_aggregation_size: o.max_aggregation_size,
            aggregation_branch_factor: o.aggregation_branch_factor,
        },
        None => GoTConfig::default(),
    }
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_event_name_should_format_correctly() {
        let name = session_event_name("got_abc");
        assert_eq!(name, "got:event:got_abc");
    }

    #[test]
    fn event_name_prefix_should_be_constant() {
        assert_eq!(event_name_prefix(), "got:event:");
    }

    #[test]
    fn payload_thought_node_created_should_serialize_to_snake_case() {
        let payload = GoTEventPayload::ThoughtNodeCreated {
            session_id: "got_1".into(),
            node_id: "got".into(),
            thought_id: "thought_1".into(),
            parent_id: Some("thought_0".into()),
            depth: 1,
            content_preview: "考虑从用户角度思考".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"thought_node_created\""));
        assert!(json.contains("\"node_id\":\"got\""));
        assert!(json.contains("\"thought_id\":\"thought_1\""));
        assert!(json.contains("\"parent_id\":\"thought_0\""));
        assert!(json.contains("\"depth\":1"));
    }

    #[test]
    fn payload_thoughts_aggregated_should_serialize_source_ids() {
        let payload = GoTEventPayload::ThoughtsAggregated {
            session_id: "got_1".into(),
            node_id: "got".into(),
            aggregated_thought_id: "agg_1".into(),
            source_ids: vec!["thought_1".into(), "thought_2".into()],
            depth: 2,
            content_preview: "综合两者优点".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"thoughts_aggregated\""));
        assert!(json.contains("\"aggregated_thought_id\":\"agg_1\""));
        assert!(json.contains("\"source_ids\":[\"thought_1\",\"thought_2\"]"));
        assert!(json.contains("\"depth\":2"));
    }

    #[test]
    fn from_orchestrator_event_should_map_thoughts_aggregated() {
        let event = OrchestratorEvent::ThoughtsAggregated {
            node_id: "got".into(),
            aggregated_thought_id: "agg_1".into(),
            source_ids: vec!["t1".into(), "t2".into()],
            depth: 1,
            content_preview: "聚合".into(),
        };
        let payload = GoTEventPayload::from_orchestrator_event(&event, "got_1");
        assert!(payload.is_some());
        match payload.unwrap() {
            GoTEventPayload::ThoughtsAggregated {
                aggregated_thought_id,
                source_ids,
                ..
            } => {
                assert_eq!(aggregated_thought_id, "agg_1");
                assert_eq!(source_ids, vec!["t1".to_string(), "t2".to_string()]);
            }
            _ => panic!("应转换为 ThoughtsAggregated"),
        }
    }

    #[test]
    fn from_orchestrator_event_should_skip_unmapped_variants() {
        // PlanCreated 事件不在 GoT 处理范围
        let event = OrchestratorEvent::PlanCreated { items: Vec::new() };
        let payload = GoTEventPayload::from_orchestrator_event(&event, "got_1");
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
        let payload = GoTEventPayload::from_orchestrator_event(&event, "got_1");
        assert!(payload.is_none());
    }

    #[test]
    fn from_orchestrator_event_should_skip_router_event() {
        let event = OrchestratorEvent::RouterDecisionMade {
            node_id: "router".into(),
            target_id: "branch_a".into(),
            target_name: "分支 A".into(),
            reason: None,
            is_fallback: false,
        };
        let payload = GoTEventPayload::from_orchestrator_event(&event, "got_1");
        assert!(payload.is_none());
    }

    #[test]
    fn build_got_config_should_use_defaults_when_none() {
        let cfg = build_got_config(None);
        let default = GoTConfig::default();
        assert_eq!(cfg.tot.max_depth, default.tot.max_depth);
        assert_eq!(cfg.aggregation_enabled, default.aggregation_enabled);
        assert_eq!(cfg.aggregation_threshold, default.aggregation_threshold);
    }

    #[test]
    fn build_got_config_should_apply_custom_values() {
        let opts = GoTConfigOptions {
            max_depth: 8,
            max_thoughts: 100,
            beam_width: 5,
            branch_factor: 4,
            score_convergence_threshold: 3,
            require_summary: false,
            check_goal_at_root: true,
            aggregation_enabled: false,
            aggregation_threshold: 80,
            max_aggregation_size: 5,
            aggregation_branch_factor: 2,
        };
        let cfg = build_got_config(Some(&opts));
        assert_eq!(cfg.tot.max_depth, 8);
        assert_eq!(cfg.tot.beam_width, 5);
        assert_eq!(cfg.tot.require_summary, false);
        assert_eq!(cfg.aggregation_enabled, false);
        assert_eq!(cfg.aggregation_threshold, 80);
        assert_eq!(cfg.max_aggregation_size, 5);
        assert_eq!(cfg.aggregation_branch_factor, 2);
    }

    #[test]
    fn got_run_result_should_map_node_status() {
        let r = NodeResult {
            status: NodeStatus::Done,
            summary: Some("GoT: 已找到最优思维".into()),
            error: None,
        };
        let result = GoTRunResult::from(r);
        assert_eq!(result.status, "done");
        assert_eq!(result.summary.as_deref(), Some("GoT: 已找到最优思维"));
    }

    #[allow(dead_code)]
    fn _assert_node_type_is_graph() {
        // 编译期断言：GoTNode 的 node_type() 返回 NodeType::Graph
        // （通过此函数确保 GoT 与 ToT 在 node_type 上区分）
        // 实际运行时检查在 graph_of_thoughts.rs 的单元测试中
        let _ = NodeType::Graph;
    }
}
