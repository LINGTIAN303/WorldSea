/**
 * 本文件于 Phase 3 从 src/plugins/official/mindmap/composables/useRustGraphAnalysis.ts 迁移到 apps/tauri/src/plugins/mindmap/composables/useRustGraphAnalysis.ts
 * 端分离：Tauri 端专用（依赖 @tauri-apps/api）
 */

/** Rust 图分析算法桥接（Tauri invoke → worldsmith-core，Web 回退 JS），详细见 docs/details/注释/tauri/useRustGraphAnalysis.md */
import { invoke } from '@tauri-apps/api/core'
import type { GraphNode, GraphEdge } from '@worldsmith/canvas-engine'

function isTauriAvailable(): boolean {
  try {
    return !!window.__TAURI_INTERNALS__ || !!window.__TAURI__
  } catch {
    return false
  }
}

function buildWeightedGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Record<string, unknown> {
  const adjacency: Record<string, Array<{ target: string; weight: number; label?: string }>> = {}
  for (const n of nodes) adjacency[n.id] = []
  for (const e of edges) {
    if (!adjacency[e.source]) adjacency[e.source] = []
    if (!adjacency[e.target]) adjacency[e.target] = []
    adjacency[e.source].push({ target: e.target, weight: 1, label: e.relLabel })
    if (e.bidirectional || e.symmetric) {
      adjacency[e.target].push({ target: e.source, weight: 1, label: e.relLabel })
    }
  }
  return { adjacency }
}

export function useRustGraphAnalysis() {
  /**
   * Dijkstra 最短路径
   */
  async function findShortestPath(
    nodes: GraphNode[],
    edges: GraphEdge[],
    sourceId: string,
    targetId: string,
  ): Promise<string[]> {
    if (!isTauriAvailable()) {
      return bfsShortestPath(nodes, edges, sourceId, targetId)
    }
    const graph = buildWeightedGraph(nodes, edges)
    try {
      const result: any = await invoke('cmd_algo_dijkstra_path', {
        graphJson: JSON.stringify(graph),
        source: sourceId,
        target: targetId,
      })
      if (result?.found) return result.path
      return []
    } catch {
      return bfsShortestPath(nodes, edges, sourceId, targetId)
    }
  }

  /**
   * 连通分量
   */
  async function findConnectedComponents(
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): Promise<string[][]> {
    if (!isTauriAvailable()) {
      return bfsComponents(nodes, edges)
    }
    const graph = buildWeightedGraph(nodes, edges)
    try {
      const result: any = await invoke('cmd_algo_connected_components', {
        graphJson: JSON.stringify(graph),
      })
      return result?.components || []
    } catch {
      return bfsComponents(nodes, edges)
    }
  }

  /**
   * 查找悬空节点（无连接的节点）
   */
  async function findIsolatedNodes(
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): Promise<string[]> {
    const connected = new Set<string>()
    for (const e of edges) {
      connected.add(e.source)
      connected.add(e.target)
    }
    return nodes.filter(n => !connected.has(n.id)).map(n => n.id)
  }

  /**
   * PageRank
   */
  async function computePageRank(
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): Promise<Map<string, number>> {
    if (!isTauriAvailable()) {
      return simplePageRank(nodes, edges)
    }
    const graph = buildWeightedGraph(nodes, edges)
    try {
      const result: any = await invoke('cmd_algo_pagerank', {
        graphJson: JSON.stringify(graph),
        damping: 0.85,
        maxIterations: 100,
        tolerance: 1e-6,
      })
      const scores = new Map<string, number>()
      if (result?.scores) {
        for (const [id, score] of Object.entries(result.scores)) {
          scores.set(id, score as number)
        }
      }
      return scores
    } catch {
      return simplePageRank(nodes, edges)
    }
  }

  /**
   * 社区检测 (Louvain)
   */
  async function detectCommunities(
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): Promise<Map<string, string[]>> {
    if (!isTauriAvailable()) {
      return simpleCommunities(nodes, edges)
    }
    const graph = buildWeightedGraph(nodes, edges)
    try {
      const result: any = await invoke('cmd_algo_community_detection', {
        graphJson: JSON.stringify(graph),
      })
      const communities = new Map<string, string[]>()
      if (result?.communities) {
        for (const c of result.communities) {
          communities.set(`community-${c.id}`, c.members)
        }
      }
      return communities
    } catch {
      return simpleCommunities(nodes, edges)
    }
  }

  return {
    findShortestPath,
    findConnectedComponents,
    findIsolatedNodes,
    computePageRank,
    detectCommunities,
  }
}

