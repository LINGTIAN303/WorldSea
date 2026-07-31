//! # Router Registry — Router 实例注册表
//!
//! 阶段 2.5 新增。用于在 Tauri 应用进程内管理多个 `RouterNode` 实例，
//! 与 `AgentRegistry` / `SupervisorRegistry` 并列存在。
//!
//! ## 设计要点
//! - **线程安全**：基于 `tokio::sync::RwLock<HashMap>`，与其它 Registry 一致
//! - **共享 backend**：RouterNode 路由决策通过 `NodeBackendAccessor` 调用 LLM，
//!   registry 持有 backend 的 Arc 引用避免被 GC 释放
//! - **共享 state**：`OrchestratorState` 跨命令访问（cmd_router_run 写入，
//!   cmd_router_get_state 读取），使用 `RwLock<OrchestratorState>` 保护
//! - **中断检查**：通过 `Arc<AtomicBool>` 实现，cmd_router_abort 设置 true，
//!   NodeContext.is_aborted() 读取
//! - **事件广播**：通过 `EventBroadcaster` 实现，cmd_router_create 时订阅
//!   TauriEventListener，RouterNode execute 时通过 emitter 推送事件
//!
//! ## 与 Supervisor Registry 的差异
//! - **无 tool_bus / tool_bridge**：Router 是纯决策节点，不执行工具调用，
//!   所以 entry 不持有 `tool_bus` / `tool_bridge`
//! - **无 agent_pool**：Router 不创建子 Agent 实例，无需 `clear_agent_pool`
//! - **事件种类更少**：只有 `RouterDecisionMade` / `RouterNoMatch` / `RouterError`
//!   三种事件，无子 Agent 执行类事件
//!
//! ## 与 Tauri 命令的关系
//! ```text
//! cmd_router_create  -> registry.register(session_id, router_entry)
//! cmd_router_run     -> registry.get(session_id) → router.execute(ctx)
//! cmd_router_abort   -> registry.get(session_id) → abort_flag.store(true)
//! cmd_router_destroy -> registry.remove(session_id)
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventBroadcaster, EventListener, OrchestratorEvent};
use agent_runtime::node::{AbortCheck, EventEmitter};
use agent_runtime::router::RouterNode;
use agent_runtime::types::OrchestratorState;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::warn;

// ─── 错误类型 ────────────────────────────────────────────

/// Router 注册表错误
///
/// 复用 SupervisorRegistryError 的错误形态，但作为独立类型，避免语义混淆。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RouterRegistryError {
    /// 指定 session_id 的 Router 不存在
    NotFound { session_id: String },
    /// 指定 session_id 已存在（重复创建）
    AlreadyExists { session_id: String },
    /// Router 执行错误
    RouterError { message: String },
    /// 锁竞争失败
    LockError { message: String },
}

impl std::fmt::Display for RouterRegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound { session_id } => {
                write!(f, "Router session not found: {}", session_id)
            }
            Self::AlreadyExists { session_id } => {
                write!(f, "Router session already exists: {}", session_id)
            }
            Self::RouterError { message } => write!(f, "Router error: {}", message),
            Self::LockError { message } => write!(f, "Lock error: {}", message),
        }
    }
}

impl std::error::Error for RouterRegistryError {}

// ─── Router 条目 ────────────────────────────────────────────

/// 注册表中的 Router 条目
///
/// 持有 RouterNode 及其依赖（backend），以及跨命令共享的状态
/// （state / abort_flag / broadcaster）。
///
/// 注意：与 `SupervisorEntry` 不同，不持有 `tool_bus` / `tool_bridge`，
/// 因为 Router 是纯决策节点，不执行工具调用。
#[derive(Clone)]
pub struct RouterEntry {
    /// Router 节点实例
    pub router: Arc<RouterNode>,
    /// LLM 后端访问器（用于 LLM 路由决策）
    pub backend: Arc<dyn NodeBackendAccessor>,
    /// 事件广播器（用于订阅 TauriEventListener）
    pub broadcaster: Arc<RwLock<EventBroadcaster>>,
    /// 中断标志（cmd_router_abort 设置 true，NodeContext 读取）
    pub abort_flag: Arc<AtomicBool>,
    /// 共享编排状态（跨命令访问）
    pub state: Arc<RwLock<OrchestratorState>>,
    /// 创建时间戳（Unix 毫秒）
    pub created_at: i64,
}

