/**
 * 关系路径搜索：在关系核心内做无向 BFS 最短路。
 *
 * 实体之间只有「有/无关系」两种事实，边的方向语义不参与寻路；关系数量增长时
 * BFS 仍是 O(V+E)，不需要引入额外图算法依赖。
 */
import type { OverviewEdge } from './types'

export interface GraphPath {
  nodeIds: string[]
  edgeIds: string[]
  /** 经过的关系数 */
  hops: number
}

export function findShortestPath(
  edges: OverviewEdge[],
  fromId: string,
  toId: string,
): GraphPath | null {
  if (!fromId || !toId) return null
  if (fromId === toId) return { nodeIds: [fromId], edgeIds: [], hops: 0 }

  const adjacency = new Map<string, { to: string; edgeId: string }[]>()
  const link = (from: string, to: string, edgeId: string): void => {
    const list = adjacency.get(from)
    if (list) list.push({ to, edgeId })
    else adjacency.set(from, [{ to, edgeId }])
  }
  for (const edge of edges) {
    link(edge.source, edge.target, edge.id)
    link(edge.target, edge.source, edge.id)
  }

  const previous = new Map<string, { nodeId: string; edgeId: string }>()
  const visited = new Set<string>([fromId])
  const queue = [fromId]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    if (current === toId) break
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next.to)) continue
      visited.add(next.to)
      previous.set(next.to, { nodeId: current, edgeId: next.edgeId })
      queue.push(next.to)
    }
  }
  if (!visited.has(toId)) return null

  const nodeIds = [toId]
  const edgeIds: string[] = []
  let cursor = toId
  while (cursor !== fromId) {
    const step = previous.get(cursor)
    if (!step) return null
    edgeIds.push(step.edgeId)
    nodeIds.push(step.nodeId)
    cursor = step.nodeId
  }
  nodeIds.reverse()
  edgeIds.reverse()
  return { nodeIds, edgeIds, hops: edgeIds.length }
}
