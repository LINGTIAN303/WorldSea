/**
 * 世界总览数据适配（2026-10-26 重构）。
 *
 * 输入是实体/关系 store 的节点与去重边；输出「关系核心 + 类型星座 + 统计」。
 * 关键取舍：关系核心只收有关系的实体，孤立实体按类型收进星座——这是数据现实（829 实体 /
 * 22 条关系）下唯一能读出世界结构的方式，而不是把所有点等权撒在画布上。
 */
import type {
  EntityNodeInput,
  Overview,
  OverviewEdge,
  OverviewGroup,
  OverviewNode,
  RelationEdgeInput,
  TypeMeta,
  TypeSummary,
} from './types'
import { familyOfRelation } from '../policy/edgeStyle'

const FALLBACK_META: TypeMeta = { label: '未分类', icon: 'circle', shape: 'ellipse' }

export function analyzeOverview(
  nodes: EntityNodeInput[],
  edges: RelationEdgeInput[],
  metaOf: (type: string) => TypeMeta,
): Overview {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const adjacency = new Map<string, Set<string>>()

  const validEdges = edges.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
  for (const edge of validEdges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set())
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set())
    adjacency.get(edge.source)!.add(edge.target)
    adjacency.get(edge.target)!.add(edge.source)
  }

  const connectedIds = new Set<string>()
  let components = 0
  for (const node of nodes) {
    if (!adjacency.has(node.id) || connectedIds.has(node.id)) continue
    components++
    const queue = [node.id]
    connectedIds.add(node.id)
    while (queue.length > 0) {
      const current = queue.pop()!
      for (const next of adjacency.get(current) ?? []) {
        if (connectedIds.has(next)) continue
        connectedIds.add(next)
        queue.push(next)
      }
    }
  }

  const typeTotals = new Map<string, { total: number; connected: number }>()
  for (const node of nodes) {
    const entry = typeTotals.get(node.type) ?? { total: 0, connected: 0 }
    entry.total++
    if (connectedIds.has(node.id)) entry.connected++
    typeTotals.set(node.type, entry)
  }

  const coreGroup: OverviewGroup | null = connectedIds.size > 0
    ? {
        id: 'core',
        kind: 'core',
        type: null,
        label: '关系核心',
        icon: 'graph',
        count: connectedIds.size,
        nodeIds: nodes.filter(n => connectedIds.has(n.id)).map(n => n.id),
      }
    : null

  const isolatedByType = new Map<string, string[]>()
  for (const node of nodes) {
    if (connectedIds.has(node.id)) continue
    const list = isolatedByType.get(node.type) ?? []
    list.push(node.id)
    isolatedByType.set(node.type, list)
  }

  const islands: OverviewGroup[] = [...isolatedByType.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([type, ids]) => {
      const meta = metaOf(type) ?? FALLBACK_META
      return {
        id: `island:${type}`,
        kind: 'island',
        type,
        label: meta.label || type,
        icon: meta.icon || 'circle',
        count: ids.length,
        nodeIds: ids,
      }
    })

  const groups = coreGroup ? [coreGroup, ...islands] : islands
  const groupByNode = new Map<string, string>()
  for (const group of groups) {
    for (const id of group.nodeIds) groupByNode.set(id, group.id)
  }

  const overviewNodes: OverviewNode[] = nodes.map(node => {
    const meta = metaOf(node.type) ?? FALLBACK_META
    const isolated = !connectedIds.has(node.id)
    return {
      ...node,
      groupId: groupByNode.get(node.id) ?? `island:${node.type}`,
      isolated,
      typeLabel: meta.label || node.label || node.type,
      typeIcon: meta.icon || node.icon || 'circle',
      typeShape: meta.shape || node.shape || 'ellipse',
    }
  })

  const overviewEdges: OverviewEdge[] = validEdges.map(edge => ({
    ...edge,
    family: familyOfRelation(edge.relType),
  }))

  const types: TypeSummary[] = [...typeTotals.entries()]
    .map(([type, counts]) => {
      const meta = metaOf(type) ?? FALLBACK_META
      return {
        type,
        label: meta.label || type,
        icon: meta.icon || 'circle',
        shape: meta.shape || 'ellipse',
        total: counts.total,
        connected: counts.connected,
        isolated: counts.total - counts.connected,
      }
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))

  const entities = nodes.length
  const connected = connectedIds.size
  return {
    nodes: overviewNodes,
    edges: overviewEdges,
    groups,
    types,
    stats: {
      entities,
      relations: validEdges.length,
      connected,
      isolated: entities - connected,
      types: types.length,
      components,
      connectedRatio: entities > 0 ? connected / entities : 0,
    },
  }
}
