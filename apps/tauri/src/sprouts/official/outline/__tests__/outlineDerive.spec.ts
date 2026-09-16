import { describe, it, expect } from 'vitest'
import {
  MAX_DEPTH,
  parentIdOf,
  orderOf,
  resolveChildNodes,
  resolveNodeDepth,
  resolveSiblingIndex,
  resolveNodeNumbering,
  collectDescendantIds,
  type NodeLike,
} from '../board/outlineDerive'

/** 造一个最小节点（只带派生计算需要的字段） */
function mk(id: string, parentId = '', order = 0): NodeLike {
  return { id, properties: { parentId, order } } as unknown as NodeLike
}

describe('outlineDerive / 基础读值', () => {
  it('parentIdOf 与 orderOf 对缺失值给出安全默认', () => {
    expect(parentIdOf(undefined)).toBe('')
    expect(parentIdOf(mk('a'))).toBe('')
    expect(orderOf(undefined)).toBe(0)
    expect(orderOf({ id: 'x', properties: {} } as unknown as NodeLike)).toBe(0)
    expect(orderOf({ id: 'x', properties: { order: 'abc' } } as unknown as NodeLike)).toBe(0)
  })
})

describe('outlineDerive / resolveChildNodes', () => {
  const nodes = [mk('a', '', 2), mk('b', '', 1), mk('c', 'b', 1), mk('d', 'b', 1)]

  it('只取直接子节点并按 order 升序', () => {
    const roots = resolveChildNodes('', nodes)
    expect(roots.map(n => n.id)).toEqual(['b', 'a'])
  })

  it('order 相同时用 id 兜底保证顺序稳定', () => {
    const children = resolveChildNodes('b', nodes)
    expect(children.map(n => n.id)).toEqual(['c', 'd'])
  })

  it('无子节点时返回空数组', () => {
    expect(resolveChildNodes('c', nodes)).toEqual([])
  })
})

describe('outlineDerive / resolveNodeDepth', () => {
  const nodes = [mk('root', '', 1), mk('child', 'root', 1), mk('grand', 'child', 1)]

  it('根为 0，逐层递增', () => {
    expect(resolveNodeDepth('root', nodes)).toBe(0)
    expect(resolveNodeDepth('child', nodes)).toBe(1)
    expect(resolveNodeDepth('grand', nodes)).toBe(2)
  })

  it('节点不存在时返回 0', () => {
    expect(resolveNodeDepth('nope', nodes)).toBe(0)
  })

  it('父链断裂（父不存在）视为根', () => {
    const broken = [mk('orphan', 'ghost', 1)]
    expect(resolveNodeDepth('orphan', broken)).toBe(0)
  })

  it('数据成环时不无限递归', () => {
    const cyclic = [mk('a', 'b', 1), mk('b', 'a', 1)]
    const depth = resolveNodeDepth('a', cyclic)
    expect(Number.isFinite(depth)).toBe(true)
    expect(depth).toBeLessThanOrEqual(MAX_DEPTH)
  })

  it('自指（parent 指向自身）也停在当前层', () => {
    expect(resolveNodeDepth('self', [mk('self', 'self', 1)])).toBe(0)
  })
})

describe('outlineDerive / resolveSiblingIndex', () => {
  const nodes = [mk('a', '', 2), mk('b', '', 1), mk('c', '', 3)]

  it('按 order 排序后的 1 基下标', () => {
    expect(resolveSiblingIndex('b', nodes)).toBe(1)
    expect(resolveSiblingIndex('a', nodes)).toBe(2)
    expect(resolveSiblingIndex('c', nodes)).toBe(3)
  })

  it('节点不存在返回 0', () => {
    expect(resolveSiblingIndex('nope', nodes)).toBe(0)
  })
})

describe('outlineDerive / resolveNodeNumbering', () => {
  it('产出自根到自身的序号链', () => {
    const nodes = [
      mk('v1', '', 1), mk('v2', '', 2),
      mk('c1', 'v2', 1), mk('c2', 'v2', 2),
      mk('g1', 'c2', 1),
    ]
    expect(resolveNodeNumbering('v1', nodes)).toEqual([1])
    expect(resolveNodeNumbering('c2', nodes)).toEqual([2, 2])
    expect(resolveNodeNumbering('g1', nodes)).toEqual([2, 2, 1])
  })

  it('成环时截断且不死循环', () => {
    const cyclic = [mk('a', 'b', 1), mk('b', 'a', 1)]
    const chain = resolveNodeNumbering('a', cyclic)
    expect(chain.length).toBeLessThanOrEqual(MAX_DEPTH)
  })
})

describe('outlineDerive / collectDescendantIds', () => {
  it('收集全部后代且不含自身', () => {
    const nodes = [mk('a', '', 1), mk('b', 'a', 1), mk('c', 'b', 1), mk('d', 'a', 2)]
    const ids = collectDescendantIds('a', nodes)
    expect(ids.sort()).toEqual(['b', 'c', 'd'])
  })

  it('成环时不重复收集（seen 去重）', () => {
    const cyclic = [mk('a', 'b', 1), mk('b', 'a', 1)]
    const ids = collectDescendantIds('a', cyclic)
    expect(ids).toEqual(['b'])
  })
})
