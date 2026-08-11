/** 会话管理器：Dexie 持久化 + 删除时级联清理图片，详细见 docs/details/注释/packages/agent-runtime/session-manager.md */

import Dexie, { type Table } from 'dexie'
import type { AgentSession } from './types'
import type { AgentProfile, GroupChatSession } from '../group-chat/types'
import { deleteImage } from '../stores/image-persistence'

/* ════════════════════════════════════════
   AgentDB 类
   ════════════════════════════════════════ */

/** Dexie 数据库类，封装 sessions / agentProfiles / groupSessions 表 */
class AgentDB extends Dexie {
  sessions!: Table<AgentSession, string>
  agentProfiles!: Table<AgentProfile, string>
  groupSessions!: Table<GroupChatSession, string>

  /**
   * @param projectId 项目 ID。传入时数据库名为 `worldsmith-agent-${projectId}`；
   * 不传时使用旧的全局数据库名 `worldsmith-agent`（仅用于数据迁移）。
   */
  constructor(projectId?: string) {
    const dbName = projectId
      ? `worldsmith-agent-${projectId}`
      : 'worldsmith-agent'
    super(dbName)
    this.version(1).stores({
      sessions: 'id, name, updatedAt, providerMode',
    })
    this.version(2).stores({
      sessions: 'id, name, updatedAt, providerMode',
      agentProfiles: 'id, name, enabled, createdAt',
      groupSessions: 'id, name, updatedAt',
    })
  }
}

/* ════════════════════════════════════════
   数据库实例池
   ════════════════════════════════════════ */

const MAX_CACHED_AGENT_DBS = 3

interface CachedAgentDb {
  db: AgentDB
  lastAccess: number
}

const agentDbPool = new Map<string, CachedAgentDb>()

/** 当前活跃的 projectId，由外部通过 setCurrentProjectId 设置 */
let currentProjectId: string | null = null

/**
 * 设置当前项目 ID。
 * 由 ProjectManager.switchProject() 调用。
 */
export function setAgentCurrentProjectId(projectId: string | null): void {
  currentProjectId = projectId
}

/**
 * 获取当前项目的 AgentDB 实例。
 * 如果没有设置 projectId，回退到旧的全局数据库。
 */
function getDb(): AgentDB {
  if (currentProjectId) {
    return getProjectAgentDb(currentProjectId)
  }
  // 回退：未初始化项目系统时使用全局数据库
  return getLegacyDb()
}

/** 旧的全局数据库实例（仅用于迁移和回退） */
let legacyDb: AgentDB | null = null

function getLegacyDb(): AgentDB {
  if (!legacyDb) {
    legacyDb = new AgentDB()
  }
  return legacyDb
}

/**
 * 获取指定项目的 AgentDB 实例。
 * 使用 LRU 策略管理缓存。
 */
function getProjectAgentDb(projectId: string): AgentDB {
  const cached = agentDbPool.get(projectId)
  if (cached) {
    cached.lastAccess = Date.now()
    return cached.db
  }

  const db = new AgentDB(projectId)
  agentDbPool.set(projectId, { db, lastAccess: Date.now() })

  // LRU 淘汰
  if (agentDbPool.size > MAX_CACHED_AGENT_DBS) {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [key, entry] of agentDbPool) {
      if (key !== projectId && entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess
        oldestKey = key
      }
    }
    if (oldestKey) {
      releaseAgentDb(oldestKey)
    }
  }

  return db
}

/**
 * 释放指定项目的 AgentDB 连接。
 */
export function releaseAgentDb(projectId: string): void {
  const cached = agentDbPool.get(projectId)
  if (cached) {
    cached.db.close()
    agentDbPool.delete(projectId)
  }
}

/* ════════════════════════════════════════
   Session CRUD
   ════════════════════════════════════════ */

/** 列出所有会话，按更新时间倒序 */
export async function listSessions(): Promise<AgentSession[]> {
  try {
    return await getDb().sessions.orderBy('updatedAt').reverse().toArray()
  } catch {
    return []
  }
}

/** 获取单个会话 */
export async function getSession(id: string): Promise<AgentSession | undefined> {
  try {
    return await getDb().sessions.get(id)
  } catch {
    return undefined
  }
}

/** 保存或更新会话（自动更新 updatedAt 时间戳） */
export async function saveSession(session: AgentSession): Promise<void> {
  try {
    session.updatedAt = new Date().toISOString()
    await getDb().sessions.put(session)
  } catch (err) {
    console.warn('[AgentDB] saveSession failed:', err)
  }
}

