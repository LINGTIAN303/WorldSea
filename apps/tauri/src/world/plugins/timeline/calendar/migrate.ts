/**
 * 旧事件日期迁移：`properties.date/dateEnd + era` → 规范文本 + calendarId。
 *
 * 口径：只改可解析的事件；解析失败保留原文并登记失败项，不丢数据。
 * `era` 属性保留为历史只读（不再参与计算）。
 */
import { formatTimePoint } from './format'
import { encodeValue, unitStart, valueIndex } from './math'
import { parseNumber } from './numeral'
import { parseTimePoint, parseUnitValue } from './parse'
import type { Calendar, TimePoint } from './types'

export interface LegacyEventLike {
  id: string
  properties: Record<string, unknown>
}

export interface MigrationFailure {
  id: string
  raw: string
  reason: string
}

export interface MigrationUpdate {
  id: string
  properties: Record<string, unknown>
}

export interface MigrationResult {
  updates: MigrationUpdate[]
  updated: number
  failed: MigrationFailure[]
  /** 遇到但历法里没有的纪元名（调用方可补进命名纪元） */
  missingEraNames: string[]
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 在文本里按单位格式取一个值（用于只有年份/只有纪元的旧文本） */
function parseLooseUnit(text: string, calendar: Calendar, unitId: string): number | string | null {
  const unit = calendar.units.find(item => item.id === unitId)
  if (!unit) return null
  const direct = parseUnitValue(text, unit)
  if (direct !== null) return direct
  if (unit.kind === 'numeric') {
    const number = parseNumber(text)
    return number === null ? null : number
  }
  return null
}

function buildPoint(
  calendar: Calendar,
  dateText: string,
  eraText: string,
): { point: TimePoint; reason?: string } | null {
  const parsed = parseTimePoint(dateText, calendar)
  if (parsed) {
    const point = parsed.point
    const hasEra = parsed.parsedLevels.includes(0)
    if (!hasEra && eraText) {
      const era = parseLooseUnit(eraText, calendar, calendar.units[0].id)
      if (era !== null) point.values[0] = era
    }
    if (point.values.length < 2) {
      return { point, reason: '缺少年份' }
    }
    return { point }
  }

  // 兜底：年份单独可解析（"147年" / "147"）+ 纪元字段
  const year = parseLooseUnit(dateText, calendar, 'year')
  if (year === null) return null
  const era = eraText ? parseLooseUnit(eraText, calendar, calendar.units[0].id) : null
  const values: (number | string)[] = [era ?? encodeValue(calendar.units[0], unitStart(calendar.units[0])), year]
  return { point: { calendarId: calendar.id, values, certainty: 'exact', raw: dateText } }
}

/** 迁移一批事件；纯函数，不写库 */
export function migrateEventDates(
  events: LegacyEventLike[],
  calendar: Calendar,
): MigrationResult {
  const updates: MigrationUpdate[] = []
  const failed: MigrationFailure[] = []
  const missingEraNames = new Set<string>()
  const eraUnit = calendar.units[0]

  for (const event of events) {
    const properties = event.properties ?? {}
    const dateText = textOf(properties.date)
    const endText = textOf(properties.dateEnd)
    const eraText = textOf(properties.era)
    if (eraUnit.kind === 'named' && eraText && parseLooseUnit(eraText, calendar, eraUnit.id) === null) {
      missingEraNames.add(eraText)
    }
    if (!dateText && !eraText) continue
    if (!dateText) {
      failed.push({ id: event.id, raw: eraText, reason: '没有日期文本' })
      continue
    }

    // 已迁移且规范文本可解析 → 跳过，保证幂等
    if (properties.calendarId === calendar.id && parseTimePoint(dateText, calendar)) continue

    const built = buildPoint(calendar, dateText, eraText)
    if (!built || built.reason) {
      failed.push({ id: event.id, raw: dateText, reason: built?.reason ?? '无法解析日期' })
      continue
    }

    if (eraUnit.kind === 'named' && eraText) {
      const index = valueIndex(eraUnit, built.point.values[0])
      if (index < 0) missingEraNames.add(eraText)
    }

    const next: Record<string, unknown> = {
      ...properties,
      // 日期文本只存纯日期；模糊限定词落到 dateCertainty，避免两套真相
      date: formatTimePoint({ ...built.point, certainty: 'exact' }, calendar),
      calendarId: calendar.id,
      dateCertainty: built.point.certainty,
    }

    if (endText) {
      const end = buildPoint(calendar, endText, eraText)
      if (end && !end.reason) {
        next.dateEnd = formatTimePoint({ ...end.point, certainty: 'exact' }, calendar)
      } else {
        failed.push({ id: event.id, raw: endText, reason: '结束日期无法解析' })
      }
    }

    updates.push({ id: event.id, properties: next })
  }

  return { updates, updated: updates.length, failed, missingEraNames: Array.from(missingEraNames) }
}
