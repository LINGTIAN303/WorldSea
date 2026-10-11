import type { Relation } from '../types'
import { inverseRegistry } from '../core'

export interface MergedEdge {
  id: string
  source: string
  target: string
  relType: string
  relLabel: string
  bidirectional: boolean
  symmetric: boolean
  relationIds: string[]
}

export function deduplicateEdges(
  relations: Relation[],
  getLabel: (type: string) => string
): MergedEdge[] {
  const pairMap = new Map<string, MergedEdge>()

  for (const r of relations) {
    const key = [r.sourceId, r.targetId].sort().join('::')
    const existing = pairMap.get(key)

    if (!existing) {
      const sym = inverseRegistry.isSymmetric(r.type)
      pairMap.set(key, {
        id: r.id,
        source: r.sourceId,
        target: r.targetId,
        relType: r.type,
        relLabel: getLabel(r.type),
        bidirectional: false,
        symmetric: sym,
        relationIds: [r.id],
      })
    } else {
      existing.bidirectional = true
      existing.relationIds.push(r.id)
      if (!existing.relLabel.includes(getLabel(r.type))) {
        existing.relLabel = existing.relLabel + ' / ' + getLabel(r.type)
      }
    }
  }

  return Array.from(pairMap.values())
}
