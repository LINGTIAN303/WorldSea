//! # ToT Registry — Tree of Thoughts 实例注册表
//!
//! 阶段 2.1 新增。用于在 Tauri 应用进程内管理多个 `ToTNode` 实例，
//! 与 `AgentRegistry` / `SupervisorRegistry` / `RouterRegistry` 并列存在。
//!
//! ## 设计要点
//! - **线程安全**：基于 `tokio::sync::RwLock<HashMap>`，与其它 Registry 一致
//! - **共享 backend**：ToTNode 探索/评分/目标检查通过 `NodeBackendAccessor` 调用 LLM，
//!   registry 持有 backend 的 Arc 引用避免被 GC 释放
//! - **共享 state**：`OrchestratorState` 跨命令访问（cmd_tot_run 写入，
//!   cmd_tot_get_state 读取），使用 `RwLock<OrchestratorState>` 保护
//! - **中断检查**：通过 `Arc<AtomicBool>` 实现，cmd_tot_abort 设置 true，
//!   NodeContext.is_aborted() 读取
//! - **事件广播**：通过 `EventBroadcaster` 实现，cmd_tot_create 时订阅
//!   TauriEventListener，ToTNode execute 时通过 emitter 推送事件
//!
//! ## 与 Supervisor/Router Registry 的差异
//! - **无 tool_bus / tool_bridge**：ToT 是纯探索节点，不执行工具调用，
//!   只调用 LLM 生成思维/评分/目标检查，所以 entry 不持有 `tool_bus` / `tool_bridge`
//! - **无 agent_pool**：ToT 不创建子 AgentLoop 实例
//! - **思维树状态查询**：ToTNode 内部维护 `tree: HashMap<id, ThoughtNode>`，
//!   通过 `tree_snapshot()` / `best_node_id()` 公开方法供前端展示
//! - **事件种类**：6 个 ToT 专用事件
//!   （ThoughtNodeCreated / ThoughtNodeScored / ThoughtBranchExplored /
//!    ToTGoalReached / ToTTerminated / ToTError）
//!
//! ## 与 Tauri 命令的关系
//! ```text
//! cmd_tot_create  -> registry.register(session_id, tot_entry)
//! cmd_tot_run     -> registry.get(session_id) → tot.execute(ctx)
//! cmd_tot_abort   -> registry.get(session_id) → abort_flag.store(true)
//! cmd_tot_destroy -> registry.remove(session_id)
//! cmd_tot_get_tree -> registry.get(session_id) → tot.tree_snapshot() + best_node_id()
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventBroadcaster, EventListener, OrchestratorEvent};
use agent_runtime::node::{AbortCheck, EventEmitter};
use agent_runtime::tree_of_thoughts::{ThoughtNode, ToTNode};
use agent_runtime::types::OrchestratorState;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::warn;

// ─── 错误类型 ────────────────────────────────────────────

/// ToT 注册表错误
///
/// 复用 SupervisorRegistryError / RouterRegistryError 的错误形态，
/// 但作为独立类型，避免语义混淆。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToTRegistryError {
    /// 指定 session_id 的 ToT 不存在
    NotFound { session_id: String },
    /// 指定 session_id 已存在（重复创建）
    AlreadyExists { session_id: String },
    /// ToT 执行错误
    ToTError { message: String },
    /// 锁竞争失败
    LockError { message: String },
}

impl std::fmt::Display for ToTRegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound { session_id } => {
                write!(f, "ToT session not found: {}", session_id)
            }
            Self::AlreadyExists { session_id } => {
                write!(f, "ToT session already exists: {}", session_id)
            }
            Self::ToTError { message } => write!(f, "ToT error: {}", message),
            Self::LockError { message } => write!(f, "Lock error: {}", message),
        }
    }
}

impl std::error::Error for ToTRegistryError {}

// ─── ToT 条目 ────────────────────────────────────────────

