/**
 * 历法数学：单位链取值 ↔ 标量（最小单位计数）。
 *
 * 三条口径：
 * 1. 标量是唯一可比较量；排序/缩放/冲突/拖拽都只认它。
 * 2. 变长单位（命名月长、闰日、变长纪元）在换算时按实例求值，不做常量近似。
 * 3. 无界值只允许出现在顶层单位末尾（如「第三纪元」之后没有时间）。
 */
import type {
  Calendar, CalendarError, CalendarUnit, ResolvedTimePoint, TimePoint,
} from './types'
import { validateCalendar } from './validate'

/** 单位取值在单位内的序号：命名单位 = 值下标，数值单位 = 数值本身 */
export function valueIndex(unit: CalendarUnit, value: number | string): number {
  if (typeof value === 'number') return value
  if (unit.kind === 'numeric') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  const values = unit.values ?? []
  return values.findIndex(item => item.id === value || item.name === value)
}

/** 序号 → 持久化取值（命名单位用 id） */
export function encodeValue(unit: CalendarUnit, index: number): number | string {
  if (unit.kind === 'numeric') return index
  return unit.values?.[index]?.id ?? index
}

/** 单位取值起点（命名单位 0，数值单位 start ?? 1） */
export function unitStart(unit: CalendarUnit): number {
  return unit.kind === 'named' ? 0 : (unit.start ?? 1)
}

/** 取值在父级中的 1 起实例序号（闰规则用） */
function instanceIndex1(unit: CalendarUnit, value: number | string): number {
  return valueIndex(unit, value) - unitStart(unit) + 1
}

/** 周期闰判定：返回该实例应增加的子单位数 */
export function leapAdd(rule: CalendarUnit['leap'], parentIndex1: number): number {
  if (!rule || rule.every <= 0 || rule.add === 0) return 0
  const n = parentIndex1 - (rule.offset ?? 0)
  if (n <= 0 || n % rule.every !== 0) return 0
  if (rule.exceptEvery && rule.exceptEvery > 0 && n % rule.exceptEvery === 0) {
    const restored = rule.butEvery && rule.butEvery > 0 && n % rule.butEvery === 0
    if (!restored) return 0
  }
  return rule.add
}

export interface WeekdayInfo {
  index: number
  name: string
}

export interface CalendarRuntime {
  calendar: Calendar
  validate(): CalendarError[]
  unitLevel(unitId: string): number
  unitAt(level: number): CalendarUnit | undefined
  /** 该单位实例包含的下一级单位数量；无界返回 Infinity */
  childCount(level: number, value: number | string, parentIndex1: number): number
  /** 该单位实例折算成最小单位的长度 */
  lengthInBase(level: number, value: number | string, parentIndex1: number): number
  /** 当前层级取值之前已经过去的标量（用于色带/期段起点） */
  unitStartScalar(level: number, value: number | string, parentIndex1: number): number
  toScalar(point: TimePoint): number
  /** 该时间点按精度覆盖的标量长度（只写到年 = 一年；写到日 = 一天） */
  spanOf(point: TimePoint): number
  fromScalar(scalar: number, depth?: number): TimePoint
  resolve(point: TimePoint): ResolvedTimePoint
  shift(point: TimePoint, unitId: string, delta: number): TimePoint
  weekday(scalar: number): WeekdayInfo | null
}

