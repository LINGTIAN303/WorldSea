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

const ERA_PATTERNS = [
  /第([零一二三四五六七八九十百千万\d]+)纪元/i,
  /第([零一二三四五六七八九十百千万\d]+)纪/i,
  /纪元[：:\s]*([零一二三四五六七八九十百千万\d]+)/i,
  /([零一二三四五六七八九十百千万\d]+)纪元/i,
]

const YEAR_PATTERNS = [
  /(\d+)\s*年/,
  /第?([零一二三四五六七八九十百千万\d]+)\s*年/,
  /(\d+)\s*(?:BC|B\.C\.|公元前)/i,
]

const CHINESE_DIGITS: Record<string, number> = {
  '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
  '十': 10, '百': 100, '千': 1000, '万': 10000,
}

function parseChineseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s)
  let result = 0
  let current = 0
  for (const ch of s) {
    const val = CHINESE_DIGITS[ch]
    if (val === undefined) return null
    if (val >= 10) {
      if (current === 0) current = 1
      current *= val
      result += current
      current = 0
    } else {
      current = val
    }
  }
  result += current
  return result
}

function parseEra(text: string): { index: number; remaining: string } | null {
  for (const pattern of ERA_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      const num = parseChineseNumber(match[1])
      if (num !== null) {
        return { index: num, remaining: text.replace(match[0], '').trim() }
      }
    }
  }
  return null
}

function parseYear(text: string): { year: number; isBC: boolean; remaining: string } | null {
  for (const pattern of YEAR_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      const num = parseChineseNumber(match[1])
      const isBC = /BC|B\.C\.|公元前/i.test(match[0])
      if (num !== null) {
        return { year: num, isBC, remaining: text.replace(match[0], '').trim() }
      }
    }
  }
  const numMatch = text.match(/(\d+)/)
  if (numMatch) {
    return { year: parseInt(numMatch[1]), isBC: false, remaining: text.replace(numMatch[0], '').trim() }
  }
  return null
}

function parseDateEnd(text: string): ParsedDate | null {
  if (!text) return null
  return parseDate(text)
}

export function parseDate(text: string): ParsedDate | null {
  if (!text || text === '?') return null

  const eraResult = parseEra(text)
  const era = eraResult?.index ?? 0
  const searchText = eraResult?.remaining ?? text

  const yearResult = parseYear(searchText)
  if (!yearResult) return null

  const year = yearResult.isBC ? -yearResult.year : yearResult.year

  return {
    raw: text,
    era,
    year,
    isRange: false,
  }
}

export function parseDateRange(dateText: string, dateEndText: string): ParsedDate | null {
  const start = parseDate(dateText)
  if (!start) return null

  if (dateEndText) {
    const end = parseDateEnd(dateEndText)
    if (end) {
      return {
        ...start,
        isRange: true,
        rawEnd: end.raw,
        eraEnd: end.era,
        yearEnd: end.year,
      }
    }
  }

  return start
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
  for (const d of dates) {
    if (!d) continue
    const existing = eraMap.get(d.era)
    if (existing) {
      existing.minYear = Math.min(existing.minYear, d.year)
      existing.maxYear = Math.max(existing.maxYear, d.year)
    } else {
      eraMap.set(d.era, { minYear: d.year, maxYear: d.year })
    }
  }
  return Array.from(eraMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([era, range], i) => ({
      name: era === 0 ? '未知纪元' : `第${era}纪元`,
      index: i,
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

export function useDateParser() {
  return { parseDate, parseDateRange, compareDates, detectEras, datesOverlap }
}