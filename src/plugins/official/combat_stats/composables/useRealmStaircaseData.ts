import { computed } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'

export interface RealmStep {
  id: string
  name: string
  system: string
  tier: number
  realm: string
  culture: string
  promotion: string
  bottleneck: string
  power: string
  color: string
  icon: string
}

const SYSTEM_ICONS: Record<string, string> = {
  '修仙': '🧘', '魔法': '🔮', '武道': '🥋',
  '异能': '⚡', '科技': '🔬', '混合': '🌀', '其他': '⚡',
}

const SYSTEM_COLORS: Record<string, string> = {
  '修仙': '#a371f7', '魔法': '#d2a8ff', '武道': '#f0883e',
  '异能': '#58a6ff', '科技': '#3fb950', '混合': '#d29922', '其他': '#8b949e',
}

const RADAR_DIMS = [
  { key: 'power', label: '战力', max: 10 },
  { key: 'promotion', label: '晋升难度', max: 10 },
  { key: 'bottleneck', label: '瓶颈强度', max: 10 },
  { key: 'rarity', label: '稀有度', max: 10 },
  { key: 'versatility', label: '通用性', max: 10 },
]

function estimateValue(text: string, max: number): number {
  if (!text) return max * 0.3
  const len = text.length
  const score = Math.min(len / 20, 1)
  return Math.round(score * max * 0.7 + max * 0.3)
}

export function getRadarValues(step: RealmStep): number[] {
  return [
    estimateValue(step.power, 10),
    estimateValue(step.promotion, 10),
    estimateValue(step.bottleneck, 10),
    step.tier > 0 ? Math.min(step.tier / 3, 10) : 5,
    step.culture ? 7 : 4,
  ]
}

export { RADAR_DIMS }

export function useRealmStaircaseData() {
  const es = useEntityStore()

  const combatEntities = computed(() =>
    (es.entities ?? []).filter(e => e.type === 'combat_stat')
  )

  const steps = computed<RealmStep[]>(() => {
    const result = combatEntities.value.map(e => {
      const sys = (e.properties.system as string) || '其他'
      const tierStr = (e.properties.tier as string) || '0'
      const tierNum = parseInt(tierStr, 10) || 0
      return {
        id: e.id,
        name: e.name,
        system: sys,
        tier: tierNum,
        realm: (e.properties.realm as string) || '',
        culture: (e.properties.culture as string) || '',
        promotion: (e.properties.promotion as string) || '',
        bottleneck: (e.properties.bottleneck as string) || '',
        power: (e.properties.power as string) || '',
        color: SYSTEM_COLORS[sys] || '#8b949e',
        icon: SYSTEM_ICONS[sys] || '⚡',
      }
    })
    result.sort((a, b) => a.tier - b.tier)
    return result
  })

  const systems = computed(() => {
    const set = new Set<string>()
    for (const s of steps.value) set.add(s.system)
    return Array.from(set).sort()
  })

  return { combatEntities, steps, systems }
}
