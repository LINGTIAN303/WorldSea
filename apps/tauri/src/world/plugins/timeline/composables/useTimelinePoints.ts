/**
 * 事件时间数据层：按事件所属历法解析 date/dateEnd，产出标量区间、期段色带与分组上下文。
 *
 * 口径：
 * - 同一视图只激活一套历法；其他历法事件标 foreign（不参与当前轴）。
 * - 解析失败保留原文并入「未定时间」，不丢数据。
 * - 标量是唯一可比较量，排序/缩放/冲突/拖拽都只消费它。
 * 详细见 docs/details/注释/apps/tauri/world/timeline-calendar.md
 */
import { computed, type ComputedRef, type Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import type { Calendar, Certainty, TimePoint } from '../calendar/types'
import { createCalendarRuntime, type CalendarRuntime } from '../calendar/math'
import { parseTimePoint } from '../calendar/parse'
import { formatTimePoint } from '../calendar/format'

export interface EventTime {
  calendarId: string
  /** 不属于当前激活历法：不上当前轴，列表单独分组 */
  foreign: boolean
  start?: TimePoint
  end?: TimePoint
  startScalar: number
  /** 渲染用终点（点事件 = 起点 + 一个精度跨度；模糊「早于/晚于」不取无穷） */
  endScalar: number
  /** 是否显式填了 dateEnd */
  range: boolean
  fuzzy: boolean
  certainty: Certainty
  raw: string
  /** 按所属历法格式化的显示文本 */
  text: string
  unresolved: boolean
}

export interface PeriodBand {
  id: string
  name: string
  start: number
  end: number
  depth: number
  parentId?: string
  color?: string
}

export interface UnitBand {
  id: string
  label: string
  start: number
  end: number
}

export interface AxisBand extends UnitBand {
  tone: 'base' | 'period'
  depth: number
  color?: string
}

export interface TimelinePointsOptions {
  events: ComputedRef<Entity[]>
  calendars: Ref<Calendar[]>
  activeCalendar: ComputedRef<Calendar>
}

/** 历法运行时按「id + 更新时间」缓存：历法编辑后 updatedAt 变化自然失效 */
const runtimeCache = new Map<string, CalendarRuntime>()
function runtimeOf(calendar: Calendar): CalendarRuntime {
  const key = `${calendar.id}@${calendar.updatedAt ?? 0}`
  let runtime = runtimeCache.get(key)
  if (!runtime) {
    runtime = createCalendarRuntime(calendar)
    runtimeCache.set(key, runtime)
  }
  return runtime
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function useTimelinePoints(options: TimelinePointsOptions) {
  const { events, calendars, activeCalendar } = options

  const runtime = computed(() => runtimeOf(activeCalendar.value))

  const points = computed<Map<string, EventTime>>(() => {
    const calendar = activeCalendar.value
    const all = calendars.value
    const map = new Map<string, EventTime>()
    for (const event of events.value) {
      const properties = event.properties ?? {}
      const ownId = textOf(properties.calendarId) || calendar.id
      const own = all.find(item => item.id === ownId) ?? calendar
      const ownRuntime = runtimeOf(own)
      const foreign = own.id !== calendar.id
      const raw = textOf(properties.date)
      const rawEnd = textOf(properties.dateEnd)
      const parsed = raw ? parseTimePoint(raw, own) : null

      if (!parsed) {
        map.set(event.id, {
          calendarId: own.id, foreign, startScalar: Number.NaN, endScalar: Number.NaN,
          range: false, fuzzy: false, certainty: 'exact', raw, text: raw || '未定时间', unresolved: true,
        })
        continue
      }

      const endParsed = rawEnd ? parseTimePoint(rawEnd, own) : null
      const fieldCertainty = textOf(properties.dateCertainty) as Certainty
      const certainty = parsed.point.certainty !== 'exact'
        ? parsed.point.certainty
        : (['approx', 'before', 'after', 'legend'].includes(fieldCertainty) ? fieldCertainty : 'exact')
      const start: TimePoint = { ...parsed.point, certainty }
      const end = endParsed ? { ...endParsed.point, certainty } : undefined

      let startScalar = Number.NaN
      let endScalar = Number.NaN
      try {
        startScalar = ownRuntime.toScalar(start)
        const span = Math.max(1, ownRuntime.spanOf(start))
        const endRaw = end ? ownRuntime.toScalar(end) : Number.NaN
        endScalar = Number.isFinite(endRaw) ? Math.max(startScalar + 1, endRaw) : startScalar + span
      } catch {
        map.set(event.id, {
          calendarId: own.id, foreign, start, end, startScalar: Number.NaN, endScalar: Number.NaN,
          range: !!end, fuzzy: certainty !== 'exact', certainty, raw, text: raw || '未定时间', unresolved: true,
        })
        continue
      }

      const text = end
        ? `${formatTimePoint(start, own)} ~ ${formatTimePoint(end, own)}`
        : formatTimePoint(start, own)
      map.set(event.id, {
        calendarId: own.id, foreign, start, end, startScalar, endScalar,
        range: !!end, fuzzy: certainty !== 'exact', certainty, raw, text, unresolved: false,
      })
    }
    return map
  })

  /** 期段色带：起止文本按当前历法解析，父链深度用于嵌套区分 */
  const periods = computed<PeriodBand[]>(() => {
    const calendar = activeCalendar.value
    const list = calendar.periods ?? []
    const byId = new Map(list.map(item => [item.id, item]))
    const result: PeriodBand[] = []
    for (const period of list) {
      const start = period.start ? parseTimePoint(period.start, calendar) : null
      const end = period.end ? parseTimePoint(period.end, calendar) : null
      if (!start || !end) continue
      try {
        let depth = 0
        let parent = period.parentId ? byId.get(period.parentId) : undefined
        while (parent && depth < 8) { depth++; parent = parent.parentId ? byId.get(parent.parentId) : undefined }
        result.push({
          id: period.id,
          name: period.name,
          start: runtime.value.toScalar(start.point),
          end: runtime.value.toScalar(end.point),
          depth,
          parentId: period.parentId,
          color: period.color,
        })
      } catch { /* 解析不到标量的期段不参与色带 */ }
    }
    return result.sort((a, b) => a.start - b.start || b.depth - a.depth)
  })

  /** 顶层单位色带：命名单位取全部有界取值；数值单位取事件中实际出现的取值 */
  const unitBands = computed<UnitBand[]>(() => {
    const calendar = activeCalendar.value
    const unit = calendar.units[0]
    if (!unit) return []
    const rt = runtime.value
    const result: UnitBand[] = []
    try {
      if (unit.kind === 'named') {
        let scalar = 0
        for (const value of unit.values ?? []) {
          const length = rt.lengthInBase(0, value.id, 1)
          const end = Number.isFinite(length) ? scalar + length : Number.POSITIVE_INFINITY
          result.push({ id: `base:${value.id}`, label: value.name, start: scalar, end })
          if (!Number.isFinite(length)) break
          scalar = end
        }
      } else {
        const seen = new Map<number, string>()
        for (const point of points.value.values()) {
          if (point.foreign || point.unresolved || !point.start) continue
          const value = point.start.values[0]
          if (typeof value !== 'number' || seen.has(value)) continue
          seen.set(value, String(value))
        }
        for (const value of [...seen.keys()].sort((a, b) => a - b)) {
          const start = rt.unitStartScalar(0, value, 1)
          const length = rt.lengthInBase(0, value, 1)
          result.push({
            id: `base:${value}`,
            label: String(value),
            start,
            end: Number.isFinite(length) ? start + length : Number.POSITIVE_INFINITY,
          })
        }
      }
    } catch { return result }
    return result
  })

  const axisBands = computed<AxisBand[]>(() => [
    ...unitBands.value.map(band => ({ ...band, tone: 'base' as const, depth: 0 })),
    ...periods.value.map(period => ({
      id: `period:${period.id}`, label: period.name, start: period.start, end: period.end,
      tone: 'period' as const, depth: period.depth, color: period.color,
    })),
  ])

  const foreignCount = computed(() => {
    let count = 0
    for (const point of points.value.values()) if (point.foreign) count++
    return count
  })

  return { points, runtime, periods, unitBands, axisBands, foreignCount }
}
