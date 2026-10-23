/** 模糊日期与区间比较（冲突检测/排序共用）。 */
import type { CalendarRuntime } from './math'
import type { Certainty, TimePoint } from './types'

export const CERTAINTY_LABELS: Record<Certainty, string> = {
  exact: '精确',
  approx: '约',
  before: '早于',
  after: '晚于',
  legend: '传说',
}

export function isFuzzy(certainty: Certainty): boolean {
  return certainty !== 'exact'
}

export interface ScalarRange {
  start: number
  end: number
  fuzzy: boolean
}

/**
 * 时间点的标量区间。
 * - 精确/约/传说：从起点到下一个最小单位（或给定终点）。
 * - 早于：(-∞, 起点]；晚于：[起点, +∞)。
 */
export function scalarRange(
  runtime: CalendarRuntime,
  point: TimePoint,
  end?: TimePoint,
): ScalarRange {
  const start = runtime.toScalar(point)
  if (point.certainty === 'before') return { start: Number.NEGATIVE_INFINITY, end: start, fuzzy: true }
  if (point.certainty === 'after') return { start, end: Number.POSITIVE_INFINITY, fuzzy: true }
  const span = Math.max(1, runtime.spanOf(point))
  const resolvedEnd = end ? runtime.toScalar(end) : start + span
  return {
    start,
    end: Math.max(start + 1, resolvedEnd),
    fuzzy: isFuzzy(point.certainty),
  }
}

/** 两个区间是否重叠（模糊区间也算重叠，由调用方决定是否忽略） */
export function rangesOverlap(a: ScalarRange, b: ScalarRange): boolean {
  return a.start < b.end && b.start < a.end
}

/** 按标量排序；相等时保持 0（调用方负责稳定排序） */
export function comparePoints(runtime: CalendarRuntime, a: TimePoint, b: TimePoint): number {
  return runtime.toScalar(a) - runtime.toScalar(b)
}
