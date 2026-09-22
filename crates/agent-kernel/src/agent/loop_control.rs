use std::sync::atomic::Ordering;
use std::sync::Arc;

use tokio::sync::RwLock;
use tracing::info;

use crate::event::{EventBroadcaster, OrchestratorEvent};
use crate::long_task::LongTaskManager;
use crate::loop_control::{LoopControlCheck, RateLimitExceeded, SoftTimeoutLevel, WatchdogAlert};
use crate::types::{MessageRole, OrchestratorMessage, PlanItemStatus};

use super::AgentLoop;

// ─── Loop Engineering 批次5：内建 LoopController 辅助方法 ─────────

/// T4（2026-09-18）：`LoopEngRetrying` 的显式依赖版本——工具执行统一包装（无 `&self`）复用，
/// 使并行 task 与串行路径发出同一形态的重试事件。
pub(super) async fn emit_loop_retrying_with(
    broadcaster: &Arc<RwLock<EventBroadcaster>>,
    long_task_manager: &Arc<LongTaskManager>,
    attempt: u32,
    max_retries: u32,
    backoff_ms: u64,
    error: &str,
) {
    let task_id = long_task_manager
        .get_active_task_id()
        .await
        .unwrap_or_default();
    broadcaster
        .read()
        .await
        .handle()
        .emit(&OrchestratorEvent::LoopEngRetrying {
            task_id,
            attempt,
            max_retries,
            backoff_ms,
            error: error.to_string(),
        });
}

/// T4（2026-09-18）：`LoopEngRetryExhausted` 的显式依赖版本（同上）。
pub(super) async fn emit_loop_retry_exhausted_with(
    broadcaster: &Arc<RwLock<EventBroadcaster>>,
    long_task_manager: &Arc<LongTaskManager>,
    total_attempts: u32,
    final_error: &str,
) {
    let task_id = long_task_manager
        .get_active_task_id()
        .await
        .unwrap_or_default();
    broadcaster
        .read()
        .await
        .handle()
        .emit(&OrchestratorEvent::LoopEngRetryExhausted {
            task_id,
            total_attempts,
            final_error: final_error.to_string(),
        });
}

impl AgentLoop {
    /// 获取当前任务 ID（用于 LoopEng 事件广播）
    ///
    /// 复用长任务管理器当前活跃任务的 task_id；若无活跃长任务则返回空串，
    /// 由 Tauri 端按 session 填充（对齐 `DeepPhaseChanged.node_id` 的处理方式）。
    async fn loop_task_id(&self) -> String {
        self.long_task_manager
            .get_active_task_id()
            .await
            .unwrap_or_default()
    }

    /// 广播恢复事件（`LoopEngRecovered`），详细见 docs/details/注释/agent-runtime/agent.md
    pub(super) async fn emit_loop_recovered_if_needed(&self) {
        let alerted_now = self.loop_controller.is_alerted();
        let was_alerted = self
            .loop_control_warned
            .swap(alerted_now, Ordering::SeqCst);
        if was_alerted && !alerted_now {
            let task_id = self.loop_task_id().await;
            let turn_count = self.loop_controller.rate_limiter.turns();
            self.broadcast(OrchestratorEvent::LoopEngRecovered {
                task_id,
                turn_count,
                recovery_method: "auto".to_string(),
            })
            .await;
        }
    }