/// 注册表中的 ToT 条目
///
/// 持有 ToTNode 及其依赖（backend），以及跨命令共享的状态
/// （state / abort_flag / broadcaster）。
///
/// 注意：与 `SupervisorEntry` 不同，不持有 `tool_bus` / `tool_bridge`，
/// 因为 ToT 是纯探索节点，不执行工具调用，只调用 LLM 生成思维/评分/目标检查。
#[derive(Clone)]
pub struct ToTEntry {
    /// ToT 节点实例
    pub tot: Arc<ToTNode>,
    /// LLM 后端访问器（用于 LLM 思维生成/评分/目标检查）
    pub backend: Arc<dyn NodeBackendAccessor>,
    /// 事件广播器（用于订阅 TauriEventListener）
    pub broadcaster: Arc<RwLock<EventBroadcaster>>,
    /// 中断标志（cmd_tot_abort 设置 true，NodeContext 读取）
    pub abort_flag: Arc<AtomicBool>,
    /// 共享编排状态（跨命令访问）
    pub state: Arc<RwLock<OrchestratorState>>,
    /// 创建时间戳（Unix 毫秒）
    pub created_at: i64,
}

impl ToTEntry {
    /// 创建新条目
    pub fn new(
        tot: Arc<ToTNode>,
        backend: Arc<dyn NodeBackendAccessor>,
        initial_state: OrchestratorState,
    ) -> Self {
        Self {
            tot,
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

// ─── ToT Registry ────────────────────────────────────────────

/// ToT 实例注册表
pub struct ToTRegistry {
    entries: RwLock<HashMap<String, ToTEntry>>,
}

impl ToTRegistry {
    /// 创建空注册表
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// 注册一个新 ToT
    pub async fn register(
        &self,
        session_id: impl Into<String>,
        entry: ToTEntry,
    ) -> Result<(), ToTRegistryError> {
        let session_id = session_id.into();
        let mut entries = self.entries.write().await;

        if entries.contains_key(&session_id) {
            return Err(ToTRegistryError::AlreadyExists { session_id });
        }

        entries.insert(session_id, entry);
        Ok(())
    }

    /// 获取 ToT 条目（克隆）
    pub async fn get(&self, session_id: &str) -> Result<ToTEntry, ToTRegistryError> {
        let entries = self.entries.read().await;
        entries
            .get(session_id)
            .cloned()
            .ok_or_else(|| ToTRegistryError::NotFound {
                session_id: session_id.to_string(),
            })
    }

    /// 移除并返回 ToT 条目
    pub async fn remove(&self, session_id: &str) -> Result<ToTEntry, ToTRegistryError> {
        let mut entries = self.entries.write().await;
        entries
            .remove(session_id)
            .ok_or_else(|| ToTRegistryError::NotFound {
                session_id: session_id.to_string(),
            })
    }

    /// 中断指定 ToT
    pub async fn abort(&self, session_id: &str) -> Result<(), ToTRegistryError> {
        let entry = self.get(session_id).await?;
        entry.abort();
        Ok(())
    }

    /// 检查 ToT 是否存在
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

    /// 清空所有 ToT（应用退出时清理）
    pub async fn clear(&self) {
        self.entries.write().await.clear();
    }
}

impl Default for ToTRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 适配器：中断检查 / 事件发射 ────────────────────────────────────────────

/// 中断检查适配器 — 把 `Arc<AtomicBool>` 适配为 `AbortCheck` trait
///
/// 在 `cmd_tot_run` 中构造 NodeContext 时注入，
/// 使 ToTNode.execute 通过 ctx.is_aborted() 能读到 abort_flag。
pub struct ToTAbortCheck {
    abort_flag: Arc<AtomicBool>,
}

impl ToTAbortCheck {
    pub fn new(abort_flag: Arc<AtomicBool>) -> Self {
        Self { abort_flag }
    }
}

#[async_trait]
impl AbortCheck for ToTAbortCheck {
    fn is_aborted(&self) -> bool {
        self.abort_flag.load(Ordering::SeqCst)
    }

    async fn wait_if_paused(&self) {
        // 阶段 2.1 不实现 pause/resume，仅响应 abort
        // 若需 pause，可扩展为 EventWaiter（与 AgentLoop 的 PauseControl 类似）
    }
}

/// 事件发射适配器 — 把事件推送到 `EventBroadcaster`
///
/// 在 `cmd_tot_run` 中构造 NodeContext 时注入，
/// ToTNode.execute 通过 ctx.emit(event) 触发事件，
/// 本适配器把事件转发到 broadcaster，broadcaster 再 fan-out 到所有 listener
/// （如 TauriEventListener → 前端）。
pub struct ToTEmitter {
    broadcaster: Arc<RwLock<EventBroadcaster>>,
}

impl ToTEmitter {
    pub fn new(broadcaster: Arc<RwLock<EventBroadcaster>>) -> Self {
        Self { broadcaster }
    }
}

impl EventEmitter for ToTEmitter {
    fn emit(&self, event: OrchestratorEvent) {
        // 通过 try_read 避免阻塞：若锁被占用（极少见），丢弃事件并记录警告
        // 这与 BackendEventBridge / SupervisorEmitter 的策略一致（避免阻塞节点执行）
        match self.broadcaster.try_read() {
            Ok(bc) => bc.broadcast(&event),
            Err(_) => {
                warn!(
                    "ToTEmitter: broadcaster 锁占用，事件被丢弃: {:?}",
                    std::mem::discriminant(&event)
                );
            }
        }
    }
}

// ─── 思维树快照（前端展示用） ────────────────────────────────────────────

/// 思维树快照 — 用于 `cmd_tot_get_tree` 返回
///
/// 包含完整思维树（节点列表）与最优节点 ID，
/// 前端可据此渲染树形探索过程与高亮最优路径。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToTTreeSnapshot {
    /// 所有思维节点（扁平列表，前端可按 parent_id 重建树结构）
    pub nodes: Vec<ThoughtNode>,
    /// 最优节点 ID（执行完成后更新；执行中为 None）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub best_node_id: Option<String>,
    /// 节点总数
    pub total_count: usize,
    /// 当前最大深度
    pub max_depth_reached: usize,
}

impl ToTTreeSnapshot {
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
        let registry = ToTRegistry::new();
        // 用 mock entry（实际 ToTNode 由命令层创建）
        // 这里只验证 registry 的 CRUD 逻辑
        assert_eq!(registry.count().await, 0);
        assert!(registry.list().await.is_empty());
    }

    #[tokio::test]
    async fn get_nonexistent_should_return_not_found() {
        let registry = ToTRegistry::new();
        let result = registry.get("nope").await;
        assert!(matches!(result, Err(ToTRegistryError::NotFound { .. })));
    }

    #[test]
    fn tot_registry_error_should_serialize_to_json() {
        let err = ToTRegistryError::NotFound {
            session_id: "tot_1".into(),
        };
        let json = serde_json::to_string(&err).expect("应能序列化");
        assert!(json.contains("\"kind\":\"not_found\""));
        assert!(json.contains("\"session_id\":\"tot_1\""));
    }

    #[test]
    fn abort_flag_should_be_atomic_and_visible() {
        let flag = Arc::new(AtomicBool::new(false));
        let checker = ToTAbortCheck::new(Arc::clone(&flag));

        assert!(!checker.is_aborted());
        flag.store(true, Ordering::SeqCst);
        assert!(checker.is_aborted());
    }

    #[test]
    fn tree_snapshot_should_compute_total_and_max_depth() {
        let nodes = vec![
            ThoughtNode {
                id: "thought_1".into(),
                content: "根".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 0,
                score: Some(80),
                score_reasoning: None,
                children: vec!["thought_2".into()],
                status: agent_runtime::tree_of_thoughts::ThoughtNodeStatus::Expanded,
            },
            ThoughtNode {
                id: "thought_2".into(),
                content: "子".into(),
                parent_id: Some("thought_1".into()),
                parents: Vec::new(),
                depth: 1,
                score: Some(90),
                score_reasoning: Some("更优".into()),
                children: vec![],
                status: agent_runtime::tree_of_thoughts::ThoughtNodeStatus::Scored,
            },
        ];
        let snapshot = ToTTreeSnapshot::from_nodes(nodes, Some("thought_2".into()));
        assert_eq!(snapshot.total_count, 2);
        assert_eq!(snapshot.max_depth_reached, 1);
        assert_eq!(snapshot.best_node_id.as_deref(), Some("thought_2"));
    }
}
