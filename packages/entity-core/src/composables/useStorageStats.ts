import { ref } from 'vue'
import { storage } from '../core'
import { useEntityStore } from '../stores'
import { useRelationStore } from '../stores'
import { useFileStore } from '../stores'

/**
 * 存储概览统计（2026-10-02 数据源修正）：全部读**活动存储后端**（FileStorageBackend，项目文件夹 JSON）。
 * 旧实现读 Dexie WorldDatabase（web 时代项目库）+ navigator.storage.estimate（webview 配额），在文件项目架构下两路都测不到真实数据，数字误导。
 * 占用为内存估算：实体/关系 JSON 序列化长度 + 文件记录体积之和。
 */

const MB = 1024 * 1024

export interface StorageStats {
  totalUsageMB: number
  entityCount: number
  relationCount: number
  fileCount: number
  fileTotalMB: number
  kvCount: number
  orphanFileCount: number | null
  lastUpdated: number
}

const DEFAULT_STATS: StorageStats = {
  totalUsageMB: 0,
  entityCount: 0,
  relationCount: 0,
  fileCount: 0,
  fileTotalMB: 0,
  kvCount: 0,
  orphanFileCount: null,
  lastUpdated: 0,
}

export function useStorageStats() {
  const stats = ref<StorageStats>({ ...DEFAULT_STATS })
  const isScanning = ref(false)

  /** 确保三个 store 已从活动后端加载（空则 loadAll，调用方面板为手动刷新语义） */
  async function ensureLoaded(): Promise<void> {
    const entityStore = useEntityStore()
    const relationStore = useRelationStore()
    const fileStore = useFileStore()
    if (!entityStore.entities.length) await entityStore.loadAll()
    if (!relationStore.relations.length) await relationStore.loadAll()
    if (!fileStore.files.length) await fileStore.loadAll()
  }

  async function refresh(): Promise<void> {
    isScanning.value = true
    try {
      await ensureLoaded()
      const entityStore = useEntityStore()
      const relationStore = useRelationStore()
      const fileStore = useFileStore()

      const entityCount = entityStore.entities.length
      const relationCount = relationStore.relations.length
      const fileCount = fileStore.files.length

      // 占用估算：实体/关系 JSON 序列化长度 + 文件记录体积
      const entitiesBytes = JSON.stringify(entityStore.entities).length
      const relationsBytes = JSON.stringify(relationStore.relations).length
      const filesBytes = fileStore.files.reduce((s, f) => s + (f.size || 0), 0)

      const kvAll = await storage.kvGetAll()

      stats.value = {
        totalUsageMB: Math.round((entitiesBytes + relationsBytes + filesBytes) / MB * 100) / 100,
        entityCount,
        relationCount,
        fileCount,
        fileTotalMB: Math.round(filesBytes / MB * 100) / 100,
        kvCount: kvAll.length,
        orphanFileCount: stats.value.orphanFileCount,
        lastUpdated: Date.now(),
      }
    } catch (e) {
      console.warn('[useStorageStats] refresh failed:', e)
    } finally {
      isScanning.value = false
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

  return { stats, isScanning, refresh, scanOrphanCount }
}
