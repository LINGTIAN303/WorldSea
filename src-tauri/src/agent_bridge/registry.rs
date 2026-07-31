//! # Agent Registry — Agent 实例注册表
//!
//! 阶段 1.5 新增。用于在 Tauri 应用进程内管理多个 `AgentLoop` 实例，
//! 对应前端"多实例"Agent 管理策略（每个会话一个独立 Agent）。
//!
//! ## 设计要点
//! - **线程安全**：基于 `tokio::sync::RwLock<HashMap>`，读写分离，适合"读多写少"场景
//! - **生命周期**：`AgentLoop` 通过 `Arc` 共享所有权，注册表只持有引用
//! - **当前 message_id**：每个 Agent 会维护一个"当前消息 ID"，供 `StreamDelta`/`StreamEnd` 关联
//! - **不持有 backend / tool_bus 句柄**：这些已封装在 `AgentLoop` 内部，注册表只管 Agent 本身
//!
//! ## 与 Tauri 命令的关系
//! ```text
//! cmd_agent_create  -> registry.register(session_id, agent)
//! cmd_agent_prompt  -> registry.get(session_id) → agent.run(input)
//! cmd_agent_abort   -> registry.get(session_id) → agent.abort()
//! cmd_agent_destroy -> registry.remove(session_id)
//! ```
//!
//! 错误处理：所有 Tauri 命令通过 `Result<T, AgentRegistryError>` 返回，
//! `AgentRegistryError` 实现 `Serialize` 以便通过 Tauri 命令边界传递。

use std::collections::HashMap;
use std::sync::{Arc, RwLock as StdRwLock};

use agent_runtime::AgentLoop;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::warn;
use uuid::Uuid;

use crate::agent_bridge::tool_bridge::FrontendToolBridge;

// ─── 共享消息 ID 类型 ────────────────────────────────────────────

/// 共享的消息 ID（在 `AgentEntry` 与 `TauriEventListener` 之间共享同一引用）
///
/// ## 设计目的
/// 修复 message_id 轮换缺陷：原实现中 `AgentEntry.current_message_id` 是 `String`，
/// `TauriEventListener.message_id` 是独立的 `RwLock<String>`，两者不同步，
/// 导致 `cmd_agent_prompt` 轮换 entry 的 message_id 后，listener 仍持有旧值。
///
/// ## 解决方案
/// 改为 `Arc<RwLock<String>>`，在 `cmd_agent_create` 时创建一个共享实例，
/// 分别传给 `AgentEntry` 和 `TauriEventListener`，任一方更新都对另一方立即可见。
///
/// ## 为什么用 `std::sync::RwLock` 而非 `tokio::sync::RwLock`
/// `TauriEventListener::on_event` 是同步方法，不能 await。
/// 写临界区极短（仅字符串替换），不会阻塞异步运行时。
pub type SharedMessageId = Arc<StdRwLock<String>>;

// ─── 错误类型 ────────────────────────────────────────────

/// Agent 注册表错误
///
/// 实现 `Serialize` 以便 Tauri 命令直接返回（前端能拿到结构化错误信息）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentRegistryError {
    /// 指定 session_id 的 Agent 不存在
    NotFound { session_id: String },
    /// 指定 session_id 已存在（重复创建）
    AlreadyExists { session_id: String },
    /// Agent 执行错误（包装 `AgentError`）
    AgentError { message: String },
    /// 锁竞争失败（极少出现）
    LockError { message: String },
}

impl std::fmt::Display for AgentRegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound { session_id } => {
                write!(f, "Agent session not found: {}", session_id)
            }
            Self::AlreadyExists { session_id } => {
                write!(f, "Agent session already exists: {}", session_id)
            }
            Self::AgentError { message } => write!(f, "Agent error: {}", message),
            Self::LockError { message } => write!(f, "Lock error: {}", message),
        }
    }
}

impl std::error::Error for AgentRegistryError {}

impl From<agent_runtime::AgentError> for AgentRegistryError {
    fn from(e: agent_runtime::AgentError) -> Self {
        Self::AgentError { message: e.to_string() }
    }
}

// ─── Agent 条目 ────────────────────────────────────────────

