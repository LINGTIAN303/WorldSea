/** 周期 occurrence 展开：只展开可见标量窗口内的发生，不落库。 */
import { computed, type ComputedRef } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import type { Calendar, RecurrenceRule } from '../calendar/types'
import type { CalendarRuntime } from '../calendar/math'
import { expandRecurrence } from '../calendar/recurrence'
import { formatTimePoint } from '../calendar/format'
import type { OccurrenceMarker } from './useSwimlaneLayout'
import type { EventTime } from './useTimelinePoints'

export interface TimelineOccurrenceOptions {
  events: ComputedRef<Entity[]>
  points: ComputedRef<Map<string, EventTime>>
  runtime: ComputedRef<CalendarRuntime>
  calendar: ComputedRef<Calendar>
  window: ComputedRef<{ start: number; end: number }>
  /** 单个事件展开上限（防御） */
  limit?: number
  /** 总上限（防御） */
  totalLimit?: number
}

function recurrenceRule(value: unknown): RecurrenceRule | null {
  if (!value) return null
  if (typeof value === 'string') {
    try { return JSON.parse(value) as RecurrenceRule } catch { return null }
  }
  if (typeof value === 'object') return value as RecurrenceRule
  return null
}

export function useTimelineOccurrences(options: TimelineOccurrenceOptions) {
  return computed<OccurrenceMarker[]>(() => {
    const window = options.window.value
    const result: OccurrenceMarker[] = []
    if (!Number.isFinite(window.start) || !Number.isFinite(window.end)) return result
    const limit = options.limit ?? 80
    const totalLimit = options.totalLimit ?? 400
    for (const event of options.events.value) {
      const rule = recurrenceRule(event.properties?.recurrence)
      const point = options.points.value.get(event.id)
      if (!rule || !point?.start || point.foreign || point.unresolved) continue
      try {
        for (const occurrence of expandRecurrence(point.start, rule, options.runtime.value, window, limit)) {
          const scalar = options.runtime.value.toScalar(occurrence)
          if (scalar === point.startScalar) continue
          result.push({
            key: `${event.id}#${scalar}`,
            eventId: event.id,
            scalar,
            text: formatTimePoint(occurrence, options.calendar.value),
          })
          if (result.length >= totalLimit) return result
        }
      } catch { /* 周期规则非法时忽略展开 */ }
    }
    return result
  })
}
