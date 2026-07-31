//! # Loop Controller Registry — Loop Engineering 实例注册表
//!
//! 阶段 2.6 批次2 新增。用于在 Tauri 应用进程内管理多个 `LoopController` 实例，
//! 与 `AgentRegistry` / `SupervisorRegistry` / `RouterRegistry` / `ToTRegistry` /
//! `GoTRegistry` / `MultiAgentRegistry` 并列存在。
//!
//! ## 与其他 Registry 的差异
//!
//! Loop Engineering 是**横切关注点**（cross-cutting concern），不是独立的编排节点：
//! - 其他 Registry 按 `session_id` 管理节点实例（一个会话一个节点）
//! - 本 Registry 按 `task_id` 管理 LoopController（一个会话可能有多个长任务，
//!   每个长任务对应独立的 LoopController）
//!
//! 因此 Entry 不持有 backend / tool_bus / tool_bridge（LoopController 不调用
//! LLM/tool，只做检查与状态聚合），也不持有共享 state（LoopController 自身已
//! 包含状态：RateLimiter 计数器、Watchdog 时间戳、SoftTimeout 触发标志等）。
//!
//! ## 设计要点
//! - **线程安全**：基于 `tokio::sync::RwLock<HashMap>`，与其他 Registry 一致
//! - **任务级生命周期**：通过 `task_id` 索引，与 `LongTaskRecord.task_id` 对齐
//! - **事件广播**：通过 `EventBroadcaster` 实现，命令层创建时订阅 TauriEventListener，
//!   LoopController 检查到事件时由命令层显式 emit（LoopController 本身不触发事件，
//!   避免在核心层耦合 EventListener）
//! - **无 AbortCheck 适配器**：LoopController 自身提供 `should_stop()`，
//!   不需要额外的 AtomicBool 中转
//!
//! ## 与 Tauri 命令的关系
//! ```text
//! cmd_loop_control_create           -> registry.register(task_id, entry)
//! cmd_loop_control_check            -> registry.get(task_id) → controller.check_all()
//! cmd_loop_control_update_activity  -> registry.get(task_id) → controller.update_activity()
//! cmd_loop_control_reset_counters   -> registry.get(task_id) → controller.rate_limiter.reset()
//! cmd_loop_control_get_config       -> registry.get(task_id) → 返回配置快照
//! cmd_loop_control_get_status       -> registry.get(task_id) → 返回计数器与状态
//! cmd_loop_control_destroy          -> registry.remove(task_id)
//! cmd_loop_control_list_tasks       -> registry.list()
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use agent_runtime::event::EventBroadcaster;
use agent_runtime::loop_control::{
    LoopControlCheck, LoopControlConfig, LoopController, RateLimitExceeded, SoftTimeoutLevel,
    WatchdogAlert,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

// ─── 错误类型 ────────────────────────────────────────────

/// Loop Control 注册表错误
///
/// 复用其他 Registry 的错误形态，但作为独立类型避免语义混淆。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LoopControlRegistryError {
    /// 指定 task_id 的 LoopController 不存在
    NotFound { task_id: String },
    /// 指定 task_id 已存在（重复创建）
    AlreadyExists { task_id: String },
    /// 锁竞争失败
    LockError { message: String },
    /// 配置错误（如所有 rate_limit 维度都为 None）
    InvalidConfig { message: String },
}

impl std::fmt::Display for LoopControlRegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound { task_id } => {
                write!(f, "LoopController task not found: {}", task_id)
            }
            Self::AlreadyExists { task_id } => {
                write!(f, "LoopController task already exists: {}", task_id)
            }
            Self::LockError { message } => write!(f, "Lock error: {}", message),
            Self::InvalidConfig { message } => write!(f, "Invalid config: {}", message),
        }
    }
}

impl std::error::Error for LoopControlRegistryError {}

// ─── LoopController 条目 ────────────────────────────────────────────

/// 注册表中的 LoopController 条目
///
/// 持有 LoopController 与事件广播器。
/// 不持有 backend / tool_bus / tool_bridge（LoopController 不调用 LLM/tool）。
/// 不持有共享 state（LoopController 自身已包含状态）。
#[derive(Clone)]
pub struct LoopControlEntry {
    /// LoopController 实例（聚合 RateLimiter/RetryPolicy/SoftTimeout/Watchdog）
    pub controller: Arc<LoopController>,
    /// 任务创建时使用的配置（用于 `cmd_loop_control_get_config` 返回）
    pub config: LoopControlConfig,
    /// 事件广播器（用于订阅 TauriEventListener）
    ///
    /// 与其他 Registry 不同，LoopController 本身不直接触发事件，
    /// 由命令层在 `check_all` 返回非空结果时显式 emit。
    /// broadcaster 保留是为了与现有事件订阅模式对齐，
    /// 并支持未来扩展（如 Watchdog 自动恢复时触发 `LoopEngRecovered`）。
    pub broadcaster: Arc<RwLock<EventBroadcaster>>,
    /// 创建时间戳（Unix 毫秒）
    pub created_at: i64,
}

