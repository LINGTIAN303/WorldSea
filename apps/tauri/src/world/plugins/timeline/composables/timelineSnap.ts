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

/** 拖拽气泡：单个落点按吸附规则格式化 */
export function describeDragPoint(ctx: SnapContext, scalar: number, mode: 'floor' | 'ceil' = 'floor'): string {
  return formatSnapped(ctx, mode === 'ceil' ? snapCeil(ctx, scalar) : snapFloor(ctx, scalar))
}

/** 拖拽气泡：区间起止；end 为 null 表示点事件 */
export function describeDragRange(
  ctx: SnapContext,
  start: number,
  end: number | null,
  runtime: CalendarRuntime,
): string {
  const startPoint = snapFloor(ctx, start)
  const startText = formatSnapped(ctx, startPoint)
  if (end === null) return startText
  try {
    const span = Math.max(1, end - runtime.toScalar(startPoint))
    const endPoint = runtime.fromScalar(runtime.toScalar(startPoint) + span, snapDepth(ctx))
    return `${startText} ~ ${formatSnapped(ctx, endPoint)}`
  } catch {
    return startText
  }
}

export interface DragHintPoint {
  raw: string
  rawEnd?: string
  range: boolean
}

/** 移动/拉伸中的日期气泡文案（与落点吸附同一套规则） */
export function dragHintText(
  ctx: SnapContext,
  point: DragHintPoint,
  mode: 'move' | 'resize-start' | 'resize-end',
  originStart: number,
  originEnd: number,
  delta: number,
  runtime: CalendarRuntime,
): string {
  if (mode === 'move') {
    return describeDragRange(ctx, originStart + delta, point.range ? originEnd + delta : null, runtime)
  }
  if (mode === 'resize-start') {
    return `${describeDragPoint(ctx, originStart + delta)} ~ ${point.rawEnd ?? ''}`
  }
  return `${point.raw} ~ ${describeDragPoint(ctx, originEnd + delta, 'ceil')}`
}
