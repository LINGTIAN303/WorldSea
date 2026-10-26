/**
 * 世界时间轴索引。
 *
 * 只有填了 date 的实体进入时间轴；没有日期的实体在过滤时保持常显，
 * 避免「大部分世界还没写日期就被整体藏掉」。
 * 绝对年份沿用历法内核的编码：era * 10000 + year。
 */
import { parseDateRange, type ParsedDate } from '../../timeline/composables/useDateParser'

export interface TimelineEntityInput {
  id: string
  properties?: Record<string, unknown>
}

export interface TimelinePoint {
  id: string
  /** 区间起点（绝对年） */
  start: number
  /** 区间终点（绝对年），无 dateEnd 时等于 start */
  end: number
  raw: string
}

export interface TimelineIndex {
  points: TimelinePoint[]
  byId: Map<string, TimelinePoint>
  min: number
  max: number
  datedCount: number
}

const ABS_ERA_BASE = 10000

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function absOf(parsed: ParsedDate): number {
  return parsed.era * ABS_ERA_BASE + parsed.year
}

/** 区间终点：优先 dateEnd，缺失或早于起点时退回起点 */
function endOf(parsed: ParsedDate): number {
  if (parsed.yearEnd === undefined) return absOf(parsed)
  const end = (parsed.eraEnd ?? parsed.era) * ABS_ERA_BASE + parsed.yearEnd
  return Math.max(end, absOf(parsed))
}

export function buildTimeline(entities: TimelineEntityInput[]): TimelineIndex {
  const points: TimelinePoint[] = []
  for (const entity of entities) {
    const properties = entity.properties ?? {}
    const raw = textOf(properties.date)
    if (!raw) continue
    const parsed = parseDateRange(raw, textOf(properties.dateEnd))
    if (!parsed) continue
    points.push({ id: entity.id, start: absOf(parsed), end: endOf(parsed), raw })
  }
  points.sort((a, b) => a.start - b.start)

  const byId = new Map(points.map(point => [point.id, point]))
  const min = points.length ? Math.min(...points.map(point => point.start)) : 0
  const max = points.length ? Math.max(...points.map(point => point.end)) : 0
  return { points, byId, min, max, datedCount: points.length }
}

export function formatAbsYear(value: number): string {
  if (value >= ABS_ERA_BASE) {
    const era = Math.floor(value / ABS_ERA_BASE)
    const year = value - era * ABS_ERA_BASE
    return `第${era}纪元 ${year}年`
  }
  if (value < 0) return `公元前 ${-value} 年`
  return `${value} 年`
}

/** 区间与过滤窗口无交集时隐藏；无日期实体永不隐藏 */
export function isOutsideRange(point: TimelinePoint | undefined, start: number, end: number): boolean {
  if (!point) return false
  return point.end < start || point.start > end
}
