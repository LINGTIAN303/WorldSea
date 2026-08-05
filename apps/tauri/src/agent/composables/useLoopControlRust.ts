/**
 * 本文件于 Phase 3 从 src/agent/composables/useLoopControlRust.ts 迁移到 apps/tauri/src/agent/composables/useLoopControlRust.ts
 * 端分离：Tauri 端专用（依赖 @tauri-apps/api）
 */

/**
 * # useLoopControlRust — Loop Engineering 的前端适配层
 *
 * 阶段 2.6（Loop Engineering 批次3）新增。本文件桥接前端 Vue 层与
 * Rust 端 `agent_runtime::loop_control::LoopController`，通过 Tauri `invoke` + `listen` 通信。
 *
 * ## 职责
 *   1. 通过 Tauri 命令管理 LoopController 实例（create / check / recordTurn / 等 11 个命令）
 *   2. 监听 `loop_control:event:{taskId}` 事件流，分发到订阅者
 *   3. 维护多个 Loop Control 任务的响应式状态（计数器、触发状态、事件历史）
 *   4. 提供 Reactive 视图（lastCheck / status / events / 触发计数）供 UI 组件使用
 *
 * ## 与 useMultiAgentRust / useGoTRust / useToTRust / useSupervisorRust 的差异
 *
 * Loop Engineering 是**横切关注点**（cross-cutting concern），不是独立编排节点：
 * - **索引键不同**：按 `task_id` 索引（与 `LongTaskRecord.task_id` 对齐），
 *   其他 composable 按 `session_id` 索引（一个会话一个节点）
 * - **无 LLM/tool 调用**：LoopController 只做检查与状态聚合，不执行任务
 *   （因此无 `run` / `abort` 方法，由 AgentLoop 驱动）
 * - **无编排节点**：不参与 OrchestratorState，不返回 NodeResult
 * - **事件由命令层显式 emit**：`LoopEngRetrying` / `LoopEngRetryExhausted` / `LoopEngRecovered`
 *   由 AgentLoop 在重试/恢复时直接 emit（命令层不介入）
 * - **状态来源**：状态由 `getStatus` / `check` 命令返回 + 事件流累加双重维护
 *
 * ## Tauri 命令映射
 * | TS 函数            | Rust 命令                            |
 * |--------------------|--------------------------------------|
 * | `create`           | `cmd_loop_control_create`            |
 * | `check`            | `cmd_loop_control_check`             |
 * | `recordTurn`       | `cmd_loop_control_record_turn`       |
 * | `recordToolCall`   | `cmd_loop_control_record_tool_call`  |
 * | `recordTokens`     | `cmd_loop_control_record_tokens`     |
 * | `updateActivity`   | `cmd_loop_control_update_activity`   |
 * | `resetCounters`    | `cmd_loop_control_reset_counters`    |
 * | `getConfig`        | `cmd_loop_control_get_config`        |
 * | `getStatus`        | `cmd_loop_control_get_status`        |
 * | `destroy`          | `cmd_loop_control_destroy`           |
 * | `listTasks`        | `cmd_loop_control_list_tasks`        |
 *
 * ## 事件命名约定
 * - 事件名：`loop_control:event:{taskId}`（与 `agent:event:*` / `multi_agent:event:*` 并列）
 * - Payload 字段：snake_case（Rust 端 `LoopControlEventPayload` 只对变体名用
 *   `rename_all = "snake_case"`，变体内部字段保持 snake_case）
 * - 变体 tag：snake_case（如 `loop_eng_rate_limit_exceeded` / `loop_eng_recovered`）
 *
 * ## 配置参数命名
 * Rust 端 `LoopControlConfig` / `RateLimitConfig` / `RetryConfig` /
 * `SoftTimeoutConfig` / `WatchdogConfig` 启用 `#[serde(rename_all = "camelCase")]`，
 * 前端用 camelCase。
 *
 * ## Duration 序列化
 * Rust serde 默认将 `std::time::Duration` 序列化为 `{secs: u64, nanos: u32}` 对象。
 * 前端构造时使用 `secsToDuration` / `msToDuration` 辅助函数，
 * 读取时使用 `durationToMs` / `durationToSecs` 辅助函数。
 *
 * ## RateLimitExceeded / WatchdogAlert 序列化
 * - `RateLimitExceeded`：`#[serde(tag = "type", rename_all = "snake_case")]`
 *   - `{"type":"turns","current":100,"max":100}`
 *   - `{"type":"tool_calls","current":200,"max":200}`
 *   - `{"type":"tokens","current":100000,"max":100000}`
 *   - `{"type":"duration","current":{secs,nanos},"max":{secs,nanos}}`
 * - `WatchdogAlert`：`#[serde(tag = "level", rename_all = "lowercase")]`
 *   - `{"level":"idle","last_activity":"2026-...","elapsed":{secs,nanos}}`
 *   - `{"level":"dead","last_activity":"2026-...","elapsed":{secs,nanos}}`
 *
 * ## SoftTimeoutLevel 序列化
 * `#[serde(rename_all = "lowercase")]` → `"warning"` / `"critical"`
 *
 * ## 多任务并发
 * 模块级 `lcTasks` Map 支持多个 Loop Control 任务并发。
 * 每个任务独立的事件监听器、状态、订阅者集合。
 * 一个 Agent 会话可能同时有多个长任务，每个长任务对应独立的 LoopController。
 */

