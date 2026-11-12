/**
 * 事件「参与角色/组织」→ involves 关系同步（表单保存后调用）。
 * 关系是角色日程冲突检测的唯一数据源：正向 involves（事件→角色）+ 反向 involved_in_event 成对维护。
 */
import type { Relation } from '@worldsea/entity-core'
import { useBidirectional } from '@worldsea/entity-core/composables'
import { relationsSvc } from '../serviceAccess'

const INVOLVES = 'involves'
const INVOLVE_INVERSE = 'involved_in_event'

export interface InvolveDiff {
  /** 需要新建关系的目标实体 id */
  add: string[]
  /** 需要删除的关系行 id（成对关系的两行都在内） */
  remove: string[]
}

/** 差集：现有 involves / involved_in_event 行 vs 期望勾选的目标集合（纯函数，便于单测） */
export function diffInvolves(relations: Relation[], eventId: string, targetIds: string[]): InvolveDiff {
  const wanted = new Set(targetIds.filter(id => !!id && id !== eventId))
  const existing = new Map<string, string[]>()
  for (const relation of relations) {
    const targetId = relation.type === INVOLVES && relation.sourceId === eventId ? relation.targetId
      : relation.type === INVOLVE_INVERSE && relation.targetId === eventId ? relation.sourceId : ''
    if (!targetId) continue
    const bucket = existing.get(targetId) ?? []
    bucket.push(relation.id)
    existing.set(targetId, bucket)
  }
  return {
    add: [...wanted].filter(id => !existing.has(id)),
    remove: [...existing].filter(([targetId]) => !wanted.has(targetId)).flatMap(([, ids]) => ids),
  }
}

/** 落库：删除取消勾选的关系行，为新勾选建立成对关系 */
export async function syncEventInvolves(eventId: string, targetIds: string[]): Promise<void> {
  if (!eventId) return
  const relations = relationsSvc()
  const { createBidirectional } = useBidirectional()
  const { add, remove } = diffInvolves([...relations.list()], eventId, targetIds)
  for (const id of remove) await relations.remove(id)
  for (const targetId of add) await createBidirectional({ type: INVOLVES, sourceId: eventId, targetId })
  if (add.length || remove.length) await relations.reload()
}
