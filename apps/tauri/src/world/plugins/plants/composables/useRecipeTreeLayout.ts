import type { RecipeNode, RecipeEdge } from './useRecipeTreeData'

export type RecipeLayoutMode = 'bottom-up' | 'radial'

export function useRecipeTreeLayout() {
  function layoutBottomUp(nodes: RecipeNode[], edges: RecipeEdge[]): void {
    if (nodes.length === 0) return

    const outDegree = new Map<string, number>()
    for (const n of nodes) outDegree.set(n.id, 0)
    for (const e of edges) {
      outDegree.set(e.sourceId, (outDegree.get(e.sourceId) || 0) + 1)
    }

    const layers = new Map<string, number>()
    const visited = new Set<string>()
    const queue: string[] = []

    for (const n of nodes) {
      if ((outDegree.get(n.id) || 0) === 0) {
        layers.set(n.id, 0)
        queue.push(n.id)
      }
    }

    const reverseAdj = new Map<string, string[]>()
    for (const n of nodes) reverseAdj.set(n.id, [])
    for (const e of edges) {
      reverseAdj.get(e.targetId)?.push(e.sourceId)
    }

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      const currentLayer = layers.get(current) || 0

      for (const source of (reverseAdj.get(current) || [])) {
        const targetLayer = currentLayer + 1
        const existing = layers.get(source) || 0
        layers.set(source, Math.max(existing, targetLayer))
        queue.push(source)
      }
    }

    for (const n of nodes) {
      if (!layers.has(n.id)) {
        layers.set(n.id, n.nodeType === 'plant' ? 0 : 1)
      }
    }

    const layerGroups = new Map<number, RecipeNode[]>()
    for (const n of nodes) {
      const layer = layers.get(n.id) || 0
      if (!layerGroups.has(layer)) layerGroups.set(layer, [])
      layerGroups.get(layer)!.push(n)
    }

    const layerH = 130
    const nodeW = 140

    for (const [, layerNodes] of layerGroups) {
      layerNodes.sort((a, b) => {
        if (a.nodeType !== b.nodeType) {
          const typeOrder: Record<string, number> = { 'plant': 0, 'item': 1, 'magic': 2 }
          return (typeOrder[a.nodeType] || 0) - (typeOrder[b.nodeType] || 0)
        }
        return a.subType.localeCompare(b.subType)
      })
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

  function layoutRadial(nodes: RecipeNode[], edges: RecipeEdge[]): void {
    if (nodes.length === 0) return

    const connCount = new Map<string, number>()
    for (const n of nodes) connCount.set(n.id, 0)
    for (const e of edges) {
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
    for (const e of edges) {
      adj.get(e.sourceId)?.push(e.targetId)
      adj.get(e.targetId)?.push(e.sourceId)
    }

    while (queue.length > 0) {
      const [current, d] = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      dist.set(current, d)
      for (const neighbor of (adj.get(current) || [])) {
        if (!visited.has(neighbor)) queue.push([neighbor, d + 1])
      }
    }

    for (const n of nodes) {
      if (!dist.has(n.id)) dist.set(n.id, 999)
    }

    const ringGroups = new Map<number, RecipeNode[]>()
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

  function applyLayout(nodes: RecipeNode[], edges: RecipeEdge[], mode: RecipeLayoutMode): void {
    if (mode === 'bottom-up') layoutBottomUp(nodes, edges)
    else layoutRadial(nodes, edges)
  }

  return { applyLayout }
}
