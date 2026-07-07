import { computed } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'

export interface FestivalNode {
  id: string
  name: string
  cultureType: string
  cycle: string
  angle: number
  season: string
  color: string
  icon: string
  significance: string
  practices: string
  participants: string
  origin: string
}

const TYPE_ICONS: Record<string, string> = {
  '节日庆典': 'sparkles', '宗教仪式': 'heart', '风俗习惯': 'landmark',
  '艺术流派': 'palette', '饮食文化': 'coffee', '服饰传统': 'clothing',
  '社交礼仪': 'handshake', '丧葬习俗': 'flame', '其他': 'sparkles',
}

const TYPE_COLORS: Record<string, string> = {
  '节日庆典': '#f0883e', '宗教仪式': '#a371f7', '风俗习惯': '#3fb950',
  '艺术流派': '#f778ba', '饮食文化': '#d29922', '服饰传统': '#79c0ff',
  '社交礼仪': '#58a6ff', '丧葬习俗': '#8b949e', '其他': '#95a5a6',
}

const MONTH_NAMES = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月',
]

const MONTH_ALIASES: [RegExp, number][] = [
  [/正月/, 0], [/一月|1月|一月份/, 0],
  [/二月|2月|二月份/, 1], [/三月|3月|三月份/, 2],
  [/四月|4月|四月份/, 3], [/五月|5月|五月份/, 4],
  [/六月|6月|六月份/, 5], [/七月|7月|七月份/, 6],
  [/八月|8月|八月份/, 7], [/九月|9月|九月份/, 8],
  [/十月|10月|十月份/, 9], [/十一月|11月/, 10], [/十二月|12月/, 11],
]

const SEASON_MAP: Record<string, { months: number[]; season: string }> = {
  '春': { months: [2, 3, 4], season: '春' },
  '夏': { months: [5, 6, 7], season: '夏' },
  '秋': { months: [8, 9, 10], season: '秋' },
  '冬': { months: [11, 0, 1], season: '冬' },
}

const SOLAR_TERMS: [RegExp, number][] = [
  [/春分/, 2.5], [/清明/, 3], [/谷雨/, 3.5],
  [/立夏/, 4], [/小满/, 4.5], [/芒种/, 5], [/夏至/, 5.5],
  [/小暑/, 6], [/大暑/, 6.5], [/立秋/, 7], [/处暑/, 7.5],
  [/白露/, 8], [/秋分/, 8.5], [/寒露/, 9], [/霜降/, 9.5],
  [/立冬/, 10], [/小雪/, 10.5], [/大雪/, 11], [/冬至/, 11.5],
  [/小寒/, 0.5], [/大寒/, 1], [/立春/, 1.5], [/雨水/, 2],
]

function parseCycleToMonth(cycle: string): { month: number; season: string } {
  if (!cycle) return { month: -1, season: '' }

  for (const [re, month] of SOLAR_TERMS) {
    if (re.test(cycle)) return { month, season: getSeasonForMonth(month) }
  }

  for (const [re, month] of MONTH_ALIASES) {
    if (re.test(cycle)) return { month, season: getSeasonForMonth(month) }
  }

  for (const [key, val] of Object.entries(SEASON_MAP)) {
    if (cycle.includes(key)) {
      return { month: val.months[1], season: val.season }
    }
  }

  if (/年初|新年|除夕|春节|元宵/.test(cycle)) return { month: 0, season: '冬' }
  if (/中秋|重阳/.test(cycle)) return { month: 8, season: '秋' }
  if (/端午/.test(cycle)) return { month: 5, season: '夏' }
  if (/七夕/.test(cycle)) return { month: 6, season: '夏' }
  if (/每[日天]/.test(cycle)) return { month: -1, season: '' }
  if (/每[周星]/.test(cycle)) return { month: -1, season: '' }
  if (/每月|每旬/.test(cycle)) return { month: -1, season: '' }

  return { month: -1, season: '' }
}

function getSeasonForMonth(month: number): string {
  if (month >= 2 && month <= 4) return '春'
  if (month >= 5 && month <= 7) return '夏'
  if (month >= 8 && month <= 10) return '秋'
  return '冬'
}

export function monthToAngle(month: number): number {
  return (month / 12) * Math.PI * 2 - Math.PI / 2
}

export function useFestivalCalendarData() {
  const es = useEntityStore()

  const cultureEntities = computed(() =>
    (es.entities ?? []).filter(e => e.type === 'culture')
  )

  const nodes = computed<FestivalNode[]>(() =>
    cultureEntities.value.map(e => {
      const ct = (e.properties.cultureType as string) || '其他'
      const cycle = (e.properties.cycle as string) || ''
      const { month, season } = parseCycleToMonth(cycle)
      const angle = month >= 0 ? monthToAngle(month) : -1
      return {
        id: e.id,
        name: e.name,
        cultureType: ct,
        cycle,
        angle,
        season,
        color: TYPE_COLORS[ct] || '#95a5a6',
        icon: TYPE_ICONS[ct] || 'sparkles',
        significance: (e.properties.significance as string) || '',
        practices: (e.properties.practices as string) || '',
        participants: (e.properties.participants as string) || '',
        origin: (e.properties.origin as string) || '',
      }
    })
  )

  const timedNodes = computed(() => nodes.value.filter(n => n.angle >= 0))
  const untimeNodes = computed(() => nodes.value.filter(n => n.angle < 0))

  const monthGroups = computed(() => {
    const groups: Map<number, FestivalNode[]> = new Map()
    for (let i = 0; i < 12; i++) groups.set(i, [])
    for (const n of timedNodes.value) {
      const m = Math.round(((n.angle + Math.PI / 2) / (Math.PI * 2)) * 12) % 12
      groups.get(m)?.push(n)
    }
    return groups
  })

  return { cultureEntities, nodes, timedNodes, untimeNodes, monthGroups, MONTH_NAMES }
}
