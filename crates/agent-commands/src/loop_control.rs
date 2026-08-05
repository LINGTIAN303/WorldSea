//! # Loop Control 注册表 — Loop Engineering 实例管理（服务层）
//!
//! 端分离迁移前位于 `src-tauri/src/agent_bridge/loop_control_registry.rs`，
//! 迁移后按"纯逻辑命令层放 agent-commands、Tauri 薄包装放 tauri app"的架构约定
//! 落到本 crate。本模块**不依赖 tauri**，可独立 `cargo test`。
//!
//! ## 职责
//! 在 Tauri 应用进程内按 `task_id` 管理多个 [`LoopController`] 实例，
//! 与 AgentRegistry / SubAgentManager 等并行。Loop Engineering 是**横切关注点**：
//! - 其他 Registry 按 `session_id` 管理节点实例（一个会话一个节点）
//! - 本 Registry 按 `task_id` 管理 LoopController（一个会话可能有多个长任务，
//!   每个长任务对应独立的 LoopController，`task_id` 与 `LongTaskRecord.task_id` 对齐）
//!
//! ## 事件广播
//! 每个条目持有独立的 [`EventBroadcaster`]。命令层 `check_and_emit` 在检查到
//! 非空结果（rate_limit / soft_timeout / watchdog）时构造 `OrchestratorEvent::LoopEng*`
//! 并广播；Tauri 端在 `cmd_loop_control_create` 时订阅一个监听器，把事件转发到
//! 前端 `loop_control:event:{task_id}` 通道。
//!
//! ## 与 Tauri 命令的关系
//! ```text
//! cmd_loop_control_create           -> registry.register(task_id, entry) + 订阅监听器
//! cmd_loop_control_check            -> registry.check_and_emit(task_id)
//! cmd_loop_control_record_turn      -> registry.get(task_id) → rate_limiter.inc_turns()
//! cmd_loop_control_update_activity  -> registry.get(task_id) → controller.update_activity()
//! cmd_loop_control_reset_counters   -> registry.get(task_id) → entry.reset_counters()
//! cmd_loop_control_get_config       -> registry.get(task_id) → 返回配置快照
//! cmd_loop_control_get_status       -> registry.get(task_id) → 返回计数器与状态
//! cmd_loop_control_destroy          -> registry.remove(task_id)
//! cmd_loop_control_list_tasks       -> registry.list()
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use agent_runtime::event::{EventBroadcaster, EventListener, OrchestratorEvent};
use agent_runtime::loop_control::{
    LoopControlCheck, LoopControlConfig, LoopController, RateLimitExceeded, SoftTimeoutLevel,
    WatchdogAlert,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::warn;

// ─── 错误类型 ────────────────────────────────────────────

/// Loop Control 注册表错误
///
/// `#[serde(tag = "kind")]` + snake_case 变体名，前端类型
/// `RustLoopControlRegistryError` 与其对齐（`not_found` / `already_exists` / ...）。
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
    /// 内部错误（如绑定会话时会话不存在、注册失败）
    Internal { message: String },
}

impl std::fmt::Display for LoopControlRegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound { task_id } => {
                write!(f, "LoopController task not found: {task_id}")
            }
            Self::AlreadyExists { task_id } => {
                write!(f, "LoopController task already exists: {task_id}")
            }
            Self::LockError { message } => write!(f, "Lock error: {message}"),
            Self::InvalidConfig { message } => write!(f, "Invalid config: {message}"),
            Self::Internal { message } => write!(f, "Internal error: {message}"),
        }
    }
}

impl std::error::Error for LoopControlRegistryError {}

// ─── LoopController 条目 ────────────────────────────────────────────

/// 注册表中的 LoopController 条目
///
/// 持有 LoopController 与事件广播器。不持有 backend / tool_bus / tool_bridge
/// （LoopController 不调用 LLM/tool，只做检查与状态聚合）。
#[derive(Clone)]
pub struct LoopControlEntry {
    /// LoopController 实例（聚合 RateLimiter/RetryPolicy/SoftTimeout/Watchdog）
    pub controller: Arc<LoopController>,
    /// 任务创建时使用的配置（用于 `cmd_loop_control_get_config` 返回）
    pub config: LoopControlConfig,
    /// 事件广播器（用于订阅 TauriEventListener）
    ///
    /// LoopController 本身不直接触发事件，由命令层在 `check_all` 返回非空结果时
    /// 显式 emit。broadcaster 保留是为了与现有事件订阅模式对齐，并支持未来扩展
    /// （如 Watchdog 自动恢复时触发 `LoopEngRecovered`）。
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
    pub async fn subscribe(&self, listener: Arc<dyn EventListener>) {
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
    /// （rate_limit 针对整个任务生命周期）。SoftTimeout 的触发标志也会重置，
    /// Watchdog 的触发标志会重置且 last_activity 更新。
    pub fn reset_counters(&self) {
        self.controller.rate_limiter.reset();
        self.controller.soft_timeout.reset();
        self.controller.update_activity();
    }
}

// ─── LoopController Registry ────────────────────────────────────────────

/// LoopController 实例注册表
#[derive(Default)]
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

