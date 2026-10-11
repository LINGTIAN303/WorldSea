import { ref } from 'vue'
import Graph from 'graphology'
import { type WeightedGraph, getBackend } from '../core/backendProvider'
import type { GraphNode, GraphEdge } from '../graph/useGraphData'

export function graphToWeightedGraph(graph: Graph): WeightedGraph {
  const adjacency: Record<string, { target: string; weight: number; label?: string }[]> = {}
  for (const node of graph.nodes()) {
    adjacency[node] = []
  }
  for (const eid of graph.edges()) {
    const src = graph.source(eid)
    const tgt = graph.target(eid)
    if (!adjacency[src]) adjacency[src] = []
    if (!adjacency[tgt]) adjacency[tgt] = []
    adjacency[src].push({ target: tgt, weight: 1 })
    const reverseExists = adjacency[tgt].some(e => e.target === src)
    if (!reverseExists) {
      adjacency[tgt].push({ target: src, weight: 1 })
    }
  }
  return { adjacency }
}

export function useGraphAlgorithms() {
  /** WASM 后端状态：`null`＝未探测（提示条只在**真实降级**后出现——旧实现初值 js-fallback，
   *  未查先报「不可用」，2026-10-09 图谱批 B 修）；'wasm' 加权最短路；'js-fallback' 无权降级 */
  const backendUsed = ref<'wasm' | 'js-fallback' | null>(null)

  function buildGraph(nodes: GraphNode[], edges: GraphEdge[]): Graph {
    const g = new Graph({ multi: false })
    for (const n of nodes) {
      g.addNode(n.id, { type: n.type, name: n.name })
    }
    for (const e of edges) {
      if (g.hasNode(e.source) && g.hasNode(e.target)) {
        try {
          g.addEdge(e.source, e.target, {
            id: e.id,
            relType: e.relType,
          })
        } catch {
        }
      }
    }
    return g
  }

  async function shortestPath(graph: Graph, from: string, to: string): Promise<string[]> {
    try {
      const backend = getBackend()
      if (backend?.algoDijkstraPath) {
        const wg = graphToWeightedGraph(graph)
        const result = await backend.algoDijkstraPath(wg, from, to)
        // 有响应即算 wasm 生效（找不到路 ≠ 降级）；无权 JS 重试与 wasm 同图，重试无意义
        backendUsed.value = 'wasm'
        return result?.found ? result.path : []
      }
    } catch {
      console.warn('[useGraphAlgorithms] WASM 路径不可用，降级到 JS Dijkstra')
    }
    backendUsed.value = 'js-fallback'
    return dijkstraFallback(graph, from, to)
  }

  function dijkstraFallback(graph: Graph, from: string, to: string): string[] {
    if (!graph.hasNode(from) || !graph.hasNode(to)) return []
    if (from === to) return [from]
    const dist = new Map<string, number>()
    const prev = new Map<string, string | null>()
    const visited = new Set<string>()
    const queue: { id: string; d: number }[] = []
    dist.set(from, 0)
    queue.push({ id: from, d: 0 })
    while (queue.length) {
      queue.sort((a, b) => a.d - b.d)
      const { id: u } = queue.shift()!
      if (visited.has(u)) continue
      visited.add(u)
      if (u === to) break
      const du = dist.get(u) ?? 0
      const neighbors = typeof graph.neighbors === 'function' ? graph.neighbors(u) : []
      for (const v of neighbors) {
        if (visited.has(v)) continue
        const alt = du + 1
        if (!dist.has(v) || alt < (dist.get(v) ?? Infinity)) {
          dist.set(v, alt)
          prev.set(v, u)
          queue.push({ id: v, d: alt })
        }
      }
    }
    if (!dist.has(to)) return []
    const path: string[] = []
    let cur: string | null = to
    while (cur) {
      path.unshift(cur)
      cur = prev.get(cur) ?? null
    }
    return path
  }

  async function detectCommunities(graph: Graph): Promise<Map<string, string[]>> {
    const communities = new Map<string, string[]>()
    try {
      const backend = getBackend()
      if (backend?.algoCommunityDetection) {
        const wg = graphToWeightedGraph(graph)
        const result = await backend.algoCommunityDetection(JSON.stringify(wg))
        for (const comm of result.communities) {
          const key = String(comm.id)
          communities.set(key, comm.members)
        }
      }
    } catch {
      for (const node of graph.nodes()) {
        communities.set(node, [node])
      }
    }
    return communities
  }

  function getNeighbors(graph: Graph, nodeId: string, depth: number): string[] {
    const visited = new Set<string>([nodeId])
    let frontier = [nodeId]
    for (let d = 0; d < depth; d++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const neighbor of graph.neighbors(id)) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor)
            next.push(neighbor)
          }
        }
      }
      frontier = next
    }
    visited.delete(nodeId)
    return Array.from(visited)
  }

  function getDegree(graph: Graph, nodeId: string): number {
    return graph.degree(nodeId)
  }

  return {
    buildGraph,
    shortestPath,
    detectCommunities,
    getNeighbors,
    getDegree,
    backendUsed,
  }
}
