import { ref } from 'vue'
import { storage } from '../core'
import { getProjectManager, db as legacyDb } from '../core'
import { useEntityStore } from '../stores'
import { useFileStore } from '../stores'

/** 获取当前项目的数据库实例，未初始化时回退到全局数据库 */
function getCurrentDb() {
  try {
    return getProjectManager().getCurrentProjectDb()
  } catch {
    return legacyDb
  }
}

export interface StorageStats {
  totalUsageMB: number
  quotaMB: number | null
  entityCount: number
  relationCount: number
  fileCount: number
  fileContentEstimateMB: number
  sessionCount: number
  kvCount: number
  orphanFileCount: number | null
  lastUpdated: number
}

const DEFAULT_STATS: StorageStats = {
  totalUsageMB: 0,
  quotaMB: null,
  entityCount: 0,
  relationCount: 0,
  fileCount: 0,
  fileContentEstimateMB: 0,
  sessionCount: 0,
  kvCount: 0,
  orphanFileCount: null,
  lastUpdated: 0,
}

export function useStorageStats() {
  const stats = ref<StorageStats>({ ...DEFAULT_STATS })
  const isScanning = ref(false)

  async function refresh(): Promise<void> {
    isScanning.value = true
    try {
      const fileStore = useFileStore()

      const [entityCount, relationCount, kvAll] = await Promise.all([
        getCurrentDb().entities.count(),
        getCurrentDb().relations.count(),
        storage.kvGetAll(),
      ])

      const fileCount = fileStore.files.length || (await storage.getAllFiles()).length
      let sessionCount = 0
      try {
        const { countSessions } = await import('@worldsmith/agent-runtime/session/manager')
        sessionCount = await countSessions()
      } catch {}

      let fileContentEstimateMB = 0
      try {
        const contents = await getCurrentDb().file_contents.toArray()
        for (const c of contents) {
          const textLen = c.textContent?.length || 0
          const binLen = c.binaryData?.length || 0
          fileContentEstimateMB += (textLen + binLen) / (1024 * 1024)
        }
      } catch {}
      fileContentEstimateMB = Math.round(fileContentEstimateMB * 100) / 100

      const totalUsageMB = Math.round(fileContentEstimateMB * 100) / 100

      stats.value = {
        totalUsageMB,
        quotaMB: stats.value.quotaMB,
        entityCount,
        relationCount,
        fileCount,
        fileContentEstimateMB,
        sessionCount: sessionCount as number,
        kvCount: kvAll.length,
        orphanFileCount: stats.value.orphanFileCount,
        lastUpdated: Date.now(),
      }

      estimateQuota()
    } catch (e) {
      console.warn('[useStorageStats] refresh failed:', e)
    } finally {
      isScanning.value = false
    }
  }

  async function estimateQuota(): Promise<void> {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate()
        stats.value = {
          ...stats.value,
          quotaMB: est.quota ? Math.round(est.quota / (1024 * 1024) * 100) / 100 : null,
          totalUsageMB: est.usage ? Math.round(est.usage / (1024 * 1024) * 100) / 100 : stats.value.totalUsageMB,
        }
      }
    } catch {
      stats.value.quotaMB = null
    }
  }

  async function scanOrphanCount(): Promise<number> {
    const fileStore = useFileStore()
    const entityStore = useEntityStore()
    if (!entityStore.entities.length) {
      await entityStore.loadAll()
    }
    if (!fileStore.files.length) {
      await fileStore.loadAll()
    }
    const entityIds = new Set(entityStore.entities.map(e => e.id))
    let count = 0
    for (const f of fileStore.files) {
      if (f.entityId && !entityIds.has(f.entityId)) {
        count++
      }
    }
    stats.value = { ...stats.value, orphanFileCount: count }
    return count
  }

  return { stats, isScanning, refresh, estimateQuota, scanOrphanCount }
}
