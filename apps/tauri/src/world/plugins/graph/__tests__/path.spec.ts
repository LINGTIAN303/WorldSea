import { describe, expect, it } from 'vitest'
import { findShortestPath } from '../model/path'
import type { OverviewEdge } from '../model/types'

function edge(id: string, source: string, target: string): OverviewEdge {
  return {
    id, source, target, relType: 'knows', relLabel: '认识', bidirectional: false, symmetric: false,
    noArrow: false, dashed: false, relationIds: [id], family: 'social',
  }
}

describe('findShortestPath', () => {
  it('链式关系返回节点与边的顺序链路', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')]
    const path = findShortestPath(edges, 'a', 'd')
    expect(path).not.toBeNull()
    expect(path!.nodeIds).toEqual(['a', 'b', 'c', 'd'])
    expect(path!.edgeIds).toEqual(['e1', 'e2', 'e3'])
    expect(path!.hops).toBe(3)
  })

  it('无向寻路：反向查询得到对称路径', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]
    const path = findShortestPath(edges, 'c', 'a')
    expect(path!.nodeIds).toEqual(['c', 'b', 'a'])
    expect(path!.edgeIds).toEqual(['e2', 'e1'])
  })

  it('多条路径时取跳数最少的一条', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'a', 'c')]
    const path = findShortestPath(edges, 'a', 'c')
    expect(path!.hops).toBe(1)
    expect(path!.edgeIds).toEqual(['e3'])
  })

  it('同节点返回 0 步', () => {
    const path = findShortestPath([edge('e1', 'a', 'b')], 'a', 'a')
    expect(path).toEqual({ nodeIds: ['a'], edgeIds: [], hops: 0 })
  })

  it('不连通时返回 null', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'c', 'd')]
    expect(findShortestPath(edges, 'a', 'd')).toBeNull()
  })

  it('空输入返回 null', () => {
    expect(findShortestPath([], '', 'a')).toBeNull()
    expect(findShortestPath([], 'a', '')).toBeNull()
    expect(findShortestPath([], 'a', 'b')).toBeNull()
  })
})
