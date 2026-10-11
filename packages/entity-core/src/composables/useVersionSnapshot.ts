import { ref, computed } from 'vue'
import { storage } from '../core/StorageBackend'

export interface Snapshot {
  id: string
  label: string
  timestamp: string
  entityCount: number
  relationCount: number
  data?: string
}

const SNAPSHOTS_KEY = 'ws_version_snapshots'
const MAX_SNAPSHOTS = 50

export function useVersionSnapshot() {
  const snapshots = ref<Snapshot[]>([])
  const creating = ref(false)

  function loadSnapshots() {
    try {
      const raw = localStorage.getItem(SNAPSHOTS_KEY)
      if (raw) snapshots.value = JSON.parse(raw)
    } catch { snapshots.value = [] }
  }

  function saveSnapshots() {
    try {
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots.value))
    } catch (e) {
      // localStorage 配额不足时，移除最旧的快照后重试
      console.warn('[VersionSnapshot] localStorage 配额不足，尝试清理旧快照:', e)
      while (snapshots.value.length > 1) {
        snapshots.value.pop()
        try {
          localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots.value))
          return
        } catch { /* 继续清理 */ }
      }
      // 最后手段：清空快照
      snapshots.value = []
      try { localStorage.removeItem(SNAPSHOTS_KEY) } catch { /* ignore */ }
    }
  }

  async function createSnapshot(label: string): Promise<Snapshot> {
    creating.value = true
    try {
      const entities = await storage.getAllEntities()
      const relations = await storage.getAllRelations()
      const snapshot: Snapshot = {
        id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label,
        timestamp: new Date().toISOString(),
        entityCount: entities.length,
        relationCount: relations.length,
        data: JSON.stringify({ entities, relations }),
      }
      snapshots.value.unshift(snapshot)
      while (snapshots.value.length > MAX_SNAPSHOTS) snapshots.value.pop()
      saveSnapshots()
      return snapshot
    } finally {
      creating.value = false
    }
  }

  async function restoreSnapshot(snapshotId: string): Promise<boolean> {
    const snapshot = snapshots.value.find(s => s.id === snapshotId)
    if (!snapshot?.data) return false
    try {
      // Create auto-backup before restoring
      await createSnapshot('恢复前自动备份')
      const { entities, relations } = JSON.parse(snapshot.data)
      // Clear and restore
      await storage.clearEntities()
      await storage.clearRelations()
      for (const entity of entities) await storage.putEntity(entity)
      for (const relation of relations) await storage.putRelation(relation)
      // 刷新内存状态
      const { useEntityStore } = await import('../stores/entityStore')
      const { useRelationStore } = await import('../stores/relationStore')
      await useEntityStore().loadAll()
      await useRelationStore().loadAll()
      return true
    } catch {
      return false
    }
  }

  function deleteSnapshot(snapshotId: string) {
    snapshots.value = snapshots.value.filter(s => s.id !== snapshotId)
    saveSnapshots()
  }

  const totalSize = computed(() => {
    const raw = localStorage.getItem(SNAPSHOTS_KEY) || ''
    return raw.length
  })

  loadSnapshots()
  return { snapshots, creating, totalSize, createSnapshot, restoreSnapshot, deleteSnapshot }
}
