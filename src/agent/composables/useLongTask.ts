/**
 * useLongTask — 长任务管理器（任务 4 P1 核心）
 *
 * 职责：
 *   1. 状态机：running → completed/failed/cancelled
 *   2. 心跳：定时更新 lastHeartbeatAt，检测失联（软提醒，不强制终止）
 *   3. checkpoint：事件驱动快照 pi-ai agent 内部 messages，支持断点恢复
 *   4. 协作式取消：设 cancelFlag，beforeToolCall hook 检查，等当前 tool call 完成再停
 *
 * 设计原则（复用 workflow 引擎模式）：
 *   - 协作式取消 > 强制取消（Temporal/Airflow 经典模式）
 *   - 心跳判活（DispatchHandle.last_heartbeat_at_ms 模式）
 *   - checkpoint 持久化（SqliteStore 模式，此处用 IndexedDB）
 *   - 无硬超时（符合"无强制中断"需求）
 *
 * P1 范围：仅主 Agent 接入（单活跃任务）；P4 子 Agent 接入时扩展为多任务 Map。
 */
import { ref, readonly, computed } from 'vue'
import type { LongTaskRecord, LongTaskType, LongTaskCheckpoint } from './longTaskStore'
import { saveTask, updateTask, listRunningTasks } from './longTaskStore'

/** 心跳间隔（ms）：每 5s 更新一次 lastHeartbeatAt + flush 脏 checkpoint */
const HEARTBEAT_INTERVAL_MS = 5_000
/** 心跳失联阈值（ms）：超过 30s 标记 stale（UI 提醒，不终止） */
const HEARTBEAT_STALE_MS = 30_000
/** 心跳死亡阈值（ms）：超过 5min 标记 dead（疑似崩溃，建议恢复） */
const HEARTBEAT_DEAD_MS = 5 * 60_000

// ─────────────────────────────────────────────────────────────────────────────
// 模块级单例状态（useAgent 是模块级单例 composable，此处保持一致）
// ─────────────────────────────────────────────────────────────────────────────

/** 当前活跃任务（响应式，UI 可读） */
const activeTask = ref<LongTaskRecord | null>(null)
/** 心跳状态：alive(活跃) / stale(失联) / dead(疑似崩溃) */
const heartbeatStatus = ref<'alive' | 'stale' | 'dead'>('alive')

/** 内存中的取消标志（协作式取消；不持久化，刷新后丢失，P2 恢复时用户决定） */
const cancelFlags = new Map<string, boolean>()

/** checkpoint 数据提供者回调（startTask 时注入，读取 pi-ai 内部 messages） */
const checkpointDataProviders = new Map<string, () => LongTaskCheckpoint>()

/** 心跳定时器句柄 */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
/** 脏标记：checkpoint 更新后置 true，心跳定时器 flush 持久化 */
let checkpointDirty = false

// ─────────────────────────────────────────────────────────────────────────────
// 心跳定时器
// ─────────────────────────────────────────────────────────────────────────────

/** 启动心跳定时器（每 5s 更新心跳 + flush 脏 checkpoint） */
function startHeartbeat(taskId: string): void {
  stopHeartbeat()
  heartbeatTimer = setInterval(async () => {
    if (!activeTask.value || activeTask.value.taskId !== taskId) {
      stopHeartbeat()
      return
    }
    // 仅 running 状态才心跳
    if (activeTask.value.status !== 'running') {
      stopHeartbeat()
      return
    }
    activeTask.value.lastHeartbeatAt = Date.now()
    if (checkpointDirty) {
      // 有脏 checkpoint：完整保存（含最新 messages 快照）
      checkpointDirty = false
      await saveTask(activeTask.value)
    } else {
      // 仅更新心跳时间（轻量写入）
      await updateTask(taskId, { lastHeartbeatAt: activeTask.value.lastHeartbeatAt })
    }
    updateHeartbeatStatus()
  }, HEARTBEAT_INTERVAL_MS)
}

/** 停止心跳定时器 */
function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/** 根据最近心跳时间计算心跳状态（软监控，不强制终止） */
function updateHeartbeatStatus(): void {
  if (!activeTask.value || activeTask.value.status !== 'running') {
    heartbeatStatus.value = 'alive'
    return
  }
  const elapsed = Date.now() - activeTask.value.lastHeartbeatAt
  if (elapsed > HEARTBEAT_DEAD_MS) heartbeatStatus.value = 'dead'
  else if (elapsed > HEARTBEAT_STALE_MS) heartbeatStatus.value = 'stale'
  else heartbeatStatus.value = 'alive'
}