impl LoopControlEntry {
    /// 创建新条目
    pub fn new(controller: Arc<LoopController>, config: LoopControlConfig) -> Self {
        Self {
            controller,
            config,
            broadcaster: Arc::new(RwLock::new(EventBroadcaster::new())),
            created_at: chrono::Utc::now().timestamp_millis(),
        }
    }

    /// 订阅事件监听器
    pub async fn subscribe(&self, listener: Arc<dyn agent_runtime::event::EventListener>) {
        let mut bc = self.broadcaster.write().await;
        bc.subscribe(listener);
    }

    /// 一站式检查（委托给 LoopController::check_all）
    pub fn check_all(&self) -> LoopControlCheck {
        self.controller.check_all()
    }

    /// 更新活动时间（委托给 LoopController::update_activity）
    pub fn update_activity(&self) {
        self.controller.update_activity();
    }

    /// 重置速率限制计数器（委托给 RateLimiter::reset）
    ///
    /// 注意：仅重置 turns/tool_calls/tokens 计数器，不重置 started_at
    /// （rate_limit 针对整个任务生命周期）。
    /// SoftTimeout 的触发标志也会重置，但 started_at 不重置。
    /// Watchdog 的触发标志会重置，last_activity 也会更新。
    pub fn reset_counters(&self) {
        self.controller.rate_limiter.reset();
        self.controller.soft_timeout.reset();
        self.controller.update_activity();
    }
}

// ─── LoopController Registry ────────────────────────────────────────────

/// LoopController 实例注册表
pub struct LoopControlRegistry {
    entries: RwLock<HashMap<String, LoopControlEntry>>,
}

impl LoopControlRegistry {
    /// 创建空注册表
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// 注册一个新 LoopController
    pub async fn register(
        &self,
        task_id: impl Into<String>,
        entry: LoopControlEntry,
    ) -> Result<(), LoopControlRegistryError> {
        let task_id = task_id.into();
        let mut entries = self.entries.write().await;

        if entries.contains_key(&task_id) {
            return Err(LoopControlRegistryError::AlreadyExists { task_id });
        }

        entries.insert(task_id, entry);
        Ok(())
    }

    /// 获取 LoopController 条目（克隆）
    pub async fn get(
        &self,
        task_id: &str,
    ) -> Result<LoopControlEntry, LoopControlRegistryError> {
        let entries = self.entries.read().await;
        entries
            .get(task_id)
            .cloned()
            .ok_or_else(|| LoopControlRegistryError::NotFound {
                task_id: task_id.to_string(),
            })
    }

    /// 移除并返回 LoopController 条目
    pub async fn remove(
        &self,
        task_id: &str,
    ) -> Result<LoopControlEntry, LoopControlRegistryError> {
        let mut entries = self.entries.write().await;
        entries
            .remove(task_id)
            .ok_or_else(|| LoopControlRegistryError::NotFound {
                task_id: task_id.to_string(),
            })
    }

    /// 检查 LoopController 是否存在
    pub async fn contains(&self, task_id: &str) -> bool {
        self.entries.read().await.contains_key(task_id)
    }

    /// 列出所有 task_id
    pub async fn list(&self) -> Vec<String> {
        self.entries.read().await.keys().cloned().collect()
    }

    /// 当前注册数量
    pub async fn count(&self) -> usize {
        self.entries.read().await.len()
    }

    /// 清空所有 LoopController（应用退出时清理）
    pub async fn clear(&self) {
        self.entries.write().await.clear();
    }
}

impl Default for LoopControlRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 状态快照（用于前端展示）────────────────────────────────────────

/// LoopController 状态快照
///
/// 由 `cmd_loop_control_get_status` 返回，前端可据此展示：
/// - 当前 turns / tool_calls / tokens 计数
/// - 已运行时长
/// - 各组件触发状态（rate_limit / soft_timeout / watchdog）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopControlStatus {
    /// 任务 ID
    pub task_id: String,
    /// 当前轮次
    pub turns: u32,
    /// 当前工具调用数
    pub tool_calls: u32,
    /// 当前 token 数
    pub tokens: u64,
    /// 已运行时长（毫秒）
    pub elapsed_ms: u64,
    /// 速率限制是否超限（None=未超限）
    pub rate_limit_exceeded: Option<RateLimitExceeded>,
    /// 软超时级别（None=未触发）
    pub soft_timeout_level: Option<SoftTimeoutLevel>,
    /// 看门狗告警（None=未触发）
    pub watchdog_alert: Option<WatchdogAlert>,
    /// 创建时间戳（Unix 毫秒）
    pub created_at: i64,
}