/// 注册表中的 Agent 条目
///
/// 持有 `Arc<AgentLoop>` 共享所有权，外部可 clone 后异步操作。
/// `current_message_id` 是与 `TauriEventListener` 共享的 `Arc<RwLock<String>>`，
/// 任一方更新都对另一方立即可见（修复多轮对话事件关联错位缺陷）。
#[derive(Clone)]
pub struct AgentEntry {
    /// Agent 实例（共享所有权）
    pub agent: Arc<AgentLoop>,
    /// 当前消息 ID（与 TauriEventListener 共享同一 Arc）
    ///
    /// 每次 prompt 前 `cmd_agent_prompt` 通过 `rotate_message_id` 更新，
    /// TauriEventListener 在事件 emit 时通过 `current_message_id()` 读取最新值。
    pub current_message_id: SharedMessageId,
    /// 前端工具桥接器（用于 Rust → TS 反向调用业务工具）
    ///
    /// 在 `cmd_agent_create` 时创建并注入，由 `cmd_agent_tool_result` 命令
    /// 调用 `on_tool_result` 唤醒等待中的工具调用。
    /// 使用 `Option` 因为：注册时不一定立即创建，可在 create 命令后续注入。
    pub tool_bridge: Option<Arc<FrontendToolBridge>>,
    /// 创建时间戳（Unix 毫秒）
    pub created_at: i64,
}

impl AgentEntry {
    /// 创建新条目，自动生成初始 message_id（共享 Arc）
    pub fn new(agent: Arc<AgentLoop>) -> Self {
        Self {
            agent,
            current_message_id: Arc::new(StdRwLock::new(Self::fresh_message_id())),
            tool_bridge: None,
            created_at: chrono::Utc::now().timestamp_millis(),
        }
    }

    /// 生成新的 message_id（格式：`msg_{uuid_simple}`）
    pub fn fresh_message_id() -> String {
        format!("msg_{}", Uuid::new_v4().simple())
    }

    /// 读取当前 message_id（用于事件 payload）
    pub fn current_message_id(&self) -> String {
        self.current_message_id
            .read()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    /// 获取共享 message_id 的 Arc 引用（供 TauriEventListener 持有）
    pub fn shared_message_id(&self) -> SharedMessageId {
        Arc::clone(&self.current_message_id)
    }

    /// 轮换 message_id（返回旧值便于日志）
    ///
    /// 通过共享 `Arc<RwLock<String>>` 更新，TauriEventListener 立即可见。
    pub fn rotate_message_id(&mut self) -> String {
        let new_id = Self::fresh_message_id();
        if let Ok(mut g) = self.current_message_id.write() {
            let old = std::mem::replace(&mut *g, new_id);
            old
        } else {
            // 锁毒化兜底：返回空串，新 ID 仍写入失败，但流程不阻断
            warn!("AgentEntry current_message_id 锁毒化，轮换失败");
            String::new()
        }
    }

    /// 获取前端工具桥接器（若存在）
    pub fn tool_bridge(&self) -> Option<Arc<FrontendToolBridge>> {
        self.tool_bridge.clone()
    }

    /// 注入前端工具桥接器
    pub fn set_tool_bridge(&mut self, bridge: Arc<FrontendToolBridge>) {
        self.tool_bridge = Some(bridge);
    }
}

// ─── Agent Registry ────────────────────────────────────────────

/// Agent 实例注册表
///
/// 基于 `tokio::sync::RwLock<HashMap<session_id, AgentEntry>>`，
/// 支持并发读、互斥写。
///
/// # 使用示例
/// ```rust,ignore
/// let registry = AgentRegistry::new();
///
/// // 创建并注册 Agent
/// let agent = Arc::new(AgentLoop::new(backend, tool_bus));
/// registry.register("sess_1", agent).await.unwrap();
///
/// // 获取 Agent 执行 prompt
/// let entry = registry.get("sess_1").await.unwrap();
/// let response = entry.agent.run("你好".into()).await.unwrap();
///
/// // 中断 Agent
/// let entry = registry.get("sess_1").await.unwrap();
/// entry.agent.abort().await;
///
/// // 销毁 Agent
/// registry.remove("sess_1").await.unwrap();
/// ```
pub struct AgentRegistry {
    entries: RwLock<HashMap<String, AgentEntry>>,
}

impl AgentRegistry {
    /// 创建空注册表
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// 注册一个新 Agent
    ///
    /// 若 `session_id` 已存在，返回 `AlreadyExists` 错误
    pub async fn register(
        &self,
        session_id: impl Into<String>,
        agent: Arc<AgentLoop>,
    ) -> Result<(), AgentRegistryError> {
        let session_id = session_id.into();
        let mut entries = self.entries.write().await;

        if entries.contains_key(&session_id) {
            return Err(AgentRegistryError::AlreadyExists { session_id });
        }

        let entry = AgentEntry::new(agent);
        entries.insert(session_id, entry);
        Ok(())
    }

