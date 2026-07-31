//! # GoT Registry — Graph of Thoughts 实例注册表
//!
//! 阶段 2.2 新增。用于在 Tauri 应用进程内管理多个 `GoTNode` 实例，
//! 与 `AgentRegistry` / `SupervisorRegistry` / `RouterRegistry` / `ToTRegistry` 并列存在。
//!
//! ## 设计要点
//! - **线程安全**：基于 `tokio::sync::RwLock<HashMap>`，与其它 Registry 一致
//! - **共享 backend**：GoTNode 探索/评分/目标检查/聚合通过 `NodeBackendAccessor` 调用 LLM，
//!   registry 持有 backend 的 Arc 引用避免被 GC 释放
//! - **共享 state**：`OrchestratorState` 跨命令访问（cmd_got_run 写入，
//!   cmd_got_get_state 读取），使用 `RwLock<OrchestratorState>` 保护
//! - **中断检查**：通过 `Arc<AtomicBool>` 实现，cmd_got_abort 设置 true，
//!   NodeContext.is_aborted() 读取
//! - **事件广播**：通过 `EventBroadcaster` 实现，cmd_got_create 时订阅
//!   TauriEventListener，GoTNode execute 时通过 emitter 推送事件
//!
//! ## 与 ToT Registry 的差异
//! - **节点类型**：GoTNode 而非 ToTNode（独立实现 OrchestratorNode trait）
//! - **聚合策略**：GoTNode 持有 `AggregationStrategy`，ToTNode 无此策略
//! - **图语义**：ThoughtNode.parents 字段在 GoT 中可能非空（聚合节点多 parent）
//! - **新增事件**：`ThoughtsAggregated`（GoT 专用，ToT 无此事件）
//! - **快照类型**：`GoTGraphSnapshot` 与 `ToTTreeSnapshot` 形态一致但语义不同
//!
//! ## 与 Tauri 命令的关系
//! ```text
//! cmd_got_create  -> registry.register(session_id, got_entry)
//! cmd_got_run     -> registry.get(session_id) → got.execute(ctx)
//! cmd_got_abort   -> registry.get(session_id) → abort_flag.store(true)
//! cmd_got_destroy -> registry.remove(session_id)
//! cmd_got_get_tree -> registry.get(session_id) → got.tree_snapshot() + best_node_id()
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventBroadcaster, EventListener, OrchestratorEvent};
use agent_runtime::graph_of_thoughts::GoTNode;
use agent_runtime::node::{AbortCheck, EventEmitter};
use agent_runtime::tree_of_thoughts::ThoughtNode;
use agent_runtime::types::OrchestratorState;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::warn;

// ─── 错误类型 ────────────────────────────────────────────

/// GoT 注册表错误
///
/// 复用 ToTRegistryError 的错误形态，但作为独立类型，避免语义混淆。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GoTRegistryError {
    /// 指定 session_id 的 GoT 不存在
    NotFound { session_id: String },
    /// 指定 session_id 已存在（重复创建）
    AlreadyExists { session_id: String },
    /// GoT 执行错误
    GoTError { message: String },
    /// 锁竞争失败
    LockError { message: String },
}

impl std::fmt::Display for GoTRegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound { session_id } => {
                write!(f, "GoT session not found: {}", session_id)
            }
            Self::AlreadyExists { session_id } => {
                write!(f, "GoT session already exists: {}", session_id)
            }
            Self::GoTError { message } => write!(f, "GoT error: {}", message),
            Self::LockError { message } => write!(f, "Lock error: {}", message),
        }
    }
}

impl std::error::Error for GoTRegistryError {}

// ─── GoT 条目 ────────────────────────────────────────────

/// 注册表中的 GoT 条目
///
/// 持有 GoTNode 及其依赖（backend），以及跨命令共享的状态
/// （state / abort_flag / broadcaster）。
///
/// 注意：与 `ToTEntry` 一致，不持有 `tool_bus` / `tool_bridge`，
/// 因为 GoT 是纯探索 + 聚合节点，不执行工具调用，只调用 LLM。
#[derive(Clone)]
pub struct GoTEntry {
    /// GoT 节点实例
    pub got: Arc<GoTNode>,
    /// LLM 后端访问器（用于 LLM 思维生成/评分/目标检查/聚合）
    pub backend: Arc<dyn NodeBackendAccessor>,
    /// 事件广播器（用于订阅 TauriEventListener）
    pub broadcaster: Arc<RwLock<EventBroadcaster>>,
    /// 中断标志（cmd_got_abort 设置 true，NodeContext 读取）
    pub abort_flag: Arc<AtomicBool>,
    /// 共享编排状态（跨命令访问）
    pub state: Arc<RwLock<OrchestratorState>>,
    /// 创建时间戳（Unix 毫秒）
    pub created_at: i64,
}

