//! # Router 命令层 — Tauri 命令封装
//!
//! 阶段 2.5 新增。本模块把 `agent_runtime::router::RouterNode` 的能力
//! 通过 Tauri 命令暴露给前端，与 `commands::agent` / `commands::supervisor` 并列存在。
//!
//! ## 命令一览
//! | 命令 | 说明 |
//! |------|------|
//! | `cmd_router_create`         | 创建 RouterNode 实例并注册 |
//! | `cmd_router_run`            | 提交输入，触发路由决策（输出 next_node_id） |
//! | `cmd_router_abort`          | 中断当前运行（设置 abort_flag） |
//! | `cmd_router_destroy`        | 销毁实例（移除注册） |
//! | `cmd_router_get_state`      | 获取共享 OrchestratorState 快照 |
//! | `cmd_router_set_state`      | 写回 state（用于断点恢复） |
//! | `cmd_router_list_sessions`  | 列出所有已注册的 Router session_id |
//! | `cmd_router_get_targets`    | 获取路由目标列表（前端展示用） |
//!
//! ## 事件流
//! 事件通过 `app.emit("router:event:{session_id}", RouterEventPayload)` 推送，
//! 前端通过 `listen("router:event:" + sessionId, handler)` 监听。
//!
//! Router 执行期间触发的事件序列（成功路径）：
//!   `RouterDecisionMade`
//!
//! 失败路径：
//!   - 无匹配且无 fallback：`RouterNoMatch`
//!   - 路由决策失败：`RouterError` (stage="route")
//!   - 目标查找失败：`RouterError` (stage="target_lookup")
//!   - fallback 查找失败：`RouterError` (stage="fallback_lookup")
//!
//! ## 与 Supervisor 命令层的差异
//! - **无 tool_bus / tool_bridge**：Router 是纯决策节点，不执行工具调用
//! - **无 agent_pool**：Router 不创建子 Agent，无需 `clear_agent_pool`
//! - **事件种类更少**：只有 `RouterDecisionMade` / `RouterNoMatch` / `RouterError` 三种
//! - **新增 get_targets 命令**：前端可查询路由目标列表用于 UI 展示

use std::sync::Arc;

use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventListener, OrchestratorEvent};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::node::{NodeContext, NodeResult, NodeStatus, OrchestratorNode};
use agent_runtime::router::{
    LlmRoutingStrategy, RouteTarget, RouterConfig, RouterNode, RoutingPromptTemplate,
};
use agent_runtime::types::OrchestratorState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, info, warn};

use crate::agent_bridge::router_registry::{
    RouterAbortCheck, RouterEmitter, RouterEntry, RouterRegistryError,
};
use crate::state::AppState;

// ─── 事件名约定 ────────────────────────────────────────────

/// Router 会话事件名前缀
///
/// 完整事件名：`router:event:{session_id}`
/// 前端：`listen(\`router:event:${sessionId}\`, ...)`
const fn event_name_prefix() -> &'static str {
    "router:event:"
}

/// 构造单个 session 的事件名
fn session_event_name(session_id: &str) -> String {
    format!("{}{}", event_name_prefix(), session_id)
}

// ─── Router 事件 Payload ────────────────────────────────────────────

/// Router 事件 Payload — 前端友好的扁平化事件结构
///
/// 与 `AgentEventPayload` / `SupervisorEventPayload` 并列存在。
/// 处理 `OrchestratorEvent` 中 Router 相关变体
/// （RouterDecisionMade / RouterNoMatch / RouterError），
/// 其他事件（基础 Agent 事件、Plan/Reflection/Supervisor 事件）暂不映射（返回 None）。
///
/// ## 序列化
/// 使用 `#[serde(tag = "type")]` 内部标签模式，匹配前端 discriminated union：
/// ```json
/// {"type":"router_decision_made","node_id":"router","target_id":"coder",...}
/// ```
///
/// 注意：`#[serde(tag = "type", rename_all = "snake_case")]` 只对变体名重命名，
/// 变体内部字段保持 Rust 原生 snake_case（与前端 `RustRouterEventPayload` 类型一致）。
/// 前端通过 `rustEventToTsEvent` 转换为 camelCase 供 UI 使用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RouterEventPayload {
    /// Router 路由决策完成
    RouterDecisionMade {
        session_id: String,
        node_id: String,
        target_id: String,
        target_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        /// 是否走了 fallback（true 表示无匹配后走了 fallback_target_id）
        is_fallback: bool,
    },
    /// Router 无匹配路由（且无 fallback）
    RouterNoMatch {
        session_id: String,
        node_id: String,
        /// 输入摘要（前 100 字符）
        input_sample: String,
    },
    /// Router 决策阶段失败
    RouterError {
        session_id: String,
        node_id: String,
        /// 错误阶段（"route" / "target_lookup" / "fallback_lookup"）
        stage: String,
        error: String,
    },
}

