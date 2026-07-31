//! # Loop Control 命令层 — Tauri 命令封装
//!
//! 阶段 2.6 批次2 新增。本模块把 `agent_runtime::loop_control::LoopController` 的能力
//! 通过 Tauri 命令暴露给前端，与 `commands::supervisor` / `commands::router` /
//! `commands::tot` / `commands::got` / `commands::multi_agent` 并列存在。
//!
//! ## 与其他命令层的差异
//!
//! Loop Engineering 是**横切关注点**，不是独立编排节点：
//! - 其他命令层按 `session_id` 管理节点实例
//! - 本命令层按 `task_id` 管理 LoopController（与 `LongTaskRecord.task_id` 对齐）
//!
//! 因此本命令层不涉及 LLM 调用、工具执行或节点编排，
//! 仅提供 LoopController 的生命周期管理与状态查询。
//!
//! ## 命令一览
//! | 命令 | 说明 |
//! |------|------|
//! | `cmd_loop_control_create`           | 创建 LoopController 实例并注册 |
//! | `cmd_loop_control_check`            | 执行一站式检查，返回结果并 emit 事件 |
//! | `cmd_loop_control_record_turn`      | 记录一次轮次（inc_turns） |
//! | `cmd_loop_control_record_tool_call` | 记录一次工具调用（inc_tool_calls） |
//! | `cmd_loop_control_record_tokens`    | 记录 token 消耗（add_tokens） |
//! | `cmd_loop_control_update_activity`  | 更新活动时间（心跳） |
//! | `cmd_loop_control_reset_counters`   | 重置计数器（retry 后调用） |
//! | `cmd_loop_control_get_config`       | 获取任务配置快照 |
//! | `cmd_loop_control_get_status`       | 获取状态快照（计数器+触发状态） |
//! | `cmd_loop_control_destroy`          | 销毁实例（移除注册） |
//! | `cmd_loop_control_list_tasks`       | 列出所有已注册的 task_id |
//!
//! ## 事件流
//! 事件通过 `app.emit("loop_control:event:{task_id}", LoopControlEventPayload)` 推送，
//! 前端通过 `listen("loop_control:event:" + taskId, handler)` 监听。
//!
//! `cmd_loop_control_check` 在检测到非空结果时会 emit 对应事件：
//!   - rate_limit 超限 → `LoopEngRateLimitExceeded`
//!   - soft_timeout 触发 → `LoopEngSoftTimeoutWarning` / `LoopEngSoftTimeoutCritical`
//!   - watchdog 告警 → `LoopEngWatchdogIdle` / `LoopEngWatchdogDead`
//!
//! 注意：`LoopEngRetrying` / `LoopEngRetryExhausted` / `LoopEngRecovered` 事件
//! 由 AgentLoop 在重试/恢复时直接 emit（命令层不介入），因为重试逻辑由
//! AgentLoop 根据 `RetryPolicy::should_retry` 返回值驱动。

use std::sync::Arc;

use agent_runtime::event::{EventListener, OrchestratorEvent};
use agent_runtime::loop_control::{
    LoopControlCheck, LoopControlConfig, LoopController, RateLimitExceeded, SoftTimeoutLevel,
    WatchdogAlert,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, info, warn};

use crate::agent_bridge::loop_control_registry::{
    LoopControlEntry, LoopControlRegistryError, LoopControlStatus,
};
use crate::state::AppState;

// ─── 事件名约定 ────────────────────────────────────────────

/// Loop Control 任务事件名前缀
///
/// 完整事件名：`loop_control:event:{task_id}`
/// 前端：`listen(\`loop_control:event:${taskId}\`, ...)`
const fn event_name_prefix() -> &'static str {
    "loop_control:event:"
}

/// 构造单个 task 的事件名
fn task_event_name(task_id: &str) -> String {
    format!("{}{}", event_name_prefix(), task_id)
}

// ─── Loop Control 事件 Payload ────────────────────────────────────────────

