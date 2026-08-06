//! 循环控制组件：速率限制/重试/软超时/看门狗，详细见 docs/details/注释/agent-runtime/loop_control.md

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

// ─── 配置 ────────────────────────────────────────────

/// Loop Engineering 总配置，详细见 docs/details/注释/agent-runtime/loop_control.md
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopControlConfig {
    /// 速率限制配置
    #[serde(default)]
    pub rate_limit: RateLimitConfig,
    /// 重试策略配置
    #[serde(default)]
    pub retry: RetryConfig,
    /// 软超时配置
    #[serde(default)]
    pub soft_timeout: SoftTimeoutConfig,
    /// 看门狗配置
    #[serde(default)]
    pub watchdog: WatchdogConfig,
}

impl Default for LoopControlConfig {
    fn default() -> Self {
        Self {
            rate_limit: RateLimitConfig::default(),
            retry: RetryConfig::default(),
            soft_timeout: SoftTimeoutConfig::default(),
            watchdog: WatchdogConfig::default(),
        }
    }
}

/// 速率限制配置
///
/// 任意一项超限即触发 `should_stop = true`。
/// 设为 `None` 表示不限制该维度。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitConfig {
    /// 最大轮次限制（None=不限）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    /// 最大工具调用次数（None=不限）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tool_calls: Option<u32>,
    /// 最大 token 数（None=不限）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    /// 最大执行时长（None=不限）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_duration: Option<Duration>,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        // 默认较宽松，对应"长任务最多 6 小时"约束
        Self {
            max_turns: Some(100),
            max_tool_calls: Some(200),
            max_tokens: Some(100_000),
            max_duration: Some(Duration::from_secs(6 * 60 * 60)), // 6h
        }
    }
}

/// 重试策略配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryConfig {
    /// 最大重试次数（0=不重试）
    pub max_retries: u32,
    /// 初始退避时长（首次重试等待时间）
    pub initial_backoff: Duration,
    /// 退避乘数（每次重试等待时间 = initial * multiplier^attempt）
    pub backoff_multiplier: f64,
    /// 最大退避时长（避免无限增长）
    pub max_backoff: Duration,
    /// 可重试的错误类型（字符串匹配，如 "rate_limit" / "timeout" / "server_error"）
    pub retryable_errors: Vec<String>,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_backoff: Duration::from_secs(1),
            backoff_multiplier: 2.0,
            max_backoff: Duration::from_secs(30),
            retryable_errors: vec![
                "rate_limit".into(),
                "timeout".into(),
                "server_error".into(),
                "connection_reset".into(),
            ],
        }
    }
}

/// 软超时配置
///
/// 软超时仅提醒不强制终止，符合"无强制中断"原则。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftTimeoutConfig {
    /// 提醒阈值（达到此时长触发 `SoftTimeoutWarning` 事件）
    pub warn_threshold: Duration,
    /// 临界阈值（达到此时长触发 `SoftTimeoutCritical` 事件，建议停止）
    pub critical_threshold: Duration,
}

impl Default for SoftTimeoutConfig {
    fn default() -> Self {
        Self {
            warn_threshold: Duration::from_secs(30 * 60),     // 30min
            critical_threshold: Duration::from_secs(2 * 60 * 60), // 2h
        }
    }
}

/// 看门狗配置
///
/// 监控任务活跃度，长时间无活动触发恢复机制。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogConfig {
    /// 无活动阈值（超过此时长无心跳触发 `WatchdogIdle` 事件）
    pub idle_threshold: Duration,
    /// 死亡阈值（超过此时长无心跳触发 `WatchdogDead` 事件，建议恢复）
    pub dead_threshold: Duration,
    /// 是否启用自动恢复（true=自动调 resume，false=仅通知）
    pub auto_recovery: bool,
}

impl Default for WatchdogConfig {
    fn default() -> Self {
        Self {
            idle_threshold: Duration::from_secs(5 * 60),       // 5min
            dead_threshold: Duration::from_secs(30 * 60),      // 30min
            auto_recovery: false, // 默认仅通知，不自动恢复
        }
    }
}

// ─── 速率限制器 ────────────────────────────────────────────

/// 速率限制器（线程安全，无锁），详细见 docs/details/注释/agent-runtime/loop_control.md
#[derive(Debug)]
pub struct RateLimiter {
    config: RateLimitConfig,
    turns: AtomicU32,
    tool_calls: AtomicU32,
    tokens: AtomicU64,
    started_at: Instant,
}