impl RouterEventPayload {
    /// 从 `OrchestratorEvent` 转换为前端 Payload
    ///
    /// 只处理 Router 相关变体，其他变体返回 `None`。
    /// `session_id` 由外部注入（Rust 端事件不携带 session_id）。
    pub fn from_orchestrator_event(event: &OrchestratorEvent, session_id: &str) -> Option<Self> {
        let session_id = session_id.to_string();
        Some(match event {
            OrchestratorEvent::RouterDecisionMade {
                node_id,
                target_id,
                target_name,
                reason,
                is_fallback,
            } => Self::RouterDecisionMade {
                session_id,
                node_id: node_id.clone(),
                target_id: target_id.clone(),
                target_name: target_name.clone(),
                reason: reason.clone(),
                is_fallback: *is_fallback,
            },

            OrchestratorEvent::RouterNoMatch {
                node_id,
                input_sample,
            } => Self::RouterNoMatch {
                session_id,
                node_id: node_id.clone(),
                input_sample: input_sample.clone(),
            },

            OrchestratorEvent::RouterError {
                node_id,
                stage,
                error,
            } => Self::RouterError {
                session_id,
                node_id: node_id.clone(),
                stage: stage.clone(),
                error: error.clone(),
            },

            // 其他事件（Agent/Plan/Reflection/Memory/WorkingMemory/Supervisor）暂不映射
            _ => return None,
        })
    }
}

// ─── RouterTauriEventListener ────────────────────────────────────────────

/// 把 `OrchestratorEvent` 转为 `RouterEventPayload` 并通过 `app.emit` 推送到前端
///
/// 每个 `RouterNode` 实例对应一个监听器，在 `cmd_router_create` 时
/// 通过 `entry.subscribe(Arc::new(...))` 注入到 `EventBroadcaster`。
///
/// # 设计
/// - `app: AppHandle`：可克隆，跨任务安全
/// - `session_id: String`：用于事件名和 payload 中的 session_id 字段
/// - **无 message_id**：与 Supervisor 监听器一致，Router 事件不与流式 message 关联
///
/// # 锁竞争
/// `EventBroadcaster` 用 `tokio::sync::RwLock`，`RouterEmitter::emit` 用 `try_read`
/// 避免阻塞节点执行。本监听器在 `on_event` 同步方法中只做 `app.emit`，不涉及 RwLock。
struct RouterTauriEventListener {
    /// Tauri 应用句柄
    app: AppHandle,
    /// 会话 ID
    session_id: String,
}

impl EventListener for RouterTauriEventListener {
    fn on_event(&self, event: &OrchestratorEvent) {
        let Some(payload) = RouterEventPayload::from_orchestrator_event(event, &self.session_id)
        else {
            // 未映射的事件直接丢弃
            return;
        };

        let event_name = session_event_name(&self.session_id);
        match self.app.emit(&event_name, &payload) {
            Ok(()) => {
                debug!(
                    "router event emitted: session={} event={}",
                    self.session_id, event_name
                );
            }
            Err(e) => {
                warn!(
                    "router event emit 失败: session={} err={}",
                    self.session_id, e
                );
            }
        }
    }
}

// ─── 命令参数与返回类型 ────────────────────────────────────────────

