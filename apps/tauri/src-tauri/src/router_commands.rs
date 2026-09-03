//! Router Pattern — Tauri 命令层（编排 4 模式 UI 下沉之 Router 样板）
//!
//! Router 是纯决策节点：`RoutingStrategy.route(input, targets, backend)` 一次决策选中目标，
//! 无长运行无 abort。本命令层用一个无状态注册表（session -> {targets, strategy, fallback}）
//! 复用 agent-runtime 的策略引擎，封装决策/目标管理/结果回显给前端面板。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use agent_commands::AgentCommandService;
use agent_runtime::router::{
    KeywordRoutingStrategy, LlmRoutingStrategy, RouteResult, RouteTarget, RoutingError,
    RoutingStrategy,
};
use serde::Serialize;
use tauri::State;

// ─── 注册表 ────────────────────────────────────────────────────────────

/// 每个会话一份 Router 配置（targets + 策略 + fallback）
#[derive(Clone)]
pub(crate) struct RouterEntry {
    targets: Vec<RouteTarget>,
    /// true = LLM 意图分类；false = 关键词匹配
    use_llm: bool,
    /// 无匹配时兜底目标 ID（None = 无匹配报错）
    fallback_target_id: Option<String>,
    /// 最近一次决策结果（供 get_state 回显）
    last_decision: Option<RouterDecision>,
}

/// 路由决策回显（前端展示选中目标 + 理由）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterDecision {
    pub target_id: String,
    pub target_name: String,
    pub reason: Option<String>,
    pub is_fallback: bool,
}

/// Router 会话状态回显
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterState {
    pub targets: Vec<RouteTarget>,
    pub use_llm: bool,
    pub fallback_target_id: Option<String>,
    pub last_decision: Option<RouterDecision>,
}

/// 全局 Router 注册表（按 session_id）
pub struct RouterRegistry(pub(crate) Mutex<HashMap<String, RouterEntry>>);

