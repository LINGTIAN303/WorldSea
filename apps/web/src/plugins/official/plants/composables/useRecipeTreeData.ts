import { computed } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'

export type RecipeNodeType = 'plant' | 'item' | 'magic'

export interface RecipeNode {
  id: string
  name: string
  nodeType: RecipeNodeType
  subType: string
  rarity: string
  x: number
  y: number
  color: string
  icon: string
}

export interface RecipeEdge {
  sourceId: string
  targetId: string
  edgeType: 'materials_from' | 'magic_material'
}

const PLANT_ICONS: Record<string, string> = {
  '树木': 'tree', '花卉': 'flower', '草药': 'plant', '藤蔓': 'leaf',
  '菌类': 'target', '苔藓': 'plant', '水生植物': 'water', '食肉植物': 'plant',
  '魔法植物': 'sparkles', '其他': 'plant',
}

const ITEM_ICONS: Record<string, string> = {
  '药水': 'flask', '武器': 'sword', '防具': 'shield', '食物': 'coffee',
  '材料': 'gem', '卷轴': 'scroll', '饰品': 'ring', '工具': 'wrench', '其他': 'package',
}

const RARITY_COLORS: Record<string, string> = {
  '常见': '#8b949e', '少见': '#3fb950', '稀有': '#58a6ff',
  '极稀有': '#d2a8ff', '传说': '#f0883e', '已灭绝': '#f85149',
}

const NODE_TYPE_COLORS: Record<RecipeNodeType, string> = {
  'plant': '#3fb950',
  'item': '#58a6ff',
  'magic': '#d2a8ff',
}

export function useRecipeTreeData() {
  const es = useEntityStore()
  const rs = useRelationStore()

  const plantEntities = computed(() =>
    (es.entities ?? []).filter(e => e.type === 'plant')
  )

  const nodes = computed<RecipeNode[]>(() => {
    const result: RecipeNode[] = []
    const itemIds = new Set<string>()

    for (const r of rs.relations) {
      if (r.type === 'materials_from') itemIds.add(r.targetId)
      if (r.type === 'magic_material') itemIds.add(r.targetId)
    }

    for (const e of plantEntities.value) {
      const pt = (e.properties.plantType as string) || '其他'
      const rarity = (e.properties.rarity as string) || '常见'
      result.push({
        id: e.id,
        name: e.name,
        nodeType: 'plant',
        subType: pt,
        rarity,
        x: 0,
        y: 0,
        color: RARITY_COLORS[rarity] || NODE_TYPE_COLORS['plant'],
        icon: PLANT_ICONS[pt] || 'plant',
      })
    }

    for (const itemId of itemIds) {
      const entity = es.entities?.find(e => e.id === itemId)
      if (!entity) continue
      const it = (entity.properties.itemType as string) || '其他'
      const rarity = (entity.properties.rarity as string) || '常见'
      result.push({
        id: entity.id,
        name: entity.name,
        nodeType: entity.type === 'magic' ? 'magic' : 'item',
        subType: it,
        rarity,
        x: 0,
        y: 0,
        color: RARITY_COLORS[rarity] || NODE_TYPE_COLORS['item'],
        icon: entity.type === 'magic' ? 'sparkles' : (ITEM_ICONS[it] || 'package'),
      })
    }

    return result
  })

  const edges = computed<RecipeEdge[]>(() => {
    const result: RecipeEdge[] = []
    for (const r of rs.relations) {
      if (r.type === 'materials_from') {
        result.push({ sourceId: r.sourceId, targetId: r.targetId, edgeType: 'materials_from' })
      } else if (r.type === 'magic_material') {
        result.push({ sourceId: r.sourceId, targetId: r.targetId, edgeType: 'magic_material' })
      }
    }
    return result
  })

  return { plantEntities, nodes, edges }
}