impl RateLimiter {
    /// 创建速率限制器
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            config,
            turns: AtomicU32::new(0),
            tool_calls: AtomicU32::new(0),
            tokens: AtomicU64::new(0),
            started_at: Instant::now(),
        }
    }

    /// 增加轮次计数
    pub fn inc_turns(&self) {
        self.turns.fetch_add(1, Ordering::SeqCst);
    }

    /// 增加工具调用计数
    pub fn inc_tool_calls(&self) {
        self.tool_calls.fetch_add(1, Ordering::SeqCst);
    }

    /// 增加 token 计数
    pub fn add_tokens(&self, count: u64) {
        self.tokens.fetch_add(count, Ordering::SeqCst);
    }

    /// 获取当前轮次
    pub fn turns(&self) -> u32 {
        self.turns.load(Ordering::SeqCst)
    }

    /// 获取当前工具调用数
    pub fn tool_calls(&self) -> u32 {
        self.tool_calls.load(Ordering::SeqCst)
    }

    /// 获取当前 token 数
    pub fn tokens(&self) -> u64 {
        self.tokens.load(Ordering::SeqCst)
    }

    /// 获取已运行时长
    pub fn elapsed(&self) -> Duration {
        self.started_at.elapsed()
    }

    /// 获取速率限制配置
    pub fn config(&self) -> &RateLimitConfig {
        &self.config
    }

    /// 是否应该停止（任意一项超限）
    ///
    /// 返回 `Option<RateLimitExceeded>` 描述超限原因，`None` 表示未超限。
    pub fn check_exceeded(&self) -> Option<RateLimitExceeded> {
        if let Some(max) = self.config.max_turns {
            if self.turns() >= max {
                return Some(RateLimitExceeded::Turns {
                    current: self.turns(),
                    max,
                });
            }
        }
        if let Some(max) = self.config.max_tool_calls {
            if self.tool_calls() >= max {
                return Some(RateLimitExceeded::ToolCalls {
                    current: self.tool_calls(),
                    max,
                });
            }
        }
        if let Some(max) = self.config.max_tokens {
            if self.tokens() >= max {
                return Some(RateLimitExceeded::Tokens {
                    current: self.tokens(),
                    max,
                });
            }
        }
        if let Some(max) = self.config.max_duration {
            if self.elapsed() >= max {
                return Some(RateLimitExceeded::Duration {
                    current: self.elapsed(),
                    max,
                });
            }
        }
        None
    }

    /// 是否应该停止（便捷方法）
    pub fn should_stop(&self) -> bool {
        self.check_exceeded().is_some()
    }

    /// 重置计数器（用于 retry 时重新开始）
    pub fn reset(&self) {
        self.turns.store(0, Ordering::SeqCst);
        self.tool_calls.store(0, Ordering::SeqCst);
        self.tokens.store(0, Ordering::SeqCst);
        // 注意：started_at 不重置，因为 rate_limit 针对整个任务生命周期
    }
}

/// 速率限制超限原因
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RateLimitExceeded {
    /// 轮次超限
    Turns { current: u32, max: u32 },
    /// 工具调用次数超限
    ToolCalls { current: u32, max: u32 },
    /// Token 数超限
    Tokens { current: u64, max: u64 },
    /// 执行时长超限
    Duration { current: Duration, max: Duration },
}

impl RateLimitExceeded {
    /// 转为人类可读字符串
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Turns { .. } => "turns_exceeded",
            Self::ToolCalls { .. } => "tool_calls_exceeded",
            Self::Tokens { .. } => "tokens_exceeded",
            Self::Duration { .. } => "duration_exceeded",
        }
    }
}

// ─── 重试策略 ────────────────────────────────────────────

/// 重试策略执行器，详细见 docs/details/注释/agent-runtime/loop_control.md
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    config: RetryConfig,
}

impl RetryPolicy {
    /// 创建重试策略
    pub fn new(config: RetryConfig) -> Self {
        Self { config }
    }