    /// 一站式检查 + 事件广播（`cmd_loop_control_check` 调用）
    ///
    /// 1. 对指定任务执行 `controller.check_all()`
    /// 2. 若结果非空，构造对应的 `OrchestratorEvent::LoopEng*` 并广播到条目 broadcaster
    ///    （Tauri 端订阅的监听器会转发到前端 `loop_control:event:{task_id}`）
    /// 3. 返回 [`LoopControlCheckResult`]（即使无事件也会返回，has_any=false）
    ///
    /// 注意：本方法只 emit rate_limit / soft_timeout / watchdog 五类事件；
    /// `LoopEngRetrying` / `LoopEngRetryExhausted` / `LoopEngRecovered` 由
    /// AgentLoop 在重试/恢复时直接 emit（命令层不介入）。
    pub async fn check_and_emit(
        &self,
        task_id: &str,
    ) -> Result<LoopControlCheckResult, LoopControlRegistryError> {
        let entry = self.get(task_id).await?;
        let check = entry.check_all();

        if check.has_any() {
            let broadcaster = entry.broadcaster.clone();

            // rate_limit 超限
            if let Some(exceeded) = &check.rate_limit_exceeded {
                let (limit_type, current, max) = match exceeded {
                    RateLimitExceeded::Turns { current, max } => {
                        ("turns", *current as u64, *max as u64)
                    }
                    RateLimitExceeded::ToolCalls { current, max } => {
                        ("tool_calls", *current as u64, *max as u64)
                    }
                    RateLimitExceeded::Tokens { current, max } => ("tokens", *current, *max),
                    RateLimitExceeded::Duration { current, max } => {
                        ("duration", current.as_secs(), max.as_secs())
                    }
                };
                let event = OrchestratorEvent::LoopEngRateLimitExceeded {
                    task_id: task_id.to_string(),
                    limit_type: limit_type.into(),
                    current,
                    max,
                };
                broadcast_event(&broadcaster, &event).await;
            }

            // soft_timeout（Warning / Critical 只触发一次）
            if let Some(level) = check.soft_timeout_level {
                let elapsed_secs = entry.controller.soft_timeout.elapsed().as_secs();
                let event = match level {
                    SoftTimeoutLevel::Warning => {
                        OrchestratorEvent::LoopEngSoftTimeoutWarning {
                            task_id: task_id.to_string(),
                            elapsed_secs,
                            threshold_secs: entry.config.soft_timeout.warn_threshold.as_secs(),
                        }
                    }
                    SoftTimeoutLevel::Critical => {
                        OrchestratorEvent::LoopEngSoftTimeoutCritical {
                            task_id: task_id.to_string(),
                            elapsed_secs,
                            threshold_secs: entry.config.soft_timeout.critical_threshold.as_secs(),
                        }
                    }
                };
                broadcast_event(&broadcaster, &event).await;
            }

            // watchdog（Idle / Dead 只触发一次）
            if let Some(alert) = &check.watchdog_alert {
                let event = match alert {
                    WatchdogAlert::Idle {
                        last_activity,
                        elapsed,
                    } => OrchestratorEvent::LoopEngWatchdogIdle {
                        task_id: task_id.to_string(),
                        last_activity: *last_activity,
                        idle_secs: elapsed.as_secs(),
                    },
                    WatchdogAlert::Dead {
                        last_activity,
                        elapsed,
                    } => OrchestratorEvent::LoopEngWatchdogDead {
                        task_id: task_id.to_string(),
                        last_activity: *last_activity,
                        idle_secs: elapsed.as_secs(),
                    },
                };
                broadcast_event(&broadcaster, &event).await;
            }
        }

        Ok(LoopControlCheckResult::from_check(check))
    }
}

// ─── 状态快照 / 检查结果（供前端展示）───────────────────────────

/// `cmd_loop_control_check` 的返回结果
///
/// 包含一站式检查结果与是否触发了事件。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopControlCheckResult {
    /// 是否有任何需要关注的事件
    pub has_any: bool,
    /// 是否应该强制停止（rate_limit 超限）
    pub should_stop: bool,
    /// 速率限制超限详情（None=未超限）
    pub rate_limit_exceeded: Option<RateLimitExceeded>,
    /// 软超时级别（None=未触发）
    pub soft_timeout_level: Option<SoftTimeoutLevel>,
    /// 看门狗告警（None=未触发）
    pub watchdog_alert: Option<WatchdogAlert>,
}

impl LoopControlCheckResult {
    /// 从 `LoopControlCheck` 构造
    pub fn from_check(check: LoopControlCheck) -> Self {
        Self {
            has_any: check.has_any(),
            should_stop: check.should_stop(),
            rate_limit_exceeded: check.rate_limit_exceeded,
            soft_timeout_level: check.soft_timeout_level,
            watchdog_alert: check.watchdog_alert,
        }
    }
}

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

