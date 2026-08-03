import type { EvoNode, EvoEdge } from './useEvolutionTreeData'

export type EvoLayoutMode = 'top-down' | 'radial'

export function useEvolutionTreeLayout() {
  function layoutTopDown(nodes: EvoNode[], edges: EvoEdge[]): void {
    if (nodes.length === 0) return

    const ancestorEdges = edges.filter(e => e.relation === '祖先' || e.relation === '进化')
    const hybridEdges = edges.filter(e => e.relation === '杂交')

    const inDegree = new Map<string, number>()
    for (const n of nodes) inDegree.set(n.id, 0)

    for (const e of ancestorEdges) {
      inDegree.set(e.targetId, (inDegree.get(e.targetId) || 0) + 1)
    }

    for (const e of hybridEdges) {
      inDegree.set(e.targetId, (inDegree.get(e.targetId) || 0) + 1)
      inDegree.set(e.sourceId, (inDegree.get(e.sourceId) || 0) + 1)
    }

    const layers = new Map<string, number>()
    const visited = new Set<string>()
    const queue: string[] = []

    for (const n of nodes) {
      if ((inDegree.get(n.id) || 0) === 0) {
        layers.set(n.id, 0)
        queue.push(n.id)
      }
    }

    const adj = new Map<string, string[]>()
    for (const n of nodes) adj.set(n.id, [])
    for (const e of ancestorEdges) {
      adj.get(e.sourceId)?.push(e.targetId)
    }
    for (const e of hybridEdges) {
      adj.get(e.sourceId)?.push(e.targetId)
      adj.get(e.targetId)?.push(e.sourceId)
    }

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      const currentLayer = layers.get(current) || 0

      for (const neighbor of (adj.get(current) || [])) {
        const targetLayer = currentLayer + 1
        const existing = layers.get(neighbor) || 0
        layers.set(neighbor, Math.max(existing, targetLayer))
        queue.push(neighbor)
      }
    }

    for (const n of nodes) {
      if (!layers.has(n.id)) layers.set(n.id, 0)
    }

    const layerGroups = new Map<number, EvoNode[]>()
    for (const n of nodes) {
      const layer = layers.get(n.id) || 0
      if (!layerGroups.has(layer)) layerGroups.set(layer, [])
      layerGroups.get(layer)!.push(n)
    }

    const layerH = 130
    const nodeW = 120

    for (const [, layerNodes] of layerGroups) {
      layerNodes.sort((a, b) => a.speciesType.localeCompare(b.speciesType))
    }

    const sortedLayers = [...layerGroups.entries()].sort((a, b) => a[0] - b[0])

    for (const [layerIdx, layerNodes] of sortedLayers) {
      const totalWidth = (layerNodes.length - 1) * nodeW
      const startX = -totalWidth / 2
      const y = layerIdx * layerH
      for (let i = 0; i < layerNodes.length; i++) {
        layerNodes[i].x = startX + i * nodeW
        layerNodes[i].y = y
      }
    }
  }

  function layoutRadial(nodes: EvoNode[], edges: EvoEdge[]): void {
    if (nodes.length === 0) return

    const allEdges = edges
    const connCount = new Map<string, number>()
    for (const n of nodes) connCount.set(n.id, 0)
    for (const e of allEdges) {
      connCount.set(e.sourceId, (connCount.get(e.sourceId) || 0) + 1)
      connCount.set(e.targetId, (connCount.get(e.targetId) || 0) + 1)
    }

    let centerId = nodes[0].id
    let maxConn = 0
    for (const [id, count] of connCount) {
      if (count > maxConn) { maxConn = count; centerId = id }
    }

    const dist = new Map<string, number>()
    const visited = new Set<string>()
    const queue: [string, number][] = [[centerId, 0]]
    dist.set(centerId, 0)

    const adj = new Map<string, string[]>()
    for (const n of nodes) adj.set(n.id, [])
    for (const e of allEdges) {
      adj.get(e.sourceId)?.push(e.targetId)
      adj.get(e.targetId)?.push(e.sourceId)
    }

    while (queue.length > 0) {
      const [current, d] = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      dist.set(current, d)
      for (const neighbor of (adj.get(current) || [])) {
        if (!visited.has(neighbor)) {
          queue.push([neighbor, d + 1])
        }
      }
    }

    for (const n of nodes) {
      if (!dist.has(n.id)) dist.set(n.id, 999)
    }

    const ringGroups = new Map<number, EvoNode[]>()
    for (const n of nodes) {
      const d = dist.get(n.id) || 0
      if (!ringGroups.has(d)) ringGroups.set(d, [])
      ringGroups.get(d)!.push(n)
    }

    const ringSpacing = 160
    for (const [ringIdx, ringNodes] of ringGroups) {
      if (ringIdx === 0) {
        ringNodes[0].x = 0
        ringNodes[0].y = 0
        continue
      }
      const angleStep = (2 * Math.PI) / ringNodes.length
      const radius = ringIdx * ringSpacing
      for (let i = 0; i < ringNodes.length; i++) {
        const angle = angleStep * i - Math.PI / 2
        ringNodes[i].x = Math.cos(angle) * radius
        ringNodes[i].y = Math.sin(angle) * radius
      }
    }
  }

  function applyLayout(nodes: EvoNode[], edges: EvoEdge[], mode: EvoLayoutMode): void {
    if (mode === 'top-down') {
      layoutTopDown(nodes, edges)
    } else {
      layoutRadial(nodes, edges)
    }
  }

  return { applyLayout }
}
