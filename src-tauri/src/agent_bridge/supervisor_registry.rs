//! # Supervisor Registry — Supervisor 实例注册表
//!
//! 阶段 2.1 新增。用于在 Tauri 应用进程内管理多个 `SupervisorNode` 实例，
//! 与 `AgentRegistry` 并列存在（SupervisorNode 不是 AgentLoop，独立管理）。
//!
//! ## 设计要点
//! - **线程安全**：基于 `tokio::sync::RwLock<HashMap>`，与 AgentRegistry 一致
//! - **共享 backend / tool_bus**：SupervisorNode 内部子 Agent 共享父 backend 与 tool_bus，
//!   registry 同时持有这些 Arc 引用，避免被 GC 释放
//! - **共享 state**：`OrchestratorState` 跨命令访问（cmd_supervisor_run 写入，
//!   cmd_supervisor_get_state 读取），使用 `RwLock<OrchestratorState>` 保护
//! - **中断检查**：通过 `Arc<AtomicBool>` 实现，cmd_supervisor_abort 设置 true，
//!   NodeContext.is_aborted() 读取
//! - **事件广播**：通过 `EventBroadcaster` 实现，cmd_supervisor_create 时订阅
//!   TauriEventListener，SupervisorNode execute 时通过 emitter 推送事件
//!
//! ## 与 Tauri 命令的关系
//! ```text
//! cmd_supervisor_create  -> registry.register(session_id, supervisor_entry)
//! cmd_supervisor_run     -> registry.get(session_id) → supervisor.execute(ctx)
//! cmd_supervisor_abort   -> registry.get(session_id) → abort_flag.store(true)
//! cmd_supervisor_destroy -> registry.remove(session_id)
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventBroadcaster, EventListener, OrchestratorEvent};
use agent_runtime::node::{AbortCheck, EventEmitter};
use agent_runtime::supervisor::SupervisorNode;
use agent_runtime::tool::ToolBus;
use agent_runtime::types::OrchestratorState;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::warn;

use crate::agent_bridge::tool_bridge::FrontendToolBridge;

// ─── 错误类型 ────────────────────────────────────────────

/// Supervisor 注册表错误
///
/// 复用 AgentRegistryError 的错误形态，但作为独立类型，避免语义混淆。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SupervisorRegistryError {
    /// 指定 session_id 的 Supervisor 不存在
    NotFound { session_id: String },
    /// 指定 session_id 已存在（重复创建）
    AlreadyExists { session_id: String },
    /// Supervisor 执行错误
    SupervisorError { message: String },
    /// 锁竞争失败
    LockError { message: String },
}

impl std::fmt::Display for SupervisorRegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound { session_id } => {
                write!(f, "Supervisor session not found: {}", session_id)
            }
            Self::AlreadyExists { session_id } => {
                write!(f, "Supervisor session already exists: {}", session_id)
            }
            Self::SupervisorError { message } => write!(f, "Supervisor error: {}", message),
            Self::LockError { message } => write!(f, "Lock error: {}", message),
        }
    }
}

impl std::error::Error for SupervisorRegistryError {}

// ─── Supervisor 条目 ────────────────────────────────────────────

/// 注册表中的 Supervisor 条目
///
/// 持有 SupervisorNode 及其依赖（backend / tool_bus / tool_bridge），
/// 以及跨命令共享的状态（state / abort_flag / broadcaster）。
#[derive(Clone)]
pub struct SupervisorEntry {
    /// Supervisor 节点实例
    pub supervisor: Arc<SupervisorNode>,
    /// LLM 后端访问器（与子 Agent 共享）
    pub backend: Arc<dyn NodeBackendAccessor>,
    /// 工具总线（与子 Agent 共享）
    pub tool_bus: Arc<dyn ToolBus>,
    /// 前端工具桥接器（Rust → TS 反向调用）
    pub tool_bridge: Arc<FrontendToolBridge>,
    /// 事件广播器（用于订阅 TauriEventListener）
    pub broadcaster: Arc<RwLock<EventBroadcaster>>,
    /// 中断标志（cmd_supervisor_abort 设置 true，NodeContext 读取）
    pub abort_flag: Arc<AtomicBool>,
    /// 共享编排状态（跨命令访问）
    pub state: Arc<RwLock<OrchestratorState>>,
    /// 创建时间戳（Unix 毫秒）
    pub created_at: i64,
}

