/**
 * 时间线筛选管线：搜索 + 顶层单位 + 期段 + 重要度，以及分组模式选项。
 *
 * 口径：筛选与分组都读历法解析结果（points），不再读 properties.era；
 * 分组选项按视图形态给出——编年史只有时间维度，画布另有角色/地点/标签泳道。
 */
import { computed, ref, watch, type Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import type { Calendar } from '../calendar/types'
import { formatUnitSegment } from '../calendar/format'
import type { EventTime, PeriodBand } from './useTimelinePoints'
import { periodOf, type GroupMode } from './timelineGroups'

export interface TimelineFilterContext {
  points: Ref<Map<string, EventTime>>
  periods: Ref<PeriodBand[]>
  calendar: Ref<Calendar>
  layoutMode: Ref<'horizontal' | 'vertical'>
}

const IMPORTANCE_OPTIONS = [
  { value: '', label: '全部重要度' },
  { value: '关键', label: '★ 关键' },
  { value: '重要', label: '★★ 重要' },
  { value: '普通', label: '★★★ 普通' },
  { value: '细微', label: '★★★★ 细微' },
]

function normalizeGroupMode(value: string, calendar: Calendar): GroupMode {
  const unitId = calendar.units[0]?.id ?? 'era'
  if (!value || value === 'none') return 'none'
  // 旧设置值 'era' 映射到顶层单位分组，避免升级后落到无分组
  if (value === 'era') return `unit:${unitId}`
  return value as GroupMode
}

export function useTimelineFilters(
  sortedEvents: Ref<Entity[]>,
  ctx: TimelineFilterContext,
  initialGroupMode = 'none',
) {
  const searchQuery = ref('')
  const unitFilter = ref('')
  const periodFilter = ref('')
  const importanceFilter = ref('')
  const groupMode = ref<GroupMode>(normalizeGroupMode(initialGroupMode, ctx.calendar.value))

  const unitFilterOptions = computed(() => {
    const unit = ctx.calendar.value.units[0]
    const options: { value: string; label: string }[] = [
      { value: '', label: `全部${unit?.name ?? '时间'}` },
    ]
    if (!unit) return options
    const seen = new Set<string>()
    for (const event of sortedEvents.value) {
      const point = ctx.points.value.get(event.id)
      if (!point || point.foreign || point.unresolved || !point.start) continue
      const value = point.start.values[0]
      if (value === undefined) continue
      const key = String(value)
      if (seen.has(key)) continue
      seen.add(key)
      options.push({ value: key, label: formatUnitSegment(unit, value) })
    }
    return options
  })

  const periodFilterOptions = computed(() => [
    { value: '', label: '全部期段' },
    { value: 'none', label: '无期段' },
    ...ctx.periods.value.map(period => ({ value: period.id, label: period.name })),
  ])

  const groupModeOptions = computed(() => {
    const calendar = ctx.calendar.value
    const options = [
      { value: 'none', label: '无分组' },
      ...(ctx.periods.value.length ? [{ value: 'period', label: '按期段' }] : []),
      ...calendar.units.map(unit => ({ value: `unit:${unit.id}`, label: `按${unit.name}` })),
    ]
    if (ctx.layoutMode.value !== 'horizontal') return options
    return [
      ...options,
      { value: 'character', label: '按角色' },
      { value: 'location', label: '按地点' },
      { value: 'tag', label: '按标签' },
    ]
  })

  // 切换视图/历法后，当前分组模式可能不再可用 → 回落无分组
  watch(groupModeOptions, options => {
    if (!options.some(option => option.value === groupMode.value)) groupMode.value = 'none'
  }, { immediate: true })
  // 期段被删空时同步回落
  watch(ctx.periods, periods => {
    if (!periods.length && groupMode.value === 'period') groupMode.value = 'none'
    if (!periods.length && periodFilter.value) periodFilter.value = ''
  })
  // 切历法后顶层单位取值可能整体变化，失效的筛选值回落全部
  watch(unitFilterOptions, options => {
    if (unitFilter.value && !options.some(option => option.value === unitFilter.value)) unitFilter.value = ''
  })

  const filteredEvents = computed(() => {
    let list = sortedEvents.value
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      list = list.filter(event =>
        event.name.toLowerCase().includes(query)
        || event.description.toLowerCase().includes(query)
        || (event.properties.date as string)?.toLowerCase().includes(query)
      )
    }
    if (unitFilter.value) {
      list = list.filter(event => {
        const point = ctx.points.value.get(event.id)
        return !!point && !point.foreign && !point.unresolved
          && String(point.start?.values[0]) === unitFilter.value
      })
    }
    if (periodFilter.value) {
      list = list.filter(event => {
        const point = ctx.points.value.get(event.id)
        if (!point || point.foreign || point.unresolved) return false
        if (periodFilter.value === 'none') return !periodOf(ctx.periods.value, point.startScalar)
        const target = ctx.periods.value.find(period => period.id === periodFilter.value)
        return !!target && point.startScalar >= target.start && point.startScalar <= target.end
      })
    }
    if (importanceFilter.value) {
      list = list.filter(event => (event.properties.importance as string) === importanceFilter.value)
    }
    return list
  })

  return {
    searchQuery, unitFilter, periodFilter, importanceFilter,
    groupMode, groupModeOptions,
    unitFilterOptions, periodFilterOptions, importanceFilterOptions: IMPORTANCE_OPTIONS,
    filteredEvents,
  }
}
