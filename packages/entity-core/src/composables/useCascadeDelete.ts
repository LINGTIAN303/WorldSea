import { useRelationStore } from '../stores/relationStore'
import { useEntityStore } from '../stores/entityStore'
import { useUndoRedo } from './useUndoRedo'
import { getEventBus } from '../core/serviceProvider'

/**
 * 级联删除 composable。
 * 提供事务级的级联删除封装，删除实体时自动清理关联关系。
 *
 * 注意：entityStore.remove() 已内置级联清理逻辑，
 * 此 composable 提供额外的事务包装和事件通知。
 */
export function useCascadeDelete() {
  const { beginTransaction, commitTransaction } = useUndoRedo()

  /**
   * 级联删除单个实体及其所有关联关系。
   * 使用事务确保原子性，支持撤销。
   */
  async function cascadeDeleteEntity(
    entityId: string,
    source: 'user' | 'agent' | 'import' = 'user',
  ): Promise<{ deletedRelations: number }> {
    const relationStore = useRelationStore()
    const entityStore = useEntityStore()

    beginTransaction()
    try {
      // 1. 查找并记录所有关联关系
      const connectedRels = relationStore.relations.filter(
        (r) => r.sourceId === entityId || r.targetId === entityId,
      )

      // 2. 删除实体（内置级联清理关系）
      await entityStore.remove(entityId, source)

      commitTransaction(`删除实体及 ${connectedRels.length} 个关系`)

      getEventBus().emit('entity:cascade-delete', {
        entityId,
        deletedRelationCount: connectedRels.length,
        source,
      })

      return { deletedRelations: connectedRels.length }
    } catch (e) {
      commitTransaction()
      throw e
    }
  }

  /**
   * 批量级联删除多个实体。
   * 先收集所有关联关系（去重），再统一删除。
   */
  async function cascadeDeleteEntities(
    entityIds: string[],
    source: 'user' | 'agent' | 'import' = 'user',
  ): Promise<{ deletedEntities: number; deletedRelations: number }> {
    const relationStore = useRelationStore()
    const entityStore = useEntityStore()

    beginTransaction()
    try {
      // 收集所有关联关系ID（去重）
      const relIdsToDelete = new Set<string>()
      for (const eid of entityIds) {
        const rels = relationStore.relations.filter(
          (r) => r.sourceId === eid || r.targetId === eid,
        )
        for (const r of rels) relIdsToDelete.add(r.id)
      }

      const totalRels = relIdsToDelete.size

      // 逐个删除实体（内置级联清理）
      for (const eid of entityIds) {
        await entityStore.remove(eid, source)
      }

      commitTransaction(`批量删除 ${entityIds.length} 个实体及 ${totalRels} 个关系`)

      return { deletedEntities: entityIds.length, deletedRelations: totalRels }
    } catch (e) {
      commitTransaction()
      throw e
    }
  }

  return { cascadeDeleteEntity, cascadeDeleteEntities }
}
