import type { CanvasNode, CanvasEdge } from './canvasTypes'

/** 找出图中所有孤立节点（没有任何边） */
export function findIsolatedNodes(nodes: CanvasNode[], edges: CanvasEdge[]): string[] {
  const connected = new Set<string>()
  for (const e of edges) {
    if (e.hidden) continue
    connected.add(e.source)
    connected.add(e.target)
  }
  return nodes.filter(n => !n.hidden && !connected.has(n.id)).map(n => n.id)
}

/** 找出图中的所有简单环（DFS 限制深度 6） */
export function findCycles(nodes: CanvasNode[], edges: CanvasEdge[], maxDepth = 6): string[][] {
  const adj = new Map<string, string[]>()
  for (const n of nodes) if (!n.hidden) adj.set(n.id, [])
  for (const e of edges) {
    if (e.hidden) continue
    if (!adj.has(e.source) || !adj.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    if (!e.directional) adj.get(e.target)!.push(e.source)
  }
  const cycles: string[][] = []
  const seenCycles = new Set<string>()
  const startNodes = [...adj.keys()]
  for (const start of startNodes) {
    const stack: Array<{ node: string; path: string[] }> = [{ node: start, path: [start] }]
    while (stack.length > 0) {
      const { node, path } = stack.pop()!
      if (path.length > maxDepth) continue
      for (const next of adj.get(node) || []) {
        if (next === start && path.length >= 2) {
          const sorted = [...path].sort().join(',')
          if (!seenCycles.has(sorted)) {
            seenCycles.add(sorted)
            cycles.push([...path])
          }
          continue
        }
        if (path.includes(next)) continue  // 防已访问非起点
        stack.push({ node: next, path: [...path, next] })
      }
    }
  }
  return cycles
}

/** BFS 最短路径（无权重） */
export function findShortestPath(nodes: CanvasNode[], edges: CanvasEdge[], sourceId: string, targetId: string): string[] | null {
  if (sourceId === targetId) return [sourceId]
  const adj = new Map<string, string[]>()
  for (const n of nodes) if (!n.hidden) adj.set(n.id, [])
  for (const e of edges) {
    if (e.hidden) continue
    if (!adj.has(e.source) || !adj.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    if (!e.directional) adj.get(e.target)!.push(e.source)
  }
  if (!adj.has(sourceId) || !adj.has(targetId)) return null
  const prev = new Map<string, string>()
  const visited = new Set<string>([sourceId])
  const queue: string[] = [sourceId]
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
  if (!prev.has(targetId)) return null
  const path: string[] = [targetId]
  let cur: string | undefined = targetId
  while (cur !== undefined && cur !== sourceId) {
    cur = prev.get(cur)
    if (cur) path.unshift(cur)
  }
  return path[0] === sourceId ? path : null
}
