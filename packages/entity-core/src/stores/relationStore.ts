import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useShallowArray } from '@worldsea/perf-kit/reactive'
import { storage } from '../core/StorageBackend'
import { useUndoRedo, isUndoing } from '../composables/useUndoRedo'
import type { Relation } from '../types/relation'
import { getEventBus } from '../core/serviceProvider'

export const useRelationStore = defineStore('relation', () => {
  const { items: relations, setAll, push, removeById, updateById, findById, trigger } = useShallowArray<Relation>('id')
  const loading = ref(false)
  const { record } = useUndoRedo()

  async function loadAll() {
    loading.value = true
    setAll(await storage.getAllRelations())
    loading.value = false
  }

  async function loadByEntity(entityId: string) {
    loading.value = true
    setAll(await storage.getRelationsByEntity(entityId))
    loading.value = false
  }

  async function add(relation: Relation, source: 'user' | 'agent' | 'import' = 'user'): Promise<string> {
    const existingId = relation.id
    await storage.putRelation(relation)
    if (!findById(existingId)) {
      push({ ...relation, id: existingId })
    }
    if (!isUndoing) record('relation', 'add', existingId, null, { ...relation, id: existingId })
    getEventBus().emit('relation:create', {
      relationId: existingId,
      sourceId: relation.sourceId,
      targetId: relation.targetId,
      type: relation.type,
      source,
    })
    return existingId
  }

  async function update(id: string, changes: Partial<Relation>) {
    changes.updatedAt = new Date().toISOString()
    const old = findById(id)
    if (!isUndoing && old) {
      const before: Partial<Relation> = {}
      for (const key of Object.keys(changes)) {
        (before as any)[key] = (old as any)[key]
      }
      record('relation', 'update', id, before, changes)
    }
    await storage.updateRelation(id, changes)
    updateById(id, changes)
  }

  async function remove(id: string, source: 'user' | 'agent' | 'import' = 'user') {
    const old = findById(id)
    if (!isUndoing && old) record('relation', 'delete', id, { ...old }, null)
    if (old) {
      getEventBus().emit('relation:delete', {
        relationId: id,
        sourceId: old.sourceId,
        targetId: old.targetId,
        type: old.type,
        source,
      })
    }
    await storage.deleteRelation(id)
    removeById(id)
  }

  async function getConnected(entityId: string): Promise<Relation[]> {
    return storage.getRelationsByEntity(entityId)
  }

  async function getAllRelations(): Promise<Relation[]> {
    return storage.getAllRelations()
  }

  async function updateLabel(id: string, label: string) {
    const rel = findById(id)
    if (rel) {
      rel.label = label
      rel.updatedAt = new Date().toISOString()
      trigger()
      await storage.updateRelation(id, { label, updatedAt: rel.updatedAt })
    }
  }

  function getPairRelation(relationId: string): Relation | undefined {
    const relation = findById(relationId)
    if (!relation?.pairId) return undefined
    return relations.value.find(
      r => r.pairId === relation.pairId && r.id !== relationId
    )
  }

  function getByPairId(pairId: string): Relation[] {
    return relations.value.filter(r => r.pairId === pairId)
  }

  /**
   * 批量导入关系：一次性写入 DB + 刷新内存状态。
   * 替代逐个 add()，避免 N 次 IPC/DB 写入。
   */
  async function importBatch(newRelations: Relation[]): Promise<number> {
    const count = await storage.importRelations(newRelations)
    setAll(await storage.getAllRelations())
    return count
  }

  return {
    relations,
    loading,
    loadAll,
    updateLabel,

    loadByEntity,
    add,
    update,
    remove,
    getConnected,
    getAllRelations,
    getPairRelation,
    getByPairId,
    importBatch,
  }
})