    /// 判断是否应该重试
    ///
    /// # 参数
    /// - `error`：错误信息（用于匹配 `retryable_errors`）
    /// - `attempt`：当前重试次数（0=首次失败，1=已重试 1 次，...）
    ///
    /// # 返回
    /// - `Some(Duration)`：应该重试，等待指定时长
    /// - `None`：不应重试（超过最大次数或错误不可重试）
    pub fn should_retry(&self, error: &str, attempt: u32) -> Option<Duration> {
        // 检查重试次数
        if attempt >= self.config.max_retries {
            debug!(
                "RetryPolicy: 已达最大重试次数 {}，不再重试",
                self.config.max_retries
            );
            return None;
        }

        // 检查错误是否可重试
        if !self.is_retryable(error) {
            debug!("RetryPolicy: 错误不可重试: {}", error);
            return None;
        }

        // 计算退避时长：initial * multiplier^attempt
        let backoff_ms = self.config.initial_backoff.as_millis() as f64
            * self.config.backoff_multiplier.powi(attempt as i32);
        let backoff = Duration::from_millis(backoff_ms as u64);

        // 限制最大退避时长
        let capped = if backoff > self.config.max_backoff {
            self.config.max_backoff
        } else {
            backoff
        };

        info!(
            "RetryPolicy: 将在第 {} 次重试后等待 {}ms（错误: {}）",
            attempt + 1,
            capped.as_millis(),
            error
        );

        Some(capped)
    }

    /// 检查错误是否可重试
    fn is_retryable(&self, error: &str) -> bool {
        // 空错误列表 = 全部可重试
        if self.config.retryable_errors.is_empty() {
            return true;
        }
        // 大小写不敏感匹配
        let error_lower = error.to_lowercase();
        self.config
            .retryable_errors
            .iter()
            .any(|e| error_lower.contains(&e.to_lowercase()))
    }

    /// 获取配置引用
    pub fn config(&self) -> &RetryConfig {
        &self.config
    }
}

// ─── 软超时 ────────────────────────────────────────────

/// 软超时监控器
///
/// 跟踪任务执行时长，触发 `Warning` / `Critical` 两级提醒。
/// 不强制终止，仅通过事件通知前端。
#[derive(Debug)]
pub struct SoftTimeout {
    config: SoftTimeoutConfig,
    started_at: Instant,
    /// 是否已触发 Warning（避免重复触发）
    warn_triggered: std::sync::atomic::AtomicBool,
    /// 是否已触发 Critical（避免重复触发）
    critical_triggered: std::sync::atomic::AtomicBool,
}

