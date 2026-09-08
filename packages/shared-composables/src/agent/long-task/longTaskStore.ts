/** 长任务持久化层（Dexie/IndexedDB，checkpoint 快照支持断点恢复），详细见 docs/details/注释/packages/shared-composables/agent/long-task/longTaskStore.md */
import Dexie, { type Table } from 'dexie'

/** 长任务类型 */
export type LongTaskType = 'main-agent' | 'sub-agent'

/** 长任务状态机 */
export type LongTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** 断点恢复快照（pi-ai agent 内部 messages + 重建所需上下文） */
export interface LongTaskCheckpoint {
  /** pi-ai agent 内部 messages（含完整 tool call/result，用于恢复续跑） */
  agentMessages: unknown[]
  /** 触发任务的用户消息文本 */
  lastUserText: string
  /** 技能名列表（若通过 skill 触发） */
  skillNames?: string[]
  /** 会话聊天模式 */
  chatMode?: string
  /** 锁定的聊天模式（首条消息时锁定） */
  lockedChatMode?: string
}

/** 长任务记录（持久化到 IndexedDB） */
export interface LongTaskRecord {
  /** 任务唯一 ID */
  taskId: string
  /** 任务类型：主 Agent / 子 Agent */
  type: LongTaskType
  /** 状态机：running / completed / failed / cancelled */
  status: LongTaskStatus
  /** 创建时间 (ms) */
  startedAt: number
  /** 最后心跳时间 (ms) */
  lastHeartbeatAt: number
  /** 结束时间 (ms)，终态时填充 */
  endedAt?: number
  /** 进度：已完成轮次（turn_end 触发数） */
  turnCount: number
  /** 进度：当前执行的 tool 名称 */
  currentTool?: string
  /** 进度：当前阶段标签（深度模式） */
  currentPhase?: string
  /** 断点恢复快照 */
  checkpoint: LongTaskCheckpoint
  /** 元数据 */
  meta: {
    /** 子 Agent 类型（type='sub-agent' 时） */
    agentType?: string
    /** 任务描述/prompt */
    prompt: string
    /** 创作编排上下文（子 Agent 接入时用） */
    pipelineContext?: { pipelineId: string; stepId: string }
  }
}

/**
 * LongTaskDB — Dexie 数据库定义
 *
 * 表：tasks（长任务记录）
 * 索引：taskId(主键) + status(查询 running) + type(区分主/子) + startedAt(排序) + lastHeartbeatAt(心跳检测)
 */
class LongTaskDB extends Dexie {
  tasks!: Table<LongTaskRecord, string>

  constructor() {
    super('worldsea-long-task')
    this.version(1).stores({
      tasks: 'taskId, status, type, startedAt, lastHeartbeatAt',
    })
  }
}

/** 单例数据库实例（懒加载） */
let db: LongTaskDB | null = null

function getDb(): LongTaskDB {
  if (!db) db = new LongTaskDB()
  return db
}

/** 深拷贝（避免 IndexedDB 结构化克隆副作用，剥离 Vue 响应式） */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/**
 * 保存/更新任务记录（upsert）
 * @param record 任务记录
 */
export async function saveTask(record: LongTaskRecord): Promise<void> {
  try {
    const raw = deepClone({ ...record, lastHeartbeatAt: Date.now() })
    await getDb().tasks.put(raw)
  } catch (err) {
    console.warn('[LongTaskStore] saveTask 失败:', err)
  }
}

/**
 * 仅更新任务记录（不自动刷新 lastHeartbeatAt，用于 checkpoint/状态变更）
 */
export async function updateTask(taskId: string, patch: Partial<LongTaskRecord>): Promise<void> {
  try {
    const existing = await getDb().tasks.get(taskId)
    if (!existing) {
      console.warn(`[LongTaskStore] updateTask: 未找到任务 ${taskId}`)
      return
    }
    const merged = deepClone({ ...existing, ...patch })
    await getDb().tasks.put(merged)
  } catch (err) {
    console.warn('[LongTaskStore] updateTask 失败:', err)
  }
}

/**
 * 获取单个任务记录
 */
export async function getTask(taskId: string): Promise<LongTaskRecord | undefined> {
  try {
    return await getDb().tasks.get(taskId)
  } catch (err) {
    console.warn('[LongTaskStore] getTask 失败:', err)
    return undefined
  }
}

/**
 * 列出所有 running 状态的任务（用于应用启动时检测可恢复任务）
 */
export async function listRunningTasks(): Promise<LongTaskRecord[]> {
  try {
    return await getDb().tasks.where('status').equals('running').toArray()
  } catch (err) {
    console.warn('[LongTaskStore] listRunningTasks 失败:', err)
    return []
  }
}

/**
 * 列出所有任务（按 startedAt 倒序，用于任务管理面板）
 */
export async function listAllTasks(limit = 50): Promise<LongTaskRecord[]> {
  try {
    return await getDb().tasks.orderBy('startedAt').reverse().limit(limit).toArray()
  } catch (err) {
    console.warn('[LongTaskStore] listAllTasks 失败:', err)
    return []
  }
}

/**
 * 删除任务记录
 */
export async function deleteTask(taskId: string): Promise<void> {
  try {
    await getDb().tasks.delete(taskId)
  } catch (err) {
    console.warn('[LongTaskStore] deleteTask 失败:', err)
  }
}

/**
 * 清理已终结的任务（completed/failed/cancelled），保留最近 N 条
 * @param keepCount 保留的最近终结任务数（默认 20）
 */
export async function purgeTerminatedTasks(keepCount = 20): Promise<number> {
  try {
    const terminated = await getDb()
      .tasks.where('status')
      .anyOf(['completed', 'failed', 'cancelled'])
      .reverse()
      .sortBy('startedAt')
    const toDelete = terminated.slice(keepCount)
    await Promise.all(toDelete.map((t) => getDb().tasks.delete(t.taskId)))
    return toDelete.length
  } catch (err) {
    console.warn('[LongTaskStore] purgeTerminatedTasks 失败:', err)
    return 0
  }
}