    /// 广播软超时 / 看门狗告警事件（不停止循环，仅提醒用户）
    ///
    /// # 设计
    /// - 软超时：达到 `warn_threshold` → `LoopEngSoftTimeoutWarning`；
    ///   达到 `critical_threshold` → `LoopEngSoftTimeoutCritical`（建议停止，但不强制）
    /// - 看门狗：达到 `idle_threshold` → `LoopEngWatchdogIdle`；
    ///   达到 `dead_threshold` → `LoopEngWatchdogDead`（建议恢复，但不自动恢复）
    ///
    /// 符合项目"无强制中断"原则：所有控制均为协作式软限制。
    pub(super) async fn emit_loop_control_warnings(&self, check: &LoopControlCheck) {
        let task_id = self.loop_task_id().await;
        if let Some(level) = &check.soft_timeout_level {
            let elapsed_secs = self.loop_controller.soft_timeout.elapsed().as_secs();
            let cfg = self.loop_controller.soft_timeout.config();
            match level {
                SoftTimeoutLevel::Warning => {
                    self.broadcast(OrchestratorEvent::LoopEngSoftTimeoutWarning {
                        task_id: task_id.clone(),
                        elapsed_secs,
                        threshold_secs: cfg.warn_threshold.as_secs(),
                    })
                    .await;
                }
                SoftTimeoutLevel::Critical => {
                    self.broadcast(OrchestratorEvent::LoopEngSoftTimeoutCritical {
                        task_id: task_id.clone(),
                        elapsed_secs,
                        threshold_secs: cfg.critical_threshold.as_secs(),
                    })
                    .await;
                }
            }
        }
        if let Some(alert) = &check.watchdog_alert {
            match alert {
                WatchdogAlert::Idle {
                    last_activity,
                    elapsed,
                } => {
                    self.broadcast(OrchestratorEvent::LoopEngWatchdogIdle {
                        task_id: task_id.clone(),
                        last_activity: *last_activity,
                        idle_secs: elapsed.as_secs(),
                    })
                    .await;
                }
                WatchdogAlert::Dead {
                    last_activity,
                    elapsed,
                } => {
                    self.broadcast(OrchestratorEvent::LoopEngWatchdogDead {
                        task_id: task_id.clone(),
                        last_activity: *last_activity,
                        idle_secs: elapsed.as_secs(),
                    })
                    .await;
                }
            }
        }
    }

