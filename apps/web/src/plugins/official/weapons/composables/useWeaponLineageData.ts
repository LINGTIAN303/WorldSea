import { computed } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'

export interface WeaponNode {
  id: string
  name: string
  weaponType: string
  rank: string
  status: string
  material: string
  smith: string
  specialAbilities: string
  x: number
  y: number
  color: string
  icon: string
}

export interface HolderLink {
  weaponId: string
  characterId: string
  characterName: string
  isCurrent: boolean
}

export interface WeaponEdge {
  sourceId: string
  targetId: string
  relation: string
}

const TYPE_ICONS: Record<string, string> = {
  '剑': 'sword', '刀': 'sword', '枪': 'sword', '弓': 'target',
  '斧': 'sword', '锤': 'wrench', '杖': 'magic', '鞭': 'link',
  '暗器': 'target', '盾': 'shield', '其他': 'sword',
}

const RANK_COLORS: Record<string, string> = {
  '凡品': '#8b949e', '良品': '#3fb950', '精品': '#58a6ff',
  '珍品': '#d2a8ff', '绝品': '#f0883e', '神品': '#f778ba',
}

const TYPE_COLORS: Record<string, string> = {
  '剑': '#58a6ff', '刀': '#f0883e', '枪': '#3fb950', '弓': '#d29922',
  '斧': '#a1887f', '锤': '#90a4ae', '杖': '#d2a8ff', '鞭': '#8b949e',
  '暗器': '#7986cb', '盾': '#79c0ff', '其他': '#95a5a6',
}

export function useWeaponLineageData() {
  const es = useEntityStore()
  const rs = useRelationStore()

  const weaponEntities = computed(() =>
    (es.entities ?? []).filter(e =>
      e.type === 'item' && (e.facets?.weapon != null || e.properties?.itemType === '武器')
    )
  )

  const nodes = computed<WeaponNode[]>(() =>
    weaponEntities.value.map(e => {
      // 迁移后武器特有字段在 facets.weapon 中，通用字段在 properties 中
      const wf = (e.facets?.weapon ?? {}) as Record<string, unknown>
      const wt = (wf.weaponType as string) || (e.properties.weaponType as string) || '其他'
      const rank = (wf.rank as string) || (e.properties.rank as string) || '凡品'
      return {
        id: e.id,
        name: e.name,
        weaponType: wt,
        rank,
        status: (e.properties.status as string) || (e.properties.condition as string) || '',
        material: (e.properties.material as string) || '',
        smith: (wf.smith as string) || (e.properties.smith as string) || '',
        specialAbilities: (wf.specialAbility as string) || (wf.specialAbilities as string) || (e.properties.specialAbilities as string) || '',
        x: 0,
        y: 0,
        color: RANK_COLORS[rank] || TYPE_COLORS[wt] || '#95a5a6',
        icon: TYPE_ICONS[wt] || 'sword',
      }
    })
  )

  const holderLinks = computed<HolderLink[]>(() => {
    const result: HolderLink[] = []
    for (const r of rs.relations) {
      if (r.type === 'current_holder') {
        const ch = es.entities?.find(e => e.id === r.targetId && e.type === 'character')
        if (ch) result.push({ weaponId: r.sourceId, characterId: ch.id, characterName: ch.name, isCurrent: true })
      } else if (r.type === 'past_holders') {
        const ch = es.entities?.find(e => e.id === r.targetId && e.type === 'character')
        if (ch) result.push({ weaponId: r.sourceId, characterId: ch.id, characterName: ch.name, isCurrent: false })
      }
    }
    return result
  })

  const weaponEdges = computed<WeaponEdge[]>(() => {
    const result: WeaponEdge[] = []
    for (const r of rs.relations) {
      if (r.type === 'weapon_relation') {
        const rel = (r.properties?.relation as string) || '配套'
        result.push({ sourceId: r.sourceId, targetId: r.targetId, relation: rel })
      }
    }
    return result
  })

  const weaponTypes = computed(() => {
    const set = new Set<string>()
    for (const n of nodes.value) set.add(n.weaponType)
    return Array.from(set).sort()
  })

  return { weaponEntities, nodes, holderLinks, weaponEdges, weaponTypes }
}