/// 路由策略类型枚举（前端选择路由策略）
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum StrategyKind {
    /// LLM 决策路由（默认）
    #[default]
    Llm,
    /// 关键词匹配路由
    Keyword,
}

/// `cmd_router_create` 的可选配置
///
/// 包装 `RouterConfig` + 路由策略选择，让前端通过 camelCase 字段传递，
/// 内部转换为 Rust 端 snake_case 字段。
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateRouterOptions {
    /// 路由策略（默认 LLM）
    #[serde(default)]
    pub strategy: Option<StrategyKind>,
    /// Fallback 目标 ID（无匹配时路由到此目标）
    ///
    /// - `Some(id)`：无匹配时走 fallback，触发 `RouterDecisionMade { is_fallback: true }`
    /// - `None`：无匹配时触发 `RouterNoMatch` 事件并返回错误
    #[serde(default)]
    pub fallback_target_id: Option<String>,
    /// 自定义 LLM 路由提示词模板（仅 strategy=Llm 时生效）
    #[serde(default)]
    pub prompt_template: Option<RoutingPromptTemplateOptions>,
}

/// 路由提示词模板（自定义 LLM 决策提示词）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingPromptTemplateOptions {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{input}` 和 `{targets}` 占位符）
    pub user_template: String,
}

/// `cmd_router_run` 的返回结果
///
/// 序列化为前端 JSON，包含节点执行状态、下一节点 ID、错误信息、摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterRunResult {
    /// 节点执行状态（"continue" / "done" / "aborted" / "error"）
    pub status: String,
    /// 下一节点 ID（Router 决策结果，供 Orchestrator 调度下一节点）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_node_id: Option<String>,
    /// 错误信息（status=error 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 摘要（如 "Router: 已路由到 '代码专家' 分支"）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

