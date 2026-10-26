import { describe, expect, it } from 'vitest'
import { analyzeOverview } from '../model/overview'
import type { EntityNodeInput, RelationEdgeInput } from '../model/types'

const META = (type: string) => {
  const labels: Record<string, string> = { character: '角色', concept: '概念', region: '区域' }
  const shapes: Record<string, string> = { character: 'round-rectangle', concept: 'ellipse', region: 'round-triangle' }
  return { label: labels[type] ?? type, icon: type, shape: shapes[type] ?? 'ellipse' }
}

function node(id: string, type: string, degree = 0): EntityNodeInput {
  return { id, name: id, type, label: type, icon: type, shape: 'ellipse', tags: [], description: '', degree }
}

function edge(id: string, source: string, target: string, relType = 'knows'): RelationEdgeInput {
  return {
    id, source, target, relType, relLabel: relType, bidirectional: false, symmetric: false,
    noArrow: false, dashed: false, relationIds: [id],
  }
}

describe('analyzeOverview', () => {
  it('关系核心只收有关系的节点，孤立节点按类型成星座', () => {
    const nodes = [
      node('a', 'character', 2), node('b', 'character', 1), node('c', 'concept', 1),
      node('d', 'concept'), node('e', 'concept'), node('f', 'region'),
    ]
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]
    const overview = analyzeOverview(nodes, edges, META)

    expect(overview.stats).toMatchObject({
      entities: 6, relations: 2, connected: 3, isolated: 3, types: 3, components: 1,
    })
    expect(overview.stats.connectedRatio).toBeCloseTo(0.5)

    const core = overview.groups.find(g => g.kind === 'core')
    expect(core?.nodeIds.sort()).toEqual(['a', 'b', 'c'])

    const islands = overview.groups.filter(g => g.kind === 'island')
    expect(islands.map(g => [g.type, g.count])).toEqual([['concept', 2], ['region', 1]])
    expect(islands[0]!.id).toBe('island:concept')
    expect(islands[0]!.label).toBe('概念')
  })

  it('边只统计两端都存在的记录，关系族被推导', () => {
    const nodes = [node('a', 'character'), node('b', 'region')]
    const edges = [edge('e1', 'a', 'b', 'located_in'), edge('e2', 'a', 'missing', 'knows')]
    const overview = analyzeOverview(nodes, edges, META)
    expect(overview.stats.relations).toBe(1)
    expect(overview.edges[0]!.family).toBe('spatial')
  })

  it('空数据返回空结构', () => {
    const overview = analyzeOverview([], [], META)
    expect(overview.nodes).toEqual([])
    expect(overview.groups).toEqual([])
    expect(overview.stats.entities).toBe(0)
    expect(overview.stats.connectedRatio).toBe(0)
  })
})
