import { useTrashStore } from '../stores/trashStore'
import { useEntityStore } from '../stores/entityStore'
import { useRelationStore } from '../stores/relationStore'
import { storage } from '../core/StorageBackend'
import { getEventBus } from '../core/serviceProvider'
import type { Entity, Relation } from '../types'

export function useTrash() {
  const trashStore = useTrashStore()

  /**
   * 软删除实体：从存储中移除，但将数据放入回收站（关联关系同样移除并放入回收站）。
   * @deprecated 使用 entityStore.remove() 代替，它已内置软删除（放入回收站）+ undo + 事件
   */
  async function softDeleteEntity(
    entityId: string,
    source: 'user' | 'agent' | 'import' = 'user',
  ) {
    const entityStore = useEntityStore()
    const relationStore = useRelationStore()

    const entity = entityStore.entities.find(e => e.id === entityId)
    if (!entity) return

    // 收集关联关系
    const connectedRels = relationStore.relations.filter(
      r => r.sourceId === entityId || r.targetId === entityId,
    )
    const cascadedRelationIds = connectedRels.map(r => r.id)

    // 从存储中删除（deleteEntityAtomic 会同时清理关系）
    await storage.deleteEntityAtomic(entityId)

    // 更新内存状态
    entityStore.entities = entityStore.entities.filter(e => e.id !== entityId)
    if (connectedRels.length > 0) {
      const relIds = new Set(cascadedRelationIds)
      relationStore.relations = relationStore.relations.filter(r => !relIds.has(r.id))
    }

    // 放入回收站 - 实体
    trashStore.add({
      id: `trash_entity_${entityId}_${Date.now()}`,
      entityType: 'entity',
      data: { ...entity },
      deletedAt: new Date().toISOString(),
      deletedBy: source,
      cascadedRelationIds,
    })

    // 放入回收站 - 关联关系
    for (const rel of connectedRels) {
      trashStore.add({
        id: `trash_rel_${rel.id}_${Date.now()}`,
        entityType: 'relation',
        data: { ...rel },
        deletedAt: new Date().toISOString(),
        deletedBy: source,
      })
    }

    getEventBus().emit('entity:soft-delete', { entityId, entityType: entity.type, source })
  }

  /**
   * 从回收站恢复实体。
   * 同时恢复关联关系（仅当源和目标实体都存在时）。
   */
  async function restoreEntity(trashItemId: string): Promise<boolean> {
    const entityStore = useEntityStore()
    const relationStore = useRelationStore()

    const trashItem = trashStore.getItem(trashItemId)
    if (!trashItem || trashItem.entityType !== 'entity') return false

    const entity = trashItem.data as Entity

    // 恢复实体到存储
    await storage.putEntity(entity)
    entityStore.entities.push(entity)

    // 恢复关联关系
    if (trashItem.cascadedRelationIds && trashItem.cascadedRelationIds.length > 0) {
      for (const relId of trashItem.cascadedRelationIds) {
        // 在回收站中查找对应的关系
        const relTrashItem = trashStore.items.find(
          i => i.entityType === 'relation' && (i.data as Relation).id === relId,
        )
        if (relTrashItem) {
          const rel = relTrashItem.data as Relation
          // 检查源和目标实体是否都存在
          const sourceExists = entityStore.entities.some(e => e.id === rel.sourceId)
          const targetExists = entityStore.entities.some(e => e.id === rel.targetId)
          if (sourceExists && targetExists) {
            await storage.putRelation(rel)
            if (!relationStore.relations.find(r => r.id === rel.id)) {
              relationStore.relations.push(rel)
            }
            // 关系成功恢复后才从回收站移除
            trashStore.permanentDelete(relTrashItem.id)
          }
          // 源或目标不存在时，关系回收站条目保留，等另一端恢复后再处理
        }
      }
    }

    // 从回收站移除
    trashStore.permanentDelete(trashItemId)
    getEventBus().emit('entity:restore', { entityId: entity.id, entityType: entity.type })
    return true
  }

  /**
   * 永久删除回收站中的实体（不恢复）。
   */
  function permanentDeleteEntity(trashItemId: string) {
    const trashItem = trashStore.getItem(trashItemId)
    if (!trashItem) return

    // 同时删除回收站中的关联关系
    if (trashItem.entityType === 'entity' && trashItem.cascadedRelationIds) {
      for (const relId of trashItem.cascadedRelationIds) {
        const relTrashItem = trashStore.items.find(
          i => i.entityType === 'relation' && (i.data as Relation).id === relId,
        )
        if (relTrashItem) {
          trashStore.permanentDelete(relTrashItem.id)
        }
      }
    }

    trashStore.permanentDelete(trashItemId)
  }

  return {
    trashStore,
    softDeleteEntity,
    restoreEntity,
    permanentDeleteEntity,
  }
}
