/**
 * 聚类展示策略 spec（2026-10-09 图谱改进批 E）。
 * 断言锚点：语义命名格式与兜底链（Top 度数 → tie 序先 → 无名 id → 空主导类型「未知」→ 空簇）、
 * 簇色映射（构建/同节点取先/空表）、悬停高亮集（null/成员）。
 */
import { describe, expect, it } from 'vitest'
import Graph from 'graphology'
import { clusterHighlightIds, clusterLabel, nodeClusterColorMap } from '../clusterPolicy'
import type { ClusterInfo } from '../composables/useGraphClustering'

function makeGraph(): Graph {
  const g = new Graph()
  // 度数：a=3 > b=2 = c=2 > d=1（b/c tie，序先取 b）
  g.addNode('a', { label: '庆晨' })
  g.addNode('b', { label: '庆国' })
  g.addNode('c', { label: '云溪' })
  g.addNode('d', { label: '北荒' })
  g.addNode('e') // 无 label
  g.addEdge('a', 'b')
  g.addEdge('a', 'c')
  g.addEdge('a', 'd')
  g.addEdge('b', 'c')
  return g
}

function cluster(id: string, color: string, nodeIds: string[]): ClusterInfo {
  return { id, label: '', color, nodeIds, size: nodeIds.length }
}

describe('clusterLabel / 语义命名', () => {
  it('格式「主导类型·Top 成员名 (N)」，Top = 簇内度数最高者', () => {
    expect(clusterLabel(makeGraph(), ['a', 'b', 'c', 'd'], '城邦')).toBe('城邦·庆晨 (4)')
  })

  it('度数 tie 取序先（b/c 同为 2，取 b）', () => {
    expect(clusterLabel(makeGraph(), ['b', 'c'], '部族')).toBe('部族·庆国 (2)')
  })

  it('Top 节点无 label 兜底用 id', () => {
    expect(clusterLabel(makeGraph(), ['e'], '散点')).toBe('散点·e (1)')
  })

  it('簇内节点不在图中按度 0 处理，不抛错', () => {
    expect(clusterLabel(makeGraph(), ['ghost', 'a'], '城邦')).toBe('城邦·庆晨 (2)')
  })

  it('主导类型为空 → 「未知」', () => {
    expect(clusterLabel(makeGraph(), ['a'], '')).toBe('未知·庆晨 (1)')
  })

  it('空簇 → 只显主导类型', () => {
    expect(clusterLabel(makeGraph(), [], '城邦')).toBe('城邦 (0)')
  })
})

describe('nodeClusterColorMap / 簇色映射', () => {
  it('构建 nodeId → 簇色', () => {
    const map = nodeClusterColorMap([cluster('c1', '#4fc3f7', ['a', 'b']), cluster('c2', '#7c4dff', ['c'])])
    expect(map.get('a')).toBe('#4fc3f7')
    expect(map.get('b')).toBe('#4fc3f7')
    expect(map.get('c')).toBe('#7c4dff')
    expect(map.size).toBe(3)
  })

  it('同节点多簇取先（WASM 社区互斥的防御）', () => {
    const map = nodeClusterColorMap([cluster('c1', '#4fc3f7', ['a']), cluster('c2', '#7c4dff', ['a', 'b'])])
    expect(map.get('a')).toBe('#4fc3f7')
    expect(map.get('b')).toBe('#7c4dff')
  })

  it('空簇表 → 空 Map', () => {
    expect(nodeClusterColorMap([]).size).toBe(0)
  })
})

describe('clusterHighlightIds / 悬停高亮集', () => {
  it('null → 空集（离开簇项恢复）', () => {
    expect(clusterHighlightIds(null).size).toBe(0)
  })

  it('簇 → 成员 id 集', () => {
    expect(clusterHighlightIds(cluster('c1', '#4fc3f7', ['a', 'b']))).toEqual(new Set(['a', 'b']))
  })
})
