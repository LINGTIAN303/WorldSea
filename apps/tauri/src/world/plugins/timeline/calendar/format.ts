/** 时间点格式化：单位片段拼接 + 模糊限定词。 */
import type { Certainty, Calendar, CalendarUnit, TimePoint } from './types'
import { formatNumber } from './numeral'
import { valueIndex } from './math'

const CERTAINTY_PREFIX: Record<Certainty, string> = {
  exact: '',
  approx: '约 ',
  before: '早于 ',
  after: '晚于 ',
  legend: '传说 ',
}

/** 单位片段缺省值 */
export function defaultUnitFormat(unit: CalendarUnit): string {
  return unit.kind === 'named' ? '{value}' : `{value}${unit.name}`
}

/** 单个取值的显示文本 */
export function formatUnitValue(unit: CalendarUnit, value: number | string): string {
  if (unit.kind === 'named') {
    const index = valueIndex(unit, value)
    return unit.values?.[index]?.name ?? String(value)
  }
  const number = Number(value)
  return formatNumber(number, unit.numeral ?? 'arabic')
}

/** 单位片段的最终文本 */
export function formatUnitSegment(unit: CalendarUnit, value: number | string): string {
  const template = unit.format ?? defaultUnitFormat(unit)
  return template.replaceAll('{value}', formatUnitValue(unit, value))
}

/**
 * 格式化时间点。
 * @param depth 精度（默认按 point.values 长度；大于长度时按长度）
 */
export function formatTimePoint(point: TimePoint, calendar: Calendar, depth = point.values.length): string {
  const levels = Math.min(depth, calendar.units.length, point.values.length)
  if (levels <= 0) return point.raw ?? ''
  const segments: string[] = []
  for (let level = 0; level < levels; level++) {
    segments.push(formatUnitSegment(calendar.units[level], point.values[level]))
  }
  let body: string
  if (calendar.format) {
    body = calendar.format.replace(/\{(\d+)\}/g, (_match, raw: string) => segments[Number(raw)] ?? '')
  } else {
    body = segments.join('')
  }
  return CERTAINTY_PREFIX[point.certainty] + body
}

/** 范围文本 */
export function formatTimeRange(start: TimePoint, end: TimePoint | undefined, calendar: Calendar): string {
  const left = formatTimePoint(start, calendar)
  if (!end) return left
  return `${left} ~ ${formatTimePoint(end, calendar)}`
}

/** 模糊限定词（供 UI 徽标使用） */
export function certaintyPrefix(certainty: Certainty): string {
  return CERTAINTY_PREFIX[certainty]
}
