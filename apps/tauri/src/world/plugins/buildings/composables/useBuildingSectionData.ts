import { computed } from 'vue'
import { getWorldService } from '../../../service-registry'
import type { WorldEntitiesService, WorldRelationsService } from '../../../services'

/** 取数经树服务（唯一取数通道，换数据源只改 services.ts）；取不到属时序被破坏，报错不降级。 */
function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[buildings] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}
function relationsSvc(): WorldRelationsService {
  const svc = getWorldService<WorldRelationsService>('world.relations')
  if (!svc) throw new Error('[buildings] world.relations 服务未就绪（视图渲染早于起树）')
  return svc
}


export interface BuildingNode {
  id: string
  name: string
  buildingType: string
  floors: number
  style: string
  status: string
  material: string
  significance: string
  interior: string
  x: number
  y: number
  color: string
  icon: string
  expanded: boolean
}

export interface FloorInfo {
  index: number
  label: string
  content: string
}

export interface ConnectionEdge {
  sourceId: string
  targetId: string
  routeType: string
}

const TYPE_ICONS: Record<string, string> = {
  '宫殿/城堡': 'building', '塔楼/堡垒': 'building', '寺庙/教堂': 'landmark',
  '住宅/民居': 'home', '商店/市场': 'building', '学校/学院': 'building',
  '工厂/工坊': 'building', '地牢/监狱': 'building', '桥梁/道路': 'bridge',
  '奇观/遗迹': 'landmark', '其他': 'landmark',
}

const TYPE_COLORS: Record<string, string> = {
  '宫殿/城堡': '#f0883e', '塔楼/堡垒': '#d29922', '寺庙/教堂': '#d2a8ff',
  '住宅/民居': '#3fb950', '商店/市场': '#58a6ff', '学校/学院': '#79c0ff',
  '工厂/工坊': '#8b949e', '地牢/监狱': '#f85149', '桥梁/道路': '#a371f7',
  '奇观/遗迹': '#f778ba', '其他': '#95a5a6',
}

export function parseFloors(interior: string, floorCount: number): FloorInfo[] {
  if (!interior && floorCount <= 0) return []

  const floors: FloorInfo[] = []

  if (interior) {
    const parts = interior.split(/[;；\n]/).map(s => s.trim()).filter(Boolean)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const match = part.match(/^([B\d]+F?[:：]?\s*)?(.*)/)
      if (match) {
        const label = match[1] ? match[1].replace(/[:：]\s*$/, '') : `${i + 1}F`
        const content = match[2] || part
        floors.push({ index: i, label, content })
      }
    }
  }

  if (floors.length === 0 && floorCount > 0) {
    for (let i = 0; i < floorCount; i++) {
      const isBasement = i >= floorCount - Math.floor(floorCount * 0.3) && floorCount > 3
      const idx = isBasement ? -(i - floorCount + Math.ceil(floorCount * 0.7)) : i + 1
      floors.push({
        index: i,
        label: idx <= 0 ? `B${Math.abs(idx) + 1}` : `${idx}F`,
        content: '',
      })
    }
  }

  return floors
}

export function useBuildingSectionData() {
    
  const buildingEntities = computed(() =>
    (entitiesSvc().list() ?? []).filter(e => e.type === 'building')
  )

  const nodes = computed<BuildingNode[]>(() =>
    buildingEntities.value.map(e => {
      const bt = (e.properties.buildingType as string) || '其他'
      const floorStr = (e.properties.floors as string) || '1'
      const floorNum = parseInt(floorStr, 10) || 1
      return {
        id: e.id,
        name: e.name,
        buildingType: bt,
        floors: floorNum,
        style: (e.properties.style as string) || '',
        status: (e.properties.status as string) || '',
        material: (e.properties.material as string) || '',
        significance: (e.properties.significance as string) || '',
        interior: (e.properties.interior as string) || '',
        x: 0,
        y: 0,
        color: TYPE_COLORS[bt] || '#95a5a6',
        icon: TYPE_ICONS[bt] || 'landmark',
        expanded: false,
      }
    })
  )

  const connections = computed<ConnectionEdge[]>(() => {
    const result: ConnectionEdge[] = []
    for (const r of relationsSvc().list()) {
      if (r.type === 'connected_to') {
        result.push({
          sourceId: r.sourceId,
          targetId: r.targetId,
          routeType: (r.properties?.routeType as string) || '通道',
        })
      }
    }
    return result
  })

  const buildingTypes = computed(() => {
    const set = new Set<string>()
    for (const n of nodes.value) set.add(n.buildingType)
    return Array.from(set).sort()
  })

  function getResidents(buildingId: string) {
    return relationsSvc().list()
      .filter(r => r.type === 'resident' && r.sourceId === buildingId)
      .map(r => entitiesSvc().list()?.find(e => e.id === r.targetId && e.type === 'character'))
      .filter(e => !!e)
      .map(e => ({ id: e!.id, name: e!.name }))
  }

  function getStoredItems(buildingId: string) {
    return relationsSvc().list()
      .filter(r => r.type === 'stored_at' && r.sourceId === buildingId)
      .map(r => entitiesSvc().list()?.find(e => e.id === r.targetId && e.type === 'item'))
      .filter(e => !!e)
      .map(e => ({ id: e!.id, name: e!.name }))
  }

  return { buildingEntities, nodes, connections, buildingTypes, getResidents, getStoredItems }
}
