/** 周期事件展开：按可见标量窗口生成虚拟 occurrence，不落库。 */
import type { CalendarRuntime } from './math'
import { parseTimePoint } from './parse'
import type { RecurrenceRule, TimePoint } from './types'

export interface RecurrenceWindow {
  start: number
  end: number
}

/**
 * 展开周期事件。
 * - 基础事件本身的标量视为第一次发生；之后每 every 个单位一次。
 * - 只返回落在窗口内（含端点）的发生；超过 limit 截断。
 */
export function expandRecurrence(
  base: TimePoint,
  rule: RecurrenceRule,
  runtime: CalendarRuntime,
  window: RecurrenceWindow,
  limit = rule.limit ?? 200,
): TimePoint[] {
  if (!Number.isFinite(rule.every) || rule.every < 1) return []
  const level = runtime.unitLevel(rule.unit)
  if (level < 0) return []
  const until = rule.until ? parseTimePoint(rule.until, runtime.calendar) : null
  const untilScalar = until ? runtime.toScalar(until.point) : Number.POSITIVE_INFINITY
  const exceptions = new Set<number>()
  for (const text of rule.exceptions ?? []) {
    const parsed = parseTimePoint(text, runtime.calendar)
    if (parsed) exceptions.add(runtime.toScalar(parsed.point))
  }

  const baseScalar = runtime.toScalar(base)
  let current = base
  let currentScalar = baseScalar

  // 基础事件远早于窗口时，先按近似单位长度快进，避免逐次扫描
  if (currentScalar < window.start - runtime.spanOf(base) * 2) {
    const approx = Math.max(1, runtime.lengthInBase(level, base.values[level], 1))
    const steps = Math.floor((window.start - currentScalar) / (approx * rule.every))
    if (steps > 1) {
      current = runtime.shift(base, rule.unit, (steps - 1) * rule.every)
      currentScalar = runtime.toScalar(current)
    }
  }

  const result: TimePoint[] = []
  let guard = 0
  while (currentScalar <= window.end && guard++ < 10_000) {
    if (currentScalar >= window.start && currentScalar <= untilScalar && !exceptions.has(currentScalar)) {
      result.push(current)
      if (result.length >= limit) break
    }
    current = runtime.shift(current, rule.unit, rule.every)
    currentScalar = runtime.toScalar(current)
  }
  return result
}

/** 预览最近 n 次（编辑器用） */
export function previewRecurrence(
  base: TimePoint,
  rule: RecurrenceRule,
  runtime: CalendarRuntime,
  count = 5,
): TimePoint[] {
  const start = runtime.toScalar(base)
  const window: RecurrenceWindow = { start, end: Number.MAX_SAFE_INTEGER }
  return expandRecurrence(base, rule, runtime, window, count)
}