/// Loop Control 事件 Payload — 前端友好的扁平化事件结构
///
/// 与 `MultiAgentEventPayload` 并列存在。处理 `OrchestratorEvent` 中
/// Loop Engineering 相关变体（LoopEngRateLimitExceeded / LoopEngRetrying 等），
/// 其他事件（基础 Agent 事件、Supervisor 事件等）暂不映射（返回 None）。
///
/// ## 序列化
/// 使用 `#[serde(tag = "type")]` 内部标签模式，匹配前端 discriminated union：
/// ```json
/// {"type":"loop_eng_rate_limit_exceeded","task_id":"task_1","limit_type":"turns",...}
/// ```
///
/// 注意：`#[serde(tag = "type", rename_all = "snake_case")]` 只对变体名重命名，
/// 变体内部字段保持 Rust 原生 snake_case（与前端 `RustLoopControlEventPayload` 类型一致）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LoopControlEventPayload {
    /// 速率限制触发
    LoopEngRateLimitExceeded {
        task_id: String,
        limit_type: String,
        current: u64,
        max: u64,
    },
    /// 正在重试
    LoopEngRetrying {
        task_id: String,
        attempt: u32,
        max_retries: u32,
        backoff_ms: u64,
        error: String,
    },
    /// 重试次数用尽
    LoopEngRetryExhausted {
        task_id: String,
        total_attempts: u32,
        final_error: String,
    },
    /// 软超时警告
    LoopEngSoftTimeoutWarning {
        task_id: String,
        elapsed_secs: u64,
        threshold_secs: u64,
    },
    /// 软超时临界
    LoopEngSoftTimeoutCritical {
        task_id: String,
        elapsed_secs: u64,
        threshold_secs: u64,
    },
    /// 看门狗空闲告警
    LoopEngWatchdogIdle {
        task_id: String,
        last_activity: chrono::DateTime<chrono::Utc>,
        idle_secs: u64,
    },
    /// 看门狗死亡告警
    LoopEngWatchdogDead {
        task_id: String,
        last_activity: chrono::DateTime<chrono::Utc>,
        idle_secs: u64,
    },
    /// 任务已恢复
    LoopEngRecovered {
        task_id: String,
        turn_count: u32,
        recovery_method: String,
    },
}

impl LoopControlEventPayload {
    /// 从 `OrchestratorEvent` 转换为前端 Payload
    ///
    /// 只处理 Loop Engineering 相关变体，其他变体返回 `None`。
    /// `task_id` 由外部注入（Rust 端事件本身已携带 task_id，但此处仍显式传入
    /// 以保持与其他 Payload 转换函数签名一致）。
    pub fn from_orchestrator_event(event: &OrchestratorEvent) -> Option<Self> {
        Some(match event {
            OrchestratorEvent::LoopEngRateLimitExceeded {
                task_id,
                limit_type,
                current,
                max,
            } => Self::LoopEngRateLimitExceeded {
                task_id: task_id.clone(),
                limit_type: limit_type.clone(),
                current: *current,
                max: *max,
            },

            OrchestratorEvent::LoopEngRetrying {
                task_id,
                attempt,
                max_retries,
                backoff_ms,
                error,
            } => Self::LoopEngRetrying {
                task_id: task_id.clone(),
                attempt: *attempt,
                max_retries: *max_retries,
                backoff_ms: *backoff_ms,
                error: error.clone(),
            },

            OrchestratorEvent::LoopEngRetryExhausted {
                task_id,
                total_attempts,
                final_error,
            } => Self::LoopEngRetryExhausted {
                task_id: task_id.clone(),
                total_attempts: *total_attempts,
                final_error: final_error.clone(),
            },

            OrchestratorEvent::LoopEngSoftTimeoutWarning {
                task_id,
                elapsed_secs,
                threshold_secs,
            } => Self::LoopEngSoftTimeoutWarning {
                task_id: task_id.clone(),
                elapsed_secs: *elapsed_secs,
                threshold_secs: *threshold_secs,
            },

            OrchestratorEvent::LoopEngSoftTimeoutCritical {
                task_id,
                elapsed_secs,
                threshold_secs,
            } => Self::LoopEngSoftTimeoutCritical {
                task_id: task_id.clone(),
                elapsed_secs: *elapsed_secs,
                threshold_secs: *threshold_secs,
            },

            OrchestratorEvent::LoopEngWatchdogIdle {
                task_id,
                last_activity,
                idle_secs,
            } => Self::LoopEngWatchdogIdle {
                task_id: task_id.clone(),
                last_activity: *last_activity,
                idle_secs: *idle_secs,
            },

            OrchestratorEvent::LoopEngWatchdogDead {
                task_id,
                last_activity,
                idle_secs,
            } => Self::LoopEngWatchdogDead {
                task_id: task_id.clone(),
                last_activity: *last_activity,
                idle_secs: *idle_secs,
            },

            OrchestratorEvent::LoopEngRecovered {
                task_id,
                turn_count,
                recovery_method,
            } => Self::LoopEngRecovered {
                task_id: task_id.clone(),
                turn_count: *turn_count,
                recovery_method: recovery_method.clone(),
            },

            // 其他事件（Agent/Supervisor/Router/ToT/GoT/MultiAgent/Plan/Reflection/Memory）暂不映射
            _ => return None,
        })
    }
}