    /// 获取 Agent 条目（共享所有权，返回 clone）
    ///
    /// 若不存在返回 `NotFound` 错误
    pub async fn get(&self, session_id: &str) -> Result<AgentEntry, AgentRegistryError> {
        let entries = self.entries.read().await;
        entries
            .get(session_id)
            .cloned()
            .ok_or_else(|| AgentRegistryError::NotFound {
                session_id: session_id.to_string(),
            })
    }

    /// 获取 Agent 条目的可变引用（需要写锁）
    ///
    /// 通过闭包操作 entry，避免外部直接持有锁。
    /// 用于 `cmd_agent_prompt` 中旋转 message_id 等场景。
    pub async fn with_entry_mut<F, R>(&self, session_id: &str, f: F) -> Result<R, AgentRegistryError>
    where
        F: FnOnce(&mut AgentEntry) -> R,
    {
        let mut entries = self.entries.write().await;
        let entry = entries.get_mut(session_id).ok_or_else(|| {
            AgentRegistryError::NotFound {
                session_id: session_id.to_string(),
            }
        })?;
        Ok(f(entry))
    }

    /// 获取指定 session 的前端工具桥接器
    ///
    /// 用于 `cmd_agent_tool_result` 命令查找对应 session 的桥接器，
    /// 调用 `on_tool_result` 唤醒等待中的工具调用。
    pub async fn get_tool_bridge(
        &self,
        session_id: &str,
    ) -> Result<Option<Arc<FrontendToolBridge>>, AgentRegistryError> {
        let entry = self.get(session_id).await?;
        Ok(entry.tool_bridge())
    }

    /// 为指定 session 注入前端工具桥接器
    ///
    /// 在 `cmd_agent_create` 中创建 bridge 后调用此方法注入。
    pub async fn set_tool_bridge(
        &self,
        session_id: &str,
        bridge: Arc<FrontendToolBridge>,
    ) -> Result<(), AgentRegistryError> {
        self.with_entry_mut(session_id, |entry| entry.set_tool_bridge(bridge.clone()))
            .await
    }

    /// 移除并返回 Agent 条目
    ///
    /// 若不存在返回 `NotFound` 错误
    pub async fn remove(&self, session_id: &str) -> Result<AgentEntry, AgentRegistryError> {
        let mut entries = self.entries.write().await;
        entries
            .remove(session_id)
            .ok_or_else(|| AgentRegistryError::NotFound {
                session_id: session_id.to_string(),
            })
    }

    /// 中断指定 Agent
    ///
    /// 等价于 `get(session_id).agent.abort()`，但返回更精确的错误。
    /// 若 Agent 不存在返回 `NotFound`。
    pub async fn abort(&self, session_id: &str) -> Result<(), AgentRegistryError> {
        let entry = self.get(session_id).await?;
        entry.agent.abort().await;
        Ok(())
    }

    /// 检查 Agent 是否存在
    pub async fn contains(&self, session_id: &str) -> bool {
        self.entries.read().await.contains_key(session_id)
    }

    /// 列出所有 session_id
    pub async fn list(&self) -> Vec<String> {
        self.entries.read().await.keys().cloned().collect()
    }

    /// 当前注册的 Agent 数量
    pub async fn count(&self) -> usize {
        self.entries.read().await.len()
    }

    /// 清空所有 Agent（用于应用退出时清理）
    ///
    /// 注意：不会主动调用 `abort()`，调用方应在清理前显式中断运行中的 Agent。
    pub async fn clear(&self) {
        self.entries.write().await.clear();
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use agent_runtime::backend::{NodeBackendAccessor, PromptCallOptions, PromptResponse, BackendError};
    use agent_runtime::tool::SimpleToolBus;
    use agent_runtime::types::OrchestratorMessage;
    use async_trait::async_trait;

    /// Mock 后端 — 用于测试 AgentLoop，不实际调用 LLM
    struct StubBackend;

    #[async_trait]
    impl NodeBackendAccessor for StubBackend {
        async fn prompt(
            &self,
            _prompt: String,
            _options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            Ok(PromptResponse::text_only("stub response"))
        }
        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
        }
        async fn get_messages(&self) -> Vec<OrchestratorMessage> {
            Vec::new()
        }
        async fn set_messages(
            &self,
            _messages: Vec<OrchestratorMessage>,
        ) -> Result<(), BackendError> {
            Ok(())
        }
        async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
            Ok(())
        }
    }

    fn make_stub_agent() -> Arc<AgentLoop> {
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(StubBackend);
        let tool_bus = Arc::new(SimpleToolBus::new());
        Arc::new(AgentLoop::new(backend, tool_bus))
    }