impl RouterRegistry {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

// ─── 内部工具 ──────────────────────────────────────────────────────────

/// 应用 fallback：主决策 NoMatch 且配置了 fallback 时返回兜底决策
fn apply_fallback(
    entry: &RouterEntry,
    err: &RoutingError,
    input: &str,
) -> Result<RouterDecision, String> {
    if let Some(fb_id) = &entry.fallback_target_id {
        if let Some(fb) = entry.targets.iter().find(|t| t.id.as_str() == fb_id) {
            return Ok(RouterDecision {
                target_id: fb.id.clone(),
                target_name: fb.name.clone(),
                reason: Some(format!("主决策无匹配，已走兜底（输入: {}）", truncate(input, 60))),
                is_fallback: true,
            });
        }
    }
    Err(format!("路由失败: {err}"))
}

/// 执行一次路由决策（LLM 或关键词策略），返回选中决策
async fn do_route(
    entry: &RouterEntry,
    input: &str,
    backend: &dyn agent_runtime::backend::NodeBackendAccessor,
) -> Result<RouteResult, RoutingError> {
    let strategy: Arc<dyn RoutingStrategy> = if entry.use_llm {
        Arc::new(LlmRoutingStrategy::new())
    } else {
        Arc::new(KeywordRoutingStrategy::new())
    };
    strategy.route(input, &entry.targets, backend).await
}

/// 截断长文本（决策 reason 展示用）
fn truncate(s: &str, max: usize) -> String {
    let ch: Vec<char> = s.chars().collect();
    if ch.len() <= max {
        s.to_string()
    } else {
        format!("{}…", ch.into_iter().take(max).collect::<String>())
    }
}

/// 从会话取 AgentLoop 的 LLM 后端（Arc<dyn NodeBackendAccessor> 可直接传入 do_route）
async fn session_backend(
    state: &State<'_, AgentCommandService>,
    session_id: &str,
) -> Result<Arc<dyn agent_runtime::backend::NodeBackendAccessor>, String> {
    let agent = state
        .get_agent(session_id)
        .await
        .map_err(|e| format!("取会话失败: {e}"))?;
    Ok(agent.node_backend())
}

// ─── Tauri 命令 ────────────────────────────────────────────────────────

/// 创建/替换某会话的 Router 配置（targets 必填且非空）
#[tauri::command]
pub async fn router_create(
    state: State<'_, AgentCommandService>,
    registry: State<'_, RouterRegistry>,
    session_id: String,
    targets: Vec<RouteTarget>,
    use_llm: Option<bool>,
    fallback_target_id: Option<String>,
) -> Result<(), String> {
    if targets.is_empty() {
        return Err("至少需要一个路由目标".into());
    }
    let mut map = registry.0.lock().unwrap();
    let _ = &state; // 本次仅存配置，backend 在 route 时动态取
    map.insert(
        session_id,
        RouterEntry {
            targets,
            use_llm: use_llm.unwrap_or(true),
            fallback_target_id,
            last_decision: None,
        },
    );
    Ok(())
}

/// 执行一次路由决策（LLM/关键词），返回选中目标
#[tauri::command]
pub async fn router_route(
    state: State<'_, AgentCommandService>,
    registry: State<'_, RouterRegistry>,
    session_id: String,
    input: String,
) -> Result<RouterDecision, String> {
    let input = input.trim().to_string();
    if input.is_empty() {
        return Err("路由输入为空".into());
    }
    let entry = {
        let map = registry.0.lock().unwrap();
        map.get(&session_id).cloned().ok_or("该会话未创建 Router 配置（先调用 router_create）")?
    };
    let backend = session_backend(&state, &session_id).await?;
    let decision = match do_route(&entry, &input, &*backend).await {
        Ok(r) => {
            let name = entry
                .targets
                .iter()
                .find(|t| t.id == r.target_id)
                .map(|t| t.name.clone())
                .unwrap_or_else(|| r.target_id.clone());
            RouterDecision {
                target_id: r.target_id,
                target_name: name,
                reason: r.reason,
                is_fallback: false,
            }
        }
        Err(e) => apply_fallback(&entry, &e, &input)?,
    };
    // 写回最近决策
    if let Ok(mut map) = registry.0.lock() {
        if let Some(e) = map.get_mut(&session_id) {
            e.last_decision = Some(decision.clone());
        }
    }
    Ok(decision)
}

/// 更新路由目标（可换 target 列表/策略/fallback）
#[tauri::command]
pub async fn router_set_targets(
    registry: State<'_, RouterRegistry>,
    session_id: String,
    targets: Vec<RouteTarget>,
    use_llm: Option<bool>,
    fallback_target_id: Option<String>,
) -> Result<(), String> {
    if targets.is_empty() {
        return Err("至少需要一个路由目标".into());
    }
    let mut map = registry.0.lock().unwrap();
    if let Some(e) = map.get_mut(&session_id) {
        e.targets = targets;
        e.use_llm = use_llm.unwrap_or(e.use_llm);
        e.fallback_target_id = fallback_target_id;
        e.last_decision = None;
        Ok(())
    } else {
        Err("该会话未创建 Router 配置".into())
    }
}

/// 查询某会话 Router 状态（targets/策略/最近决策）
#[tauri::command]
pub async fn router_get_state(
    registry: State<'_, RouterRegistry>,
    session_id: String,
) -> Result<Option<RouterState>, String> {
    let map = registry.0.lock().unwrap();
    Ok(map.get(&session_id).map(|e| RouterState {
        targets: e.targets.clone(),
        use_llm: e.use_llm,
        fallback_target_id: e.fallback_target_id.clone(),
        last_decision: e.last_decision.clone(),
    }))
}

/// 列出已创建 Router 的会话
#[tauri::command]
pub async fn router_list_sessions(
    registry: State<'_, RouterRegistry>,
) -> Result<Vec<String>, String> {
    let map = registry.0.lock().unwrap();
    Ok(map.keys().cloned().collect())
}

/// 销毁某会话 Router 配置
#[tauri::command]
pub async fn router_destroy(
    registry: State<'_, RouterRegistry>,
    session_id: String,
) -> Result<(), String> {
    registry.0.lock().unwrap().remove(&session_id);
    Ok(())
}