// ─── 辅助函数 ────────────────────────────────────────────

/// 通过 broadcaster 广播事件（非阻塞）
///
/// 使用 `try_read` 避免阻塞：若锁被占用（极少见），丢弃事件并记录警告。
async fn broadcast_event(
    broadcaster: &Arc<RwLock<EventBroadcaster>>,
    event: &OrchestratorEvent,
) {
    match broadcaster.try_read() {
        Ok(bc) => bc.broadcast(event),
        Err(_) => {
            warn!(
                "loop_control broadcast_event: broadcaster 锁占用，事件被丢弃: {:?}",
                std::mem::discriminant(event)
            );
        }
    }
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(max_turns: Option<u32>) -> LoopControlEntry {
        let config = LoopControlConfig {
            rate_limit: agent_runtime::loop_control::RateLimitConfig {
                max_turns,
                ..Default::default()
            },
            ..Default::default()
        };
        let controller = Arc::new(LoopController::new(config.clone()));
        LoopControlEntry::new(controller, config)
    }

    #[tokio::test]
    async fn register_get_remove_roundtrip() {
        let registry = LoopControlRegistry::new();
        assert_eq!(registry.count().await, 0);
        assert!(registry.list().await.is_empty());

        registry.register("task_1", make_entry(None)).await.unwrap();
        assert_eq!(registry.count().await, 1);
        assert!(registry.contains("task_1").await);
        assert_eq!(registry.list().await, vec!["task_1"]);

        registry.remove("task_1").await.unwrap();
        assert_eq!(registry.count().await, 0);
        // 重复注册报 AlreadyExists
        registry.register("task_2", make_entry(None)).await.unwrap();
        let err = registry.register("task_2", make_entry(None)).await;
        assert!(matches!(err, Err(LoopControlRegistryError::AlreadyExists { .. })));
    }

    #[tokio::test]
    async fn get_missing_returns_not_found() {
        let registry = LoopControlRegistry::new();
        let err = registry.get("nope").await;
        assert!(matches!(err, Err(LoopControlRegistryError::NotFound { .. })));
    }

    #[tokio::test]
    async fn check_and_emit_broadcasts_rate_limit_event() {
        // 用内存监听器捕获广播的事件
        struct CaptureListener(std::sync::Mutex<Vec<OrchestratorEvent>>);
        impl EventListener for CaptureListener {
            fn on_event(&self, event: &OrchestratorEvent) {
                self.0.lock().unwrap().push(event.clone());
            }
        }

        let registry = LoopControlRegistry::new();
        // max_turns = 1 → 一轮后超限
        let entry = make_entry(Some(1));
        let capture = Arc::new(CaptureListener(std::sync::Mutex::new(Vec::new())));
        entry.subscribe(capture.clone()).await;
        registry.register("task_1", entry).await.unwrap();

        // 初始 check：无事件
        let r0 = registry.check_and_emit("task_1").await.unwrap();
        assert!(!r0.has_any);
        assert!(capture.0.lock().unwrap().is_empty());

        // 增加一轮后 check：触发 rate_limit 事件
        let entry = registry.get("task_1").await.unwrap();
        entry.controller.rate_limiter.inc_turns();

        let r1 = registry.check_and_emit("task_1").await.unwrap();
        assert!(r1.has_any);
        assert!(r1.should_stop);
        assert!(matches!(
            r1.rate_limit_exceeded,
            Some(RateLimitExceeded::Turns { current: 1, max: 1 })
        ));
        let captured = capture.0.lock().unwrap();
        assert!(captured.iter().any(|e| matches!(
            e,
            OrchestratorEvent::LoopEngRateLimitExceeded {
                task_id,
                limit_type,
                current: 1,
                max: 1,
            } if task_id == "task_1" && limit_type == "turns"
        )));
    }

    #[test]
    fn check_result_from_empty_check_should_be_falsy() {
        let check = LoopControlCheck {
            rate_limit_exceeded: None,
            soft_timeout_level: None,
            watchdog_alert: None,
        };
        let result = LoopControlCheckResult::from_check(check);
        assert!(!result.has_any);
        assert!(!result.should_stop);
    }

    #[test]
    fn status_from_entry_reports_counters() {
        let entry = make_entry(None);
        entry.controller.rate_limiter.inc_turns();
        entry.controller.rate_limiter.inc_tool_calls();
        entry.controller.rate_limiter.add_tokens(42);
        let status = LoopControlStatus::from_entry("t1", &entry);
        assert_eq!(status.task_id, "t1");
        assert_eq!(status.turns, 1);
        assert_eq!(status.tool_calls, 1);
        assert_eq!(status.tokens, 42);
        assert!(status.created_at > 0);
    }

    #[tokio::test]
    async fn reset_counters_clears_turn_count() {
        let entry = make_entry(None);
        entry.controller.rate_limiter.inc_turns();
        assert_eq!(entry.controller.rate_limiter.turns(), 1);
        entry.reset_counters();
        assert_eq!(entry.controller.rate_limiter.turns(), 0);
    }
}
