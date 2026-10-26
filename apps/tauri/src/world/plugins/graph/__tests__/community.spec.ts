import { describe, expect, it } from 'vitest'
import { analyzeOverview } from '../model/overview'
import { detectCommunities } from '../model/community'
import type { EntityNodeInput, RelationEdgeInput } from '../model/types'

const META = (type: string) => ({ label: type, icon: type, shape: 'ellipse' })

function node(id: string, type = 'character'): EntityNodeInput {
  return { id, name: id, type, label: type, icon: type, shape: 'ellipse', tags: [], description: '', degree: 0 }
}

function edge(id: string, source: string, target: string): RelationEdgeInput {
  return {
    id, source, target, relType: 'knows', relLabel: '认识', bidirectional: false, symmetric: false,
    noArrow: false, dashed: false, relationIds: [id],
  }
}

describe('detectCommunities', () => {
  it('按连通分量划分，孤立实体被排除', () => {
    const overview = analyzeOverview(
      [node('a'), node('b'), node('c'), node('d'), node('e'), node('lonely')],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'd', 'e')],
      META,
    )
    const communities = detectCommunities(overview)
    expect(communities.map(c => c.size)).toEqual([3, 2])
    expect(communities.map(c => c.id)).toEqual(['community:1', 'community:2'])
    const covered = communities.flatMap(c => c.nodeIds).sort()
    expect(covered).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(covered).not.toContain('lonely')
  })

  it('社区命名取数量最多的实体类型', () => {
    const overview = analyzeOverview(
      [node('a', 'character'), node('b', 'character'), node('c', 'concept')],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
      META,
    )
    expect(detectCommunities(overview)[0].dominantType).toBe('character')
  })

  it('全孤立时没有社区', () => {
    const overview = analyzeOverview([node('a'), node('b')], [], META)
    expect(detectCommunities(overview)).toEqual([])
  })

  it('大分量拆分后不丢节点', () => {
    const SIZE = 15
    const ids = [
      ...Array.from({ length: SIZE }, (_, i) => `left-${i}`),
      ...Array.from({ length: SIZE }, (_, i) => `right-${i}`),
    ]
    const edges: RelationEdgeInput[] = []
    // 两个团各 15 节点、团内全连接，中间用一条桥边连成单个连通分量
    for (const prefix of ['left', 'right']) {
      for (let i = 0; i < SIZE; i++) {
        for (let j = i + 1; j < SIZE; j++) {
          edges.push(edge(`${prefix}-${i}-${j}`, `${prefix}-${i}`, `${prefix}-${j}`))
        }
      }
    }
    edges.push(edge('bridge', 'left-0', 'right-0'))

    const overview = analyzeOverview(ids.map(id => node(id)), edges, META)
    const communities = detectCommunities(overview)
    expect(communities.length).toBeGreaterThanOrEqual(2)
    const covered = communities.flatMap(c => c.nodeIds).sort()
    expect(covered).toEqual([...ids].sort())
    expect(new Set(covered).size).toBe(ids.length)
  })
})
