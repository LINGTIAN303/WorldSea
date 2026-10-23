/**
 * 时间线分组（编年史分段 / 画布泳道共用）。
 *
 * 口径：分组模式 = 无 / 期段 / 单位链某一级 / 角色 / 地点 / 标签；
 * 期段按「最深的包含区间」归组，其他历法与未定时间各自成尾组，不混进主序列。
 */
import type { Entity, Relation } from '@worldsea/entity-core'
import type { Calendar } from '../calendar/types'
import { valueIndex, type CalendarRuntime } from '../calendar/math'
import { formatUnitSegment, formatTimePoint } from '../calendar/format'
import type { EventTime, PeriodBand } from './useTimelinePoints'

export type GroupMode = 'none' | 'period' | `unit:${string}` | 'character' | 'location' | 'tag'

export interface TimelineGroup {
  id: string
  /** 空串 = 不渲染段标题（无分组） */
  label: string
  detail?: string
  events: Entity[]
}

export interface GroupContext {
  calendar: Calendar
  runtime: CalendarRuntime
  points: Map<string, EventTime>
  periods: PeriodBand[]
  relations?: Relation[]
  entityMap?: Map<string, Entity>
}

/** 落在最深一层包含期段；不在任何期段内返回 null */
export function periodOf(periods: PeriodBand[], scalar: number): PeriodBand | null {
  let best: PeriodBand | null = null
  for (const period of periods) {
    if (scalar < period.start || scalar > period.end) continue
    if (!best || period.depth > best.depth) best = period
  }
  return best
}

function formatScalar(runtime: CalendarRuntime, scalar: number): string {
  try {
    return formatTimePoint(runtime.fromScalar(scalar), runtime.calendar)
  } catch {
    return ''
  }
}

/** 硬分组的公共尾桶：其他历法 / 未定时间 */
function pushTail(groups: TimelineGroup[], buckets: {
  foreign: Entity[]
  unresolved: Entity[]
}) {
  if (buckets.foreign.length) groups.push({ id: 'tail:foreign', label: '其他历法', events: buckets.foreign })
  if (buckets.unresolved.length) groups.push({ id: 'tail:unresolved', label: '未定时间', events: buckets.unresolved })
}

export function buildGroups(events: Entity[], mode: GroupMode, ctx: GroupContext): TimelineGroup[] {
  if (mode === 'none') return [{ id: 'all', label: '', events }]

  const points = ctx.points
  const foreign: Entity[] = []
  const unresolved: Entity[] = []

  if (mode === 'period') {
    const groups = new Map<string, TimelineGroup>()
    for (const period of ctx.periods) {
      groups.set(period.id, {
        id: `period:${period.id}`,
        label: period.name,
        detail: `${formatScalar(ctx.runtime, period.start)} ~ ${formatScalar(ctx.runtime, period.end)}`,
        events: [],
      })
    }
    const none = { id: 'period:none', label: '无期段', events: [] as Entity[] }
    const ordered = [...ctx.periods].sort((a, b) => a.start - b.start || a.depth - b.depth)
    for (const event of events) {
      const point = points.get(event.id)
      if (!point || point.unresolved) { unresolved.push(event); continue }
      if (point.foreign) { foreign.push(event); continue }
      const period = periodOf(ctx.periods, point.startScalar)
      if (period && groups.has(period.id)) groups.get(period.id)!.events.push(event)
      else none.events.push(event)
    }
    const result = ordered.map(period => groups.get(period.id)!).filter(group => group.events.length > 0)
    if (none.events.length) result.push(none)
    pushTail(result, { foreign, unresolved })
    return result
  }

  if (mode.startsWith('unit:')) {
    const unitId = mode.slice(5)
    const level = ctx.runtime.unitLevel(unitId)
    const unit = ctx.calendar.units[level]
    if (!unit) return buildGroups(events, 'none', ctx)
    const groups = new Map<string, { order: number; group: TimelineGroup }>()
    const pending = { id: 'unit:pending', label: `未到${unit.name}`, events: [] as Entity[] }
    for (const event of events) {
      const point = points.get(event.id)
      if (!point || point.unresolved) { unresolved.push(event); continue }
      if (point.foreign) { foreign.push(event); continue }
      const value = point.start?.values[level]
      if (value === undefined) { pending.events.push(event); continue }
      const key = String(value)
      let entry = groups.get(key)
      if (!entry) {
        entry = {
          order: valueIndex(unit, value),
          group: { id: `unit:${unitId}:${key}`, label: formatUnitSegment(unit, value), events: [] },
        }
        groups.set(key, entry)
      }
      entry.group.events.push(event)
    }
    const result = [...groups.values()]
      .sort((a, b) => a.order - b.order)
      .map(entry => entry.group)
    if (pending.events.length) result.push(pending)
    pushTail(result, { foreign, unresolved })
    return result
  }

  // 角色 / 地点 / 标签：事件属性与关系分组（两态共用）
  const buckets = new Map<string, Entity[]>()
  const push = (key: string, event: Entity) => {
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(event)
  }
  for (const event of events) {
    const point = points.get(event.id)
    if (point?.unresolved) { unresolved.push(event); continue }
    if (point?.foreign) { foreign.push(event); continue }
    if (mode === 'character') {
      const involved = (ctx.relations ?? []).filter(rel => rel.type === 'involves' && rel.sourceId === event.id)
      const names = involved
        .map(rel => ctx.entityMap?.get(rel.targetId)?.name)
        .filter((name): name is string => !!name)
      if (!names.length) push('未分配', event)
      else for (const name of names) push(name, event)
    } else if (mode === 'location') {
      push(String(event.properties.location || '未知地点'), event)
    } else {
      const tags = (event.tags ?? []) as string[]
      if (!tags.length) push('无标签', event)
      else for (const tag of tags) push(tag, event)
    }
  }
  const result = [...buckets.keys()].sort().map(key => ({
    id: `group:${key}`, label: key, events: buckets.get(key)!,
  }))
  pushTail(result, { foreign, unresolved })
  return result
}