import { reactive, readonly, computed, shallowReactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// ─── Rust Duration 镜像 ────────────────────────────────────────────

/**
 * Rust `std::time::Duration` 的前端镜像
 *
 * Rust serde 默认将 Duration 序列为 `{secs: u64, nanos: u32}` 对象。
 * 前端构造时使用 `secsToDuration` / `msToDuration` 辅助函数。
 */
export interface RustDuration {
  /** 秒部分 */
  secs: number
  /** 纳秒部分（0 ~ 999_999_999） */
  nanos: number
}

/**
 * 秒 → RustDuration
 *
 * 用于构造 `maxDuration` / `warnThreshold` 等配置字段。
 */
export function secsToDuration(secs: number): RustDuration {
  const wholeSecs = Math.floor(secs)
  const nanos = Math.round((secs - wholeSecs) * 1_000_000_000)
  return { secs: wholeSecs, nanos }
}

/**
 * 毫秒 → RustDuration
 *
 * 用于构造精度为毫秒的 Duration 字段。
 */
export function msToDuration(ms: number): RustDuration {
  const wholeSecs = Math.floor(ms / 1000)
  const nanos = (ms % 1000) * 1_000_000
  return { secs: wholeSecs, nanos }
}

/**
 * RustDuration → 毫秒
 *
 * 用于从 Rust 返回的 Duration 字段（如 `elapsed` / `current`）转换为 UI 友好的毫秒数。
 */
export function durationToMs(d: RustDuration): number {
  return d.secs * 1000 + Math.floor(d.nanos / 1_000_000)
}

/**
 * RustDuration → 秒
 *
 * 用于从 Rust 返回的 Duration 字段转换为秒数（可能丢失毫秒精度）。
 */
export function durationToSecs(d: RustDuration): number {
  return d.secs + d.nanos / 1_000_000_000
}

// ─── Rust 端配置类型镜像 ────────────────────────────────────────────

/**
 * Rust `agent_runtime::loop_control::RateLimitConfig` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 任意一项超限即触发 `shouldStop = true`。设为 `null` 表示不限制该维度。
 *
 * 默认值（`RateLimitConfig::default()`）：
 * - `maxTurns = 100`
 * - `maxToolCalls = 200`
 * - `maxTokens = 100_000`
 * - `maxDuration = 6h`（`{secs: 21600, nanos: 0}`）
 */
export interface RustRateLimitConfig {
  /** 最大轮次限制（null=不限） */
  maxTurns?: number | null
  /** 最大工具调用次数（null=不限） */
  maxToolCalls?: number | null
  /** 最大 token 数（null=不限） */
  maxTokens?: number | null
  /** 最大执行时长（null=不限；Rust Duration 对象 `{secs, nanos}`） */
  maxDuration?: RustDuration | null
}

/**
 * Rust `agent_runtime::loop_control::RetryConfig` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 *
 * 默认值（`RetryConfig::default()`）：
 * - `maxRetries = 3`
 * - `initialBackoff = 1s`
 * - `backoffMultiplier = 2.0`
 * - `maxBackoff = 30s`
 * - `retryableErrors = ["rate_limit", "timeout", "server_error", "connection_reset"]`
 */
export interface RustRetryConfig {
  /** 最大重试次数（0=不重试） */
  maxRetries: number
  /** 初始退避时长（首次重试等待时间） */
  initialBackoff: RustDuration
  /** 退避乘数（每次重试等待时间 = initial * multiplier^attempt） */
  backoffMultiplier: number
  /** 最大退避时长（避免无限增长） */
  maxBackoff: RustDuration
  /** 可重试的错误类型（字符串匹配，如 "rate_limit" / "timeout" / "server_error"） */
  retryableErrors: string[]
}

/**
 * Rust `agent_runtime::loop_control::SoftTimeoutConfig` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 软超时仅提醒不强制终止，符合"无强制中断"原则。
 *
 * 默认值（`SoftTimeoutConfig::default()`）：
 * - `warnThreshold = 30min`
 * - `criticalThreshold = 2h`
 */
export interface RustSoftTimeoutConfig {
  /** 提醒阈值（达到此时长触发 `SoftTimeoutWarning` 事件） */
  warnThreshold: RustDuration
  /** 临界阈值（达到此时长触发 `SoftTimeoutCritical` 事件，建议停止） */
  criticalThreshold: RustDuration
}

/**
 * Rust `agent_runtime::loop_control::WatchdogConfig` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 *
 * 默认值（`WatchdogConfig::default()`）：
 * - `idleThreshold = 5min`
 * - `deadThreshold = 30min`
 * - `autoRecovery = false`（默认仅通知，不自动恢复）
 */
export interface RustWatchdogConfig {
  /** 无活动阈值（超过此时长无心跳触发 `WatchdogIdle` 事件） */
  idleThreshold: RustDuration
  /** 死亡阈值（超过此时长无心跳触发 `WatchdogDead` 事件，建议恢复） */
  deadThreshold: RustDuration
  /** 是否启用自动恢复（true=自动调 resume，false=仅通知） */
  autoRecovery: boolean
}

/**
 * Rust `agent_runtime::loop_control::LoopControlConfig` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 聚合速率限制、重试策略、软超时、看门狗四项配置。
 *
 * 默认值（`LoopControlConfig::default()`）：
 * - 速率限制：100 turns / 200 tool_calls / 100k tokens / 6h
 * - 重试：3 次，指数退避 1s/2s/4s
 * - 软超时：30min 提醒，2h 临界
 * - 看门狗：5min 无活动触发 Idle，30min 触发 Dead，不自动恢复
 */
export interface RustLoopControlConfig {
  /** 速率限制配置 */
  rateLimit: RustRateLimitConfig
  /** 重试策略配置 */
  retry: RustRetryConfig
  /** 软超时配置 */
  softTimeout: RustSoftTimeoutConfig
  /** 看门狗配置 */
  watchdog: RustWatchdogConfig
}

// ─── Rust 端状态/检查结果类型镜像 ────────────────────────────────────────────

/**
 * Rust `agent_runtime::loop_control::RateLimitExceeded` 的前端镜像
 *
 * Rust 端 `#[serde(tag = "type", rename_all = "snake_case")]` → 内部标签模式。
 * 变体名 snake_case（`turns` / `tool_calls` / `tokens` / `duration`）。
 *
 * 注意：`Duration` 变体的 `current` / `max` 字段为 Rust Duration 对象 `{secs, nanos}`。
 */
export type RustRateLimitExceeded =
  | { type: 'turns'; current: number; max: number }
  | { type: 'tool_calls'; current: number; max: number }
  | { type: 'tokens'; current: number; max: number }
  | { type: 'duration'; current: RustDuration; max: RustDuration }

/**
 * Rust `agent_runtime::loop_control::SoftTimeoutLevel` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "lowercase")]` → lowercase 字符串字面量。
 */
export type RustSoftTimeoutLevel = 'warning' | 'critical'

/**
 * Rust `agent_runtime::loop_control::WatchdogAlert` 的前端镜像
 *
 * Rust 端 `#[serde(tag = "level", rename_all = "lowercase")]` → 内部标签模式。
 * 变体名 lowercase（`idle` / `dead`）。
 *
 * 注意：
 * - `lastActivity` 为 RFC3339 字符串（chrono DateTime<Utc> 默认序列化）
 * - `elapsed` 为 Rust Duration 对象 `{secs, nanos}`
 */
export type RustWatchdogAlert =
  | { level: 'idle'; lastActivity: string; elapsed: RustDuration }
  | { level: 'dead'; lastActivity: string; elapsed: RustDuration }

/**
 * Rust `commands::loop_control::LoopControlCheckResult` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 *
 * 由 `cmd_loop_control_check` 返回，包含一站式检查结果与是否触发了事件。
 */
export interface RustLoopControlCheckResult {
  /** 是否有任何需要关注的事件 */
  hasAny: boolean
  /** 是否应该强制停止（rate_limit 超限） */
  shouldStop: boolean
  /** 速率限制超限详情（null=未超限） */
  rateLimitExceeded: RustRateLimitExceeded | null
  /** 软超时级别（null=未触发） */
  softTimeoutLevel: RustSoftTimeoutLevel | null
  /** 看门狗告警（null=未触发） */
  watchdogAlert: RustWatchdogAlert | null
}

/**
 * Rust `agent_bridge::loop_control_registry::LoopControlStatus` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 *
 * 由 `cmd_loop_control_get_status` 返回，前端可据此展示：
 * - 当前 turns / toolCalls / tokens 计数
 * - 已运行时长（elapsedMs）
 * - 各组件触发状态（rateLimit / softTimeout / watchdog）
 */
export interface RustLoopControlStatus {
  /** 任务 ID */
  taskId: string
  /** 当前轮次 */
  turns: number
  /** 当前工具调用数 */
  toolCalls: number
  /** 当前 token 数 */
  tokens: number
  /** 已运行时长（毫秒） */
  elapsedMs: number
  /** 速率限制是否超限（null=未超限） */
  rateLimitExceeded: RustRateLimitExceeded | null
  /** 软超时级别（null=未触发） */
  softTimeoutLevel: RustSoftTimeoutLevel | null
  /** 看门狗告警（null=未触发） */
  watchdogAlert: RustWatchdogAlert | null
  /** 创建时间戳（Unix 毫秒） */
  createdAt: number
}

/**
 * Rust `agent_bridge::loop_control_registry::LoopControlRegistryError` 的前端镜像
 *
 * Rust 端 `#[serde(tag = "kind", rename_all = "snake_case")]` → 内部标签模式。
 * 变体名 snake_case（`not_found` / `already_exists` / `lock_error` / `invalid_config` / `internal`）。
 */
export type RustLoopControlRegistryError =
  | { kind: 'not_found'; taskId: string }
  | { kind: 'already_exists'; taskId: string }
  | { kind: 'lock_error'; message: string }
  | { kind: 'invalid_config'; message: string }
  | { kind: 'internal'; message: string }

// ─── Rust 端事件 Payload 镜像 ────────────────────────────────────────────

/**
 * Rust `commands::loop_control::LoopControlEventPayload` 的前端镜像
 *
 * **重要**：字段为 **snake_case**！
 *
 * 原因：Rust 端 `LoopControlEventPayload` 只对变体名用 `rename_all = "snake_case"`
 * （生成 `loop_eng_rate_limit_exceeded` / `loop_eng_recovered` 等 tag），
 * 变体内部字段保持 snake_case（`task_id` / `limit_type` / `attempt` / `max_retries` /
 * `backoff_ms` / `elapsed_secs` / `threshold_secs` / `last_activity` / `idle_secs` /
 * `turn_count` / `recovery_method`）。
 *
 * 与 `RustMultiAgentEventPayload` / `RustGoTEventPayload` 命名约定一致：
 * 编排层级事件保持 snake_case，不与流式 message 事件（启用 camelCase）混淆。
 *
 * ## 事件来源
 * - `loop_eng_rate_limit_exceeded` / `loop_eng_soft_timeout_warning` /
 *   `loop_eng_soft_timeout_critical` / `loop_eng_watchdog_idle` /
 *   `loop_eng_watchdog_dead`：由 `cmd_loop_control_check` 在检测到非空结果时 emit
 * - `loop_eng_retrying` / `loop_eng_retry_exhausted` / `loop_eng_recovered`：
 *   由 AgentLoop 在重试/恢复时直接 emit（命令层不介入）
 */
export type RustLoopControlEventPayload =
  | {
      type: 'loop_eng_rate_limit_exceeded'
      task_id: string
      limit_type: string
      current: number
      max: number
    }
  | {
      type: 'loop_eng_retrying'
      task_id: string
      attempt: number
      max_retries: number
      backoff_ms: number
      error: string
    }
  | {
      type: 'loop_eng_retry_exhausted'
      task_id: string
      total_attempts: number
      final_error: string
    }
  | {
      type: 'loop_eng_soft_timeout_warning'
      task_id: string
      elapsed_secs: number
      threshold_secs: number
    }
  | {
      type: 'loop_eng_soft_timeout_critical'
      task_id: string
      elapsed_secs: number
      threshold_secs: number
    }
  | {
      type: 'loop_eng_watchdog_idle'
      task_id: string
      last_activity: string
      idle_secs: number
    }
  | {
      type: 'loop_eng_watchdog_dead'
      task_id: string
      last_activity: string
      idle_secs: number
    }
  | {
      type: 'loop_eng_recovered'
      task_id: string
      turn_count: number
      recovery_method: string
    }

// ─── TS 端事件类型（camelCase，UI 友好） ────────────────────────────────────────────

/**
 * TS 端 Loop Control 事件（camelCase，UI 友好）
 *
 * 由 `rustEventToTsEvent` 从 `RustLoopControlEventPayload` 转换而来，
 * 供 UI 组件订阅。事件名采用 camelCase 与 TS 项目惯例一致。
 */
export type LoopControlEvent =
  | {
      type: 'loopEngRateLimitExceeded'
      taskId: string
      limitType: string
      current: number
      max: number
    }
  | {
      type: 'loopEngRetrying'
      taskId: string
      attempt: number
      maxRetries: number
      backoffMs: number
      error: string
    }
  | {
      type: 'loopEngRetryExhausted'
      taskId: string
      totalAttempts: number
      finalError: string
    }
  | {
      type: 'loopEngSoftTimeoutWarning'
      taskId: string
      elapsedSecs: number
      thresholdSecs: number
    }
  | {
      type: 'loopEngSoftTimeoutCritical'
      taskId: string
      elapsedSecs: number
      thresholdSecs: number
    }
  | {
      type: 'loopEngWatchdogIdle'
      taskId: string
      lastActivity: string
      idleSecs: number
    }
  | {
      type: 'loopEngWatchdogDead'
      taskId: string
      lastActivity: string
      idleSecs: number
    }
  | {
      type: 'loopEngRecovered'
      taskId: string
      turnCount: number
      recoveryMethod: string
    }

/** Rust payload → TS event 转换 */
function rustEventToTsEvent(payload: RustLoopControlEventPayload): LoopControlEvent {
  switch (payload.type) {
    case 'loop_eng_rate_limit_exceeded':
      return {
        type: 'loopEngRateLimitExceeded',
        taskId: payload.task_id,
        limitType: payload.limit_type,
        current: payload.current,
        max: payload.max,
      }
    case 'loop_eng_retrying':
      return {
        type: 'loopEngRetrying',
        taskId: payload.task_id,
        attempt: payload.attempt,
        maxRetries: payload.max_retries,
        backoffMs: payload.backoff_ms,
        error: payload.error,
      }
    case 'loop_eng_retry_exhausted':
      return {
        type: 'loopEngRetryExhausted',
        taskId: payload.task_id,
        totalAttempts: payload.total_attempts,
        finalError: payload.final_error,
      }
    case 'loop_eng_soft_timeout_warning':
      return {
        type: 'loopEngSoftTimeoutWarning',
        taskId: payload.task_id,
        elapsedSecs: payload.elapsed_secs,
        thresholdSecs: payload.threshold_secs,
      }
    case 'loop_eng_soft_timeout_critical':
      return {
        type: 'loopEngSoftTimeoutCritical',
        taskId: payload.task_id,
        elapsedSecs: payload.elapsed_secs,
        thresholdSecs: payload.threshold_secs,
      }
    case 'loop_eng_watchdog_idle':
      return {
        type: 'loopEngWatchdogIdle',
        taskId: payload.task_id,
        lastActivity: payload.last_activity,
        idleSecs: payload.idle_secs,
      }
    case 'loop_eng_watchdog_dead':
      return {
        type: 'loopEngWatchdogDead',
        taskId: payload.task_id,
        lastActivity: payload.last_activity,
        idleSecs: payload.idle_secs,
      }
    case 'loop_eng_recovered':
      return {
        type: 'loopEngRecovered',
        taskId: payload.task_id,
        turnCount: payload.turn_count,
        recoveryMethod: payload.recovery_method,
      }
  }
}

// ─── 任务级状态 ────────────────────────────────────────────

/**
 * 单个 Loop Control 任务的响应式状态
 *
 * 镜像 Rust 端 LoopController 状态 + 事件流累加计数器。
 * UI 组件通过 `lcTasks.get(taskId)` 读取并渲染。
 *
 * ## 与 MultiAgentSessionState 的差异
 * - **索引键**：`taskId`（非 `sessionId`），与 `LongTaskRecord.task_id` 对齐
 * - **无 run/abort**：LoopController 只做检查，不执行任务
 * - **状态来源**：`status` 由 `getStatus` / `check` 命令返回 + 事件流累加双重维护
 * - **事件类型**：8 个 Loop Engineering 专用事件（rate_limit / retrying /
 *   retry_exhausted / soft_timeout_warning / soft_timeout_critical /
 *   watchdog_idle / watchdog_dead / recovered）
 * - **无编排节点**：不参与 OrchestratorState，不返回 NodeResult
 */
export interface LoopControlTaskState {
  /** 任务 ID */
  taskId: string
  /** 是否活跃（destroy 后置为 false） */
  active: boolean
  /** 创建时间戳（Unix 毫秒） */
  createdAt: number

  // ── 配置（create 时填充）──
  /** 任务创建时使用的 LoopControlConfig（create 时填充；getConfig 可刷新） */
  config: RustLoopControlConfig | null

  // ── 状态快照（getStatus / check 时更新）──
  /** 最近一次 getStatus 返回的状态快照（null=尚未查询） */
  status: RustLoopControlStatus | null
  /** 最近一次 check 返回的检查结果（null=尚未检查） */
  lastCheck: RustLoopControlCheckResult | null

  // ── 事件历史 ──
  /** 事件历史（最多保留 200 条，按时间顺序） */
  events: LoopControlEvent[]

  // ── 事件驱动计数器（从事件流累加）──
  /** 速率限制触发次数（loopEngRateLimitExceeded 事件累加） */
  rateLimitTriggerCount: number
  /** 重试次数（loopEngRetrying 事件累加） */
  retryCount: number
  /** 重试耗尽次数（loopEngRetryExhausted 事件累加） */
  retryExhaustedCount: number
  /** 软超时警告次数（loopEngSoftTimeoutWarning 事件累加） */
  softTimeoutWarningCount: number
  /** 软超时临界次数（loopEngSoftTimeoutCritical 事件累加） */
  softTimeoutCriticalCount: number
  /** 看门狗空闲告警次数（loopEngWatchdogIdle 事件累加） */
  watchdogIdleCount: number
  /** 看门狗死亡告警次数（loopEngWatchdogDead 事件累加） */
  watchdogDeadCount: number
  /** 恢复次数（loopEngRecovered 事件累加） */
  recoveredCount: number

  // ── 最近错误（destroy 等命令失败时记录）──
  /** 最近一次错误信息（null=无错误） */
  lastError: string | null
}

/** 创建初始任务状态 */
function createInitialTaskState(taskId: string): LoopControlTaskState {
  return {
    taskId,
    active: true,
    createdAt: Date.now(),
    config: null,
    status: null,
    lastCheck: null,
    events: [],
    rateLimitTriggerCount: 0,
    retryCount: 0,
    retryExhaustedCount: 0,
    softTimeoutWarningCount: 0,
    softTimeoutCriticalCount: 0,
    watchdogIdleCount: 0,
    watchdogDeadCount: 0,
    recoveredCount: 0,
    lastError: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 模块级单例状态（与 useAgentRust / useSupervisorRust / useRouterRust /
//                useToTRust / useGoTRust / useMultiAgentRust 一致：模块级单例）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 所有活跃 Loop Control 任务的响应式状态映射
 *
 * key = taskId，value = LoopControlTaskState（reactive）
 * UI 通过 `lcTasks.get(taskId)` 读取状态。
 */
const lcTasks = shallowReactive<Map<string, LoopControlTaskState>>(new Map())

/** 事件监听器清理函数映射 */
const unlistenFns = new Map<string, UnlistenFn>()

/** 用户订阅者集合（每任务独立；subscribe 时注册，unsubscribe 或 destroy 时清理） */
type TaskEventListener = (event: LoopControlEvent) => void
const taskListeners = new Map<string, Set<TaskEventListener>>()

/** 任务创建时间戳（用于 listTasks 排序） */
const taskCreatedAt = new Map<string, number>()

// ─── 事件监听器设置 ────────────────────────────────────────────

/**
 * 为指定任务设置事件监听器
 *
 * 监听 `loop_control:event:{taskId}` 事件，收到 Rust payload 后：
 * 1. 转换为 TS 事件（camelCase）
 * 2. 更新模块级响应式状态（lcTasks）
 * 3. 分发给所有订阅者
 *
 * 幂等：若已存在监听器，直接返回（避免重复监听）。
 */
async function setupEventListener(taskId: string): Promise<void> {
  if (unlistenFns.has(taskId)) return

  const eventName = `loop_control:event:${taskId}`
  try {
    const unlisten = await listen<RustLoopControlEventPayload>(eventName, (e) => {
      const tsEvent = rustEventToTsEvent(e.payload)
      handleTaskEvent(taskId, tsEvent)
    })
    unlistenFns.set(taskId, unlisten)
  } catch (err) {
    console.error(`[useLoopControlRust] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定任务的事件监听器 */
function teardownEventListener(taskId: string): void {
  const unlisten = unlistenFns.get(taskId)
  if (unlisten) {
    unlisten()
    unlistenFns.delete(taskId)
  }
}

/**
 * 处理转换后的 TS 事件
 *
 * 1. 更新 `lcTasks` 中的任务状态（累加事件计数器）
 * 2. 限制 `events` 历史最多 200 条（FIFO）
 * 3. 分发给所有订阅者
 */
function handleTaskEvent(taskId: string, event: LoopControlEvent): void {
  const task = lcTasks.get(taskId)
  if (task) {
    // 更新任务状态（累加事件计数器）
    switch (event.type) {
      case 'loopEngRateLimitExceeded':
        task.rateLimitTriggerCount += 1
        break
      case 'loopEngRetrying':
        task.retryCount += 1
        break
      case 'loopEngRetryExhausted':
        task.retryExhaustedCount += 1
        break
      case 'loopEngSoftTimeoutWarning':
        task.softTimeoutWarningCount += 1
        break
      case 'loopEngSoftTimeoutCritical':
        task.softTimeoutCriticalCount += 1
        break
      case 'loopEngWatchdogIdle':
        task.watchdogIdleCount += 1
        break
      case 'loopEngWatchdogDead':
        task.watchdogDeadCount += 1
        break
      case 'loopEngRecovered':
        task.recoveredCount += 1
        break
    }

    // 追加事件历史（FIFO，上限 200）
    task.events.push(event)
    if (task.events.length > 200) {
      task.events.splice(0, task.events.length - 200)
    }
  }

  // 分发给订阅者
  const listeners = taskListeners.get(taskId)
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (err) {
        console.warn(`[useLoopControlRust] 任务 ${taskId} 订阅者异常:`, err)
      }
    }
  }
}

// ─── Tauri 命令封装 ────────────────────────────────────────────

/**
 * 创建 LoopController 实例并注册到 Rust 端 registry
 *
 * # 参数
 * - `taskId`：任务 ID（前端生成，建议前缀 `lc_`；与 `LongTaskRecord.task_id` 对齐）
 * - `config`：可选 LoopControlConfig（null=使用默认配置；仅无 sessionId 绑定时生效）
 * - `sessionId`：可选会话 ID。传入后 Rust 端通过 `register_session_loop_control`
 *   复用该会话 AgentLoop 内建 LoopController（共享单实例），消除"自动 vs 手动"双轨
 *   ——手动命令（recordTurn/getStatus/check）与自动驱动读取同一份计数器/状态。
 *   config 在绑定会话时被忽略（以会话内建控制器配置为准）。
 *
 * # 行为
 * 1. 调用 `cmd_loop_control_create` 在 Rust 端创建 LoopController
 *    - 有 sessionId：共享会话内建控制器（手动命令读数与自动驱动一致）
 *    - 无 sessionId：独立创建控制器（手动轨）
 * 2. 创建前端响应式任务状态并加入 `lcTasks`
 * 3. 设置事件监听器
 *
 * # 错误
 * 抛出 Rust 端返回的 `LoopControlRegistryError`（已序列化为 JS 对象）：
 * - `already_exists`：taskId 已存在
 * - `invalid_config`：配置错误
 * - `internal`：会话不存在或绑定失败
 */
async function create(
  taskId: string,
  config?: RustLoopControlConfig | null,
  sessionId?: string | null,
): Promise<void> {
  console.log(
    `[useLoopControlRust] 创建 lc task=${taskId} hasCustomConfig=${!!config} boundSession=${sessionId ?? 'none'}`,
  )

  await invoke('cmd_loop_control_create', {
    taskId,
    config: config ?? null,
    sessionId: sessionId ?? null,
  })

  // 创建前端响应式状态
  const taskState = reactive(createInitialTaskState(taskId))
  if (config) {
    taskState.config = config
  }
  lcTasks.set(taskId, taskState)
  taskCreatedAt.set(taskId, Date.now())

  // 设置事件监听器
  await setupEventListener(taskId)
}

/**
 * 执行一站式检查并 emit 事件
 *
 * # 参数
 * - `taskId`：任务 ID
 *
 * # 行为
 * 1. 调用 `cmd_loop_control_check`，Rust 端执行 `controller.check_all()`
 * 2. Rust 端根据 check 结果构造对应的 `LoopEng*` 事件并广播：
 *    - rate_limit 超限 → `loopEngRateLimitExceeded`
 *    - soft_timeout Warning → `loopEngSoftTimeoutWarning`
 *    - soft_timeout Critical → `loopEngSoftTimeoutCritical`
 *    - watchdog Idle → `loopEngWatchdogIdle`
 *    - watchdog Dead → `loopEngWatchdogDead`
 * 3. 事件通过事件流推送到前端（handleTaskEvent 更新状态）
 * 4. 返回 `RustLoopControlCheckResult`（含 hasAny / shouldStop / 各组件状态）
 *
 * # 注意
 * 即使 check 为空（hasAny=false）也会返回结果。
 * 此命令不 emit `LoopEngRetrying` / `LoopEngRetryExhausted` / `LoopEngRecovered`，
 * 这些事件由 AgentLoop 在重试/恢复时直接 emit。
 */
async function check(taskId: string): Promise<RustLoopControlCheckResult> {
  const result = await invoke<RustLoopControlCheckResult>('cmd_loop_control_check', {
    taskId,
  })

  // 缓存到任务状态
  const task = lcTasks.get(taskId)
  if (task) {
    task.lastCheck = result
  }
  return result
}

/**
 * 记录一次轮次（inc_turns）
 *
 * 在 AgentLoop 每轮 ReAct 迭代开始时调用。
 * Rust 端同时更新活动时间（每轮迭代视为活动）。
 */
async function recordTurn(taskId: string): Promise<void> {
  await invoke('cmd_loop_control_record_turn', { taskId })
}

/**
 * 记录一次工具调用（inc_tool_calls）
 *
 * 在 AgentLoop 每次工具调用时调用。
 * Rust 端同时更新活动时间。
 */
async function recordToolCall(taskId: string): Promise<void> {
  await invoke('cmd_loop_control_record_tool_call', { taskId })
}

/**
 * 记录 token 消耗（add_tokens）
 *
 * 在 AgentLoop 每次 LLM 调用返回后调用，传入 usage 中的 token 数。
 * Rust 端同时更新活动时间。
 */
async function recordTokens(taskId: string, tokens: number): Promise<void> {
  await invoke('cmd_loop_control_record_tokens', { taskId, tokens })
}

/**
 * 更新活动时间（心跳）
 *
 * AgentLoop 可定期调用此命令作为心跳，重置 Watchdog 的 last_activity。
 * 也可在任意活动事件（如用户输入、工具返回）时调用。
 */
async function updateActivity(taskId: string): Promise<void> {
  await invoke('cmd_loop_control_update_activity', { taskId })
}

/**
 * 重置计数器（retry 后调用）
 *
 * 重置 turns / tool_calls / tokens 计数器与 SoftTimeout / Watchdog 触发标志。
 * 注意：不重置 started_at（rate_limit 与 soft_timeout 针对整个任务生命周期）。
 *
 * # 使用场景
 * AgentLoop 在 retry 成功后调用此命令，重新开始计数。
 */
async function resetCounters(taskId: string): Promise<void> {
  await invoke('cmd_loop_control_reset_counters', { taskId })
  console.log(`[useLoopControlRust] 重置计数器 task=${taskId}`)
}

/**
 * 获取任务配置快照
 *
 * 返回创建时使用的 `LoopControlConfig`，前端可据此展示当前任务的限制参数。
 * 若 create 时未传入 config（使用默认值），此处返回 Rust 端默认配置。
 */
async function getConfig(taskId: string): Promise<RustLoopControlConfig> {
  const config = await invoke<RustLoopControlConfig>('cmd_loop_control_get_config', {
    taskId,
  })
  // 缓存到任务状态
  const task = lcTasks.get(taskId)
  if (task) {
    task.config = config
  }
  return config
}

/**
 * 获取状态快照（计数器 + 触发状态）
 *
 * 返回 `RustLoopControlStatus`，前端可据此展示：
 * - 当前 turns / toolCalls / tokens 计数
 * - 已运行时长（elapsedMs）
 * - 各组件触发状态（rateLimit / softTimeout / watchdog）
 */
async function getStatus(taskId: string): Promise<RustLoopControlStatus> {
  const status = await invoke<RustLoopControlStatus>('cmd_loop_control_get_status', {
    taskId,
  })
  // 缓存到任务状态
  const task = lcTasks.get(taskId)
  if (task) {
    task.status = status
  }
  return status
}

/**
 * 销毁 LoopController 实例
 *
 * 1. 调用 `cmd_loop_control_destroy`：Rust 端移除注册
 * 2. 清理前端事件监听器
 * 3. 从 `lcTasks` 移除
 * 4. 清理订阅者集合
 *
 * 任务完成后调用，避免内存泄漏。
 */
async function destroy(taskId: string): Promise<void> {
  try {
    await invoke('cmd_loop_control_destroy', { taskId })
  } catch (err) {
    console.warn(`[useLoopControlRust] destroy 调用失败（继续清理前端状态）:`, err)
    const task = lcTasks.get(taskId)
    if (task) {
      task.lastError = err instanceof Error ? err.message : String(err)
    }
  }

  // 清理前端状态
  teardownEventListener(taskId)
  lcTasks.delete(taskId)
  taskCreatedAt.delete(taskId)
  taskListeners.delete(taskId)
  console.log(`[useLoopControlRust] 销毁 lc task=${taskId}`)
}

/**
 * 列出所有已注册的 task_id
 *
 * 返回 Rust 端 `LoopControlRegistry::list()` 的结果。
 * 与前端 `lcTasks` 的 key 应保持一致（差异表明状态不同步）。
 */
async function listTasks(): Promise<string[]> {
  return await invoke<string[]>('cmd_loop_control_list_tasks')
}

// ─── 事件订阅 ────────────────────────────────────────────

/**
 * 订阅指定任务的事件
 *
 * 注册一个监听器，每次 Rust 端推送 `loop_control:event:{taskId}` 时调用。
 * 与 `useAgentRust.subscribe` / `useMultiAgentRust.subscribe` 模式一致。
 *
 * @returns 取消订阅函数（调用后移除监听器）
 */
function subscribe(taskId: string, listener: TaskEventListener): () => void {
  let listeners = taskListeners.get(taskId)
  if (!listeners) {
    listeners = new Set()
    taskListeners.set(taskId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
  }
}

// ─── 工具函数 ────────────────────────────────────────────

/**
 * 生成 Loop Control 任务 ID
 *
 * 格式：`lc_{timestamp}_{random}`，便于在日志与 UI 中识别。
 * 与 useAgentRust / useMultiAgentRust 的 sessionId 生成模式保持一致，
 * 但使用 `lc_` 前缀区分 Loop Control 任务。
 */
function generateTaskId(): string {
  return `lc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue Composable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loop Engineering 前端 composable
 *
 * 模块级单例，多次调用返回同一组状态与方法。
 *
 * # 使用示例
 * ```ts
 * const {
 *   tasks,
 *   activeTaskCount,
 *   create,
 *   check,
 *   recordTurn,
 *   recordToolCall,
 *   recordTokens,
 *   updateActivity,
 *   resetCounters,
 *   getConfig,
 *   getStatus,
 *   destroy,
 *   listTasks,
 *   subscribe,
 *   generateTaskId,
 *   secsToDuration,
 *   msToDuration,
 *   durationToMs,
 *   durationToSecs,
 * } = useLoopControlRust()
 *
 * // 创建任务（使用默认配置）
 * const taskId = generateTaskId()
 * await create(taskId)
 *
 * // 或创建任务（自定义配置）
 * const customConfig: RustLoopControlConfig = {
 *   rateLimit: { maxTurns: 50, maxToolCalls: 100, maxTokens: 50000, maxDuration: secsToDuration(3600) },
 *   retry: {
 *     maxRetries: 5,
 *     initialBackoff: msToDuration(500),
 *     backoffMultiplier: 1.5,
 *     maxBackoff: msToDuration(10000),
 *     retryableErrors: ['timeout', 'server_error'],
 *   },
 *   softTimeout: {
 *     warnThreshold: secsToDuration(600),
 *     criticalThreshold: secsToDuration(1800),
 *   },
 *   watchdog: {
 *     idleThreshold: secsToDuration(120),
 *     deadThreshold: secsToDuration(600),
 *     autoRecovery: false,
 *   },
 * }
 * await create(taskId, customConfig)
 *
 * // 订阅事件
 * const unsubscribe = subscribe(taskId, (event) => {
 *   if (event.type === 'loopEngRateLimitExceeded') {
 *     console.warn(`速率限制触发: ${event.limitType} (${event.current}/${event.max})`)
 *   }
 * })
 *
 * // AgentLoop 每轮调用
 * await recordTurn(taskId)
 * const checkResult = await check(taskId)
 * if (checkResult.shouldStop) {
 *   // 速率限制超限，AgentLoop 应优雅停止
 * }
 *
 * // 查询状态
 * const status = await getStatus(taskId)
 * console.log(`已运行 ${status.elapsedMs}ms, turns=${status.turns}`)
 *
 * // 任务完成后清理
 * unsubscribe()
 * await destroy(taskId)
 * ```
 */
export function useLoopControlRust() {
  return {
    // 响应式状态（只读）
    tasks: readonly(lcTasks),
    activeTaskCount: computed(() =>
      Array.from(lcTasks.values()).filter((t) => t.active).length,
    ),

    // 生命周期
    create,
    destroy,
    listTasks,

    // 检查
    check,

    // 记录
    recordTurn,
    recordToolCall,
    recordTokens,
    updateActivity,
    resetCounters,

    // 状态访问
    getConfig,
    getStatus,

    // 事件订阅
    subscribe,

    // 工具
    generateTaskId,

    // Duration 辅助函数
    secsToDuration,
    msToDuration,
    durationToMs,
    durationToSecs,

    // 内部状态访问（调试用）
    getTaskState: (taskId: string): LoopControlTaskState | null =>
      lcTasks.get(taskId) ?? null,
  }
}
