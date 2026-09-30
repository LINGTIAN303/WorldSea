/**
 * ProjectManager 的项目级数据库实例池（2026-09-30 arch 拆分）。
 *
 * LRU 保留 MAX_CACHED_DBS 个 WorldDatabase 实例；模块级单例池，随包加载建立。
 */
import { WorldDatabase } from './database'

const MAX_CACHED_DBS = 3

interface CachedDb {
  db: WorldDatabase
  lastAccess: number
}

const dbPool = new Map<string, CachedDb>()

/** 获取指定项目的 WorldDatabase 实例（命中刷新访问时间；新增超限时淘汰最久未用）。 */
export function acquireProjectDb(projectId: string): WorldDatabase {
  const cached = dbPool.get(projectId)
  if (cached) {
    cached.lastAccess = Date.now()
    return cached.db
  }

  const db = new WorldDatabase(projectId)
  dbPool.set(projectId, { db, lastAccess: Date.now() })

  // LRU 淘汰
  if (dbPool.size > MAX_CACHED_DBS) {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [key, entry] of dbPool) {
      if (key !== projectId && entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess
        oldestKey = key
      }
    }
    if (oldestKey) {
      releaseProjectDb(oldestKey)
    }
  }

  return db
}

/** 释放指定项目的数据库连接（关闭并移出池）。 */
export function releaseProjectDb(projectId: string): void {
  const cached = dbPool.get(projectId)
  if (cached) {
    cached.db.close()
    dbPool.delete(projectId)
  }
}
