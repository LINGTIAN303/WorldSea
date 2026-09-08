/**
 * 本文件于 Phase 3 从 src/agent/composables/useLongTaskRust.ts 迁移到 apps/tauri/src/agent/composables/useLongTaskRust.ts
 * 端分离：Tauri 端专用（依赖 @tauri-apps/api）
 */

/** 长任务管理器（Rust SQLite 后端版：状态机/心跳/checkpoint/协作式取消），详细见 docs/details/注释/tauri/useLongTaskRust.md */
import { ref, readonly, computed } from 'vue'
import { invoke } from './transport'

/** 生命周期调试日志开关：仅开发环境输出（生产构建剔除，P3-9） */
const DEV_LOG = import.meta.env.DEV
const log = (...args: Parameters<typeof console.log>) => {
  if (DEV_LOG) console.log(...args)
}
// 复用 TS 版类型定义（LongTaskRecord / LongTaskCheckpoint / LongTaskType / LongTaskStatus）
// 保持与 useLongTaskProgress.ts / ResumeBanner.vue 的类型兼容
// Phase 3 迁移：原 `./longTaskStore` 改为共享 composables 别名
import type {
  LongTaskRecord,
  LongTaskType,
  LongTaskStatus,
  LongTaskCheckpoint,
} from '@worldsea/shared-composables/long-task/longTaskStore'

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 心跳间隔（ms）：每 5s 更新一次 lastHeartbeatAt + flush 脏 checkpoint */
const HEARTBEAT_INTERVAL_MS = 5_000
/** 心跳失联阈值（ms）：超过 30s 标记 stale（UI 提醒，不终止） */
const HEARTBEAT_STALE_MS = 30_000
/** 心跳死亡阈值（ms）：超过 5min 标记 dead（疑似崩溃，建议恢复） */
const HEARTBEAT_DEAD_MS = 5 * 60_000

// ─── Rust 端类型镜像 ──────────────────────────────────────────────────────────

/** Rust `LongTaskRecord` 前端镜像（RFC3339 与 TS number 时间戳差异），详细见 docs/details/注释/tauri/useLongTaskRust.md */
export interface RustLongTaskRecord {
  taskId: string
  /** Rust 端 `#[serde(rename = "type")]`，序列化后字段名仍是 `type` */
  type: LongTaskType
  status: LongTaskStatus
  /** RFC3339 字符串 */
  startedAt: string
  /** RFC3339 字符串 */
  lastHeartbeatAt: string
  /** RFC3339 字符串，终态时填充 */
  endedAt?: string
  turnCount: number
  currentTool?: string
  currentPhase?: string
  checkpoint: LongTaskCheckpoint
  meta: {
    agentType?: string
    prompt: string
    pipelineContext?: { pipelineId: string; stepId: string }
  }
}

// ─── 时间戳转换工具 ───────────────────────────────────────────────────────────

/** number (ms) → RFC3339 字符串（Rust `DateTime<Utc>` 反序列化用） */
function dateToRfc3339(ms: number): string {
  return new Date(ms).toISOString()
}

/** RFC3339 字符串 → number (ms)（前端 UI 计算用） */
function rfc3339ToMs(rfc: string): number {
  return new Date(rfc).getTime()
}

/** Rust `LongTaskRecord` → TS `LongTaskRecord`（时间戳转 number） */
function rustToTsRecord(r: RustLongTaskRecord): LongTaskRecord {
  return {
    taskId: r.taskId,
    type: r.type,
    status: r.status,
    startedAt: rfc3339ToMs(r.startedAt),
    lastHeartbeatAt: rfc3339ToMs(r.lastHeartbeatAt),
    endedAt: r.endedAt ? rfc3339ToMs(r.endedAt) : undefined,
    turnCount: r.turnCount,
    currentTool: r.currentTool,
    currentPhase: r.currentPhase,
    checkpoint: r.checkpoint,
    meta: r.meta,
  }
}

