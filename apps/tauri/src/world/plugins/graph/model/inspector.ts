/**
 * 实体检查器的关系行（2026-10-26 重构）。
 *
 * 从总览边集里取与当前实体相连的边，方向以「当前实体 → 对方」为语义；
 * 纯函数，便于检查器直测与后续路径/关系面板复用。
 */
import type { EdgeFamily, Overview, OverviewNode } from './types'

export interface InspectorRelation {
  edgeId: string
  relType: string
  relLabel: string
  family: EdgeFamily
  direction: 'out' | 'in' | 'self'
  otherId: string
  otherName: string
  otherTypeLabel: string
  otherIcon: string
}

export function buildInspectorRelations(
  nodeId: string,
  overview: Overview,
): InspectorRelation[] {
  const nodeMap = new Map<string, OverviewNode>(overview.nodes.map(node => [node.id, node]))
  const rows: InspectorRelation[] = []

  for (const edge of overview.edges) {
    const outgoing = edge.source === nodeId
    const incoming = edge.target === nodeId
    if (!outgoing && !incoming) continue
    const otherId = outgoing ? edge.target : edge.source
    const other = nodeMap.get(otherId)
    if (!other) continue
    rows.push({
      edgeId: edge.id,
      relType: edge.relType,
      relLabel: edge.relLabel || edge.relType,
      family: edge.family,
      direction: outgoing && incoming ? 'self' : outgoing ? 'out' : 'in',
      otherId,
      otherName: other.name,
      otherTypeLabel: other.typeLabel,
      otherIcon: other.typeIcon,
    })
  }

  const familyOrder: EdgeFamily[] = ['structural', 'social', 'spatial', 'causal', 'narrative', 'other']
  return rows.sort((a, b) =>
    familyOrder.indexOf(a.family) - familyOrder.indexOf(b.family)
    || a.relLabel.localeCompare(b.relLabel)
    || a.otherName.localeCompare(b.otherName),
  )
}