impl SoftTimeout {
    /// 创建软超时监控器
    pub fn new(config: SoftTimeoutConfig) -> Self {
        Self {
            config,
            started_at: Instant::now(),
            warn_triggered: std::sync::atomic::AtomicBool::new(false),
            critical_triggered: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// 检查并触发超时事件
    ///
    /// # 返回
    /// - `Some(SoftTimeoutLevel::Warning)`：首次达到 warn_threshold
    /// - `Some(SoftTimeoutLevel::Critical)`：首次达到 critical_threshold
    /// - `None`：未触发或已触发过
    pub fn check(&self) -> Option<SoftTimeoutLevel> {
        let elapsed = self.started_at.elapsed();

        // 先检查 Critical（更高优先级）
        if elapsed >= self.config.critical_threshold
            && !self.critical_triggered.load(Ordering::SeqCst)
        {
            self.critical_triggered.store(true, Ordering::SeqCst);
            warn!(
                "SoftTimeout: 已达 Critical 阈值（{}s），建议停止任务",
                elapsed.as_secs()
            );
            return Some(SoftTimeoutLevel::Critical);
        }

        // 再检查 Warning
        if elapsed >= self.config.warn_threshold
            && !self.warn_triggered.load(Ordering::SeqCst)
        {
            self.warn_triggered.store(true, Ordering::SeqCst);
            warn!(
                "SoftTimeout: 已达 Warning 阈值（{}s），任务运行时间较长",
                elapsed.as_secs()
            );
            return Some(SoftTimeoutLevel::Warning);
        }

        None
    }

    /// 获取已运行时长
    pub fn elapsed(&self) -> Duration {
        self.started_at.elapsed()
    }

    /// 重置（用于 retry 时重新开始）
    pub fn reset(&self) {
        self.warn_triggered.store(false, Ordering::SeqCst);
        self.critical_triggered.store(false, Ordering::SeqCst);
        // 注意：started_at 不重置，因为 timeout 针对整个任务生命周期
    }

    /// 获取配置引用（对齐 Watchdog::config）
    pub fn config(&self) -> &SoftTimeoutConfig {
        &self.config
    }

    /// 是否处于告警锁存状态（Warning 或 Critical 已触发且未 `reset()`）
    ///
    /// 供恢复检测使用：软超时触发后锁存，`reset()` 才清除，因此
    /// 不会因"后续 check 返回 None"而误判为恢复。
    pub fn is_alerted(&self) -> bool {
        self.warn_triggered.load(Ordering::SeqCst)
            || self.critical_triggered.load(Ordering::SeqCst)
    }
}

/// 软超时级别
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SoftTimeoutLevel {
    /// 警告（达到 warn_threshold）
    Warning,
    /// 临界（达到 critical_threshold）
    Critical,
}

// ─── 看门狗 ────────────────────────────────────────────

/// 看门狗
///
/// 监控任务活跃度，长时间无心跳触发恢复机制。
/// 与 `LongTaskManager::refresh_heartbeat_status` 配合，
/// 但提供更主动的恢复策略（如自动 resume）。
#[derive(Debug)]
pub struct Watchdog {
    config: WatchdogConfig,
    /// 最后活动时间（用于计算 idle 时长）
    last_activity: std::sync::RwLock<DateTime<Utc>>,
    /// 是否已触发 Idle（避免重复触发）
    idle_triggered: std::sync::atomic::AtomicBool,
    /// 是否已触发 Dead（避免重复触发）
    dead_triggered: std::sync::atomic::AtomicBool,
}

impl Watchdog {
    /// 创建看门狗
    pub fn new(config: WatchdogConfig) -> Self {
        Self {
            config,
            last_activity: std::sync::RwLock::new(Utc::now()),
            idle_triggered: std::sync::atomic::AtomicBool::new(false),
            dead_triggered: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// 更新活动时间（心跳或任何活动事件触发）
    pub fn update_activity(&self) {
        *self.last_activity.write().unwrap() = Utc::now();
        // 活动恢复后重置触发标志
        self.idle_triggered.store(false, Ordering::SeqCst);
        self.dead_triggered.store(false, Ordering::SeqCst);
    }

    /// 检查并触发看门狗事件
    ///
    /// # 返回
    /// - `Some(WatchdogAlert::Dead)`：首次超过 dead_threshold
    /// - `Some(WatchdogAlert::Idle)`：首次超过 idle_threshold
    /// - `None`：未触发或已触发过
    pub fn check(&self) -> Option<WatchdogAlert> {
        let last = *self.last_activity.read().unwrap();
        let elapsed = Utc::now() - last;
        let elapsed_ms = elapsed.num_milliseconds();

        // 先检查 Dead（更高优先级）
        if elapsed_ms >= self.config.dead_threshold.as_millis() as i64
            && !self.dead_triggered.load(Ordering::SeqCst)
        {
            self.dead_triggered.store(true, Ordering::SeqCst);
            warn!(
                "Watchdog: 任务疑似崩溃（{}ms 无活动），建议恢复",
                elapsed_ms
            );
            return Some(WatchdogAlert::Dead {
                last_activity: last,
                elapsed: Duration::from_millis(elapsed_ms as u64),
            });
        }

        // 再检查 Idle
        if elapsed_ms >= self.config.idle_threshold.as_millis() as i64
            && !self.idle_triggered.load(Ordering::SeqCst)
        {
            self.idle_triggered.store(true, Ordering::SeqCst);
            warn!(
                "Watchdog: 任务长时间无活动（{}ms），可能卡死",
                elapsed_ms
            );
            return Some(WatchdogAlert::Idle {
                last_activity: last,
                elapsed: Duration::from_millis(elapsed_ms as u64),
            });
        }

        None
    }

    /// 是否启用自动恢复
    pub fn auto_recovery_enabled(&self) -> bool {
        self.config.auto_recovery
    }

    /// 获取配置引用
    pub fn config(&self) -> &WatchdogConfig {
        &self.config
    }

    /// 是否处于告警锁存状态（Idle 或 Dead 已触发且未随活动恢复清除）
    ///
    /// 供恢复检测使用：`update_activity()` 会清除触发标志并刷新 last_activity，
    /// 因此"活动恢复"与"看门狗告警"之间可据此判定边沿。
    pub fn is_alerted(&self) -> bool {
        self.idle_triggered.load(Ordering::SeqCst)
            || self.dead_triggered.load(Ordering::SeqCst)
    }
}

/// 看门狗告警
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "level", rename_all = "lowercase")]
pub enum WatchdogAlert {
    /// 空闲（达到 idle_threshold）
    Idle {
        /// 最后活动时间
        last_activity: DateTime<Utc>,
        /// 已空闲时长
        elapsed: Duration,
    },
    /// 死亡（达到 dead_threshold）
    Dead {
        /// 最后活动时间
        last_activity: DateTime<Utc>,
        /// 已空闲时长
        elapsed: Duration,
    },
}

// ─── LoopController（聚合控制器）────────────────────────────────────────

/// Loop Engineering 聚合控制器
///
/// 持有 RateLimiter / RetryPolicy / SoftTimeout / Watchdog 四个组件，
/// 提供 `check_all()` 一站式检查接口。
///
/// # 设计动机
/// AgentLoop 只需持有一个 `Arc<LoopController>` 即可访问所有控制逻辑，
/// 避免管理多个 Arc。
pub struct LoopController {
    pub rate_limiter: RateLimiter,
    pub retry_policy: RetryPolicy,
    pub soft_timeout: SoftTimeout,
    pub watchdog: Watchdog,
}

impl LoopController {
    /// 创建控制器（基于配置）
    pub fn new(config: LoopControlConfig) -> Self {
        Self {
            rate_limiter: RateLimiter::new(config.rate_limit),
            retry_policy: RetryPolicy::new(config.retry),
            soft_timeout: SoftTimeout::new(config.soft_timeout),
            watchdog: Watchdog::new(config.watchdog),
        }
    }

    /// 一站式检查（在 ReAct 每轮迭代开始调用）
    ///
    /// # 返回
    /// 返回 `LoopControlCheck` 聚合结果，AgentLoop 据此决定是否停止/重试。
    pub fn check_all(&self) -> LoopControlCheck {
        LoopControlCheck {
            rate_limit_exceeded: self.rate_limiter.check_exceeded(),
            soft_timeout_level: self.soft_timeout.check(),
            watchdog_alert: self.watchdog.check(),
        }
    }

    /// 更新活动时间（心跳/任何活动事件）
    pub fn update_activity(&self) {
        self.watchdog.update_activity();
    }

    /// 是否应该停止（rate_limit 超限或 watchdog 死亡）
    pub fn should_stop(&self) -> Option<RateLimitExceeded> {
        self.rate_limiter.check_exceeded()
    }

    /// 是否处于告警锁存状态（软超时或看门狗已触发且未恢复）
    ///
    /// 基于底层触发标志（非 check 返回级别），供 AgentLoop 做恢复边沿检测：
    /// `true → false` 的跳变即代表任务从告警态恢复，用于 emit `LoopEngRecovered`。
    pub fn is_alerted(&self) -> bool {
        self.soft_timeout.is_alerted() || self.watchdog.is_alerted()
    }

    /// 重建完整配置（供注册表/前端回显、共享实例时构造条目）
    ///
    /// 各子组件都持有自己的配置，这里从它们聚合回一份 [`LoopControlConfig`]。
    pub fn config(&self) -> LoopControlConfig {
        LoopControlConfig {
            rate_limit: self.rate_limiter.config().clone(),
            retry: self.retry_policy.config().clone(),
            soft_timeout: self.soft_timeout.config().clone(),
            watchdog: self.watchdog.config().clone(),
        }
    }
}

/// 一站式检查结果
#[derive(Debug, Clone)]
pub struct LoopControlCheck {
    /// 速率限制超限（None=未超限）
    pub rate_limit_exceeded: Option<RateLimitExceeded>,
    /// 软超时级别（None=未触发）
    pub soft_timeout_level: Option<SoftTimeoutLevel>,
    /// 看门狗告警（None=未触发）
    pub watchdog_alert: Option<WatchdogAlert>,
}

impl LoopControlCheck {
    /// 是否有任何需要 AgentLoop 关注的事件
    pub fn has_any(&self) -> bool {
        self.rate_limit_exceeded.is_some()
            || self.soft_timeout_level.is_some()
            || self.watchdog_alert.is_some()
    }

    /// 是否应该强制停止（rate_limit 超限）
    ///
    /// 注意：软超时和看门狗不强制停止，仅提醒。
    pub fn should_stop(&self) -> bool {
        self.rate_limit_exceeded.is_some()
    }
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_turns() {
        let config = RateLimitConfig {
            max_turns: Some(3),
            max_tool_calls: None,
            max_tokens: None,
            max_duration: None,
        };
        let limiter = RateLimiter::new(config);

        limiter.inc_turns();
        limiter.inc_turns();
        assert!(!limiter.should_stop());

        limiter.inc_turns();
        assert!(limiter.should_stop());
        assert!(matches!(
            limiter.check_exceeded(),
            Some(RateLimitExceeded::Turns { current: 3, max: 3 })
        ));
    }

    #[test]
    fn test_rate_limiter_tokens() {
        let config = RateLimitConfig {
            max_turns: None,
            max_tool_calls: None,
            max_tokens: Some(1000),
            max_duration: None,
        };
        let limiter = RateLimiter::new(config);

        limiter.add_tokens(500);
        assert!(!limiter.should_stop());

        limiter.add_tokens(600);
        assert!(limiter.should_stop());
    }

    #[test]
    fn test_retry_policy_should_retry() {
        let config = RetryConfig {
            max_retries: 3,
            initial_backoff: Duration::from_millis(100),
            backoff_multiplier: 2.0,
            max_backoff: Duration::from_secs(10),
            retryable_errors: vec!["timeout".into()],
        };
        let policy = RetryPolicy::new(config);

        // 首次失败，应该重试
        let backoff = policy.should_retry("request timeout", 0);
        assert!(backoff.is_some());
        assert_eq!(backoff.unwrap(), Duration::from_millis(100)); // 100 * 2^0

        // 第二次重试
        let backoff = policy.should_retry("request timeout", 1);
        assert!(backoff.is_some());
        assert_eq!(backoff.unwrap(), Duration::from_millis(200)); // 100 * 2^1

        // 第三次重试
        let backoff = policy.should_retry("request timeout", 2);
        assert!(backoff.is_some());
        assert_eq!(backoff.unwrap(), Duration::from_millis(400)); // 100 * 2^2

        // 超过最大次数
        let backoff = policy.should_retry("request timeout", 3);
        assert!(backoff.is_none());
    }

    #[test]
    fn test_retry_policy_non_retryable_error() {
        let config = RetryConfig {
            max_retries: 3,
            initial_backoff: Duration::from_millis(100),
            backoff_multiplier: 2.0,
            max_backoff: Duration::from_secs(10),
            retryable_errors: vec!["timeout".into()],
        };
        let policy = RetryPolicy::new(config);

        // 不可重试的错误
        let backoff = policy.should_retry("invalid api key", 0);
        assert!(backoff.is_none());
    }

    #[test]
    fn test_soft_timeout_warning() {
        let config = SoftTimeoutConfig {
            warn_threshold: Duration::from_millis(10),
            critical_threshold: Duration::from_millis(100),
        };
        let timeout = SoftTimeout::new(config);

        // 等待超过 warn_threshold
        std::thread::sleep(Duration::from_millis(20));

        let level = timeout.check();
        assert_eq!(level, Some(SoftTimeoutLevel::Warning));

        // 再次检查不应重复触发
        let level = timeout.check();
        assert_eq!(level, None);
    }

    #[test]
    fn test_watchdog_idle() {
        let config = WatchdogConfig {
            idle_threshold: Duration::from_millis(10),
            dead_threshold: Duration::from_millis(100),
            auto_recovery: false,
        };
        let watchdog = Watchdog::new(config);

        // 等待超过 idle_threshold
        std::thread::sleep(Duration::from_millis(20));

        let alert = watchdog.check();
        assert!(matches!(alert, Some(WatchdogAlert::Idle { .. })));

        // 再次检查不应重复触发
        let alert = watchdog.check();
        assert_eq!(alert, None);

        // 更新活动后应重置
        watchdog.update_activity();
        std::thread::sleep(Duration::from_millis(20));
        let alert = watchdog.check();
        assert!(matches!(alert, Some(WatchdogAlert::Idle { .. })));
    }

    #[test]
    fn test_loop_controller_aggregate() {
        let config = LoopControlConfig {
            rate_limit: RateLimitConfig {
                max_turns: Some(1),
                max_tool_calls: None,
                max_tokens: None,
                max_duration: None,
            },
            retry: RetryConfig::default(),
            soft_timeout: SoftTimeoutConfig {
                warn_threshold: Duration::from_secs(60),
                critical_threshold: Duration::from_secs(120),
            },
            watchdog: WatchdogConfig::default(),
        };
        let controller = LoopController::new(config);

        // 初始状态：无超限
        let check = controller.check_all();
        assert!(!check.has_any());

        // 增加一轮：触发 rate_limit
        controller.rate_limiter.inc_turns();
        let check = controller.check_all();
        assert!(check.should_stop());
        assert!(check.rate_limit_exceeded.is_some());
    }
}
