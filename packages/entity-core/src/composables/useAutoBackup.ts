import { ref } from 'vue'
import { storage } from '../core/StorageBackend'

const BACKUP_KEY = 'ws_auto_backup'
const BACKUP_TIMESTAMP_KEY = 'ws_auto_backup_ts'
const MAX_BACKUP_SIZE = 5 * 1024 * 1024 // 5MB

export function useAutoBackup() {
  const backing = ref(false)

  /** 创建自动备份到 localStorage（仅元数据，不含媒体） */
  async function createBackup(): Promise<string> {
    backing.value = true
    try {
      const entities = await storage.getAllEntities()
      const relations = await storage.getAllRelations()
      const backup = {
        version: 1,
        timestamp: new Date().toISOString(),
        entityCount: entities.length,
        relationCount: relations.length,
        data: { entities, relations },
      }
      const json = JSON.stringify(backup)
      if (json.length > MAX_BACKUP_SIZE) {
        // 大数据：仅备份元数据，并记录警告
        const meta = { version: 1, timestamp: backup.timestamp, entityCount: entities.length, relationCount: relations.length, data: null, truncated: true }
        console.warn(`[AutoBackup] 数据量 ${Math.round(json.length / 1024 / 1024 * 100) / 100}MB 超过 5MB 限制，仅备份元数据，无法用于恢复`)
        localStorage.setItem(BACKUP_KEY, JSON.stringify(meta))
      } else {
        localStorage.setItem(BACKUP_KEY, json)
      }
      localStorage.setItem(BACKUP_TIMESTAMP_KEY, backup.timestamp)
      return backup.timestamp
    } finally {
      backing.value = false
    }
  }

  /** 获取最近备份信息 */
  function getBackupInfo(): { timestamp: string; entityCount: number; relationCount: number; hasFullData: boolean; truncated?: boolean } | null {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return null
    try {
      const backup = JSON.parse(raw)
      return {
        timestamp: backup.timestamp,
        entityCount: backup.entityCount,
        relationCount: backup.relationCount,
        hasFullData: backup.data !== null,
        truncated: backup.truncated === true,
      }
    } catch {
      return null
    }
  }

  /** 恢复备份 */
  async function restoreBackup(): Promise<boolean> {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return false
    try {
      const backup = JSON.parse(raw)
      if (!backup.data) return false
      for (const entity of backup.data.entities) {
        await storage.putEntity(entity)
      }
      for (const relation of backup.data.relations) {
        await storage.putRelation(relation)
      }
      return true
    } catch {
      return false
    }
  }

  /** 清除备份 */
  function clearBackup() {
    localStorage.removeItem(BACKUP_KEY)
    localStorage.removeItem(BACKUP_TIMESTAMP_KEY)
  }

  return { backing, createBackup, getBackupInfo, restoreBackup, clearBackup }
}
