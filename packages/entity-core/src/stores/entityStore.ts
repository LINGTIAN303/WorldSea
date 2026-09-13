import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useShallowArray, useShallowRefMap } from '@worldsea/perf-kit/reactive'
import { storage } from '../core/StorageBackend'
import { useUndoRedo, isUndoing } from '../composables/useUndoRedo'
import { entitySchemaRegistry } from '../core/EntitySchema'
import { getValidationApi, getEventBus } from '../core/serviceProvider'
import { useRelationStore } from './relationStore'
import { useDirtyTracker } from '../composables/useDirtyTracker'
import { useTrashStore } from './trashStore'
import type { Entity } from '../types/entity'

export const useEntityStore = defineStore('entity', () => {
  const { items: entities, setAll, push, removeById, updateById, findById } = useShallowArray<Entity>('id')
  const { map: entityMap, set: mapSet, delete: mapDel, replaceAll: mapReplaceAll } = useShallowRefMap<string, Entity>()
  const loading = ref(false)
  const error = ref<string | null>(null)
  const { record } = useUndoRedo()
  const { markEntityDirty, markEntityClean, clearAllDirty } = useDirtyTracker()

  function clearError() { error.value = null }
  function setError(msg: string) { error.value = msg; console.error('[EntityStore]', msg) }

  function syncIndex() {
    mapReplaceAll(entities.value.map(e => [e.id, e] as [string, Entity]))
  }

  const typeCounts = computed(() => {
    const map = new Map<string, number>()
    for (const e of entities.value) {
      map.set(e.type, (map.get(e.type) || 0) + 1)
    }
    return map
  })

  const allTypeCounts = ref<Map<string, number>>(new Map())

  async function refreshAllTypeCounts() {
    allTypeCounts.value = await storage.countEntitiesByType()
  }

  const types = computed(() => entitySchemaRegistry.getAll())

  function sanitize(raw: (Entity | undefined)[]): Entity[] {
    return raw.filter((e): e is Entity => e != null && typeof e.id === 'string')
  }

  async function loadAll() {
    clearError()
    loading.value = true
    try {
      setAll(sanitize(await storage.getAllEntities()))
      syncIndex()
      refreshAllTypeCounts()
      clearAllDirty()
    } catch (e: any) {
      setError(e?.message ?? '加载实体失败')
    } finally {
      loading.value = false
    }
  }

  async function loadByType(type: string) {
    clearError()
    loading.value = true
    try {
      setAll(sanitize(await storage.getEntitiesByType(type)))
      syncIndex()
    } catch (e: any) {
      setError(e?.message ?? '加载实体失败')
    } finally {
      loading.value = false
    }
  }

  async function getById(id: string): Promise<Entity | undefined> {
    return entityMap.value.get(id) ?? storage.getEntity(id)
  }

  async function add(entity: Entity, source: 'user' | 'agent' | 'import' = 'user'): Promise<string> {
    clearError()
    // import 来源数据已由 importBatch 处理，无需 clone；
    // user/agent 来源需要 clone 防止外部引用污染
    const clean = source === 'import' ? entity : structuredClone(entity)
    clean.createdAt = new Date().toISOString()
    clean.updatedAt = clean.createdAt

    const schema = entitySchemaRegistry.get(entity.type)
    const validation = getValidationApi()
    const report = validation.validateEntity
      ? await validation.validateEntity(
          JSON.stringify(clean),
          schema ? JSON.stringify(schema) : undefined,
        )
      : null
    if (report && !report.valid) {
      const errors = report.errors.filter((e: any) => e.severity === 'error')
      const warnings = report.errors.filter((e: any) => e.severity !== 'error')
      if (errors.length > 0) {
        const msg = errors.map((e: any) => `${e.path}: ${e.message}`).join('; ')
        setError(msg)
        throw new Error(`实体验证失败: ${msg}`)
      }
      if (warnings.length > 0) {
        const msg = warnings.map((e: any) => `${e.path}: ${e.message}`).join('; ')
        console.warn('[EntityStore] 验证警告:', msg)
      }
    }

    await storage.putEntity(clean)
    push(clean)
    mapSet(clean.id, clean)
    if (!isUndoing) record('entity', 'add', clean.id, null, { ...clean }, clean.name)
    getEventBus().emit('entity:create', { entityId: clean.id, entityType: clean.type, properties: clean.properties || {}, source })
    refreshAllTypeCounts()
    return clean.id
  }

  /**
   * 更新实体（内存立即生效，持久化与事件异步）。
   *
   * @param opts.skipUndo 跳过撤销栈记录。**仅用于自动保存类写入**（编辑器内容防抖落库）：
   *   这类写入会在每次输入暂停时产生一条撤销记录，迅速填满撤销上限（默认 20）并把用户
   *   真实操作的撤销历史挤掉。文本级撤销由编辑器自身负责（TipTap 内部 undo / 章节快照），
   *   不进全局撤销栈。
   */
  async function update(id: string, changes: Partial<Entity>, source: 'user' | 'agent' | 'import' = 'user', opts?: { skipUndo?: boolean }) {
    clearError()
    const clean = { ...changes, updatedAt: new Date().toISOString() }

    const old = findById(id)
    const oldProps = old?.properties ?? {}

    if (!isUndoing && !opts?.skipUndo && old) {
      const before: Partial<Entity> = {}
      for (const key of Object.keys(changes)) {
        (before as any)[key] = (old as any)[key]
      }
      record('entity', 'update', id, before, changes, old.name)
    }

    // 先更新内存状态（同步，确保 UI 立即响应）
    updateById(id, clean)
    const updated = findById(id)

    // 异步持久化 + 事件发射（不阻塞 UI 更新）
    storage.updateEntity(id, clean).then(() => {
      markEntityDirty(id)
    }).catch(e => setError(e?.message ?? '更新实体失败'))

    // 更新索引
    if (updated) mapSet(id, updated)

    // 事件发射（EventBus.emit 已改为非阻塞）
    const newProps = updated?.properties ?? {}
    const changedFields = Object.keys(clean).filter(k => k !== 'updatedAt')
    getEventBus().emit('entity:update', {
      entityId: id, entityType: old?.type ?? '',
      oldProperties: oldProps, newProperties: newProps,
      changedFields,
      source,
    })

    if (clean.properties) {
      for (const [key, newVal] of Object.entries(clean.properties as Record<string, unknown>)) {
        const oldVal = oldProps[key]
        if (oldVal !== newVal) {
          getEventBus().emit('field:change', {
            entityId: id, entityType: old?.type ?? '',
            field: key, oldValue: oldVal, newValue: newVal,
          })
        }
      }
    }
  }

  async function remove(id: string, source: 'user' | 'agent' | 'import' = 'user') {
    clearError()
    const old = findById(id)
    if (!old) return

    // 收集关联关系信息（用于回收站和undo）
    const rs = useRelationStore()
    const connectedRels = rs.relations.filter(r => r.sourceId === id || r.targetId === id)

    // 从存储中删除实体和关联关系（deleteEntityAtomic 内置级联清理）
    try {
      const result = await storage.deleteEntityAtomic(id)
      if (!result.success) {
        setError(result.error ?? '删除实体失败')
        return
      }
    } catch (e: any) {
      setError(e?.message ?? '删除实体失败')
      return
    }

    // 更新内存状态
    removeById(id)
    mapDel(id)
    if (connectedRels.length > 0) {
      const connectedIds = new Set(connectedRels.map(r => r.id))
      rs.relations = rs.relations.filter(r => !connectedIds.has(r.id))
    }

    // 清理脏标记
    markEntityClean(id)
    for (const rel of connectedRels) {
      const { markRelationClean } = useDirtyTracker()
      markRelationClean(rel.id)
    }

    // 记录到 undo 栈
    if (!isUndoing) {
      for (const rel of connectedRels) {
        record('relation', 'delete', rel.id, { ...rel }, null)
      }
      record('entity', 'delete', id, { ...old }, null)
    }

    // 放入回收站（Undo 操作跳过，避免重复入站）
    if (!isUndoing) {
      const trashStore = useTrashStore()
      const cascadedRelationIds = connectedRels.map(r => r.id)
      trashStore.add({
        id: `trash_entity_${id}_${Date.now()}`,
        entityType: 'entity',
        data: { ...old },
        deletedAt: new Date().toISOString(),
        deletedBy: source,
        cascadedRelationIds,
      })
      for (const rel of connectedRels) {
        trashStore.add({
          id: `trash_rel_${rel.id}_${Date.now()}`,
          entityType: 'relation',
          data: { ...rel },
          deletedAt: new Date().toISOString(),
          deletedBy: source,
        })
      }
    }

    getEventBus().emit('entity:delete', { entityId: id, entityType: old.type, properties: old.properties || {}, source })
    refreshAllTypeCounts()
  }

  /** @deprecated 使用 loadByPage 代替；图谱等需全量数据的场景仍可使用 */
  async function getAllEntities(): Promise<Entity[]> {
    return storage.getAllEntities()
  }

  /**
   * 分页加载实体，支持排序和类型筛选。
   * 委托给存储后端：Web 端走 Dexie 索引分页（PERF-09），Tauri/File 端回退全量 + JS 排序。
   */
  async function loadByPage(opts: {
    type?: string
    offset: number
    limit: number
    sortBy?: 'updatedAt' | 'createdAt' | 'name'
    sortDir?: 'asc' | 'desc'
  }): Promise<{ items: Entity[]; total: number }> {
    clearError()
    loading.value = true
    try {
      return await storage.loadEntitiesPage(opts)
    } catch (e: any) {
      setError(e?.message ?? '分页加载失败')
      return { items: [], total: 0 }
    } finally {
      loading.value = false
    }
  }

  /**
   * 批量导入实体：一次性写入 DB + 刷新内存状态。
   * 替代逐个 add()，避免 N 次 IPC/DB 写入。
   */
  async function importBatch(newEntities: Entity[]): Promise<number> {
    clearError()
    const sanitized = sanitize(newEntities)
    const count = await storage.importEntities(sanitized)
    setAll(sanitize(await storage.getAllEntities()))
    syncIndex()
    refreshAllTypeCounts()
    return count
  }

  return {
    entities,
    loading,
    error,
    clearError,
    entityMap,
    typeCounts,
    allTypeCounts,
    refreshAllTypeCounts,
    types,
    loadAll,
    loadByType,
    loadByPage,
    getById,
    getAllEntities,
    add,
    update,
    remove,
    importBatch,
  }
})
