/**
 * 文本日期解析：按历法的单位格式逐级提取。
 *
 * 口径：
 * - 命名单位直接匹配取值名（长名优先）；数值单位按 `format` 的 `{value}` 位置提取。
 * - 某一级没写就跳过，允许只写「147年」；解析到的最高层级决定精度。
 * - 解析失败不丢原文：调用方拿 null 时保留 raw。
 */
import type { Certainty, Calendar, CalendarUnit, ParseResult, TimePoint } from './types'
import { encodeValue, unitStart, valueIndex } from './math'
import { parseNumber } from './numeral'

const CERTAINTY_PATTERNS: Array<{ prefix: string; certainty: Certainty }> = [
  { prefix: '传说', certainty: 'legend' },
  { prefix: '早于', certainty: 'before' },
  { prefix: '晚于', certainty: 'after' },
  { prefix: '大约', certainty: 'approx' },
  { prefix: '约', certainty: 'approx' },
]

const NUMBER_PATTERN = '-?\\d+|负?[零〇一二两三四五六七八九十百千万]+'

interface UnitMatch {
  index: number
  length: number
  value: number | string
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripCertainty(text: string): { body: string; certainty: Certainty } {
  for (const item of CERTAINTY_PATTERNS) {
    if (text.startsWith(item.prefix)) {
      return { body: text.slice(item.prefix.length).trim(), certainty: item.certainty }
    }
  }
  return { body: text, certainty: 'exact' }
}

function unitFormat(unit: CalendarUnit): string {
  return unit.format ?? (unit.kind === 'named' ? '{value}' : `{value}${unit.name}`)
}

/** 命名单位：在文本中找最早的取值名（同位置取更长者） */
function matchNamed(unit: CalendarUnit, text: string): UnitMatch | null {
  const values = unit.values ?? []
  let best: { at: number; length: number; index: number } | null = null
  values.forEach((item, index) => {
    if (!item.name) return
    const at = text.indexOf(item.name)
    if (at < 0) return
    if (!best || at < best.at || (at === best.at && item.name.length > best.length)) {
      best = { at, length: item.name.length, index }
    }
  })
  if (!best) return null
  const candidate = best as { at: number; length: number; index: number }
  return {
    index: candidate.at,
    length: candidate.length,
    value: encodeValue(unit, candidate.index),
  }
}

/** 数值单位：按单位格式里的 {value} 位置做正则提取 */
function matchNumeric(unit: CalendarUnit, text: string): UnitMatch | null {
  const template = unitFormat(unit)
  const parts = template.split('{value}')
  const pattern = parts.length >= 2
    ? parts.map(escapeRegExp).join(`(${NUMBER_PATTERN})`)
    : `(${NUMBER_PATTERN})`
  const match = new RegExp(pattern).exec(text)
  if (!match) return null
  const raw = match[1]
  const number = parseNumber(raw)
  if (number === null) return null
  return { index: match.index, length: match[0].length, value: number }
}

function matchUnit(unit: CalendarUnit, text: string): UnitMatch | null {
  return unit.kind === 'named' ? matchNamed(unit, text) : matchNumeric(unit, text)
}

/** 解析单个单位的取值（迁移旧 `era` 字段用） */
export function parseUnitValue(text: string, unit: CalendarUnit): number | string | null {
  const match = matchUnit(unit, text)
  return match ? match.value : null
}

export interface ParseOptions {
  /** 是否要求至少解析到某一级（默认 0，即至少匹配一个单位） */
  minLevel?: number
}

/** 解析日期文本；失败返回 null */
export function parseTimePoint(
  text: string,
  calendar: Calendar,
  options: ParseOptions = {},
): ParseResult | null {
  const original = text.trim()
  if (!original || original === '?') return null
  const { body, certainty } = stripCertainty(original)
  if (!body) return null

  let remaining = body
  const chosen: Array<number | string | undefined> = new Array(calendar.units.length)
  const parsedLevels: number[] = []
  let highest = -1

  calendar.units.forEach((unit, level) => {
    const match = matchUnit(unit, remaining)
    if (!match) return
    chosen[level] = match.value
    parsedLevels.push(level)
    highest = Math.max(highest, level)
    remaining = (remaining.slice(0, match.index) + remaining.slice(match.index + match.length)).trim()
  })

  if (highest < (options.minLevel ?? 0)) return null

  const values: (number | string)[] = []
  for (let level = 0; level <= highest; level++) {
    const unit = calendar.units[level]
    const value = chosen[level]
    values.push(value === undefined ? encodeValue(unit, unitStart(unit)) : value)
  }

  const point: TimePoint = {
    calendarId: calendar.id,
    values,
    certainty,
    raw: original,
  }
  return { point, parsedLevels, rest: remaining }
}

/** 解析起止文本 */
export function parseTimeRange(
  startText: string,
  endText: string | undefined,
  calendar: Calendar,
): { start: TimePoint; end?: TimePoint } | null {
  const start = parseTimePoint(startText, calendar)
  if (!start) return null
  if (!endText) return { start: start.point }
  const end = parseTimePoint(endText, calendar)
  return end ? { start: start.point, end: end.point } : { start: start.point }
}

/** 取值是否落在该命名单位的合法序号内 */
export function isValidUnitValue(unit: CalendarUnit, value: number | string): boolean {
  if (unit.kind === 'numeric') return Number.isFinite(Number(value))
  return valueIndex(unit, value) >= 0
}
