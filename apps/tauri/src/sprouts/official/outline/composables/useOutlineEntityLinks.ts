import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import { getNodeTypeInfo } from '@worldsea/entity-core'
import type { Relation } from '@worldsea/entity-core'

export interface EntityLinkBadge {
  type: string
  icon: string
  color: string
  count: number
}

export interface EntityLinkCard {
  id: string
  name: string
  type: string
  icon: string
  color: string
}

export interface EntityLinksGroup {
  type: string
  icon: string
  color: string
  label: string
  entities: EntityLinkCard[]
}

export function useOutlineEntityLinks() {
  const es = useEntityStore()
  const rs = useRelationStore()

  function getRelationsForNode(nodeId: string): Relation[] {
    return rs.relations.filter(
      r => (r.sourceId === nodeId || r.targetId === nodeId)
        && r.type !== 'parent_child'
    )
  }

  function getLinkedEntityIds(nodeId: string): string[] {
    const rels = getRelationsForNode(nodeId)
    const ids = new Set<string>()
    for (const r of rels) {
      if (r.sourceId !== nodeId) ids.add(r.sourceId)
      if (r.targetId !== nodeId) ids.add(r.targetId)
    }
    return [...ids]
  }

  function getEntityCard(entityId: string): EntityLinkCard | null {
    const entity = (es.entities ?? []).find(e => e.id === entityId)
    if (!entity) return null
    const info = getNodeTypeInfo(entity.type)
    return {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      icon: info.icon,
      color: info.coolColor,
    }
  }

  function getInlineBadges(nodeId: string): EntityLinkBadge[] {
    const ids = getLinkedEntityIds(nodeId)
    const typeMap = new Map<string, { icon: string; color: string; count: number }>()
    for (const id of ids) {
      const card = getEntityCard(id)
      if (!card) continue
      const existing = typeMap.get(card.type)
      if (existing) {
        existing.count++
      } else {
        typeMap.set(card.type, { icon: card.icon, color: card.color, count: 1 })
      }
    }
    return [...typeMap.entries()]
      .map(([type, data]) => ({ type, ...data }))
      .sort((a, b) => b.count - a.count)
  }

  function getExpandedCards(nodeId: string): EntityLinksGroup[] {
    const ids = getLinkedEntityIds(nodeId)
    const typeMap = new Map<string, EntityLinkCard[]>()
    for (const id of ids) {
      const card = getEntityCard(id)
      if (!card) continue
      const list = typeMap.get(card.type) || []
      list.push(card)
      typeMap.set(card.type, list)
    }
    return [...typeMap.entries()]
      .map(([type, entities]) => {
        const info = getNodeTypeInfo(type)
        return {
          type,
          icon: info.icon,
          color: info.coolColor,
          label: info.label,
          entities,
        }
      })
      .sort((a, b) => b.entities.length - a.entities.length)
  }

  function getDetailSummary(nodeId: string): EntityLinksGroup[] {
    return getExpandedCards(nodeId)
  }

  return {
    getInlineBadges,
    getExpandedCards,
    getDetailSummary,
    getEntityCard,
  }
}
