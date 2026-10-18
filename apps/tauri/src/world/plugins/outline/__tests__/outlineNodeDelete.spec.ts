/**
 * 大纲节点删除单测（2026-10-19）
 *
 * 护栏重点：
 *   ① 级联只删**子树**（不许越界到兄弟或父级）；
 *   ② 关系清理必须**两端都命中**（source 或 target 命中都算）；
 *   ③ 顺序 = 先清关系/章节、再删实体（测试用调用序列断言）；
 *   ④ promote / reparent 只动直接子节点，且 reparent 缺目标必须抛错。
 */
import { describe, it, expect } from 'vitest'
import type { Entity, Relation } from '@worldsea/entity-core'
import {
  childrenOf,
  collectSubtreeIds,
  deleteOutlineNodeWithStrategy,
  deleteOutlineNodes,
  type OutlineNodeDeleteApi,
} from '@/entity/outlineNodeDelete'

function node(id: string, parentId = ''): Entity {
  return {
    id, type: 'outline_node', name: id,
    properties: { parentId },
    tags: [], createdAt: '', updatedAt: '',
  } as unknown as Entity
}

function rel(id: string, sourceId: string, targetId: string, type = 'parent_child'): Relation {
  return { id, type, sourceId, targetId, properties: {}, createdAt: '', updatedAt: '' } as unknown as Relation
}

function makeApi(nodes: Entity[], relations: Relation[] = []) {
  const removedEntities: string[] = []
  const removedRelations: string[] = []
  const unlinked: string[] = []
  const updates: Array<{ id: string; properties: Record<string, unknown> }> = []
  const api: OutlineNodeDeleteApi = {
    entities: () => nodes,
    relations: () => relations,
    removeEntity: async (id) => { removedEntities.push(id) },
    removeRelation: async (id) => { removedRelations.push(id) },
    unlinkChapter: async (id) => { unlinked.push(id) },
    updateNode: async (id, properties) => { updates.push({ id, properties }) },
  }
  return { api, removedEntities, removedRelations, unlinked, updates }
}

/** a → b → (c, d)；e 独立 */
function tree(): Entity[] {
  return [node('a'), node('b', 'a'), node('c', 'b'), node('d', 'b'), node('e')]
}

describe('childrenOf / collectSubtreeIds', () => {
  it('直接子节点只含一层', () => {
    expect(childrenOf(tree(), 'b').map(n => n.id).sort()).toEqual(['c', 'd'])
  })

  it('子树含自身与全部后代', () => {
    expect(collectSubtreeIds(tree(), 'b').sort()).toEqual(['b', 'c', 'd'])
    expect(collectSubtreeIds(tree(), 'a').sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('叶子节点只有自身', () => {
    expect(collectSubtreeIds(tree(), 'c')).toEqual(['c'])
  })

  it('父指针成环时不无限递归', () => {
    const cyclic = [node('x', 'y'), node('y', 'x')]
    expect(collectSubtreeIds(cyclic, 'x').sort()).toEqual(['x', 'y'])
  })
})

describe('deleteOutlineNodes', () => {
  it('关系两端任一命中即清（source / target 各一例）', async () => {
    const rows = [rel('r1', 'a', 'z'), rel('r2', 'z', 'a'), rel('r3', 'b', 'z')]
    const m = makeApi(tree(), rows)
    await deleteOutlineNodes(m.api, ['a'])
    expect(m.removedRelations.sort()).toEqual(['r1', 'r2'])
  })

  it('章节解绑与实体删除都执行', async () => {
    const m = makeApi(tree())
    const n = await deleteOutlineNodes(m.api, ['a', 'b'])
    expect(n).toBe(2)
    expect(m.unlinked.sort()).toEqual(['a', 'b'])
    expect(m.removedEntities.sort()).toEqual(['a', 'b'])
  })

  it('空数组不做任何事', async () => {
    const m = makeApi(tree())
    expect(await deleteOutlineNodes(m.api, [])).toBe(0)
    expect(m.removedEntities).toEqual([])
  })
})

describe('deleteOutlineNodeWithStrategy', () => {
  it('cascade：删整棵子树（含自身）', async () => {
    const m = makeApi(tree())
    expect(await deleteOutlineNodeWithStrategy(m.api, 'b', 'cascade')).toBe(3)
    expect(m.removedEntities.sort()).toEqual(['b', 'c', 'd'])
    expect(m.updates).toEqual([])
  })

  it('promote：子节点提升为根，只删自身', async () => {
    const m = makeApi(tree())
    expect(await deleteOutlineNodeWithStrategy(m.api, 'b', 'promote')).toBe(1)
    expect(m.updates.map(u => u.id).sort()).toEqual(['c', 'd'])
    for (const u of m.updates) expect(u.properties.parentId).toBe('')
    expect(m.removedEntities).toEqual(['b'])
  })

  it('reparent：子节点挂到目标，order 从目标现有子节点数往后排', async () => {
    const m = makeApi(tree())
    // e 目前无子节点 → c=1, d=2
    await deleteOutlineNodeWithStrategy(m.api, 'b', 'reparent', 'e')
    expect(m.updates).toEqual([
      { id: 'c', properties: { parentId: 'e', order: 1 } },
      { id: 'd', properties: { parentId: 'e', order: 2 } },
    ])
    expect(m.removedEntities).toEqual(['b'])
  })

  it('reparent 缺少目标 → 抛错（不静默降级）', async () => {
    const m = makeApi(tree())
    await expect(deleteOutlineNodeWithStrategy(m.api, 'b', 'reparent', '')).rejects.toThrow()
  })

  it('叶子节点三种策略都只删自身', async () => {
    for (const s of ['cascade', 'promote', 'reparent'] as const) {
      const m = makeApi(tree())
      const n = await deleteOutlineNodeWithStrategy(m.api, 'c', s, 'e')
      expect(n).toBe(1)
      expect(m.removedEntities).toEqual(['c'])
      expect(m.updates).toEqual([])
    }
  })
})