impl LoopControlStatus {
    /// 从 entry 构造状态快照
    pub fn from_entry(task_id: &str, entry: &LoopControlEntry) -> Self {
        let controller = &entry.controller;
        let check = controller.check_all();
        Self {
            task_id: task_id.to_string(),
            turns: controller.rate_limiter.turns(),
            tool_calls: controller.rate_limiter.tool_calls(),
            tokens: controller.rate_limiter.tokens(),
            elapsed_ms: controller.rate_limiter.elapsed().as_millis() as u64,
            rate_limit_exceeded: check.rate_limit_exceeded,
            soft_timeout_level: check.soft_timeout_level,
            watchdog_alert: check.watchdog_alert,
            created_at: entry.created_at,
        }
    }
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_and_get_should_succeed() {
        let registry = LoopControlRegistry::new();
        assert_eq!(registry.count().await, 0);
        assert!(registry.list().await.is_empty());

        // 创建一个默认配置的 LoopController
        let config = LoopControlConfig::default();
        let controller = Arc::new(LoopController::new(config.clone()));
        let entry = LoopControlEntry::new(controller, config);
        registry.register("task_1", entry).await.unwrap();

        assert_eq!(registry.count().await, 1);
        assert!(registry.contains("task_1").await);
        assert_eq!(registry.list().await, vec!["task_1"]);
    }

    #[tokio::test]
    async fn register_duplicate_should_fail() {
        let registry = LoopControlRegistry::new();
        let config = LoopControlConfig::default();
        let controller = Arc::new(LoopController::new(config.clone()));
        let entry = LoopControlEntry::new(controller, config);
        registry.register("task_1", entry).await.unwrap();

        let config2 = LoopControlConfig::default();
        let controller2 = Arc::new(LoopController::new(config2.clone()));
        let entry2 = LoopControlEntry::new(controller2, config2);
        let result = registry.register("task_1", entry2).await;
        assert!(matches!(
            result,
            Err(LoopControlRegistryError::AlreadyExists { .. })
        ));
    }

    #[tokio::test]
    async fn get_nonexistent_should_return_not_found() {
        let registry = LoopControlRegistry::new();
        let result = registry.get("nope").await;
        assert!(matches!(result, Err(LoopControlRegistryError::NotFound { .. })));
    }

    #[tokio::test]
    async fn remove_should_succeed() {
        let registry = LoopControlRegistry::new();
        let config = LoopControlConfig::default();
        let controller = Arc::new(LoopController::new(config.clone()));
        let entry = LoopControlEntry::new(controller, config);
        registry.register("task_1", entry).await.unwrap();

        registry.remove("task_1").await.unwrap();
        assert_eq!(registry.count().await, 0);
    }

    #[test]
    fn registry_error_should_serialize_to_json() {
        let err = LoopControlRegistryError::NotFound {
            task_id: "task_1".into(),
        };
        let json = serde_json::to_string(&err).expect("应能序列化");
        assert!(json.contains("\"kind\":\"not_found\""));
        assert!(json.contains("\"task_id\":\"task_1\""));
    }

    #[test]
    fn entry_check_all_should_return_empty_initially() {
        let config = LoopControlConfig::default();
        let controller = Arc::new(LoopController::new(config.clone()));
        let entry = LoopControlEntry::new(controller, config);

        let check = entry.check_all();
        // 默认配置：max_turns=100, max_tool_calls=200, max_tokens=100k, max_duration=6h
        // 初始状态不应有任何超限
        assert!(!check.has_any());
    }

    #[test]
    fn entry_update_activity_should_refresh_watchdog() {
        let config = LoopControlConfig::default();
        let controller = Arc::new(LoopController::new(config.clone()));
        let entry = LoopControlEntry::new(controller, config);

        // 更新活动时间不应出错
        entry.update_activity();

        // 检查后应无告警（刚更新过活动时间）
        let check = entry.check_all();
        assert!(check.watchdog_alert.is_none());
    }

    #[test]
    fn status_snapshot_should_reflect_counters() {
        let config = LoopControlConfig::default();
        let controller = Arc::new(LoopController::new(config.clone()));
        let entry = LoopControlEntry::new(controller, config);

        // 增加一些计数
        entry.controller.rate_limiter.inc_turns();
        entry.controller.rate_limiter.inc_tool_calls();
        entry.controller.rate_limiter.add_tokens(500);

        let status = LoopControlStatus::from_entry("task_1", &entry);
        assert_eq!(status.task_id, "task_1");
        assert_eq!(status.turns, 1);
        assert_eq!(status.tool_calls, 1);
        assert_eq!(status.tokens, 500);
        assert!(status.elapsed_ms < 1000); // 刚创建，应小于 1s
        assert!(status.rate_limit_exceeded.is_none());
        assert!(status.soft_timeout_level.is_none());
        assert!(status.watchdog_alert.is_none());
    }
}
