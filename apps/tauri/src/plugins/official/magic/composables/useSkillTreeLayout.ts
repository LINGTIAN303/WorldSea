import type { SkillNode, SkillEdge } from './useSkillTreeData'

export type LayoutMode = 'bottom-up' | 'radial'

export function useSkillTreeLayout() {
  function layoutBottomUp(nodes: SkillNode[], edges: SkillEdge[]): void {
    const upgradeEdges = edges.filter(e => e.type === 'upgrades_to')
    const inDegree = new Map<string, number>()
    for (const n of nodes) inDegree.set(n.id, 0)
    for (const e of upgradeEdges) {
      inDegree.set(e.targetId, (inDegree.get(e.targetId) || 0) + 1)
    }

    const layers: Map<string, number> = new Map()
    const visited = new Set<string>()
    const queue: string[] = []

    for (const n of nodes) {
      if ((inDegree.get(n.id) || 0) === 0) {
        layers.set(n.id, 0)
        queue.push(n.id)
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      const currentLayer = layers.get(current) || 0

      for (const e of upgradeEdges) {
        if (e.sourceId === current) {
          const targetLayer = currentLayer + 1
          const existing = layers.get(e.targetId) || 0
          layers.set(e.targetId, Math.max(existing, targetLayer))
          queue.push(e.targetId)
        }
      }
    }

    for (const n of nodes) {
      if (!layers.has(n.id)) layers.set(n.id, 0)
    }

    const layerGroups = new Map<number, SkillNode[]>()
    for (const n of nodes) {
      const layer = layers.get(n.id) || 0
      if (!layerGroups.has(layer)) layerGroups.set(layer, [])
      layerGroups.get(layer)!.push(n)
    }

    const layerH = 120
    const nodeW = 100
    const sortedLayers = [...layerGroups.entries()].sort((a, b) => a[0] - b[0])
    const maxLayer = sortedLayers.length

    for (const [, layerNodes] of sortedLayers) {
      layerNodes.sort((a, b) => a.magicType.localeCompare(b.magicType))
    }

    for (const [layerIdx, layerNodes] of sortedLayers) {
      const totalWidth = (layerNodes.length - 1) * nodeW
      const startX = -totalWidth / 2
      const y = (maxLayer - 1 - layerIdx) * layerH
      for (let i = 0; i < layerNodes.length; i++) {
        layerNodes[i].x = startX + i * nodeW
        layerNodes[i].y = y
      }
    }
  }

  function layoutRadial(nodes: SkillNode[], edges: SkillEdge[]): void {
    if (nodes.length === 0) return

    const allEdges = edges.filter(e => e.type === 'upgrades_to' || e.type === 'counters')
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

    const ringGroups = new Map<number, SkillNode[]>()
    for (const n of nodes) {
      const d = dist.get(n.id) || 0
      if (!ringGroups.has(d)) ringGroups.set(d, [])
      ringGroups.get(d)!.push(n)
    }

    const ringSpacing = 150
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

  function applyLayout(nodes: SkillNode[], edges: SkillEdge[], mode: LayoutMode): void {
    if (mode === 'bottom-up') {
      layoutBottomUp(nodes, edges)
    } else {
      layoutRadial(nodes, edges)
    }
  }

  return { applyLayout }
}