impl From<NodeResult> for RouterRunResult {
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

/// 创建 Router 实例并注册到 registry
///
/// # 参数
/// - `session_id`：会话 ID（前端生成）
/// - `provider_config`：LLM Provider 配置（用于 LLM 路由决策）
/// - `targets`：路由目标列表
/// - `options`：可选 Router 配置
///
/// # 行为
/// 1. 创建 `GenaiBackend`（持有 provider_config）
/// 2. 创建 `RouterNode`（按 strategy 选择 LLM/关键词策略）
/// 3. 创建 `RouterEntry`（含共享 state / abort_flag / broadcaster）
/// 4. 注册到 `RouterRegistry`
/// 5. 创建 `RouterTauriEventListener` 并订阅 broadcaster
///
/// # 错误
/// - `AlreadyExists`：session_id 已存在
/// - `RouterError`：targets 为空或其他参数错误
#[tauri::command]
pub async fn cmd_router_create(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    provider_config: ProviderConfig,
    targets: Vec<RouteTarget>,
    options: Option<CreateRouterOptions>,
) -> Result<(), RouterRegistryError> {
    let options = options.unwrap_or_default();

    info!(
        "cmd_router_create: session={} provider_mode={:?} model={} targets_count={} strategy={:?}",
        session_id,
        std::mem::discriminant(&provider_config),
        provider_config.model_id(),
        targets.len(),
        options.strategy.as_ref().unwrap_or(&StrategyKind::Llm),
    );

    if targets.is_empty() {
        return Err(RouterRegistryError::RouterError {
            message: "路由目标列表不能为空".into(),
        });
    }

    // 1. 创建 backend
    let backend = Arc::new(GenaiBackend::new(provider_config));

    // 2. 构造 RouterConfig
    let config = build_router_config(&options);

    // 3. 创建 RouterNode（按策略选择）
    let strategy_kind = options.strategy.unwrap_or_default();
    let router = match strategy_kind {
        StrategyKind::Llm => {
            // 自定义提示词模板 vs 默认模板
            if let Some(tpl_opts) = &options.prompt_template {
                let template = RoutingPromptTemplate {
                    system: tpl_opts.system.clone(),
                    user_template: tpl_opts.user_template.clone(),
                };
                let strategy = Arc::new(LlmRoutingStrategy::with_template(template));
                Arc::new(RouterNode::new(
                    "router",
                    "Router",
                    targets,
                    strategy,
                    Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
                    config,
                ))
            } else {
                Arc::new(RouterNode::with_default_strategy(
                    "router",
                    "Router",
                    targets,
                    Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
                    config,
                ))
            }
        }
        StrategyKind::Keyword => {
            // 关键词策略不需要 LLM，但仍需 backend 引用（RouterNode 字段要求）
            Arc::new(RouterNode::with_keyword_strategy(
                "router",
                "Router",
                targets,
                Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
                config,
            ))
        }
    };

    // 4. 创建 RouterEntry（含初始空 state）
    let initial_state = OrchestratorState::new(String::new());
    let entry = RouterEntry::new(
        router,
        Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
        initial_state,
    );

    // 5. 注册到 registry
    state
        .router_registry
        .register(session_id.clone(), entry)
        .await?;

    // 6. 取出 entry，订阅 TauriEventListener
    let entry_after = state.router_registry.get(&session_id).await?;
    let listener = Arc::new(RouterTauriEventListener {
        app: app.clone(),
        session_id: session_id.clone(),
    });
    entry_after.subscribe(listener).await;

    info!(
        "cmd_router_create: 成功创建 router session={}",
        session_id
    );
    Ok(())
}

/// 提交输入并执行路由决策
///
/// # 参数
/// - `session_id`：会话 ID
/// - `task`：用户输入文本（路由决策的依据）
///
/// # 行为
/// 1. 获取 entry（含 router / state / abort_flag / backend）
/// 2. 重置 abort_flag = false（新一轮 run）
/// 3. 获取 state 写锁，更新 `state.input = task`
/// 4. 构造 NodeContext（注入 RouterAbortCheck + RouterEmitter + backend + state）
/// 5. 调用 `router.execute(ctx)` 执行路由决策
/// 6. 返回 `RouterRunResult`（含 status / next_node_id / summary / error）
///
/// # 事件流
/// 期间通过 `app.emit("router:event:{session_id}", ...)` 推送：
/// - `RouterDecisionMade`（路由决策成功）
/// - `RouterNoMatch`（无匹配且无 fallback）
/// - `RouterError`（决策失败）
///
/// # 错误
/// - `NotFound`：session 不存在
/// - `RouterError`：执行过程中错误（已通过事件推送，命令层只返回错误码）
#[tauri::command]
pub async fn cmd_router_run(
    state: State<'_, AppState>,
    session_id: String,
    task: String,
) -> Result<RouterRunResult, RouterRegistryError> {
    debug!(
        "cmd_router_run: session={} task_len={}",
        session_id,
        task.len()
    );

    // 获取 entry
    let entry = state.router_registry.get(&session_id).await?;

    // 重置中断标志
    entry.reset_abort();

    // 取出 backend 与 router 的 Arc 引用（避免在 await 期间持有 entry 的借用）
    let backend = entry.backend.clone();
    let router = entry.router.clone();

    // 获取 state 写锁（execute 期间独占）
    let mut state_guard = entry.state.write().await;
    state_guard.input = task.clone();

    // 构造适配器
    let abort_check = RouterAbortCheck::new(entry.abort_flag.clone());
    let emitter = RouterEmitter::new(entry.broadcaster.clone());

    // 构造 NodeContext 并执行
    let ctx = NodeContext {
        state: &mut *state_guard,
        backend: &*backend,
        memory: None, // Router 不需要记忆访问，优雅降级
        emitter: &emitter,
        abort_check: &abort_check,
    };

    let result = router.execute(ctx).await;

    debug!(
        "cmd_router_run: session={} status={:?}",
        session_id, result.status
    );

    Ok(RouterRunResult::from(result))
}

/// 中断当前运行
///
/// 设置 `abort_flag = true`，RouterNode 在中断检查点命中并返回 `NodeResult::aborted()`。
///
/// # 注意
/// 中断是**协作式**的：依赖 RouterNode 主动检查 `ctx.is_aborted()`。
/// RouterNode 仅在路由决策前检查一次（无中间检查点），所以若已开始 LLM 调用，
/// 需等 LLM 调用返回后才能命中中断。
#[tauri::command]
pub async fn cmd_router_abort(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), RouterRegistryError> {
    state.router_registry.abort(&session_id).await?;
    info!("cmd_router_abort: session={}", session_id);
    Ok(())
}

/// 销毁 Router 实例
///
/// Router 是纯决策节点，无需 abort 工具调用或子 Agent。
/// 直接从 registry 移除即可。
#[tauri::command]
pub async fn cmd_router_destroy(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), RouterRegistryError> {
    state.router_registry.remove(&session_id).await?;
    info!(
        "cmd_router_destroy: 已销毁 router session={}",
        session_id
    );
    Ok(())
}

/// 获取共享 OrchestratorState 快照
///
/// 用于前端展示当前输入、消息历史等。
#[tauri::command]
pub async fn cmd_router_get_state(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<OrchestratorState, RouterRegistryError> {
    let entry = state.router_registry.get(&session_id).await?;
    let state_snapshot = entry.state.read().await.clone();
    Ok(state_snapshot)
}

/// 写回 OrchestratorState（用于断点恢复）
///
/// # 注意
/// 此命令会覆盖整个 state，调用方需确保传入完整 state（不可部分更新）。
#[tauri::command]
pub async fn cmd_router_set_state(
    state: State<'_, AppState>,
    session_id: String,
    new_state: OrchestratorState,
) -> Result<(), RouterRegistryError> {
    let entry = state.router_registry.get(&session_id).await?;
    let mut state_guard = entry.state.write().await;
    *state_guard = new_state;
    Ok(())
}

/// 列出所有已注册的 Router session_id
#[tauri::command]
pub async fn cmd_router_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<String>, RouterRegistryError> {
    Ok(state.router_registry.list().await)
}

/// 获取路由目标列表（前端展示用）
///
/// 返回 RouterNode 配置的所有路由目标，前端可用于：
/// - 展示当前 Router 的分支配置
/// - 验证 target_id 是否在候选列表中
/// - 在 Orchestrator 图中绘制 Router → 各分支节点的连线
#[tauri::command]
pub async fn cmd_router_get_targets(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<RouteTarget>, RouterRegistryError> {
    let entry = state.router_registry.get(&session_id).await?;
    Ok(entry.router.targets().to_vec())
}

// ─── 辅助函数 ────────────────────────────────────────────

/// 从 `CreateRouterOptions` 构造 `RouterConfig`
fn build_router_config(options: &CreateRouterOptions) -> RouterConfig {
    RouterConfig {
        fallback_target_id: options.fallback_target_id.clone(),
    }
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_event_name_should_format_correctly() {
        let name = session_event_name("router_abc");
        assert_eq!(name, "router:event:router_abc");
    }

    #[test]
    fn event_name_prefix_should_be_constant() {
        assert_eq!(event_name_prefix(), "router:event:");
    }

    #[test]
    fn payload_router_decision_made_should_serialize_to_snake_case() {
        let payload = RouterEventPayload::RouterDecisionMade {
            session_id: "router_1".into(),
            node_id: "router".into(),
            target_id: "coder".into(),
            target_name: "代码专家".into(),
            reason: Some("代码任务".into()),
            is_fallback: false,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"router_decision_made\""));
        assert!(json.contains("\"sessionId\":\"router_1\""));
        assert!(json.contains("\"nodeId\":\"router\""));
        assert!(json.contains("\"targetId\":\"coder\""));
        assert!(json.contains("\"targetName\":\"代码专家\""));
        assert!(json.contains("\"reason\":\"代码任务\""));
        assert!(json.contains("\"isFallback\":false"));
    }

    #[test]
    fn payload_router_no_match_should_serialize_input_sample() {
        let payload = RouterEventPayload::RouterNoMatch {
            session_id: "router_1".into(),
            node_id: "router".into(),
            input_sample: "无关输入".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"router_no_match\""));
        assert!(json.contains("\"inputSample\":\"无关输入\""));
    }

    #[test]
    fn payload_router_error_should_serialize_stage() {
        let payload = RouterEventPayload::RouterError {
            session_id: "router_1".into(),
            node_id: "router".into(),
            stage: "route".into(),
            error: "LLM 调用失败".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"router_error\""));
        assert!(json.contains("\"stage\":\"route\""));
    }

