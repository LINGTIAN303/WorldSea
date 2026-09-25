/**
 * scopeNodes 单测 —— 统计类表现形式（线索式 / 进度式）的「范围解析」纯函数。
 *
 * 重点守两件事：
 * ① `scope='this'` 是**统计**口径（**含自身**），与树式的**列举**口径（不含自身）不同；
 * ② 顺序必须是**语义顺序**（根 → 子，同级按 order），否则同一条线索的节点标签会跳来跳去。
 */
import { describe, it, expect } from 'vitest'
import { normalizeScope, nodeWordCount, resolveScopeNodes, sumWordCount } from '../board/forms/scopeNodes'

interface N {
  id: string
  name?: string
  properties: Record<string, unknown>
}

function node(id: string, parentId = '', extra: Record<string, unknown> = {}): N {
  return { id, name: `节点${id}`, properties: { parentId, order: 0, ...extra } }
}

describe('scopeNodes / 范围解析', () => {
  // 卷1 ─ 章1 ─ 场1
  //     └ 章2
  // 卷2
  const nodes: N[] = [
    node('卷2', '', { order: 2 }),
    node('章2', '卷1', { order: 2 }),
    node('卷1', '', { order: 1 }),
    node('场1', '章1', { order: 1 }),
    node('章1', '卷1', { order: 1 }),
  ]

  it('all：按语义顺序（根 → 子，同级按 order），与 store 中的乱序无关', () => {
    expect(resolveScopeNodes(nodes, 'all').map(n => n.id)).toEqual(['卷1', '章1', '场1', '章2', '卷2'])
  })

  it('this：含自身 + 整棵子树（统计口径）', () => {
    expect(resolveScopeNodes(nodes, 'this', '卷1').map(n => n.id)).toEqual(['卷1', '章1', '场1', '章2'])
  })

  it('this：叶子节点只返回自身（不像树式那样返回空）', () => {
    expect(resolveScopeNodes(nodes, 'this', '场1').map(n => n.id)).toEqual(['场1'])
  })

  it('this：rootId 缺失或不在集合内 → 退化为「全部」而不是空集', () => {
    const all = resolveScopeNodes(nodes, 'all').map(n => n.id)
    expect(resolveScopeNodes(nodes, 'this').map(n => n.id)).toEqual(all)
    expect(resolveScopeNodes(nodes, 'this', '不存在').map(n => n.id)).toEqual(all)
  })

  it('断链节点（父 id 指向集合外）视为根，补在末尾而不是丢失', () => {
    const ids = resolveScopeNodes([...nodes, node('孤儿', '已删除的父')], 'all').map(n => n.id)
    expect(ids).toContain('孤儿')
    expect(ids[ids.length - 1]).toBe('孤儿')
  })

  it('数据成环时不重复入列、不死循环', () => {
    const ids = resolveScopeNodes([node('a', 'b'), node('b', 'a')], 'all').map(n => n.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('normalizeScope：只认 this，其余一律 all', () => {
    expect(normalizeScope('this')).toBe('this')
    expect(normalizeScope('all')).toBe('all')
    expect(normalizeScope(undefined)).toBe('all')
    expect(normalizeScope('乱值')).toBe('all')
  })
})

describe('scopeNodes / 字数', () => {
  it('nodeWordCount：非法值与负数按 0', () => {
    expect(nodeWordCount(node('a', '', { wordCount: 120 }))).toBe(120)
    expect(nodeWordCount(node('a', '', { wordCount: '80' }))).toBe(80)
    expect(nodeWordCount(node('a', '', { wordCount: -5 }))).toBe(0)
    expect(nodeWordCount(node('a', '', { wordCount: 'abc' }))).toBe(0)
    expect(nodeWordCount(node('a'))).toBe(0)
    expect(nodeWordCount(undefined)).toBe(0)
  })

  it('sumWordCount：范围内合计', () => {
    expect(sumWordCount([node('a', '', { wordCount: 100 }), node('b', '', { wordCount: 30 }), node('c')])).toBe(130)
  })
})