    /// 广播速率限制超限事件并更新长任务状态
    ///
    /// # 触发
    /// `check_all().rate_limit_exceeded` 非空时调用（turns / tool_calls / tokens / duration 任一超限）。
    ///
    /// # 动作
    /// 1. 广播 `LoopEngRateLimitExceeded`（携带超限类型 + 当前/最大值，前端可展示进度）
    /// 2. 同步 `LongTaskManager` 的 rate_limit 状态（供 heartbeat tick 携带）
    pub(super) async fn emit_rate_limit_exceeded(&self, exceeded: &RateLimitExceeded) {
        let task_id = self.loop_task_id().await;
        // 将超限枚举映射为事件字段（limit_type / current / max）
        let (limit_type, current, max) = match exceeded {
            // C1-a：无进展超时（卡死兜底；累计类边界默认已解除）
            RateLimitExceeded::Idle { idle_secs, max_secs } => ("idle", *idle_secs, *max_secs),
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
        info!(
            "Loop Engineering 速率限制超限: {} ({}/{})",
            limit_type, current, max
        );
        self.broadcast(OrchestratorEvent::LoopEngRateLimitExceeded {
            task_id,
            limit_type: limit_type.to_string(),
            current,
            max,
        })
        .await;
        // 同步长任务状态（供心跳 tick 携带 + 前端展示）
        self.long_task_manager.record_rate_limit_status(limit_type).await;
    }

    /// 广播 `LoopEngRetrying` 事件（重试决策时调用；T4 起与并行路径共用显式依赖版本）
    pub(super) async fn emit_loop_retrying(&self, attempt: u32, max_retries: u32, backoff_ms: u64, error: &str) {
        emit_loop_retrying_with(
            &self.broadcaster,
            &self.long_task_manager,
            attempt,
            max_retries,
            backoff_ms,
            error,
        )
        .await;
    }

    /// 广播 `LoopEngRetryExhausted` 事件（重试次数用尽时调用；T4 起与并行路径共用显式依赖版本）
    pub(super) async fn emit_loop_retry_exhausted(&self, total_attempts: u32, final_error: &str) {
        emit_loop_retry_exhausted_with(
            &self.broadcaster,
            &self.long_task_manager,
            total_attempts,
            final_error,
        )
        .await;
    }

    /// 总步骤预算软提醒与熔断判定（工具调用轮数口径，对齐 Claude Code maxTurns）
    ///
    /// 每轮迭代开始、LLM 调用之前调用一次。内部完成预算感知（对齐 OpenHands #2406 共识方案）：
    /// - 80%：注入「剩余 N 步，开始收尾」提示 + 广播 `StepBudgetWarning(80)`
    /// - 95%：注入「1-2 步内完成」提示 + 广播 `StepBudgetWarning(95)`
    /// - 100%：注入「预算用完」提示 + 广播 `StepBudgetWarning(100)`
    ///
    /// **C1-a 目标续跑（2026-09-23）**：越过 100% **不再熔断**（无错误、不打断）——长任务不因
    /// 工具次数硬停，模型自行判断何时收尾；失控由**无进展超时**（`RateLimiter::max_idle_duration`）
    /// / 取消 / 上下文压缩 / retry 上限兜底。
    ///
    /// 通知标志（state.budget_warn_80/95/final_notified）保证各级仅触发一次；
    /// 新用户消息 / clear_history / dispose 时由调用方重置。
    pub(super) async fn apply_step_budget(&self, used: u32, limit: u32) {
        let pct = used.saturating_mul(100) / limit.max(1);

        // 决策（统一在一把锁内读状态 + 置通知标志，避免重复注入/广播）
        enum Decision {
            None,
            Warn80,
            Warn95,
            Final,
        }
        let decision = {
            let mut state = self.state.lock().await;
            if used == limit && !state.budget_final_notified {
                state.budget_final_notified = true;
                Decision::Final
            } else if pct >= 95 && !state.budget_warn_95_notified {
                state.budget_warn_95_notified = true;
                Decision::Warn95
            } else if pct >= 80 && !state.budget_warn_80_notified {
                state.budget_warn_80_notified = true;
                Decision::Warn80
            } else {
                Decision::None
            }
        };

        let (msg, percent) = match decision {
            Decision::None => return,
            Decision::Warn80 => (
                format!(
                    "[SYSTEM] 步骤预算提醒：已使用 {used}/{limit} 步（80%）。请开始收尾，优先完成最关键部分，避免开启新的大任务。"
                ),
                80,
            ),
            Decision::Warn95 => (
                format!(
                    "[SYSTEM] 步骤预算接近耗尽：已使用 {used}/{limit} 步（95%）。请在 1-2 步内完成并给出最佳答案。"
                ),
                95,
            ),
            Decision::Final => (
                format!(
                    "[SYSTEM] 步骤预算已用完（{limit} 步）：如任务尚未完成，请继续推进（可继续调用工具）；否则给出最终答案。"
                ),
                100,
            ),
        };

        // 注入系统提示（push 到消息历史末尾，随 set_messages 同步给 backend，本轮 LLM 即可感知）
        self.inject_budget_nudge(msg).await;
        let task_id = self.loop_task_id().await;
        self.broadcast(OrchestratorEvent::StepBudgetWarning {
            task_id,
            used,
            limit,
            percent,
        })
        .await;
    }

    /// 注入一条系统级提示到消息历史末尾（预算提醒等；须在 set_messages 同步 backend 之前调用）
    async fn inject_budget_nudge(&self, text: String) {
        let mut state = self.state.lock().await;
        state.messages.push(OrchestratorMessage {
            role: MessageRole::System,
            content: text,
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });
    }

    /// C1-a 目标续跑：模型停止调用工具时，若任务清单仍有未完成项且续跑次数未达上限 →
    /// 注入推进提示并返回 `true`（调用方 `continue` 主循环）；否则 `false`（正常收尾）。
    ///
    /// - 「未完成」= `state.plan` 存在且含 `Pending` / `InProgress` 项；
    /// - **无 plan 的任务完全不受影响**（行为与改造前逐字一致）；
    /// - 上限 [`crate::agent::MAX_PLAN_CONTINUATIONS`]（按 run 重置）。
    pub(super) async fn try_continue_for_plan(&self) -> bool {
        let unfinished = {
            let state = self.state.lock().await;
            state.plan.as_ref().map(|plan| {
                plan.iter()
                    .filter(|i| {
                        matches!(i.status, PlanItemStatus::Pending | PlanItemStatus::InProgress)
                    })
                    .count()
            })
        };
        let Some(unfinished) = unfinished else {
            return false; // 无 plan：不续跑（纯对话任务行为逐字不变）
        };
        if unfinished == 0 {
            return false; // 清单已全部完成：正常收尾
        }
        let attempt = self.plan_continuations.load(Ordering::SeqCst);
        if attempt >= crate::agent::MAX_PLAN_CONTINUATIONS {
            tracing::warn!(
                unfinished,
                limit = crate::agent::MAX_PLAN_CONTINUATIONS,
                "目标续跑达上限，正常收尾（清单仍有未完成项）"
            );
            return false;
        }
        self.plan_continuations.fetch_add(1, Ordering::SeqCst);
        tracing::info!(
            unfinished,
            attempt = attempt + 1,
            "目标续跑：任务清单未完成，注入推进提示继续"
        );
        self.inject_budget_nudge(format!(
            "[SYSTEM] 任务清单仍有 {unfinished} 项未完成（pending/in_progress）。请继续执行未完成步骤             （用 todo_write 更新状态，完成一步立即标记），不要提前结束。"
        ))
        .await;
        true
    }
}
