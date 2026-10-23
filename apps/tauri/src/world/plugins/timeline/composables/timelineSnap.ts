/** 画布拖拽吸附：标量 → 当前标注单位的边界（纯函数，交互与测试共用）。 */
import type { Calendar, TimePoint } from '../calendar/types'
import { unitStart, valueIndex, type CalendarRuntime } from '../calendar/math'
import { formatTimePoint } from '../calendar/format'

export interface SnapContext {
  runtime: CalendarRuntime
  calendar: Calendar
  /** 当前轴标注层级（0 起，单位链下标） */
  level: number
}

/** 吸附精度 = 标注层级 + 1（至少到该级） */
export function snapDepth(ctx: SnapContext): number {
  return Math.min(Math.max(0, ctx.level) + 1, ctx.calendar.units.length)
}

/** 向下取整到单位边界 */
export function snapFloor(ctx: SnapContext, scalar: number): TimePoint {
  const depth = snapDepth(ctx)
  try {
    return ctx.runtime.fromScalar(Math.max(0, scalar), depth)
  } catch {
    return ctx.runtime.fromScalar(0, depth)
  }
}

/** 向上取整到单位边界（范围终点用） */
export function snapCeil(ctx: SnapContext, scalar: number): TimePoint {
  const depth = snapDepth(ctx)
  const floored = snapFloor(ctx, scalar)
  try {
    const level = depth - 1
    const units = ctx.calendar.units
    const value = floored.values[level]
    const parentIndex1 = level === 0
      ? 1
      : valueIndex(units[level - 1], floored.values[level - 1]) - unitStart(units[level - 1]) + 1
    const length = ctx.runtime.lengthInBase(level, value, parentIndex1)
    if (!Number.isFinite(length) || length <= 0) return floored
    const start = ctx.runtime.toScalar(floored)
    return ctx.runtime.fromScalar(start + length, depth)
  } catch {
    return floored
  }
}

/** 按该时间点自身精度格式化（保留单位链取值长度） */
export function formatSnapped(ctx: SnapContext, point: TimePoint): string {
  return formatTimePoint(point, ctx.calendar, point.values.length)
}
