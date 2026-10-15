import { inverseRegistry } from '../core'
import { useRelationStore } from '../stores'
import { useUndoRedo } from '../composables/useUndoRedo'
import { getConfirmApi } from '../core/serviceProvider'
import { getRelationLabel } from '../core'
import type { Relation } from '../types'

export function useBidirectional() {
  const relationStore = useRelationStore()
  const { beginTransaction, commitTransaction } = useUndoRedo()
  const confirmApi = getConfirmApi()

  /**
   * 创建双向关系（forward + inverse 两条，pairId 配对）。
   * @param opts.skipUndo 透传给 relationStore.add——派生/系统类写入不进撤销栈
   *   （块 2 双链派生重算专用，见 docs/plans/2026-10-15-块2-连接派生-批计划.md §2.3）。
   */
  async function createBidirectional(params: {
    type: string
    sourceId: string
    targetId: string
    label?: string
    properties?: Record<string, unknown>
  }, opts?: { skipUndo?: boolean }): Promise<{ forward: Relation; reverse?: Relation }> {
    const { type, sourceId, targetId, label, properties } = params
    const inverseType = inverseRegistry.getInverse(type)
    const shouldCreateInverse = !!inverseType

    const pairId = shouldCreateInverse
      ? `pair-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      : undefined

    // skipUndo（派生/系统类写入）不开撤销事务：本函数内不产生撤销记录，开事务无意义，
    // 反而会把异步窗口内交错发生的其他记录错误归入本组（见 relationStore.add 注释）。
    if (!opts?.skipUndo) beginTransaction()

    const now = new Date().toISOString()
    const forwardId = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const forward: Relation = {
      id: forwardId,
      type,
      sourceId,
      targetId,
      label,
      properties: properties || {},
      pairId,
      createdAt: now,
      updatedAt: now,
    }
    await relationStore.add(forward, 'user', opts)

    let reverse: Relation | undefined
    if (shouldCreateInverse && inverseType && pairId) {
      const reverseId = `rel-${Date.now() + 1}-${Math.random().toString(36).slice(2, 6)}`
      reverse = {
        id: reverseId,
        type: inverseType,
        sourceId: targetId,
        targetId: sourceId,
        properties: inverseRegistry.isSymmetric(type) ? { ...(properties || {}) } : {},
        pairId,
        createdAt: now,
        updatedAt: now,
      }
      await relationStore.add(reverse, 'user', opts)
    }

    if (!opts?.skipUndo) commitTransaction(`创建双向关系: ${getRelationLabel(type)}`)

    return { forward, reverse }
  }

  async function deleteWithConfirm(relationId: string): Promise<void> {
    const relation = relationStore.relations.find(r => r.id === relationId)
    if (!relation) return

    let deletePair = false
    let pairRelation: Relation | undefined

    if (relation.pairId) {
      pairRelation = relationStore.relations.find(
        r => r.pairId === relation.pairId && r.id !== relationId
      )
      if (pairRelation) {
        const pairLabel = getRelationLabel(pairRelation.type)
        deletePair = await confirmApi.confirm({
          type: 'danger',
          title: '删除双向关系',
          description: `是否同时删除反向关系「${pairLabel}」？`,
        })
      }
    }

    beginTransaction()

    if (deletePair && pairRelation) {
      await relationStore.remove(pairRelation.id)
    } else if (pairRelation) {
      await relationStore.update(pairRelation.id, { pairId: undefined } as Partial<Relation>)
    }

    await relationStore.remove(relationId)

    commitTransaction('删除关系')
  }

  async function editWithSync(
    relationId: string,
    changes: Partial<Relation>
  ): Promise<void> {
    await relationStore.update(relationId, changes)

    const relation = relationStore.relations.find(r => r.id === relationId)
    if (!relation?.pairId) return

    const pair = relationStore.relations.find(
      r => r.pairId === relation.pairId && r.id !== relationId
    )
    if (!pair) return

    if (inverseRegistry.isSymmetric(relation.type) && changes.properties) {
      await relationStore.update(pair.id, { properties: changes.properties } as Partial<Relation>)
    }
  }

  function getPairRelation(relationId: string): Relation | undefined {
    const relation = relationStore.relations.find(r => r.id === relationId)
    if (!relation?.pairId) return undefined
    return relationStore.relations.find(
      r => r.pairId === relation.pairId && r.id !== relationId
    )
  }

  return { createBidirectional, deleteWithConfirm, editWithSync, getPairRelation }
}