    #[tokio::test]
    async fn register_and_get_should_succeed() {
        let registry = AgentRegistry::new();
        let agent = make_stub_agent();

        registry
            .register("sess_1", agent)
            .await
            .expect("注册应成功");

        let entry = registry.get("sess_1").await.expect("应能获取");
        let mid = entry.current_message_id();
        assert!(!mid.is_empty());
        assert!(mid.starts_with("msg_"));
    }

    #[tokio::test]
    async fn register_duplicate_should_return_already_exists() {
        let registry = AgentRegistry::new();
        let agent = make_stub_agent();

        registry
            .register("sess_1", agent.clone())
            .await
            .expect("首次注册应成功");

        let result = registry.register("sess_1", agent).await;
        assert!(matches!(result, Err(AgentRegistryError::AlreadyExists { .. })));
    }

    #[tokio::test]
    async fn get_nonexistent_should_return_not_found() {
        let registry = AgentRegistry::new();
        let result = registry.get("nope").await;
        assert!(matches!(result, Err(AgentRegistryError::NotFound { .. })));
    }

    #[tokio::test]
    async fn remove_should_return_entry_and_clear_slot() {
        let registry = AgentRegistry::new();
        let agent = make_stub_agent();
        registry
            .register("sess_1", agent)
            .await
            .expect("注册应成功");

        let removed = registry.remove("sess_1").await.expect("应能移除");
        assert!(removed.current_message_id().starts_with("msg_"));

        assert!(!registry.contains("sess_1").await);
    }

    #[tokio::test]
    async fn with_entry_mut_should_rotate_message_id() {
        let registry = AgentRegistry::new();
        let agent = make_stub_agent();
        registry
            .register("sess_1", agent)
            .await
            .expect("注册应成功");

        // 共享 Arc：从 entry 拿引用，验证轮换后 Arc 内值同步更新
        let shared_arc = registry
            .get("sess_1")
            .await
            .unwrap()
            .shared_message_id();
        let old_id = shared_arc.read().unwrap().clone();

        let returned_old = registry
            .with_entry_mut("sess_1", |entry| entry.rotate_message_id())
            .await
            .expect("应能 mutate");

        // 返回的是 old_id
        assert_eq!(returned_old, old_id);

        // 共享 Arc 内的值已轮换（TauriEventListener 视角）
        let current_in_arc = shared_arc.read().unwrap().clone();
        assert_ne!(current_in_arc, old_id);
        assert!(current_in_arc.starts_with("msg_"));

        // 通过 current_message_id() 方法读取也一致
        let current = registry.get("sess_1").await.unwrap().current_message_id();
        assert_eq!(current, current_in_arc);
    }

    #[tokio::test]
    async fn abort_should_succeed_for_existing_session() {
        let registry = AgentRegistry::new();
        let agent = make_stub_agent();
        registry
            .register("sess_1", agent)
            .await
            .expect("注册应成功");

        registry.abort("sess_1").await.expect("中断应成功");
    }

    #[tokio::test]
    async fn abort_nonexistent_should_return_not_found() {
        let registry = AgentRegistry::new();
        let result = registry.abort("nope").await;
        assert!(matches!(result, Err(AgentRegistryError::NotFound { .. })));
    }

    #[tokio::test]
    async fn list_and_count_should_reflect_registrations() {
        let registry = AgentRegistry::new();
        assert_eq!(registry.count().await, 0);
        assert!(registry.list().await.is_empty());

        registry.register("sess_1", make_stub_agent()).await.unwrap();
        registry.register("sess_2", make_stub_agent()).await.unwrap();

        assert_eq!(registry.count().await, 2);
        let mut ids = registry.list().await;
        ids.sort();
        assert_eq!(ids, vec!["sess_1".to_string(), "sess_2".to_string()]);
    }

    #[tokio::test]
    async fn clear_should_empty_registry() {
        let registry = AgentRegistry::new();
        registry.register("sess_1", make_stub_agent()).await.unwrap();
        registry.register("sess_2", make_stub_agent()).await.unwrap();

        registry.clear().await;
        assert_eq!(registry.count().await, 0);
    }

    #[test]
    fn agent_registry_error_should_serialize_to_json() {
        let err = AgentRegistryError::NotFound {
            session_id: "sess_1".into(),
        };
        let json = serde_json::to_string(&err).expect("应能序列化");
        // tag = "kind", rename_all = "snake_case"
        assert!(json.contains("\"kind\":\"not_found\""));
        assert!(json.contains("\"session_id\":\"sess_1\""));
    }
}
