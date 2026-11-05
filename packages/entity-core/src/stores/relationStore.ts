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

  /** 全量装载关系。失败时 loading 仍必须回落（下游用 loading 判定"装载结束"，见 __tests__/relationStore.spec.ts）。 */
  async function loadAll() {
    loading.value = true
    try {
      setAll(await storage.getAllRelations())
    } finally {
      loading.value = false
    }
  }

  /**
   * 按实体加载关系（**增量语义**，2026-09-18 与 entityStore.loadByType 一并修正）。
   * 【历史缺陷】此前 setAll(getRelationsByEntity(id)) 会整体替换 relations，把不涉及该实体的关系从内存挤掉；当前无调用点（预留 API），同型隐患一并修掉。
   * 【语义】涉及该实体的关系以 storage 为准替换，其它关系原样保留。
   */
  async function loadByEntity(entityId: string) {
    loading.value = true
    const fresh = await storage.getRelationsByEntity(entityId)
    const freshIds = new Set(fresh.map(r => r.id))
    const kept = relations.value.filter(
      r => r.sourceId !== entityId && r.targetId !== entityId && !freshIds.has(r.id),
    )
    setAll([...kept, ...fresh])
    loading.value = false
  }

  /**
   * 添加关系。
   * @param opts.skipUndo 跳过撤销栈记录。**仅用于派生/系统类写入**（如笔记本双链派生重算，
   *   见 docs/plans/2026-10-15-块2-连接派生-批计划.md §2.3）：这类写入在每次保存/装载时
   *   批量发生，若记撤销会迅速填满撤销上限（默认 20）并把用户真实操作的撤销历史挤掉；
   *   文本级撤销由编辑器自身负责，关系随内容重算自愈。对齐 entityStore.update 的 skipUndo 模式。
   */
  async function add(relation: Relation, source: 'user' | 'agent' | 'import' = 'user', opts?: { skipUndo?: boolean }): Promise<string> {
    const existingId = relation.id
    await storage.putRelation(relation)
    if (!findById(existingId)) {
      push({ ...relation, id: existingId })
    }
    if (!isUndoing && !opts?.skipUndo) record('relation', 'add', existingId, null, { ...relation, id: existingId })
    getEventBus().emit('relation:create', {
      relationId: existingId,
      sourceId: relation.sourceId,
      targetId: relation.targetId,
      type: relation.type,
      source,
    })
    return existingId
  }

  async function update(id: string, changes: Partial<Relation>, opts?: { skipUndo?: boolean }) {
    changes.updatedAt = new Date().toISOString()
    const old = findById(id)
    if (!isUndoing && !opts?.skipUndo && old) {
      const before: Partial<Relation> = {}
      for (const key of Object.keys(changes)) {
        (before as any)[key] = (old as any)[key]
      }
      record('relation', 'update', id, before, changes)
    }
    await storage.updateRelation(id, changes)
    updateById(id, changes)
  }

  /** 删除关系。@param opts.skipUndo 同 add——派生/系统类写入不进撤销栈（见 add 注释）。 */
  async function remove(id: string, source: 'user' | 'agent' | 'import' = 'user', opts?: { skipUndo?: boolean }) {
    const old = findById(id)
    if (!isUndoing && !opts?.skipUndo && old) record('relation', 'delete', id, { ...old }, null)
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