/** TS `LongTaskRecord` → Rust `LongTaskRecord`（时间戳转 RFC3339） */
function tsToRustRecord(r: LongTaskRecord): RustLongTaskRecord {
  return {
    taskId: r.taskId,
    type: r.type,
    status: r.status,
    startedAt: dateToRfc3339(r.startedAt),
    lastHeartbeatAt: dateToRfc3339(r.lastHeartbeatAt),
    endedAt: r.endedAt ? dateToRfc3339(r.endedAt) : undefined,
    turnCount: r.turnCount,
    currentTool: r.currentTool,
    currentPhase: r.currentPhase,
    checkpoint: r.checkpoint,
    meta: r.meta,
  }
}

// ─── Tauri 命令封装（对应 longTaskStore.ts 的持久化函数） ──────────────────────

/** 保存/更新任务记录（upsert，对应 `cmd_long_task_save`） */
async function saveTask(record: LongTaskRecord): Promise<void> {
  try {
    await invoke('cmd_long_task_save', { record: tsToRustRecord(record) })
  } catch (err) {
    console.warn('[useLongTaskRust] saveTask 失败:', err)
  }
}

/** 加载任务记录（对应 `cmd_long_task_load`） */
async function loadTask(taskId: string): Promise<LongTaskRecord | null> {
  try {
    const r = await invoke<RustLongTaskRecord>('cmd_long_task_load', { taskId })
    return rustToTsRecord(r)
  } catch (err) {
    console.warn(`[useLongTaskRust] loadTask(${taskId}) 失败:`, err)
    return null
  }
}

/** 列出所有 running 任务（对应 `cmd_long_task_list_running`） */
async function listRunningTasks(): Promise<LongTaskRecord[]> {
  try {
    const list = await invoke<RustLongTaskRecord[]>('cmd_long_task_list_running')
    return list.map(rustToTsRecord)
  } catch (err) {
    console.warn('[useLongTaskRust] listRunningTasks 失败:', err)
    return []
  }
}

/**
 * 轻量心跳更新（对应 `cmd_long_task_update_heartbeat`）
 * @returns true=更新成功 / false=task 不存在（幂等）
 */
async function updateHeartbeat(taskId: string, lastHeartbeatAtMs: number): Promise<boolean> {
  try {
    return await invoke<boolean>('cmd_long_task_update_heartbeat', {
      taskId,
      lastHeartbeatAt: dateToRfc3339(lastHeartbeatAtMs),
    })
  } catch (err) {
    console.warn(`[useLongTaskRust] updateHeartbeat(${taskId}) 失败:`, err)
    return false
  }
}

/**
 * 轻量状态更新（对应 `cmd_long_task_update_status`）
 * @returns true=更新成功 / false=task 不存在
 */
async function updateStatus(
  taskId: string,
  status: LongTaskStatus,
  endedAtMs: number,
): Promise<boolean> {
  try {
    return await invoke<boolean>('cmd_long_task_update_status', {
      taskId,
      status,
      endedAt: dateToRfc3339(endedAtMs),
    })
  } catch (err) {
    console.warn(`[useLongTaskRust] updateStatus(${taskId}) 失败:`, err)
    return false
  }
}

