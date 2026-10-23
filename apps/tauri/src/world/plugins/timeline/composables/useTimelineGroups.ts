/** 视图分组派生：两态的分组输入不同（画布剔除其他历法事件，编年史保留尾组）。 */
import { computed, type ComputedRef, type Ref } from 'vue'
import type { Entity, Relation } from '@worldsea/entity-core'
import type { Calendar } from '../calendar/types'
import type { CalendarRuntime } from '../calendar/math'
import type { EventTime, PeriodBand } from './useTimelinePoints'
import { buildGroups, type GroupMode, type TimelineGroup } from './timelineGroups'

export interface TimelineGroupsOptions {
  /** 编年史数据源（时序表已分页） */
  verticalEvents: ComputedRef<Entity[]>
  filteredEvents: ComputedRef<Entity[]>
  points: Ref<Map<string, EventTime>>
  calendar: Ref<Calendar>
  runtime: Ref<CalendarRuntime>
  periods: Ref<PeriodBand[]>
  relations: ComputedRef<Relation[]>
  entityMap: ComputedRef<Map<string, Entity>>
  groupMode: Ref<GroupMode>
}

export function useTimelineGroups(options: TimelineGroupsOptions) {
  const context = computed(() => ({
    calendar: options.calendar.value,
    runtime: options.runtime.value,
    points: options.points.value,
    periods: options.periods.value,
    relations: options.relations.value,
    entityMap: options.entityMap.value,
  }))

  const canvasEvents = computed(() =>
    options.filteredEvents.value.filter(event => !options.points.value.get(event.id)?.foreign),
  )

  const chronicleGroups = computed<TimelineGroup[]>(() => {
    const mode = options.groupMode.value
    if (mode !== 'none') return buildGroups(options.verticalEvents.value, mode, context.value)
    // 无分组时也把其他历法事件单列尾组，避免混进当前历法的时间序列
    const foreignIds = new Set(
      options.verticalEvents.value
        .filter(event => options.points.value.get(event.id)?.foreign)
        .map(event => event.id),
    )
    if (!foreignIds.size) return buildGroups(options.verticalEvents.value, 'none', context.value)
    return [
      { id: 'all', label: '', events: options.verticalEvents.value.filter(event => !foreignIds.has(event.id)) },
      { id: 'tail:foreign', label: '其他历法', events: options.verticalEvents.value.filter(event => foreignIds.has(event.id)) },
    ]
  })

  const canvasGroups = computed<TimelineGroup[]>(() =>
    buildGroups(canvasEvents.value, options.groupMode.value, context.value),
  )

  return { canvasEvents, chronicleGroups, canvasGroups }
}
