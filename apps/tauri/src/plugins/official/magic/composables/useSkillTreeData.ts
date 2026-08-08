import { computed } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { getNodeTypeInfo } from '@worldsmith/entity-core'

export interface SkillNode {
  id: string
  name: string
  magicType: string
  level: string
  x: number
  y: number
  color: string
  icon: string
}

export interface SkillEdge {
  sourceId: string
  targetId: string
  type: 'upgrades_to' | 'counters'
}

export interface SkillTreeData {
  nodes: SkillNode[]
  edges: SkillEdge[]
}

const TYPE_ICONS: Record<string, string> = {
  '元素魔法': '🔥', '心灵魔法': '🧠', '神术/圣光': '✨', '黑魔法/诅咒': '💀',
  '自然魔法': '🌿', '符文/附魔': '🔣', '炼金术': '⚗️', '武术/战技': '🥋',
  '科技/异能': '⚡', '通用': '🔮',
}

export function useSkillTreeData() {
  const es = useEntityStore()
  const rs = useRelationStore()

  const magicEntities = computed(() =>
    (es.entities ?? []).filter(e => e.type === 'magic')
  )

  const nodes = computed<SkillNode[]>(() =>
    magicEntities.value.map(e => {
      const mt = (e.properties.magicType as string) || '通用'
      const info = getNodeTypeInfo('magic')
      return {
        id: e.id,
        name: e.name,
        magicType: mt,
        level: (e.properties.level as string) || '入门',
        x: 0,
        y: 0,
        color: info.coolColor,
        icon: TYPE_ICONS[mt] || '🔮',
      }
    })
  )

  const edges = computed<SkillEdge[]>(() => {
    const result: SkillEdge[] = []
    for (const r of rs.relations) {
      if (r.type === 'upgrades_to' || r.type === 'counters') {
        result.push({
          sourceId: r.sourceId,
          targetId: r.targetId,
          type: r.type as 'upgrades_to' | 'counters',
        })
      }
    }
    return result
  })

  const treeData = computed<SkillTreeData>(() => ({
    nodes: nodes.value,
    edges: edges.value,
  }))

  return { magicEntities, nodes, edges, treeData }
}
