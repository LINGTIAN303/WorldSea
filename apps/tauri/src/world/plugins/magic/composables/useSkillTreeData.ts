import { computed } from 'vue'
import { getNodeTypeInfo } from '@worldsea/entity-core'
import { getWorldService } from '../../../service-registry'
import type { WorldEntitiesService, WorldRelationsService } from '../../../services'

/** 取数经树服务（唯一取数通道，换数据源只改 services.ts）；取不到属时序被破坏，报错不降级。 */
function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[magic] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}
function relationsSvc(): WorldRelationsService {
  const svc = getWorldService<WorldRelationsService>('world.relations')
  if (!svc) throw new Error('[magic] world.relations 服务未就绪（视图渲染早于起树）')
  return svc
}


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

// 体系图标取 ui-kit 图标集名（禁 emoji 当图标；2026-09-27 E7 收拾）
const TYPE_ICONS: Record<string, string> = {
  '元素魔法': 'sun', '心灵魔法': 'eye', '神术/圣光': 'sparkle', '黑魔法/诅咒': 'skull',
  '自然魔法': 'plant', '符文/附魔': 'tag', '炼金术': 'palette', '武术/战技': 'weapon',
  '科技/异能': 'lightning', '通用': 'magic',
}

export function useSkillTreeData() {
    
  const magicEntities = computed(() =>
    (entitiesSvc().list() ?? []).filter(e => e.type === 'magic')
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
        icon: TYPE_ICONS[mt] || 'magic',
      }
    })
  )

  const edges = computed<SkillEdge[]>(() => {
    const result: SkillEdge[] = []
    for (const r of relationsSvc().list()) {
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
