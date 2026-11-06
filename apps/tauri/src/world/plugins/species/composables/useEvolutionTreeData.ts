import { computed } from 'vue'
import { getWorldService } from '../../../service-registry'
import type { WorldEntitiesService, WorldRelationsService } from '../../../services'

/** 取数经树服务（唯一取数通道，换数据源只改 services.ts）；取不到属时序被破坏，报错不降级。 */
function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[species] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}
function relationsSvc(): WorldRelationsService {
  const svc = getWorldService<WorldRelationsService>('world.relations')
  if (!svc) throw new Error('[species] world.relations 服务未就绪（视图渲染早于起树）')
  return svc
}


export interface EvoNode {
  id: string
  name: string
  speciesType: string
  origin: string
  population: string
  x: number
  y: number
  color: string
  icon: string
}

export type RelationKind = '祖先' | '进化' | '杂交' | '共生' | '天敌'

export interface EvoEdge {
  sourceId: string
  targetId: string
  relation: RelationKind
}

export interface EvoTreeData {
  nodes: EvoNode[]
  edges: EvoEdge[]
}

const TYPE_ICONS: Record<string, string> = {
  '类人': 'user', '兽族': 'paw', '精灵': 'sparkles', '矮人': 'user',
  '龙族': 'flame', '机械': 'wrench', '元素': 'zap', '亡灵': 'skull',
  '神话生物': 'sparkles', '异界生物': 'brain', '植物智能': 'tree', '其他': 'dna',
}

const SPECIES_TYPE_COLORS: Record<string, string> = {
  '类人': '#4fc3f7', '兽族': '#ff8a65', '精灵': '#81c784', '矮人': '#a1887f',
  '龙族': '#e57373', '机械': '#90a4ae', '元素': '#ffb74d', '亡灵': '#b39ddb',
  '神话生物': '#f06292', '异界生物': '#7986cb', '植物智能': '#aed581', '其他': '#95a5a6',
}

export function useEvolutionTreeData() {
    
  const speciesEntities = computed(() =>
    (entitiesSvc().list() ?? []).filter(e => e.type === 'species')
  )

  const nodes = computed<EvoNode[]>(() =>
    speciesEntities.value.map(e => {
      const st = (e.properties.speciesType as string) || '其他'
      return {
        id: e.id,
        name: e.name,
        speciesType: st,
        origin: (e.properties.origin as string) || '',
        population: (e.properties.population as string) || '',
        x: 0,
        y: 0,
        color: SPECIES_TYPE_COLORS[st] || '#95a5a6',
        icon: TYPE_ICONS[st] || 'dna',
      }
    })
  )

  const edges = computed<EvoEdge[]>(() => {
    const result: EvoEdge[] = []
    for (const r of relationsSvc().list()) {
      if (r.type === 'related_species') {
        const rel = (r.properties?.relation as RelationKind) || '进化'
        result.push({
          sourceId: r.sourceId,
          targetId: r.targetId,
          relation: rel,
        })
      }
    }
    return result
  })

  const treeData = computed<EvoTreeData>(() => ({
    nodes: nodes.value,
    edges: edges.value,
  }))

  return { speciesEntities, nodes, edges, treeData }
}