/** 删除会话及其关联的 IndexedDB 图片（并行清理，失败不影响删除），详细见 docs/details/注释/packages/agent-runtime/session-manager.md */
export async function deleteSession(id: string): Promise<void> {
  try {
    const session = await getDb().sessions.get(id)
    if (session?.messages) {
      const imageIds: string[] = []
      for (const msg of session.messages) {
        if (msg.blocks) {
          for (const block of msg.blocks) {
            if (block.type === 'image' && block.id) {
              imageIds.push(block.id)
            }
          }
        }
      }
      await Promise.allSettled(imageIds.map(imgId => deleteImage(imgId)))
    }
    await getDb().sessions.delete(id)
  } catch (err) {
    console.warn('[AgentDB] deleteSession failed:', err)
  }
}

/** 创建新会话，使用 crypto.randomUUID() 生成唯一 ID */
export async function createSession(providerMode: string, modelId: string, chatMode?: 'deep' | 'explore' | 'task'): Promise<AgentSession> {
  const session: AgentSession = {
    id: crypto.randomUUID(),
    name: '新会话',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    providerMode: providerMode as any,
    modelId,
    messages: [],
    metadata: { totalTokens: 0, totalCost: 0, toolCallCount: 0 },
    chatMode,
  }
  return session
}

/** 固定（收藏）会话，防止自动清理 */
export async function pinSession(id: string): Promise<void> {
  try {
    const session = await getDb().sessions.get(id)
    if (session) {
      session.pinned = true
      session.updatedAt = new Date().toISOString()
      await getDb().sessions.put(session)
    }
  } catch (err) {
    console.warn('[AgentDB] pinSession failed:', err)
  }
}

/** 取消固定会话 */
export async function unpinSession(id: string): Promise<void> {
  try {
    const session = await getDb().sessions.get(id)
    if (session) {
      session.pinned = false
      session.updatedAt = new Date().toISOString()
      await getDb().sessions.put(session)
    }
  } catch (err) {
    console.warn('[AgentDB] unpinSession failed:', err)
  }
}

/** 重命名会话 */
export async function renameSession(id: string, name: string): Promise<void> {
  try {
    const session = await getDb().sessions.get(id)
    if (session) {
      session.name = name
      session.updatedAt = new Date().toISOString()
      await getDb().sessions.put(session)
    }
  } catch (err) {
    console.warn('[AgentDB] renameSession failed:', err)
  }
}

/** 统计会话总数（用于会话上限控制） */
export async function countSessions(): Promise<number> {
  try {
    return await getDb().sessions.count()
  } catch {
    return 0
  }
}

/* ─── AgentProfile CRUD ─── */

export async function listAgentProfiles(): Promise<AgentProfile[]> {
  try {
    return await getDb().agentProfiles.orderBy('createdAt').reverse().toArray()
  } catch {
    return []
  }
}

export async function getAgentProfile(id: string): Promise<AgentProfile | undefined> {
  try {
    return await getDb().agentProfiles.get(id)
  } catch {
    return undefined
  }
}

export async function saveAgentProfile(profile: AgentProfile): Promise<void> {
  try {
    profile.updatedAt = new Date().toISOString()
    await getDb().agentProfiles.put(profile)
  } catch (err) {
    console.warn('[AgentDB] saveAgentProfile failed:', err)
  }
}

export async function deleteAgentProfile(id: string): Promise<void> {
  try {
    await getDb().agentProfiles.delete(id)
  } catch (err) {
    console.warn('[AgentDB] deleteAgentProfile failed:', err)
  }
}

/* ─── GroupChatSession CRUD ─── */

export async function listGroupSessions(): Promise<GroupChatSession[]> {
  try {
    return await getDb().groupSessions.orderBy('updatedAt').reverse().toArray()
  } catch {
    return []
  }
}

export async function getGroupSession(id: string): Promise<GroupChatSession | undefined> {
  try {
    return await getDb().groupSessions.get(id)
  } catch {
    return undefined
  }
}

export async function saveGroupSession(session: GroupChatSession): Promise<void> {
  try {
    session.updatedAt = new Date().toISOString()
    await getDb().groupSessions.put(session)
  } catch (err) {
    console.warn('[AgentDB] saveGroupSession failed:', err)
  }
}

export async function deleteGroupSession(id: string): Promise<void> {
  try {
    await getDb().groupSessions.delete(id)
  } catch (err) {
    console.warn('[AgentDB] deleteGroupSession failed:', err)
  }
}
