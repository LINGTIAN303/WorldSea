/**
 * 本文件于 Phase 3 从 src/agent/composables/useLoopControlRust.ts 迁移到 apps/tauri/src/agent/composables/useLoopControlRust.ts
 * 端分离：Tauri 端专用（依赖 @tauri-apps/api）
 */

/** useLoopControlRust：Loop Engineering 前端适配层（命令管理 + 事件监听 + 响应式状态），详细见 docs/details/注释/tauri/useLoopControlRust.md */

import { reactive, readonly, computed, shallowReactive } from 'vue'
import { invoke, listen, type UnlistenFn } from './transport'

/** 生命周期调试日志开关：仅开发环境输出（生产构建剔除，P3-9） */
const DEV_LOG = import.meta.env.DEV
const log = (...args: Parameters<typeof console.log>) => {
  if (DEV_LOG) console.log(...args)
}

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

/** Rust RateLimitConfig 镜像（camelCase；任意项超限即 shouldStop），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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

/** Rust RetryConfig 镜像（camelCase；指数退避默认值），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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

/** Rust SoftTimeoutConfig 镜像（camelCase；软超时仅提醒不强制终止），详细见 docs/details/注释/tauri/useLoopControlRust.md */
export interface RustSoftTimeoutConfig {
  /** 提醒阈值（达到此时长触发 `SoftTimeoutWarning` 事件） */
  warnThreshold: RustDuration
  /** 临界阈值（达到此时长触发 `SoftTimeoutCritical` 事件，建议停止） */
  criticalThreshold: RustDuration
}

/** Rust WatchdogConfig 镜像（camelCase；idle/dead 阈值 + 自动恢复开关），详细见 docs/details/注释/tauri/useLoopControlRust.md */
export interface RustWatchdogConfig {
  /** 无活动阈值（超过此时长无心跳触发 `WatchdogIdle` 事件） */
  idleThreshold: RustDuration
  /** 死亡阈值（超过此时长无心跳触发 `WatchdogDead` 事件，建议恢复） */
  deadThreshold: RustDuration
  /** 是否启用自动恢复（true=自动调 resume，false=仅通知） */
  autoRecovery: boolean
}

/** Rust LoopControlConfig 镜像（camelCase；聚合限流/重试/软超时/看门狗四配置），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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

/** Rust WatchdogAlert 镜像（tagged enum：idle/dead，字段注意 RFC3339 与 Duration），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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

/** Rust LoopControlStatus 镜像（camelCase；计数 + 各组件触发状态），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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

/** LoopControlEventPayload 前端镜像（snake_case 字段 + 事件来源说明），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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

/** 单个 Loop Control 任务的响应式状态（镜像 Rust 状态 + 事件流累加），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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

/** 为任务设置事件监听器（转换 TS 事件 → 更新状态 → 分发订阅者），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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

/** 创建 LoopController（可绑定会话共享内建控制器，消除双轨），详细见 docs/details/注释/tauri/useLoopControlRust.md */
async function create(
  taskId: string,
  config?: RustLoopControlConfig | null,
  sessionId?: string | null,
): Promise<void> {
  log(
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

/** 执行一站式检查并 emit 事件（check_all → LoopEng* 广播 → 返回结果），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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
  log(`[useLoopControlRust] 重置计数器 task=${taskId}`)
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

/** 销毁 LoopController（移除注册 + 清理监听器/状态/订阅者），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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
  log(`[useLoopControlRust] 销毁 lc task=${taskId}`)
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

/** Loop Engineering 前端 composable（模块级单例，含完整使用示例），详细见 docs/details/注释/tauri/useLoopControlRust.md */
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