    #[test]
    fn from_orchestrator_event_should_map_router_variants() {
        let event = OrchestratorEvent::RouterDecisionMade {
            node_id: "router".into(),
            target_id: "coder".into(),
            target_name: "代码专家".into(),
            reason: Some("代码任务".into()),
            is_fallback: false,
        };
        let payload = RouterEventPayload::from_orchestrator_event(&event, "router_1");
        assert!(payload.is_some());
        match payload.unwrap() {
            RouterEventPayload::RouterDecisionMade { target_id, .. } => {
                assert_eq!(target_id, "coder");
            }
            _ => panic!("应转换为 RouterDecisionMade"),
        }
    }

    #[test]
    fn from_orchestrator_event_should_skip_unmapped_variants() {
        // PlanCreated 事件不在 Router 处理范围
        let event = OrchestratorEvent::PlanCreated { items: Vec::new() };
        let payload = RouterEventPayload::from_orchestrator_event(&event, "router_1");
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
        let payload = RouterEventPayload::from_orchestrator_event(&event, "router_1");
        assert!(payload.is_none());
    }

    #[test]
    fn run_result_from_continue_should_serialize_status_string() {
        let result = NodeResult {
            status: NodeStatus::Continue,
            next_node_id: Some("coder".into()),
            error: None,
            summary: Some("已路由".into()),
        };
        let s = RouterRunResult::from(result);
        assert_eq!(s.status, "continue");
        assert_eq!(s.next_node_id.as_deref(), Some("coder"));
        assert_eq!(s.summary.as_deref(), Some("已路由"));
    }