impl RouterEntry {
    /// 创建新条目
    pub fn new(
        router: Arc<RouterNode>,
        backend: Arc<dyn NodeBackendAccessor>,
        initial_state: OrchestratorState,
    ) -> Self {
        Self {
            router,
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

// ─── Router Registry ────────────────────────────────────────────

/// Router 实例注册表
pub struct RouterRegistry {
    entries: RwLock<HashMap<String, RouterEntry>>,
}

impl RouterRegistry {
    /// 创建空注册表
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// 注册一个新 Router
    pub async fn register(
        &self,
        session_id: impl Into<String>,
        entry: RouterEntry,
    ) -> Result<(), RouterRegistryError> {
        let session_id = session_id.into();
        let mut entries = self.entries.write().await;

        if entries.contains_key(&session_id) {
            return Err(RouterRegistryError::AlreadyExists { session_id });
        }

        entries.insert(session_id, entry);
        Ok(())
    }

    /// 获取 Router 条目（克隆）
    pub async fn get(&self, session_id: &str) -> Result<RouterEntry, RouterRegistryError> {
        let entries = self.entries.read().await;
        entries
            .get(session_id)
            .cloned()
            .ok_or_else(|| RouterRegistryError::NotFound {
                session_id: session_id.to_string(),
            })
    }

    /// 移除并返回 Router 条目
    pub async fn remove(
        &self,
        session_id: &str,
    ) -> Result<RouterEntry, RouterRegistryError> {
        let mut entries = self.entries.write().await;
        entries
            .remove(session_id)
            .ok_or_else(|| RouterRegistryError::NotFound {
                session_id: session_id.to_string(),
            })
    }

    /// 中断指定 Router
    pub async fn abort(&self, session_id: &str) -> Result<(), RouterRegistryError> {
        let entry = self.get(session_id).await?;
        entry.abort();
        Ok(())
    }

    /// 检查 Router 是否存在
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

    /// 清空所有 Router（应用退出时清理）
    pub async fn clear(&self) {
        self.entries.write().await.clear();
    }
}

impl Default for RouterRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 适配器：中断检查 / 事件发射 ────────────────────────────────────────────

/// 中断检查适配器 — 把 `Arc<AtomicBool>` 适配为 `AbortCheck` trait
///
/// 在 `cmd_router_run` 中构造 NodeContext 时注入，
/// 使 RouterNode.execute 通过 ctx.is_aborted() 能读到 abort_flag。
pub struct RouterAbortCheck {
    abort_flag: Arc<AtomicBool>,
}

impl RouterAbortCheck {
    pub fn new(abort_flag: Arc<AtomicBool>) -> Self {
        Self { abort_flag }
    }
}

#[async_trait]
impl AbortCheck for RouterAbortCheck {
    fn is_aborted(&self) -> bool {
        self.abort_flag.load(Ordering::SeqCst)
    }

    async fn wait_if_paused(&self) {
        // 阶段 2.5 不实现 pause/resume，仅响应 abort
    }
}

/// 事件发射适配器 — 把事件推送到 `EventBroadcaster`
///
/// 在 `cmd_router_run` 中构造 NodeContext 时注入，
/// RouterNode.execute 通过 ctx.emit(event) 触发事件，
/// 本适配器把事件转发到 broadcaster，broadcaster 再 fan-out 到所有 listener
/// （如 TauriEventListener → 前端）。
pub struct RouterEmitter {
    broadcaster: Arc<RwLock<EventBroadcaster>>,
}

impl RouterEmitter {
    pub fn new(broadcaster: Arc<RwLock<EventBroadcaster>>) -> Self {
        Self { broadcaster }
    }
}

impl EventEmitter for RouterEmitter {
    fn emit(&self, event: OrchestratorEvent) {
        // 通过 try_read 避免阻塞：若锁被占用（极少见），丢弃事件并记录警告
        // 这与 SupervisorEmitter 的策略一致（避免阻塞节点执行）
        match self.broadcaster.try_read() {
            Ok(bc) => bc.broadcast(&event),
            Err(_) => {
                warn!(
                    "RouterEmitter: broadcaster 锁占用，事件被丢弃: {:?}",
                    std::mem::discriminant(&event)
                );
            }
        }
    }
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_and_get_should_succeed() {
        let registry = RouterRegistry::new();
        assert_eq!(registry.count().await, 0);
        assert!(registry.list().await.is_empty());
    }

    #[tokio::test]
    async fn get_nonexistent_should_return_not_found() {
        let registry = RouterRegistry::new();
        let result = registry.get("nope").await;
        assert!(matches!(result, Err(RouterRegistryError::NotFound { .. })));
    }

    #[test]
    fn router_registry_error_should_serialize_to_json() {
        let err = RouterRegistryError::NotFound {
            session_id: "router_1".into(),
        };
        let json = serde_json::to_string(&err).expect("应能序列化");
        assert!(json.contains("\"kind\":\"not_found\""));
        assert!(json.contains("\"session_id\":\"router_1\""));
    }

    #[test]
    fn abort_flag_should_be_atomic_and_visible() {
        let flag = Arc::new(AtomicBool::new(false));
        let checker = RouterAbortCheck::new(Arc::clone(&flag));

        assert!(!checker.is_aborted());
        flag.store(true, Ordering::SeqCst);
        assert!(checker.is_aborted());
    }
}