impl GoTEntry {
    /// 创建新条目
    pub fn new(
        got: Arc<GoTNode>,
        backend: Arc<dyn NodeBackendAccessor>,
        initial_state: OrchestratorState,
    ) -> Self {
        Self {
            got,
            backend,
            broadcaster: Arc::new(RwLock::new(EventBroadcaster::new())),
            abort_flag: Arc::new(AtomicBool::new(false)),
            state: Arc::new(RwLock::new(initial_state)),
            created_at: chrono::Utc::now().timestamp_millis(),
        }
    }

    /// 订阅事件监听器
    pub async fn subscribe(&self, listener: Arc<dyn EventListener>) {
        let mut bc = self.broadcaster.write().await;
        bc.subscribe(listener);
    }

    /// 触发中断（设置 abort_flag = true）
    pub fn abort(&self) {
        self.abort_flag.store(true, Ordering::SeqCst);
    }

    /// 重置中断标志（新一轮 run 前）
    pub fn reset_abort(&self) {
        self.abort_flag.store(false, Ordering::SeqCst);
    }

    /// 读取中断状态
    pub fn is_aborted(&self) -> bool {
        self.abort_flag.load(Ordering::SeqCst)
    }
}

// ─── GoT Registry ────────────────────────────────────────────

/// GoT 实例注册表
pub struct GoTRegistry {
    entries: RwLock<HashMap<String, GoTEntry>>,
}

impl GoTRegistry {
    /// 创建空注册表
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// 注册一个新 GoT
    pub async fn register(
        &self,
        session_id: impl Into<String>,
        entry: GoTEntry,
    ) -> Result<(), GoTRegistryError> {
        let session_id = session_id.into();
        let mut entries = self.entries.write().await;

        if entries.contains_key(&session_id) {
            return Err(GoTRegistryError::AlreadyExists { session_id });
        }

        entries.insert(session_id, entry);
        Ok(())
    }

    /// 获取 GoT 条目（克隆）
    pub async fn get(&self, session_id: &str) -> Result<GoTEntry, GoTRegistryError> {
        let entries = self.entries.read().await;
        entries
            .get(session_id)
            .cloned()
            .ok_or_else(|| GoTRegistryError::NotFound {
                session_id: session_id.to_string(),
            })
    }

    /// 移除并返回 GoT 条目
    pub async fn remove(&self, session_id: &str) -> Result<GoTEntry, GoTRegistryError> {
        let mut entries = self.entries.write().await;
        entries
            .remove(session_id)
            .ok_or_else(|| GoTRegistryError::NotFound {
                session_id: session_id.to_string(),
            })
    }

    /// 中断指定 GoT
    pub async fn abort(&self, session_id: &str) -> Result<(), GoTRegistryError> {
        let entry = self.get(session_id).await?;
        entry.abort();
        Ok(())
    }

    /// 检查 GoT 是否存在
    pub async fn contains(&self, session_id: &str) -> bool {
        self.entries.read().await.contains_key(session_id)
    }

    /// 列出所有 session_id
    pub async fn list(&self) -> Vec<String> {
        self.entries.read().await.keys().cloned().collect()
    }

    /// 当前注册数量
    pub async fn count(&self) -> usize {
        self.entries.read().await.len()
    }

    /// 清空所有 GoT（应用退出时清理）
    pub async fn clear(&self) {
        self.entries.write().await.clear();
    }
}

impl Default for GoTRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 适配器：中断检查 / 事件发射 ────────────────────────────────────────────

/// 中断检查适配器 — 把 `Arc<AtomicBool>` 适配为 `AbortCheck` trait
///
/// 在 `cmd_got_run` 中构造 NodeContext 时注入，
/// 使 GoTNode.execute 通过 ctx.is_aborted() 能读到 abort_flag。
pub struct GoTAbortCheck {
    abort_flag: Arc<AtomicBool>,
}

impl GoTAbortCheck {
    pub fn new(abort_flag: Arc<AtomicBool>) -> Self {
        Self { abort_flag }
    }
}

#[async_trait]
impl AbortCheck for GoTAbortCheck {
    fn is_aborted(&self) -> bool {
        self.abort_flag.load(Ordering::SeqCst)
    }

    async fn wait_if_paused(&self) {
        // 阶段 2.2 不实现 pause/resume，仅响应 abort
    }
}

/// 事件发射适配器 — 把事件推送到 `EventBroadcaster`
///
/// 在 `cmd_got_run` 中构造 NodeContext 时注入，
/// GoTNode.execute 通过 ctx.emit(event) 触发事件，
/// 本适配器把事件转发到 broadcaster，broadcaster 再 fan-out 到所有 listener
/// （如 TauriEventListener → 前端）。
pub struct GoTEmitter {
    broadcaster: Arc<RwLock<EventBroadcaster>>,
}