// ─────────────────────────────────────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 启动长任务
 * @param params 任务参数（含 getCheckpointData 回调，用于读取 pi-ai 内部 messages）
 * @returns taskId
 */
function startTask(params: {
  type: LongTaskType
  prompt: string
  lastUserText: string
  skillNames?: string[]
  chatMode?: string
  lockedChatMode?: string
  agentType?: string
  pipelineContext?: { pipelineId: string; stepId: string }
  getCheckpointData: () => LongTaskCheckpoint
}): string {
  // 防御：若已有活跃任务，先标记 failed（正常不应出现）
  if (activeTask.value && activeTask.value.status === 'running') {
    console.warn('[LongTask] startTask: 已有活跃任务在跑，先标记 failed:', activeTask.value.taskId)
    failTask(activeTask.value.taskId, '被新任务抢占')
  }

  const taskId = `longtask-${params.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  checkpointDataProviders.set(taskId, params.getCheckpointData)

  // 初始 checkpoint：记录触发任务的用户消息 + 当前 agent messages（此时可能只有 user message）
  let initialCheckpoint: LongTaskCheckpoint
  try {
    initialCheckpoint = params.getCheckpointData()
  } catch (err) {
    console.warn('[LongTask] startTask: 初始 checkpoint 获取失败:', err)
    initialCheckpoint = { agentMessages: [], lastUserText: params.lastUserText }
  }

  activeTask.value = {
    taskId,
    type: params.type,
    status: 'running',
    startedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    turnCount: 0,
    checkpoint: initialCheckpoint,
    meta: {
      agentType: params.agentType,
      prompt: params.prompt,
      pipelineContext: params.pipelineContext,
    },
  }

  cancelFlags.delete(taskId)
  checkpointDirty = false
  heartbeatStatus.value = 'alive'

  // 持久化初始记录
  saveTask(activeTask.value)
  // 启动心跳
  startHeartbeat(taskId)

  console.log(`[LongTask] 启动长任务 ${taskId}（类型: ${params.type}, prompt: ${params.prompt.slice(0, 50)}...）`)
  return taskId
}

/**
 * 接管已持久化的长任务（断点恢复用，P2）
 *
 * 应用重载后，从 IndexedDB 恢复 running 任务到内存：
 *   - 设置 activeTask（内存状态）
 *   - 注册 checkpointDataProvider
 *   - 重启心跳定时器
 * 复用持久化的 taskId，不创建新任务。
 */
function resumeActiveTask(record: LongTaskRecord, getCheckpointData: () => LongTaskCheckpoint): void {
  // 若已有活跃任务，先终结（正常不应出现）
  if (activeTask.value && activeTask.value.status === 'running') {
    console.warn('[LongTask] resumeActiveTask: 已有活跃任务，先标记 failed:', activeTask.value.taskId)
    failTask(activeTask.value.taskId, '被恢复任务抢占')
  }

  checkpointDataProviders.set(record.taskId, getCheckpointData)
  activeTask.value = { ...record, lastHeartbeatAt: Date.now() }
  cancelFlags.delete(record.taskId)
  checkpointDirty = false
  heartbeatStatus.value = 'alive'

  startHeartbeat(record.taskId)
  console.log(`[LongTask] 恢复长任务 ${record.taskId}（轮次: ${record.turnCount}, 已运行: ${Math.round((Date.now() - record.startedAt) / 1000)}s）`)
}

/**
 * checkpoint：更新进度 + 快照 pi-ai 内部 messages
 *
 * 由 turn_end / tool_execution_end 事件触发。
 * 内存立即更新，持久化节流到心跳定时器（5s 一次）。
 *
 * @param taskId 任务 ID
 * @param progress 进度信息（可选）
 */
function checkpoint(taskId: string, progress?: {
  turnCount?: number
  currentTool?: string
  currentPhase?: string
}): void {
  if (!activeTask.value || activeTask.value.taskId !== taskId) return
  if (activeTask.value.status !== 'running') return

  // 更新进度
  if (progress?.turnCount !== undefined) activeTask.value.turnCount = progress.turnCount
  if (progress?.currentTool !== undefined) activeTask.value.currentTool = progress.currentTool
  if (progress?.currentPhase !== undefined) activeTask.value.currentPhase = progress.currentPhase

  // 更新 checkpoint 快照（从回调获取最新 pi-ai messages）
  const provider = checkpointDataProviders.get(taskId)
  if (provider) {
    try {
      activeTask.value.checkpoint = provider()
      checkpointDirty = true
    } catch (err) {
      console.warn('[LongTask] checkpoint: 获取快照失败:', err)
    }
  }
}

/**
 * 请求协作式取消（设 flag，不强制终止）
 *
 * beforeToolCall hook 会检查此 flag，等当前 tool call 完成后优雅停止。
 * 纯 LLM 输出（无 tool call）时，等输出完 + 下一个 tool call 前停止。
 */
function requestCancel(taskId: string): void {
  cancelFlags.set(taskId, true)
  console.log(`[LongTask] 请求取消任务 ${taskId}（协作式：等当前 tool call 完成）`)
}

/**
 * 检查是否已请求取消（beforeToolCall hook 调用）
 * @returns true 表示用户已请求取消，agent loop 应停止
 */
function isCancelRequested(taskId: string): boolean {
  return cancelFlags.get(taskId) === true
}

/**
 * 标记任务完成（agent_end 事件触发）
 * 立即持久化终态，清理内存。
 */
async function completeTask(taskId: string): Promise<void> {
  if (!activeTask.value || activeTask.value.taskId !== taskId) return
  activeTask.value.status = 'completed'
  activeTask.value.endedAt = Date.now()
  stopHeartbeat()
  await saveTask(activeTask.value)
  console.log(`[LongTask] 任务完成 ${taskId}（轮次: ${activeTask.value.turnCount}, 耗时: ${Math.round((activeTask.value.endedAt - activeTask.value.startedAt) / 1000)}s）`)
  // 清理内存（record 已持久化，供历史查看）
  checkpointDataProviders.delete(taskId)
  cancelFlags.delete(taskId)
  activeTask.value = null
  checkpointDirty = false
  heartbeatStatus.value = 'alive'
}

/**
 * 标记任务失败
 */
async function failTask(taskId: string, error: string): Promise<void> {
  if (!activeTask.value || activeTask.value.taskId !== taskId) return
  activeTask.value.status = 'failed'
  activeTask.value.endedAt = Date.now()
  stopHeartbeat()
  await saveTask(activeTask.value)
  console.warn(`[LongTask] 任务失败 ${taskId}: ${error}`)
  checkpointDataProviders.delete(taskId)
  cancelFlags.delete(taskId)
  activeTask.value = null
  checkpointDirty = false
  heartbeatStatus.value = 'alive'
}

/**
 * 标记任务已取消（协作式取消完成后调用）
 *
 * 区别于 requestCancel（设 flag）：此函数在 agent loop 实际停止后调用，
 * 将状态从 running 转为 cancelled。
 */
async function cancelTask(taskId: string): Promise<void> {
  if (!activeTask.value || activeTask.value.taskId !== taskId) return
  activeTask.value.status = 'cancelled'
  activeTask.value.endedAt = Date.now()
  stopHeartbeat()
  await saveTask(activeTask.value)
  console.log(`[LongTask] 任务已取消 ${taskId}（轮次: ${activeTask.value.turnCount}）`)
  checkpointDataProviders.delete(taskId)
  cancelFlags.delete(taskId)
  activeTask.value = null
  checkpointDirty = false
  heartbeatStatus.value = 'alive'
}

/**
 * 检测可恢复任务（P2 恢复机制用）
 * 查询 IndexedDB 中所有 status=running 的任务（刷新/崩溃后未终结的任务）。
 */
async function detectResumableTasks(): Promise<LongTaskRecord[]> {
  return listRunningTasks()
}

/**
 * 获取当前活跃任务 ID（供 useAgent 在 beforeToolCall 中检查取消）
 */
function getActiveTaskId(): string | null {
  return activeTask.value?.status === 'running' ? activeTask.value.taskId : null
}

// ─────────────────────────────────────────────────────────────────────────────
// 导出 composable
// ─────────────────────────────────────────────────────────────────────────────

export function useLongTask() {
  return {
    /** 当前活跃任务（只读响应式，UI 可读） */
    activeTask: readonly(activeTask),
    /** 心跳状态（只读响应式）：alive/stale/dead */
    heartbeatStatus: readonly(heartbeatStatus),
    /** 计算属性：是否有活跃任务 */
    hasActiveTask: computed(() => activeTask.value?.status === 'running'),
    // 任务生命周期
    startTask,
    resumeActiveTask,
    checkpoint,
    completeTask,
    failTask,
    cancelTask,
    // 协作式取消
    requestCancel,
    isCancelRequested,
    getActiveTaskId,
    // 恢复（P2）
    detectResumableTasks,
    // 心跳控制
    stopHeartbeat,
  }
}