/** 建一个历法运行时（内部缓存按实例隔离；历法编辑后重建） */
export function createCalendarRuntime(calendar: Calendar): CalendarRuntime {
  const units = calendar.units
  const last = units.length - 1
  const lengthCache = new Map<string, number>()
  const constCache: Array<{ isConst: boolean; base: number } | undefined> = []

  function unitLevel(unitId: string): number {
    return units.findIndex(unit => unit.id === unitId)
  }

  function constInfo(level: number): { isConst: boolean; base: number } {
    const cached = constCache[level]
    if (cached) return cached
    let base = 1
    let isConst = true
    for (let i = level; i <= last; i++) {
      const unit = units[i]
      if (unit.kind !== 'numeric' || unit.leap) {
        isConst = false
        break
      }
      if (i < last) {
        const factor = unit.factor ?? 0
        if (factor <= 0) {
          isConst = false
          break
        }
        base *= factor
      }
    }
    const info = { isConst, base }
    constCache[level] = info
    return info
  }

  function childCount(level: number, value: number | string, parentIndex1: number): number {
    const unit = units[level]
    if (!unit) throw new Error(`单位层级越界：${level}`)
    if (level === last) return 1
    let base: number | undefined
    let valueLeap: CalendarUnit['leap']
    if (unit.kind === 'named') {
      const index = valueIndex(unit, value)
      const item = unit.values?.[index]
      if (!item) throw new Error(`命名单位 ${unit.id} 没有取值 ${String(value)}`)
      base = item.length ?? unit.factor
      valueLeap = item.leap
      if (base === undefined && level === 0 && index === (unit.values?.length ?? 0) - 1) {
        return Infinity
      }
    } else {
      base = unit.factor
    }
    if (base === undefined || !Number.isFinite(base) || base <= 0) {
      throw new Error(`单位 ${unit.id} 缺少有效的 factor/取值长度`)
    }
    return base + leapAdd(unit.leap, parentIndex1) + leapAdd(valueLeap, parentIndex1)
  }

  function lengthInBase(level: number, value: number | string, parentIndex1: number): number {
    if (level === last) return 1
    const cacheKey = `${level}|${String(value)}|${parentIndex1}`
    const cached = lengthCache.get(cacheKey)
    if (cached !== undefined) return cached

    const count = childCount(level, value, parentIndex1)
    if (count === Infinity) {
      lengthCache.set(cacheKey, Infinity)
      return Infinity
    }
    const childLevel = level + 1
    const childConst = constInfo(childLevel)
    let total: number
    if (childLevel === last) {
      total = count
    } else if (childConst.isConst) {
      total = count * childConst.base
    } else {
      const unit = units[level]
      const thisIndex1 = instanceIndex1(unit, value)
      const childStart = unitStart(units[childLevel])
      total = 0
      for (let i = 0; i < count; i++) {
        total += lengthInBase(childLevel, childStart + i, thisIndex1)
      }
    }
    lengthCache.set(cacheKey, total)
    return total
  }

  function unitStartScalar(level: number, value: number | string, parentIndex1: number): number {
    const unit = units[level]
    if (!unit) throw new Error(`单位层级越界：${level}`)
    const index = valueIndex(unit, value)
    if (!Number.isFinite(index) || index < 0) throw new Error(`单位 ${unit.id} 的取值非法：${String(value)}`)
    let scalar = 0
    for (let v = unitStart(unit); v < index; v++) {
      const length = lengthInBase(level, v, parentIndex1)
      if (length === Infinity) throw new Error(`无界单位 ${unit.id} 之前不能再有取值`)
      scalar += length
    }
    return scalar
  }

  function toScalar(point: TimePoint): number {
    const values = point.values
    if (!values.length) throw new Error('时间点没有取值')
    let scalar = 0
    let parentIndex1 = 1
    const depth = Math.min(values.length, units.length)
    for (let level = 0; level < depth; level++) {
      const unit = units[level]
      const index = valueIndex(unit, values[level])
      if (!Number.isFinite(index) || index < 0) {
        throw new Error(`单位 ${unit.id} 的取值非法：${String(values[level])}`)
      }
      scalar += unitStartScalar(level, index, parentIndex1)
      parentIndex1 = index - unitStart(unit) + 1
    }
    return scalar
  }

  function spanOf(point: TimePoint): number {
    const depth = Math.min(point.values.length, units.length)
    if (depth <= 0) return 1
    const level = depth - 1
    const parentIndex1 = level === 0 ? 1 : instanceIndex1(units[level - 1], point.values[level - 1])
    return lengthInBase(level, point.values[level], parentIndex1)
  }

  function fromScalar(scalar: number, depth = units.length): TimePoint {
    if (!Number.isFinite(scalar)) throw new Error(`标量非法：${String(scalar)}`)
    const values: (number | string)[] = []
    let remaining = scalar
    let parentIndex1 = 1
    const maxDepth = Math.min(depth, units.length)

    for (let level = 0; level < maxDepth; level++) {
      const unit = units[level]
      const start = unitStart(unit)
      if (level === last) {
        values.push(encodeValue(unit, start + Math.floor(remaining)))
        remaining = 0
        break
      }

      const info = constInfo(level)
      if (info.isConst) {
        const steps = Math.floor(remaining / info.base)
        remaining -= steps * info.base
        values.push(encodeValue(unit, start + steps))
        parentIndex1 = steps + 1
        continue
      }

      let index = start
      let length = lengthInBase(level, index, parentIndex1)
      let guard = 0
      while (remaining >= length) {
        if (length === Infinity) break
        remaining -= length
        index++
        length = lengthInBase(level, index, parentIndex1)
        if (++guard > 10_000_000) throw new Error('历法换算超出安全次数，请检查单位长度')
      }
      values.push(encodeValue(unit, index))
      parentIndex1 = index - start + 1
    }

    return { calendarId: calendar.id, values, certainty: 'exact' }
  }

  function resolve(point: TimePoint): ResolvedTimePoint {
    return { ...point, scalar: toScalar(point) }
  }

  /** 把某个层级的取值增减后归一化（上级进位/借位，下级越界钳制） */
  function shift(point: TimePoint, unitId: string, delta: number): TimePoint {
    const level = unitLevel(unitId)
    if (level < 0) throw new Error(`历法中不存在单位：${unitId}`)
    const values: number[] = []
    for (let i = 0; i < units.length; i++) {
      if (i < point.values.length) {
        const index = valueIndex(units[i], point.values[i])
        if (!Number.isFinite(index)) throw new Error(`单位 ${units[i].id} 的取值非法`)
        values.push(index)
      } else {
        values.push(unitStart(units[i]))
      }
    }
    values[level] += delta
    normalize(values, level)

    const encoded: (number | string)[] = []
    const precision = Math.max(point.values.length, level + 1)
    for (let i = 0; i < Math.min(precision, units.length); i++) {
      encoded.push(encodeValue(units[i], values[i]))
    }
    return { ...point, values: encoded }
  }

  function normalize(values: number[], level: number) {
    for (let i = level; i >= 1; i--) {
      const unit = units[i]
      const parentValue = values[i - 1]
      const grandIndex1 = i - 1 === 0 ? 1 : instanceIndex1(units[i - 2], values[i - 2])
      let count = childCount(i - 1, parentValue, grandIndex1)
      if (count === Infinity) break
      const start = unitStart(unit)
      while (values[i] < start) {
        values[i] += count
        values[i - 1] -= 1
      }
      while (values[i] >= start + count) {
        values[i] -= count
        values[i - 1] += 1
      }
      // 上级变化后由循环下一轮继续归一
    }

    if (units[0].kind === 'named') {
      const count = units[0].values?.length ?? 1
      values[0] = Math.max(0, Math.min(count - 1, values[0]))
    }

    for (let i = level + 1; i < values.length; i++) {
      const unit = units[i]
      const parentValue = values[i - 1]
      const grandIndex1 = i - 1 === 0 ? 1 : instanceIndex1(units[i - 2], values[i - 2])
      const count = childCount(i - 1, parentValue, grandIndex1)
      if (count === Infinity) continue
      const start = unitStart(unit)
      if (values[i] >= start + count) values[i] = start + count - 1
      if (values[i] < start) values[i] = start
    }
  }

  function weekday(scalar: number): WeekdayInfo | null {
    const week = calendar.week
    if (!week || week.length <= 0) return null
    const dayLevel = unitLevel(week.dayUnit ?? 'day')
    if (dayLevel < 0) return null
    const dayConst = constInfo(dayLevel)
    const unitsPerDay = dayConst.isConst && dayConst.base > 0 ? dayConst.base : 1
    const anchorScalar = week.anchorScalar ?? 0
    const anchorIndex = week.anchorIndex ?? 0
    const days = Math.floor((scalar - anchorScalar) / unitsPerDay)
    const index = ((anchorIndex + days) % week.length + week.length) % week.length
    return { index, name: week.names[index] ?? String(index + 1) }
  }

  function validate(): CalendarError[] {
    return validateCalendar(calendar)
  }

  return {
    calendar,
    validate,
    unitLevel,
    unitAt: level => units[level],
    childCount,
    lengthInBase,
    unitStartScalar,
    toScalar,
    spanOf,
    fromScalar,
    resolve,
    shift,
    weekday,
  }
}