// ─── LoopControlTauriEventListener ────────────────────────────────────────────

/// 把 `OrchestratorEvent` 转为 `LoopControlEventPayload` 并通过 `app.emit` 推送到前端
///
/// 每个 `LoopController` 实例对应一个监听器，在 `cmd_loop_control_create` 时
/// 通过 `entry.subscribe(Arc::new(...))` 注入到 `EventBroadcaster`。
///
/// # 设计
/// - `app: AppHandle`：可克隆，跨任务安全
/// - 与 `MultiAgentTauriEventListener` 不同，本监听器不持有 task_id，
///   因为 LoopEng* 事件本身已携带 task_id，从事件中提取即可。
struct LoopControlTauriEventListener {
    /// Tauri 应用句柄
    app: AppHandle,
}

impl EventListener for LoopControlTauriEventListener {
    fn on_event(&self, event: &OrchestratorEvent) {
        let Some(payload) = LoopControlEventPayload::from_orchestrator_event(event) else {
            // 未映射的事件直接丢弃
            return;
        };

        // 从 payload 中提取 task_id 用于构造事件名
        let task_id = match &payload {
            LoopControlEventPayload::LoopEngRateLimitExceeded { task_id, .. } => task_id,
            LoopControlEventPayload::LoopEngRetrying { task_id, .. } => task_id,
            LoopControlEventPayload::LoopEngRetryExhausted { task_id, .. } => task_id,
            LoopControlEventPayload::LoopEngSoftTimeoutWarning { task_id, .. } => task_id,
            LoopControlEventPayload::LoopEngSoftTimeoutCritical { task_id, .. } => task_id,
            LoopControlEventPayload::LoopEngWatchdogIdle { task_id, .. } => task_id,
            LoopControlEventPayload::LoopEngWatchdogDead { task_id, .. } => task_id,
            LoopControlEventPayload::LoopEngRecovered { task_id, .. } => task_id,
        };

        let event_name = task_event_name(task_id);
        match self.app.emit(&event_name, &payload) {
            Ok(()) => {
                debug!(
                    "loop_control event emitted: task={} event={}",
                    task_id, event_name
                );
            }
            Err(e) => {
                warn!(
                    "loop_control event emit 失败: task={} err={}",
                    task_id, e
                );
            }
        }
    }
}

// ─── 命令参数与返回类型 ────────────────────────────────────────────

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

// ─── Tauri 命令 ────────────────────────────────────────────

/// 创建 LoopController 实例并注册到 registry
///
/// # 参数
/// - `task_id`：任务 ID（与 `LongTaskRecord.task_id` 对齐，前端生成）
/// - `config`：可选 LoopControlConfig（None=使用默认配置）
///
/// # 行为
/// 1. 构造 `LoopControlConfig`（未提供者使用默认值）
/// 2. 创建 `LoopController`
/// 3. 创建 `LoopControlEntry`（含 controller / config / broadcaster）
/// 4. 注册到 `LoopControlRegistry`
/// 5. 创建 `LoopControlTauriEventListener` 并订阅 broadcaster
///
/// # 错误
/// - `AlreadyExists`：task_id 已存在
/// - `InvalidConfig`：配置错误（如所有 rate_limit 维度都为 None 且无 watchdog）
#[tauri::command]
pub async fn cmd_loop_control_create(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    config: Option<LoopControlConfig>,
) -> Result<(), LoopControlRegistryError> {
    let config = config.unwrap_or_default();

    info!(
        "cmd_loop_control_create: task={} max_turns={:?} max_tool_calls={:?} max_tokens={:?}",
        task_id, config.rate_limit.max_turns, config.rate_limit.max_tool_calls, config.rate_limit.max_tokens,
    );

    // 1. 创建 LoopController
    let controller = Arc::new(LoopController::new(config.clone()));

    // 2. 创建 entry
    let entry = LoopControlEntry::new(controller, config);

    // 3. 注册到 registry
    state
        .loop_control_registry
        .register(task_id.clone(), entry)
        .await?;

    // 4. 取出 entry，订阅 TauriEventListener
    let entry_after = state.loop_control_registry.get(&task_id).await?;
    let listener = Arc::new(LoopControlTauriEventListener { app: app.clone() });
    entry_after.subscribe(listener).await;

    info!(
        "cmd_loop_control_create: 成功创建 loop_control task={}",
        task_id
    );
    Ok(())
}

