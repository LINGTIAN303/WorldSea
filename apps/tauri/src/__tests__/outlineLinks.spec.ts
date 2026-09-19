/**
 * outlineLinks 单测 —— 「节点 ↔ 芽实体」关联的唯一写入入口。
 *
 * 这层是 `link_entity` 工具恢复的落点，故重点在**不给假成功留口子**：
 * 未知关系简写必须返回 null（而不是回退默认值）、幂等、解除只删目标那一条。
 */
import { describe, it, expect } from 'vitest'
import type { Relation } from '@worldsea/entity-core'
import {
  hasOutlineRef,
  linkOutlineEntity,
  OUTLINE_REF_RELATION,
  refRelationKeyOf,
  resolveRefRelation,
  unlinkOutlineEntity,
  type OutlineLinkStore,
} from '../entity/outlineLinks'

function rel(type: string, sourceId: string, targetId: string, id = `${type}:${sourceId}:${targetId}`): Relation {
  return {
    id,
    type,
    sourceId,
    targetId,
    properties: {},
    createdAt: '',
    updatedAt: '',
  } as Relation
}

/** 最小 store 替身：内存关系表 + 记录调用 */
function makeStore(seed: Relation[] = []) {
  const table = new Map(seed.map(r => [r.id, { ...r }]))
  const calls = { add: 0, remove: 0 }
  const store: OutlineLinkStore = {
    async getAllRelations() {
      return [...table.values()]
    },
    async add(relation) {
      calls.add += 1
      table.set(relation.id, { ...relation })
      return relation.id
    },
    async remove(id) {
      calls.remove += 1
      table.delete(id)
    },
  }
  return { store, table, calls }
}

describe('outlineLinks / resolveRefRelation（简写 → 全名）', () => {
  it('三个简写都解析为对应全名', () => {
    expect(resolveRefRelation('mentions')).toBe(OUTLINE_REF_RELATION.mentions)
    expect(resolveRefRelation('located_in')).toBe(OUTLINE_REF_RELATION.located_in)
    expect(resolveRefRelation('covers')).toBe(OUTLINE_REF_RELATION.covers)
  })

  it('缺省 → 默认 mentions', () => {
    expect(resolveRefRelation(undefined)).toBe(OUTLINE_REF_RELATION.mentions)
    expect(resolveRefRelation('')).toBe(OUTLINE_REF_RELATION.mentions)
  })

  it('直接传全名 → 原样返回（幂等友好）', () => {
    expect(resolveRefRelation('outline_located_in')).toBe('outline_located_in')
  })

  it('**未知值 → null**（不回退默认，否则写错语义却显示成功）', () => {
    expect(resolveRefRelation('relates_to')).toBeNull()
    expect(resolveRefRelation('MENTIONS')).toBeNull()
    expect(resolveRefRelation(123)).toBeNull()
  })

  it('refRelationKeyOf 反向映射（工具回执用简写）', () => {
    expect(refRelationKeyOf('outline_mentions')).toBe('mentions')
    expect(refRelationKeyOf('nope')).toBeNull()
  })
})

describe('outlineLinks / linkOutlineEntity', () => {
  it('建立关联：写入 节点→实体 方向的一条关系', async () => {
    const { store, table, calls } = makeStore()
    const outcome = await linkOutlineEntity(store, 'n1', 'c1', 'outline_mentions')

    expect(outcome).toBe('created')
    expect(calls.add).toBe(1)
    const all = [...table.values()]
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ type: 'outline_mentions', sourceId: 'n1', targetId: 'c1' })
  })

  it('幂等：同 type+source+target 已存在 → 返回 exists 且不重复写', async () => {
    const { store, calls } = makeStore([rel('outline_mentions', 'n1', 'c1')])
    const outcome = await linkOutlineEntity(store, 'n1', 'c1', 'outline_mentions')

    expect(outcome).toBe('exists')
    expect(calls.add).toBe(0)
  })

  it('不同关系类型算不同关联（同实体可同时「提及」与「发生于」）', async () => {
    const { store, calls } = makeStore([rel('outline_mentions', 'n1', 'b1')])
    const outcome = await linkOutlineEntity(store, 'n1', 'b1', 'outline_located_in')

    expect(outcome).toBe('created')
    expect(calls.add).toBe(1)
  })

  it('同一实体换节点 → 是新关联（幂等判据含 sourceId）', async () => {
    const { store } = makeStore([rel('outline_mentions', 'n1', 'c1')])
    expect(await linkOutlineEntity(store, 'n2', 'c1', 'outline_mentions')).toBe('created')
  })

  it('空 id → missing-entity（不写脏关系）', async () => {
    const { store, calls } = makeStore()
    expect(await linkOutlineEntity(store, '', 'c1', 'outline_mentions')).toBe('missing-entity')
    expect(await linkOutlineEntity(store, 'n1', '', 'outline_mentions')).toBe('missing-entity')
    expect(calls.add).toBe(0)
  })
})

describe('outlineLinks / unlinkOutlineEntity', () => {
  it('解除：只删目标那一条', async () => {
    const { store, table, calls } = makeStore([
      rel('outline_mentions', 'n1', 'c1', 'a'),
      rel('outline_mentions', 'n1', 'c2', 'b'),
    ])
    const removed = await unlinkOutlineEntity(store, 'n1', 'c1', 'outline_mentions')

    expect(removed).toBe(true)
    expect(calls.remove).toBe(1)
    expect([...table.keys()]).toEqual(['b'])
  })

  it('不存在 → false（幂等，不抛错）', async () => {
    const { store, calls } = makeStore()
    expect(await unlinkOutlineEntity(store, 'n1', 'c1', 'outline_mentions')).toBe(false)
    expect(calls.remove).toBe(0)
  })

  it('不同关系类型不受影响（解除 mentions 不影响 located_in）', async () => {
    const { store, table } = makeStore([
      rel('outline_mentions', 'n1', 'b1', 'a'),
      rel('outline_located_in', 'n1', 'b1', 'b'),
    ])
    await unlinkOutlineEntity(store, 'n1', 'b1', 'outline_mentions')
    expect([...table.keys()]).toEqual(['b'])
  })
})

describe('outlineLinks / hasOutlineRef（纯判定）', () => {
  it('方向固定：反向关系不算「已有」', () => {
    const relations = [rel('outline_mentions', 'c1', 'n1')] // 实体 → 节点
    expect(hasOutlineRef(relations, 'n1', 'c1', 'outline_mentions')).toBe(false)
  })

  it('类型不同不算已有', () => {
    const relations = [rel('outline_located_in', 'n1', 'c1')]
    expect(hasOutlineRef(relations, 'n1', 'c1', 'outline_mentions')).toBe(false)
  })

  it('完全匹配 → true', () => {
    const relations = [rel('outline_mentions', 'n1', 'c1')]
    expect(hasOutlineRef(relations, 'n1', 'c1', 'outline_mentions')).toBe(true)
  })
})