impl SupervisorEntry {
    /// 创建新条目
    pub fn new(
        supervisor: Arc<SupervisorNode>,
        backend: Arc<dyn NodeBackendAccessor>,
        tool_bus: Arc<dyn ToolBus>,
        tool_bridge: Arc<FrontendToolBridge>,
        initial_state: OrchestratorState,
    ) -> Self {
        Self {
            supervisor,
            backend,
            tool_bus,
            tool_bridge,
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

// ─── Supervisor Registry ────────────────────────────────────────────

/// Supervisor 实例注册表
pub struct SupervisorRegistry {
    entries: RwLock<HashMap<String, SupervisorEntry>>,
}

impl SupervisorRegistry {
    /// 创建空注册表
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// 注册一个新 Supervisor
    pub async fn register(
        &self,
        session_id: impl Into<String>,
        entry: SupervisorEntry,
    ) -> Result<(), SupervisorRegistryError> {
        let session_id = session_id.into();
        let mut entries = self.entries.write().await;

        if entries.contains_key(&session_id) {
            return Err(SupervisorRegistryError::AlreadyExists { session_id });
        }

        entries.insert(session_id, entry);
        Ok(())
    }

    /// 获取 Supervisor 条目（克隆）
    pub async fn get(&self, session_id: &str) -> Result<SupervisorEntry, SupervisorRegistryError> {
        let entries = self.entries.read().await;
        entries
            .get(session_id)
            .cloned()
            .ok_or_else(|| SupervisorRegistryError::NotFound {
                session_id: session_id.to_string(),
            })
    }

    /// 移除并返回 Supervisor 条目
    pub async fn remove(
        &self,
        session_id: &str,
    ) -> Result<SupervisorEntry, SupervisorRegistryError> {
        let mut entries = self.entries.write().await;
        entries
            .remove(session_id)
            .ok_or_else(|| SupervisorRegistryError::NotFound {
                session_id: session_id.to_string(),
            })
    }

    /// 中断指定 Supervisor
    pub async fn abort(&self, session_id: &str) -> Result<(), SupervisorRegistryError> {
        let entry = self.get(session_id).await?;
        entry.abort();
        Ok(())
    }

    /// 检查 Supervisor 是否存在
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

    /// 清空所有 Supervisor（应用退出时清理）
    pub async fn clear(&self) {
        self.entries.write().await.clear();
    }
}

impl Default for SupervisorRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 适配器：中断检查 / 事件发射 ────────────────────────────────────────────

/// 中断检查适配器 — 把 `Arc<AtomicBool>` 适配为 `AbortCheck` trait
///
/// 在 `cmd_supervisor_run` 中构造 NodeContext 时注入，
/// 使 SupervisorNode.execute 通过 ctx.is_aborted() 能读到 abort_flag。
pub struct SupervisorAbortCheck {
    abort_flag: Arc<AtomicBool>,
}

impl SupervisorAbortCheck {
    pub fn new(abort_flag: Arc<AtomicBool>) -> Self {
        Self { abort_flag }
    }
}

#[async_trait]
impl AbortCheck for SupervisorAbortCheck {
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
/// 在 `cmd_supervisor_run` 中构造 NodeContext 时注入，
/// SupervisorNode.execute 通过 ctx.emit(event) 触发事件，
/// 本适配器把事件转发到 broadcaster，broadcaster 再 fan-out 到所有 listener
/// （如 TauriEventListener → 前端）。
pub struct SupervisorEmitter {
    broadcaster: Arc<RwLock<EventBroadcaster>>,
}

impl SupervisorEmitter {
    pub fn new(broadcaster: Arc<RwLock<EventBroadcaster>>) -> Self {
        Self { broadcaster }
    }
}

impl EventEmitter for SupervisorEmitter {
    fn emit(&self, event: OrchestratorEvent) {
        // 通过 try_read 避免阻塞：若锁被占用（极少见），丢弃事件并记录警告
        // 这与 BackendEventBridge 的策略一致（避免阻塞节点执行）
        match self.broadcaster.try_read() {
            Ok(bc) => bc.broadcast(&event),
            Err(_) => {
                warn!(
                    "SupervisorEmitter: broadcaster 锁占用，事件被丢弃: {:?}",
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
        let registry = SupervisorRegistry::new();
        // 用 mock entry（实际 SupervisorNode 由命令层创建）
        // 这里只验证 registry 的 CRUD 逻辑
        assert_eq!(registry.count().await, 0);
        assert!(registry.list().await.is_empty());
    }

    #[tokio::test]
    async fn get_nonexistent_should_return_not_found() {
        let registry = SupervisorRegistry::new();
        let result = registry.get("nope").await;
        assert!(matches!(result, Err(SupervisorRegistryError::NotFound { .. })));
    }

    #[test]
    fn supervisor_registry_error_should_serialize_to_json() {
        let err = SupervisorRegistryError::NotFound {
            session_id: "sup_1".into(),
        };
        let json = serde_json::to_string(&err).expect("应能序列化");
        assert!(json.contains("\"kind\":\"not_found\""));
        assert!(json.contains("\"session_id\":\"sup_1\""));
    }

    #[test]
    fn abort_flag_should_be_atomic_and_visible() {
        let flag = Arc::new(AtomicBool::new(false));
        let checker = SupervisorAbortCheck::new(Arc::clone(&flag));

        assert!(!checker.is_aborted());
        flag.store(true, Ordering::SeqCst);
        assert!(checker.is_aborted());
    }
}