/** 删除任务（对应 `cmd_long_task_delete`） */
async function deleteTask(taskId: string): Promise<boolean> {
  try {
    return await invoke<boolean>('cmd_long_task_delete', { taskId })
  } catch (err) {
    console.warn(`[useLongTaskRust] deleteTask(${taskId}) 失败:`, err)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 模块级单例状态（与 useLongTask.ts 保持一致：useAgent 是模块级单例）
// ─────────────────────────────────────────────────────────────────────────────

/** 当前活跃任务（响应式，UI 可读） */
const activeTask = ref<LongTaskRecord | null>(null)
/** 心跳状态：alive(活跃) / stale(失联) / dead(疑似崩溃) */
const heartbeatStatus = ref<'alive' | 'stale' | 'dead'>('alive')

/** 内存中的取消标志（协作式取消；不持久化，刷新后丢失，P2 恢复时用户决定） */
const cancelFlags = new Map<string, boolean>()

/** checkpoint 数据提供者回调（startTask 时注入，读取 AgentLoop 内部 messages） */
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
      // 仅更新心跳时间（轻量写入，避免 JSON 序列化整条 record）
      await updateHeartbeat(taskId, activeTask.value.lastHeartbeatAt)
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
// 公开 API（与 useLongTask.ts 完全一致签名，便于 useAgentRust 平滑替换）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 启动长任务
 * @param params 任务参数（含 getCheckpointData 回调，用于读取 AgentLoop 内部 messages）
 * @returns taskId
 *
 * 注意：async 并 await 初始 saveTask——否则快速 cancelTask/failTask 的
 * cmd_long_task_update_status 可能与初始 cmd_long_task_save（upsert running）
 * 竞态，初始 save 晚到会覆盖终态为 running（2026-08-03 实测发现并修复）。
 */
async function startTask(params: {
  type: LongTaskType
  prompt: string
  lastUserText: string
  skillNames?: string[]
  chatMode?: string
  lockedChatMode?: string
  agentType?: string
  pipelineContext?: { pipelineId: string; stepId: string }
  getCheckpointData: () => LongTaskCheckpoint
}): Promise<string> {
  // 防御：若已有活跃任务，先标记 failed（正常不应出现）
  if (activeTask.value && activeTask.value.status === 'running') {
    console.warn('[LongTaskRust] startTask: 已有活跃任务在跑，先标记 failed:', activeTask.value.taskId)
    failTask(activeTask.value.taskId, '被新任务抢占')
  }

  const taskId = `longtask-${params.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  checkpointDataProviders.set(taskId, params.getCheckpointData)

  // 初始 checkpoint：记录触发任务的用户消息 + 当前 agent messages
  let initialCheckpoint: LongTaskCheckpoint
  try {
    initialCheckpoint = params.getCheckpointData()
  } catch (err) {
    console.warn('[LongTaskRust] startTask: 初始 checkpoint 获取失败:', err)
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

  // 持久化初始记录（await：避免与快速 cancelTask/failTask 的 update_status 竞态，2026-08-03 修复）
  await saveTask(activeTask.value)
  // 启动心跳
  startHeartbeat(taskId)

  log(
    `[LongTaskRust] 启动长任务 ${taskId}（类型: ${params.type}, prompt: ${params.prompt.slice(0, 50)}...）`,
  )
  return taskId
}

/**
 * 接管已持久化的长任务（断点恢复用，P2）
 *
 * 应用重载后，从 SQLite 恢复 running 任务到内存：
 *   - 设置 activeTask（内存状态）
 *   - 注册 checkpointDataProvider
 *   - 重启心跳定时器
 * 复用持久化的 taskId，不创建新任务。
 */
function resumeActiveTask(
  record: LongTaskRecord,
  getCheckpointData: () => LongTaskCheckpoint,
): void {
  // 若已有活跃任务，先终结（正常不应出现）
  if (activeTask.value && activeTask.value.status === 'running') {
    console.warn('[LongTaskRust] resumeActiveTask: 已有活跃任务，先标记 failed:', activeTask.value.taskId)
    failTask(activeTask.value.taskId, '被恢复任务抢占')
  }

  checkpointDataProviders.set(record.taskId, getCheckpointData)
  activeTask.value = { ...record, lastHeartbeatAt: Date.now() }
  cancelFlags.delete(record.taskId)
  checkpointDirty = false
  heartbeatStatus.value = 'alive'

  startHeartbeat(record.taskId)
  log(
    `[LongTaskRust] 恢复长任务 ${record.taskId}（轮次: ${record.turnCount}, 已运行: ${Math.round((Date.now() - record.startedAt) / 1000)}s）`,
  )
}

/**
 * checkpoint：更新进度 + 快照 AgentLoop 内部 messages
 *
 * 由 turn_end / tool_execution_end 事件触发。
 * 内存立即更新，持久化节流到心跳定时器（5s 一次）。
 *
 * @param taskId 任务 ID
 * @param progress 进度信息（可选）
 */
function checkpoint(
  taskId: string,
  progress?: {
    turnCount?: number
    currentTool?: string
    currentPhase?: string
  },
): void {
  if (!activeTask.value || activeTask.value.taskId !== taskId) return
  if (activeTask.value.status !== 'running') return

  // 更新进度
  if (progress?.turnCount !== undefined) activeTask.value.turnCount = progress.turnCount
  if (progress?.currentTool !== undefined) activeTask.value.currentTool = progress.currentTool
  if (progress?.currentPhase !== undefined) activeTask.value.currentPhase = progress.currentPhase

  // 更新 checkpoint 快照（从回调获取最新 AgentLoop messages）
  const provider = checkpointDataProviders.get(taskId)
  if (provider) {
    try {
      activeTask.value.checkpoint = provider()
      checkpointDirty = true
    } catch (err) {
      console.warn('[LongTaskRust] checkpoint: 获取快照失败:', err)
    }
  }
}

/**
 * 请求协作式取消（设 flag，不强制终止）
 *
 * ReAct 循环在下一轮检查时优雅停止（等当前 tool call 完成）。
 * 纯 LLM 输出（无 tool call）时，等输出完 + 下一个 tool call 前停止。
 */
function requestCancel(taskId: string): void {
  cancelFlags.set(taskId, true)
  log(`[LongTaskRust] 请求取消任务 ${taskId}（协作式：等当前 tool call 完成）`)
}

/**
 * 检查是否已请求取消（ReAct 循环每轮检查）
 * @returns true 表示用户已请求取消，agent loop 应停止
 */
function isCancelRequested(taskId: string): boolean {
  return cancelFlags.get(taskId) === true
}

/**
 * 标记任务完成（agent_end 事件触发）
 * 立即持久化终态（轻量 status 更新），清理内存。
 */
async function completeTask(taskId: string): Promise<void> {
  if (!activeTask.value || activeTask.value.taskId !== taskId) return
  activeTask.value.status = 'completed'
  activeTask.value.endedAt = Date.now()
  stopHeartbeat()
  // 轻量状态更新（仅写 status + ended_at，不触碰 checkpoint/meta）
  await updateStatus(taskId, 'completed', activeTask.value.endedAt)
  log(
    `[LongTaskRust] 任务完成 ${taskId}（轮次: ${activeTask.value.turnCount}, 耗时: ${Math.round((activeTask.value.endedAt - activeTask.value.startedAt) / 1000)}s）`,
  )
  // 清理内存（record 已持久化，供历史查看）
  checkpointDataProviders.delete(taskId)
  cancelFlags.delete(taskId)
  activeTask.value = null
  checkpointDirty = false
  heartbeatStatus.value = 'alive'
}

/** 标记任务失败 */
async function failTask(taskId: string, error: string): Promise<void> {
  if (!activeTask.value || activeTask.value.taskId !== taskId) return
  activeTask.value.status = 'failed'
  activeTask.value.endedAt = Date.now()
  stopHeartbeat()
  await updateStatus(taskId, 'failed', activeTask.value.endedAt)
  console.warn(`[LongTaskRust] 任务失败 ${taskId}: ${error}`)
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
  await updateStatus(taskId, 'cancelled', activeTask.value.endedAt)
  log(`[LongTaskRust] 任务已取消 ${taskId}（轮次: ${activeTask.value.turnCount}）`)
  checkpointDataProviders.delete(taskId)
  cancelFlags.delete(taskId)
  activeTask.value = null
  checkpointDirty = false
  heartbeatStatus.value = 'alive'
}

/**
 * 检测可恢复任务（P2 恢复机制用）
 * 查询 SQLite 中所有 status=running 的任务（刷新/崩溃后未终结的任务）。
 */
async function detectResumableTasks(): Promise<LongTaskRecord[]> {
  return listRunningTasks()
}

/** 获取当前活跃任务 ID（供 useAgent 在 ReAct 循环中检查取消） */
function getActiveTaskId(): string | null {
  return activeTask.value?.status === 'running' ? activeTask.value.taskId : null
}

// ─────────────────────────────────────────────────────────────────────────────
// 导出 composable
// ─────────────────────────────────────────────────────────────────────────────

export function useLongTaskRust() {
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
    // 持久化原语（供 useAgentRustAdapter 实现 resumeTask/discardTask）
    loadTask,
    deleteTask,
    updateStatus,
    // 心跳控制
    stopHeartbeat,
  }
}