    #[test]
    fn run_result_from_error_should_include_error_message() {
        let result = NodeResult::error("决策失败");
        let s = RouterRunResult::from(result);
        assert_eq!(s.status, "error");
        assert_eq!(s.error.as_deref(), Some("决策失败"));
    }

    #[test]
    fn build_router_config_should_use_defaults_when_none() {
        let options = CreateRouterOptions::default();
        let config = build_router_config(&options);
        assert!(config.fallback_target_id.is_none());
    }

    #[test]
    fn build_router_config_should_set_fallback_when_provided() {
        let options = CreateRouterOptions {
            fallback_target_id: Some("fallback".into()),
            ..Default::default()
        };
        let config = build_router_config(&options);
        assert_eq!(config.fallback_target_id.as_deref(), Some("fallback"));
    }

    #[test]
    fn strategy_kind_default_should_be_llm() {
        let kind = StrategyKind::default();
        assert!(matches!(kind, StrategyKind::Llm));
    }

    #[test]
    fn strategy_kind_should_deserialize_from_lowercase() {
        let json_llm = "\"llm\"";
        let kind: StrategyKind = serde_json::from_str(json_llm).unwrap();
        assert!(matches!(kind, StrategyKind::Llm));

        let json_kw = "\"keyword\"";
        let kind: StrategyKind = serde_json::from_str(json_kw).unwrap();
        assert!(matches!(kind, StrategyKind::Keyword));
    }

    #[test]
    fn create_router_options_should_deserialize_camel_case() {
        let json = r#"{
            "strategy": "keyword",
            "fallbackTargetId": "fallback",
            "promptTemplate": {
                "system": "你是路由器",
                "userTemplate": "输入：{input}"
            }
        }"#;
        let opts: CreateRouterOptions = serde_json::from_str(json).unwrap();
        assert!(matches!(opts.strategy.unwrap(), StrategyKind::Keyword));
        assert_eq!(opts.fallback_target_id.as_deref(), Some("fallback"));
        let tpl = opts.prompt_template.unwrap();
        assert_eq!(tpl.system, "你是路由器");
        assert_eq!(tpl.user_template, "输入：{input}");
    }
}