// ==========================================================================
// JS Fallback 实现
// ==========================================================================

function bfsShortestPath(
  nodes: GraphNode[],
  edges: GraphEdge[],
  sourceId: string,
  targetId: string,
): string[] {
  if (sourceId === targetId) return [sourceId]
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    adj.get(e.source)?.push(e.target)
    if (e.bidirectional || e.symmetric) {
      adj.get(e.target)?.push(e.source)
    }
  }
  if (!adj.has(sourceId) || !adj.has(targetId)) return []
  const prev = new Map<string, string>()
  const visited = new Set([sourceId])
  const queue = [sourceId]
  while (queue.length > 0) {
    const u = queue.shift()!
    if (u === targetId) break
    for (const v of adj.get(u) || []) {
      if (visited.has(v)) continue
      visited.add(v)
      prev.set(v, u)
      queue.push(v)
    }
  }
  if (!prev.has(targetId)) return []
  const path = [targetId]
  let cur: string | undefined = targetId
  while (cur && cur !== sourceId) {
    cur = prev.get(cur)
    if (cur) path.unshift(cur)
  }
  return path[0] === sourceId ? path : []
}

function bfsComponents(
  nodes: GraphNode[],
  edges: GraphEdge[],
): string[][] {
  const adj = new Map<string, string[]>()
  const nodeIds = new Set(nodes.map(n => n.id))
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue
    adj.get(e.source)?.push(e.target)
    adj.get(e.target)?.push(e.source)
  }
  const visited = new Set<string>()
  const components: string[][] = []
  for (const id of nodeIds) {
    if (visited.has(id)) continue
    const comp: string[] = []
    const queue = [id]
    visited.add(id)
    while (queue.length > 0) {
      const u = queue.shift()!
      comp.push(u)
      for (const v of adj.get(u) || []) {
        if (!visited.has(v)) {
          visited.add(v)
          queue.push(v)
        }
      }
    }
    components.push(comp)
  }
  return components
}

function simplePageRank(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, number> {
  const scores = new Map<string, number>()
  const n = nodes.length
  if (n === 0) return scores

  for (const nd of nodes) scores.set(nd.id, 1.0 / n)

  const outEdges = new Map<string, string[]>()
  const inEdges = new Map<string, string[]>()
  for (const nd of nodes) {
    outEdges.set(nd.id, [])
    inEdges.set(nd.id, [])
  }
  for (const e of edges) {
    outEdges.get(e.source)?.push(e.target)
    inEdges.get(e.target)?.push(e.source)
  }

  const damping = 0.85
  for (let iter = 0; iter < 20; iter++) {
    const newScores = new Map<string, number>()
    for (const nd of nodes) {
      let rank = 0
      for (const src of inEdges.get(nd.id) || []) {
        const out = outEdges.get(src) || []
        if (out.length > 0) rank += (scores.get(src) || 0) / out.length
      }
      newScores.set(nd.id, (1 - damping) / n + damping * rank)
    }
    // copy newScores → scores
    for (const [k, v] of newScores) scores.set(k, v)
  }
  return scores
}

function simpleCommunities(
  _nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, string[]> {
  // 简化版：按连通分量作为社区
  const nodeSet = new Set<string>()
  for (const e of edges) { nodeSet.add(e.source); nodeSet.add(e.target) }
  const allNodes = [...nodeSet]

  const adj = new Map<string, string[]>()
  for (const id of allNodes) adj.set(id, [])
  for (const e of edges) {
    adj.get(e.source)?.push(e.target)
    adj.get(e.target)?.push(e.source)
  }

  const visited = new Set<string>()
  const communities = new Map<string, string[]>()
  let communityId = 0

  for (const id of allNodes) {
    if (visited.has(id)) continue
    const members: string[] = []
    const queue = [id]
    visited.add(id)
    while (queue.length > 0) {
      const u = queue.shift()!
      members.push(u)
      for (const v of adj.get(u) || []) {
        if (!visited.has(v)) { visited.add(v); queue.push(v) }
      }
    }
    communities.set(`community-${communityId++}`, members)
  }
  return communities
}
