/**
 * 旧 `useDateParser` 的兼容适配层：对外保持 ParsedDate/EraInfo 契约，
 * 内部改走历法内核（默认简式历法）。
 *
 * 口径：旧代码只认「纪元 + 年」；解析不到纪元时 era=0（未知纪元），与旧行为一致。
 */
import { createSimpleCalendar } from './defaults'
import { createCalendarRuntime } from './math'
import { parseNumber } from './numeral'
import { parseTimePoint } from './parse'

export interface ParsedDate {
  raw: string
  era: number
  year: number
  month?: number
  day?: number
  isRange: boolean
  rawEnd?: string
  eraEnd?: number
  yearEnd?: number
  monthEnd?: number
  dayEnd?: number
}

export interface EraInfo {
  name: string
  index: number
  startYear: number
  endYear: number
}

const SIMPLE = createSimpleCalendar()
const RUNTIME = createCalendarRuntime(SIMPLE)

const CN = '零〇一二两三四五六七八九十百千万\\d'
const LEGACY_ERA_PATTERNS = [
  new RegExp(`第([${CN}]+)纪元`, 'i'),
  new RegExp(`第([${CN}]+)纪`, 'i'),
  new RegExp(`([${CN}]+)纪元`, 'i'),
  new RegExp(`纪元[：:\\s]*([${CN}]+)`, 'i'),
]
const LEGACY_YEAR_PATTERNS = [
  /(\d+)\s*年/,
  new RegExp(`第?([${CN}]+)\\s*年`),
  /(\d+)\s*(?:BC|B\.C\.|公元前)/i,
]

function pureNumber(text: string): number | null {
  const trimmed = text.trim()
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  if (/^[负零〇一二两三四五六七八九十百千万]+$/.test(trimmed)) return parseNumber(trimmed)
  return null
}

/** 旧文本里的纪元写法（第N纪 / N纪元 / 纪元：N 等） */
function legacyEra(text: string): number | null {
  for (const pattern of LEGACY_ERA_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      const value = parseNumber(match[1])
      if (value !== null) return value
    }
  }
  return null
}

/** 旧文本里的年份（含 BC）；先剔除纪元片段，避免把纪元数字当年份 */
function legacyYear(text: string): { year: number; isBC: boolean } | null {
  let source = text
  for (const pattern of LEGACY_ERA_PATTERNS) source = source.replace(pattern, ' ')
  for (const pattern of LEGACY_YEAR_PATTERNS) {
    const match = source.match(pattern)
    if (match) {
      const value = parseNumber(match[1])
      if (value !== null) {
        const isBC = /BC|B\.C\.|公元前/i.test(match[0])
        return { year: value, isBC }
      }
    }
  }
  const fallback = source.match(/(\d+)/)
  if (fallback) return { year: parseInt(fallback[1], 10), isBC: false }
  return null
}

export function parseDate(text: string): ParsedDate | null {
  if (!text || text === '?') return null
  const parsed = parseTimePoint(text, SIMPLE)
  if (!parsed) {
    const year = legacyYear(text)
    if (!year) {
      const fallback = pureNumber(text)
      return fallback === null ? null : { raw: text, era: 0, year: fallback, isRange: false }
    }
    return {
      raw: text,
      era: legacyEra(text) ?? 0,
      year: year.isBC ? -year.year : year.year,
      isRange: false,
    }
  }

  const hasEra = parsed.parsedLevels.includes(0)
  const era = hasEra ? Number(parsed.point.values[0]) : legacyEra(text) ?? 0
  const yearRaw = parsed.point.values[1]
  if (yearRaw === undefined) {
    const year = legacyYear(text)
    return year ? { raw: text, era, year: year.isBC ? -year.year : year.year, isRange: false } : null
  }
  let year = Number(yearRaw)
  if (/公元前|B\.?C\.?/i.test(text)) year = -Math.abs(year)
  return { raw: text, era, year, isRange: false }
}

export function parseDateRange(dateText: string, dateEndText: string): ParsedDate | null {
  const start = parseDate(dateText)
  if (!start) return null
  if (!dateEndText) return start
  const end = parseDate(dateEndText)
  if (!end) return start
  return {
    ...start,
    isRange: true,
    rawEnd: end.raw,
    eraEnd: end.era,
    yearEnd: end.year,
    monthEnd: end.month,
    dayEnd: end.day,
  }
}

export function compareDates(a: ParsedDate | null, b: ParsedDate | null): number {
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  if (a.era !== b.era) return a.era - b.era
  return a.year - b.year
}

export function detectEras(dates: (ParsedDate | null)[]): EraInfo[] {
  const eraMap = new Map<number, { minYear: number; maxYear: number }>()
  for (const date of dates) {
    if (!date) continue
    const existing = eraMap.get(date.era)
    if (existing) {
      existing.minYear = Math.min(existing.minYear, date.year)
      existing.maxYear = Math.max(existing.maxYear, date.year)
    } else {
      eraMap.set(date.era, { minYear: date.year, maxYear: date.year })
    }
  }
  return Array.from(eraMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([era, range], index) => ({
      name: era === 0 ? '未知纪元' : `第${era}纪元`,
      index,
      startYear: range.minYear,
      endYear: range.maxYear,
    }))
}

export function datesOverlap(a: ParsedDate | null, b: ParsedDate | null): boolean {
  if (!a || !b) return false
  if (a.era !== b.era) return false
  const aStart = a.year
  const aEnd = a.isRange && a.yearEnd ? a.yearEnd : a.year
  const bStart = b.year
  const bEnd = b.isRange && b.yearEnd ? b.yearEnd : b.year
  return aStart <= bEnd && bStart <= aEnd
}

export function parseScalar(text: string): number | null {
  const parsed = parseTimePoint(text, SIMPLE)
  return parsed ? RUNTIME.toScalar(parsed.point) : null
}

export function useDateParser() {
  return { parseDate, parseDateRange, compareDates, detectEras, datesOverlap }
}
