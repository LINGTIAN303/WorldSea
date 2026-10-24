/** 事件参与角色：关系差集（正向 involves + 反向 involved_in_event 成对维护）。 */
import { describe, expect, it } from 'vitest'
import type { Relation } from '@worldsea/entity-core'
import { diffInvolves } from '../eventInvolves'

function rel(id: string, type: string, sourceId: string, targetId: string): Relation {
  return { id, type, sourceId, targetId, properties: {}, createdAt: '', updatedAt: '' } as Relation
}

describe('参与角色关系差集', () => {
  const relations = [
    rel('r1', 'involves', 'e1', 'c1'),
    rel('r2', 'involved_in_event', 'c1', 'e1'),
    rel('r3', 'involves', 'e1', 'c2'),
    rel('r4', 'causes', 'e1', 'c3'),
  ]

  it('正反向关系归到同一目标；取消勾选时成对删除', () => {
    expect(diffInvolves(relations, 'e1', ['c1', 'c3'])).toEqual({ add: ['c3'], remove: ['r3'] })
    expect(diffInvolves(relations, 'e1', ['c1'])).toEqual({ add: [], remove: ['r3'] })
    expect(diffInvolves(relations, 'e1', ['c1', 'c2'])).toEqual({ add: [], remove: [] })
  })

  it('只认 involves 两向；自身 id 与空值忽略', () => {
    expect(diffInvolves(relations, 'e1', ['c1', 'c2', 'c3'])).toEqual({ add: ['c3'], remove: [] })
    expect(diffInvolves([], 'e1', ['', 'e1', 'c1'])).toEqual({ add: ['c1'], remove: [] })
  })
})