/// 执行一站式检查并 emit 事件
///
/// # 参数
/// - `task_id`：任务 ID
///
/// # 行为
/// 1. 获取 entry
/// 2. 调用 `controller.check_all()` 获取 `LoopControlCheck`
/// 3. 根据 check 结果构造对应的 `OrchestratorEvent::LoopEng*` 事件
/// 4. 通过 broadcaster 广播事件（触发 TauriEventListener → 前端）
/// 5. 返回 `LoopControlCheckResult`
///
/// # 事件触发规则
/// - `rate_limit_exceeded` → `LoopEngRateLimitExceeded`
/// - `soft_timeout_level = Warning` → `LoopEngSoftTimeoutWarning`
/// - `soft_timeout_level = Critical` → `LoopEngSoftTimeoutCritical`
/// - `watchdog_alert = Idle` → `LoopEngWatchdogIdle`
/// - `watchdog_alert = Dead` → `LoopEngWatchdogDead`
///
/// 注意：本命令只在 check 返回非空结果时 emit 事件。
/// 即使 check 为空也会返回 `LoopControlCheckResult`（has_any=false）。
#[tauri::command]
pub async fn cmd_loop_control_check(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<LoopControlCheckResult, LoopControlRegistryError> {
    let entry = state.loop_control_registry.get(&task_id).await?;
    let check = entry.check_all();

    // 根据 check 结果构造并广播事件
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
                task_id: task_id.clone(),
                limit_type: limit_type.into(),
                current,
                max,
            };
            broadcast_event(&broadcaster, &event).await;
        }

        // soft_timeout
        if let Some(level) = check.soft_timeout_level {
            let elapsed_secs = entry.controller.soft_timeout.elapsed().as_secs();
            let event = match level {
                SoftTimeoutLevel::Warning => {
                    OrchestratorEvent::LoopEngSoftTimeoutWarning {
                        task_id: task_id.clone(),
                        elapsed_secs,
                        threshold_secs: entry.config.soft_timeout.warn_threshold.as_secs(),
                    }
                }
                SoftTimeoutLevel::Critical => {
                    OrchestratorEvent::LoopEngSoftTimeoutCritical {
                        task_id: task_id.clone(),
                        elapsed_secs,
                        threshold_secs: entry.config.soft_timeout.critical_threshold.as_secs(),
                    }
                }
            };
            broadcast_event(&broadcaster, &event).await;
        }

        // watchdog
        if let Some(alert) = &check.watchdog_alert {
            let event = match alert {
                WatchdogAlert::Idle {
                    last_activity,
                    elapsed,
                } => OrchestratorEvent::LoopEngWatchdogIdle {
                    task_id: task_id.clone(),
                    last_activity: last_activity.clone(),
                    idle_secs: elapsed.as_secs(),
                },
                WatchdogAlert::Dead {
                    last_activity,
                    elapsed,
                } => OrchestratorEvent::LoopEngWatchdogDead {
                    task_id: task_id.clone(),
                    last_activity: last_activity.clone(),
                    idle_secs: elapsed.as_secs(),
                },
            };
            broadcast_event(&broadcaster, &event).await;
        }
    }

    Ok(LoopControlCheckResult::from_check(check))
}

/// 记录一次轮次（inc_turns）
///
/// 在 AgentLoop 每轮 ReAct 迭代开始时调用。
#[tauri::command]
pub async fn cmd_loop_control_record_turn(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.loop_control_registry.get(&task_id).await?;
    entry.controller.rate_limiter.inc_turns();
    // 同时更新活动时间（每轮迭代视为活动）
    entry.controller.update_activity();
    Ok(())
}

/// 记录一次工具调用（inc_tool_calls）
///
/// 在 AgentLoop 每次工具调用时调用。
#[tauri::command]
pub async fn cmd_loop_control_record_tool_call(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.loop_control_registry.get(&task_id).await?;
    entry.controller.rate_limiter.inc_tool_calls();
    entry.controller.update_activity();
    Ok(())
}

/// 记录 token 消耗（add_tokens）
///
/// 在 AgentLoop 每次 LLM 调用返回后调用，传入 usage 中的 token 数。
#[tauri::command]
pub async fn cmd_loop_control_record_tokens(
    state: State<'_, AppState>,
    task_id: String,
    tokens: u64,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.loop_control_registry.get(&task_id).await?;
    entry.controller.rate_limiter.add_tokens(tokens);
    entry.controller.update_activity();
    Ok(())
}