impl GoTEmitter {
    pub fn new(broadcaster: Arc<RwLock<EventBroadcaster>>) -> Self {
        Self { broadcaster }
    }
}

impl EventEmitter for GoTEmitter {
    fn emit(&self, event: OrchestratorEvent) {
        // 通过 try_read 避免阻塞：若锁被占用（极少见），丢弃事件并记录警告
        // 这与 ToTEmitter / SupervisorEmitter 的策略一致
        match self.broadcaster.try_read() {
            Ok(bc) => bc.broadcast(&event),
            Err(_) => {
                warn!(
                    "GoTEmitter: broadcaster 锁占用，事件被丢弃: {:?}",
                    std::mem::discriminant(&event)
                );
            }
        }
    }
}

// ─── 思维图快照（前端展示用） ────────────────────────────────────────────

/// 思维图快照 — 用于 `cmd_got_get_tree` 返回
///
/// 与 `ToTTreeSnapshot` 形态一致，但独立类型以区分 GoT 语义：
/// - GoT 节点可能有多 parent（`parents` 字段非空）
/// - 前端可据此区分事件来自 ToT 还是 GoT
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoTGraphSnapshot {
    /// 所有思维节点（扁平列表，前端可按 parent_id / parents 重建图结构）
    ///
    /// 注意：GoT 中聚合节点的 `parents` 字段非空（多个源节点 ID），
    /// 前端可据此渲染图的聚合边。
    pub nodes: Vec<ThoughtNode>,
    /// 最优节点 ID（执行完成后更新；执行中为 None）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub best_node_id: Option<String>,
    /// 节点总数
    pub total_count: usize,
    /// 当前最大深度
    pub max_depth_reached: usize,
}

impl GoTGraphSnapshot {
    /// 从节点列表构造快照
    pub fn from_nodes(nodes: Vec<ThoughtNode>, best_node_id: Option<String>) -> Self {
        let total_count = nodes.len();
        let max_depth_reached = nodes.iter().map(|n| n.depth).max().unwrap_or(0);
        Self {
            nodes,
            best_node_id,
            total_count,
            max_depth_reached,
        }
    }
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_and_get_should_succeed() {
        let registry = GoTRegistry::new();
        assert_eq!(registry.count().await, 0);
        assert!(registry.list().await.is_empty());
    }

    #[tokio::test]
    async fn get_nonexistent_should_return_not_found() {
        let registry = GoTRegistry::new();
        let result = registry.get("nope").await;
        assert!(matches!(result, Err(GoTRegistryError::NotFound { .. })));
    }

    #[test]
    fn got_registry_error_should_serialize_to_json() {
        let err = GoTRegistryError::NotFound {
            session_id: "got_1".into(),
        };
        let json = serde_json::to_string(&err).expect("应能序列化");
        assert!(json.contains("\"kind\":\"not_found\""));
        assert!(json.contains("\"session_id\":\"got_1\""));
    }

    #[test]
    fn abort_flag_should_be_atomic_and_visible() {
        let flag = Arc::new(AtomicBool::new(false));
        let checker = GoTAbortCheck::new(Arc::clone(&flag));

        assert!(!checker.is_aborted());
        flag.store(true, Ordering::SeqCst);
        assert!(checker.is_aborted());
    }

    #[test]
    fn graph_snapshot_should_compute_total_and_max_depth() {
        // 模拟一个聚合节点（parents 非空）
        let nodes = vec![
            ThoughtNode {
                id: "thought_1".into(),
                content: "源1".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 0,
                score: Some(75),
                score_reasoning: None,
                children: vec!["thought_3".into()],
                status: agent_runtime::tree_of_thoughts::ThoughtNodeStatus::Expanded,
            },
            ThoughtNode {
                id: "thought_2".into(),
                content: "源2".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 0,
                score: Some(80),
                score_reasoning: None,
                children: vec!["thought_3".into()],
                status: agent_runtime::tree_of_thoughts::ThoughtNodeStatus::Expanded,
            },
            ThoughtNode {
                id: "thought_3".into(),
                content: "聚合".into(),
                parent_id: Some("thought_1".into()),
                parents: vec!["thought_1".into(), "thought_2".into()],
                depth: 0,
                score: Some(90),
                score_reasoning: Some("聚合更优".into()),
                children: vec![],
                status: agent_runtime::tree_of_thoughts::ThoughtNodeStatus::Scored,
            },
        ];
        let snapshot = GoTGraphSnapshot::from_nodes(nodes, Some("thought_3".into()));
        assert_eq!(snapshot.total_count, 3);
        assert_eq!(snapshot.max_depth_reached, 0);
        assert_eq!(snapshot.best_node_id.as_deref(), Some("thought_3"));
    }
}
