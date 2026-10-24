/** 周期事件展开：按可见标量窗口生成虚拟 occurrence，不落库。 */
import type { CalendarRuntime } from './math'
import { parseTimePoint } from './parse'
import type { Calendar, RecurrenceRule, TimePoint } from './types'

export interface RecurrenceWindow {
  start: number
  end: number
}

export interface RecurrenceOccurrence {
  point: TimePoint
  /** 从基础事件起算的第几次（含被跳过的，基础事件为第 1 次） */
  ordinal: number
  /** 命中 exceptions：画布画成跳过点，不计入 expandRecurrence 的结果 */
  skipped: boolean
}

function expand(
  base: TimePoint,
  rule: RecurrenceRule,
  runtime: CalendarRuntime,
  window: RecurrenceWindow,
  limit: number,
  includeSkipped: boolean,
): RecurrenceOccurrence[] {
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
  let ordinal = 1

  // 基础事件远早于窗口时，先按近似单位长度快进，避免逐次扫描（序号按跳过的步数折算）
  if (currentScalar < window.start - runtime.spanOf(base) * 2) {
    const approx = Math.max(1, runtime.lengthInBase(level, base.values[level], 1))
    const steps = Math.floor((window.start - currentScalar) / (approx * rule.every))
    if (steps > 1) {
      current = runtime.shift(base, rule.unit, (steps - 1) * rule.every)
      currentScalar = runtime.toScalar(current)
      ordinal = steps
    }
  }

  const result: RecurrenceOccurrence[] = []
  let guard = 0
  while (currentScalar <= window.end && guard++ < 10_000) {
    if (currentScalar >= window.start && currentScalar <= untilScalar) {
      const skipped = exceptions.has(currentScalar)
      if (!skipped || includeSkipped) {
        result.push({ point: current, ordinal, skipped })
        if (result.length >= limit) break
      }
    }
    current = runtime.shift(current, rule.unit, rule.every)
    currentScalar = runtime.toScalar(current)
    ordinal++
  }
  return result
}

/**
 * 展开周期事件（只返回有效发生，跳过例外）。
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
  return expand(base, rule, runtime, window, limit, false).map(item => item.point)
}

/** 详细展开：带「第 N 次」序号，并保留被跳过的发生（画布画成跳过点） */
export function expandRecurrenceDetailed(
  base: TimePoint,
  rule: RecurrenceRule,
  runtime: CalendarRuntime,
  window: RecurrenceWindow,
  limit = rule.limit ?? 200,
): RecurrenceOccurrence[] {
  return expand(base, rule, runtime, window, limit, true)
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

/** 周期规则的人类可读摘要（详情只读用；非法 JSON 原样返回）。 */
export function formatRecurrenceSummary(raw: string, calendar: Calendar): string {
  if (!raw) return '—'
  let rule: RecurrenceRule
  try {
    rule = JSON.parse(raw) as RecurrenceRule
  } catch {
    return raw
  }
  if (!rule || typeof rule !== 'object' || !rule.unit) return raw
  const name = calendar.units.find(unit => unit.id === rule.unit)?.name ?? rule.unit
  const every = Math.max(1, Number(rule.every) || 1)
  let text = every === 1 ? `每${name}` : `每 ${every} ${name}`
  if (rule.until) text += `，至 ${rule.until}`
  if (rule.exceptions?.length) text += `，跳过 ${rule.exceptions.length} 次`
  return text
}