/// 更新活动时间（心跳）
///
/// AgentLoop 可定期调用此命令作为心跳，重置 Watchdog 的 last_activity。
/// 也可在任意活动事件（如用户输入、工具返回）时调用。
#[tauri::command]
pub async fn cmd_loop_control_update_activity(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.loop_control_registry.get(&task_id).await?;
    entry.update_activity();
    Ok(())
}

/// 重置计数器（retry 后调用）
///
/// 重置 turns / tool_calls / tokens 计数器与 SoftTimeout / Watchdog 触发标志。
/// 注意：不重置 started_at（rate_limit 与 soft_timeout 针对整个任务生命周期）。
///
/// # 使用场景
/// AgentLoop 在 retry 成功后调用此命令，重新开始计数。
#[tauri::command]
pub async fn cmd_loop_control_reset_counters(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.loop_control_registry.get(&task_id).await?;
    entry.reset_counters();
    info!(
        "cmd_loop_control_reset_counters: task={} 计数器已重置",
        task_id
    );
    Ok(())
}

/// 获取任务配置快照
///
/// 返回创建时使用的 `LoopControlConfig`，前端可据此展示当前任务的限制参数。
#[tauri::command]
pub async fn cmd_loop_control_get_config(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<LoopControlConfig, LoopControlRegistryError> {
    let entry = state.loop_control_registry.get(&task_id).await?;
    Ok(entry.config.clone())
}

/// 获取状态快照（计数器 + 触发状态）
///
/// 返回 `LoopControlStatus`，前端可据此展示：
/// - 当前 turns / tool_calls / tokens 计数
/// - 已运行时长
/// - 各组件触发状态（rate_limit / soft_timeout / watchdog）
#[tauri::command]
pub async fn cmd_loop_control_get_status(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<LoopControlStatus, LoopControlRegistryError> {
    let entry = state.loop_control_registry.get(&task_id).await?;
    Ok(LoopControlStatus::from_entry(&task_id, &entry))
}

/// 销毁 LoopController 实例
///
/// 从 registry 移除。任务完成后调用，避免内存泄漏。
#[tauri::command]
pub async fn cmd_loop_control_destroy(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    state.loop_control_registry.remove(&task_id).await?;
    info!(
        "cmd_loop_control_destroy: 已销毁 loop_control task={}",
        task_id
    );
    Ok(())
}

/// 列出所有已注册的 task_id
#[tauri::command]
pub async fn cmd_loop_control_list_tasks(
    state: State<'_, AppState>,
) -> Result<Vec<String>, LoopControlRegistryError> {
    Ok(state.loop_control_registry.list().await)
}

// ─── 辅助函数 ────────────────────────────────────────────

/// 通过 broadcaster 广播事件（非阻塞）
///
/// 使用 `try_read` 避免阻塞：若锁被占用（极少见），丢弃事件并记录警告。
/// 这与 `MultiAgentEmitter::emit` 的策略一致。
async fn broadcast_event(
    broadcaster: &Arc<tokio::sync::RwLock<agent_runtime::event::EventBroadcaster>>,
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

    #[test]
    fn event_payload_from_rate_limit_exceeded_should_succeed() {
        let event = OrchestratorEvent::LoopEngRateLimitExceeded {
            task_id: "task_1".into(),
            limit_type: "turns".into(),
            current: 100,
            max: 100,
        };
        let payload = LoopControlEventPayload::from_orchestrator_event(&event);
        assert!(payload.is_some());
    }

    #[test]
    fn event_payload_from_non_loop_eng_event_should_return_none() {
        let event = OrchestratorEvent::Agent(AgentEvent::AgentStart {
            model: "gpt-4".into(),
        });
        let payload = LoopControlEventPayload::from_orchestrator_event(&event);
        assert!(payload.is_none());
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
    fn check_result_from_rate_limit_exceeded_should_stop() {
        let check = LoopControlCheck {
            rate_limit_exceeded: Some(RateLimitExceeded::Turns { current: 100, max: 100 }),
            soft_timeout_level: None,
            watchdog_alert: None,
        };
        let result = LoopControlCheckResult::from_check(check);
        assert!(result.has_any);
        assert!(result.should_stop);
    }

    #[test]
    fn task_event_name_should_be_well_formed() {
        let name = task_event_name("task_1");
        assert_eq!(name, "loop_control:event:task_1");
    }
}
