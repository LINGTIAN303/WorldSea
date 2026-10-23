/**
 * 时间线标尺：标量坐标 + 单位链层级缩放。
 *
 * 口径：
 * - 缩放级别 = 单位链下标（0 = 顶层单位，如纪元/劫；越大越细）。
 * - 主刻度 = 该级单位的边界，跨度过密时自动降到更粗一级并抽稀标签。
 * - 像素密度由「该级一个实例占 96px」推出，始终以标量为唯一坐标。
 * 详细见 docs/details/注释/apps/tauri/world/timeline-calendar.md
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { unitStart, valueIndex, type CalendarRuntime } from '../calendar/math'
import { formatUnitSegment } from '../calendar/format'
import type { AxisBand } from './useTimelinePoints'

export interface Tick {
  position: number
  label: string
  major: boolean
}

export interface ScaleBand {
  id: string
  label: string
  startX: number
  endX: number
  tone: 'base' | 'period'
  depth: number
  color?: string
}

export interface TimelineScaleOptions {
  /** 扣除泳道栏后的可绘制宽度 */
  viewportWidth: ComputedRef<number>
  runtime: ComputedRef<CalendarRuntime>
  events: Ref<{ startScalar: number; endScalar: number }[]>
  bands: Ref<AxisBand[]>
}

/** 一个单位实例在轴上的目标宽度 */
const UNIT_PX = 96
/** 相邻标签的最小间距，低于此值抽稀 */
const LABEL_GAP = 52
/** 次级刻度最小间距 */
const MINOR_GAP = 8

export function useTimelineScale(options: TimelineScaleOptions) {
  const { viewportWidth, runtime, events, bands } = options

  const zoomLevel = ref(0)
  const scrollOffset = ref(0)
  const fit = ref(true)
  /** 缩放锚点标量：非适配态下用它估算该级单位长度 */
  const anchor = ref(0)

  const maxLevel = computed(() => Math.max(0, runtime.value.calendar.units.length - 1))

  const timeRange = computed(() => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const event of events.value) {
      if (!Number.isFinite(event.startScalar) || !Number.isFinite(event.endScalar)) continue
      min = Math.min(min, event.startScalar)
      max = Math.max(max, event.endScalar)
    }
    if (!Number.isFinite(min)) { min = 0; max = 100 }
    if (max <= min) max = min + 1
    const padding = Math.max((max - min) * 0.04, 1)
    return { min: min - padding, max: max + padding }
  })

  /** 某级单位在指定标量处的一个实例长度；无界/异常回退 1 */
  function levelLength(level: number, scalar: number): number {
    const rt = runtime.value
    const units = rt.calendar.units
    if (level < 0 || level >= units.length) return 1
    try {
      const point = rt.fromScalar(Math.max(0, Math.floor(scalar)), level + 1)
      const value = point.values[level]
      const parentIndex1 = level === 0
        ? 1
        : valueIndex(units[level - 1], point.values[level - 1]) - unitStart(units[level - 1]) + 1
      const length = rt.lengthInBase(level, value, parentIndex1)
      if (Number.isFinite(length) && length > 0) return length
      // 无界单位（如末位命名纪元）没有有限长度：按可见跨度的 1/4 估算
      return Math.max(1, (timeRange.value.max - timeRange.value.min) / 4)
    } catch {
      return 1
    }
  }

  const pixelsPerBase = computed(() => {
    const span = timeRange.value.max - timeRange.value.min
    if (fit.value) return Math.max(1, viewportWidth.value) / span
    return UNIT_PX / levelLength(zoomLevel.value, anchor.value)
  })

  const totalWidth = computed(() => (timeRange.value.max - timeRange.value.min) * pixelsPerBase.value)

  function clampOffset(value: number): number {
    const max = Math.max(0, totalWidth.value - viewportWidth.value)
    return Math.max(0, Math.min(max, value))
  }

  watch([totalWidth, viewportWidth], () => { scrollOffset.value = clampOffset(scrollOffset.value) })

  function scalarToPixel(scalar: number): number {
    return (scalar - timeRange.value.min) * pixelsPerBase.value - scrollOffset.value
  }

  /** 内容坐标（不含滚动偏移，供缩略图使用） */
  function scalarToContentX(scalar: number): number {
    return (scalar - timeRange.value.min) * pixelsPerBase.value
  }

  function pixelToScalar(px: number): number {
    return timeRange.value.min + (px + scrollOffset.value) / pixelsPerBase.value
  }

  const viewportStart = computed(() => pixelToScalar(0))
  const viewportEnd = computed(() => pixelToScalar(viewportWidth.value))
  const viewportCenter = computed(() => pixelToScalar(viewportWidth.value / 2))
  const visible = computed(() => ({ start: viewportStart.value, end: viewportEnd.value }))

  /**
   * 实际标注的层级：从缩放级向细下探，取第一个「视口内至少两个实例」的层级。
   * 只用缩放级会让「视口落在单个纪元内部」时一条刻度都没有。
   */
  const labelLevel = computed(() => {
    const span = Math.max(1e-9, viewportEnd.value - viewportStart.value)
    let level = Math.min(zoomLevel.value, maxLevel.value)
    for (let candidate = level; candidate <= maxLevel.value; candidate++) {
      level = candidate
      if (span / Math.max(1e-9, levelLength(candidate, viewportCenter.value)) >= 2) break
    }
    return level
  })

  /**
   * 逐级边界：从 from 所在实例起点向后走到 to。
   * `sample` = 每级采样间隔（跨度过密时一次跳多个实例），cap 防御。
   */
  function boundaries(
    level: number, from: number, to: number, cap: number, sample = 1,
  ): { scalar: number; label: string }[] {
    const rt = runtime.value
    const units = rt.calendar.units
    const unit = units[level]
    const result: { scalar: number; label: string }[] = []
    if (!unit || !Number.isFinite(from) || !Number.isFinite(to) || to < 0) return result
    let scalar = 0
    try {
      scalar = rt.toScalar(rt.fromScalar(Math.max(0, from), level + 1))
    } catch {
      return result
    }
    let guard = 0
    while (scalar <= to && guard++ < cap) {
      let point
      try {
        point = rt.fromScalar(scalar, level + 1)
      } catch {
        break
      }
      const value = point.values[level]
      const parentIndex1 = level === 0
        ? 1
        : valueIndex(units[level - 1], point.values[level - 1]) - unitStart(units[level - 1]) + 1
      result.push({ scalar, label: formatUnitSegment(unit, value) })
      let length = 1
      try {
        length = rt.lengthInBase(level, value, parentIndex1)
      } catch {
        break
      }
      if (!Number.isFinite(length) || length <= 0) break
      scalar += length * Math.max(1, sample)
    }
    return result
  }

  const majorTicks = computed<Tick[]>(() => {
    const level = labelLevel.value
    const ppb = pixelsPerBase.value
    const spacing = levelLength(level, viewportCenter.value) * ppb
    const sample = Math.max(1, Math.ceil(LABEL_GAP / Math.max(spacing, 1e-9)))
    const list = boundaries(level, pixelToScalar(-200), pixelToScalar(viewportWidth.value + 200), 900, sample)
    const ticks: Tick[] = []
    let lastLabelX = Number.NEGATIVE_INFINITY
    for (const item of list) {
      const position = (item.scalar - timeRange.value.min) * ppb - scrollOffset.value
      if (position < -100 || position > viewportWidth.value + 100) continue
      // 变长单位下间距不均，标签再按像素间隔兜底抽稀（刻度线保留）
      const showLabel = position - lastLabelX >= LABEL_GAP
      if (showLabel) lastLabelX = position
      ticks.push({ position, label: showLabel ? item.label : '', major: true })
    }
    return ticks
  })

  const minorTicks = computed<Tick[]>(() => {
    const child = labelLevel.value + 1
    if (child > maxLevel.value) return []
    if (levelLength(child, viewportCenter.value) * pixelsPerBase.value < MINOR_GAP) return []
    return boundaries(child, viewportStart.value, viewportEnd.value, 500).map(item => ({
      position: (item.scalar - timeRange.value.min) * pixelsPerBase.value - scrollOffset.value,
      label: '',
      major: false,
    }))
  })

  const pixelBands = computed<ScaleBand[]>(() => bands.value.map(band => ({
    id: band.id,
    label: band.label,
    startX: scalarToPixel(band.start),
    endX: Number.isFinite(band.end) ? scalarToPixel(band.end) : viewportWidth.value + 4000,
    tone: band.tone,
    depth: band.depth,
    color: band.color,
  })))

  function zoomBy(delta: number) {
    const center = viewportCenter.value
    anchor.value = Number.isFinite(center) ? center : timeRange.value.min
    fit.value = false
    zoomLevel.value = Math.min(maxLevel.value, Math.max(0, zoomLevel.value + delta))
    scrollOffset.value = clampOffset((anchor.value - timeRange.value.min) * pixelsPerBase.value - viewportWidth.value / 2)
  }

  const zoomIn = () => zoomBy(1)
  const zoomOut = () => zoomBy(-1)

  function fitAll() {
    fit.value = true
    zoomLevel.value = 0
    scrollOffset.value = 0
  }

  function panBy(deltaPx: number) {
    scrollOffset.value = clampOffset(scrollOffset.value + deltaPx)
  }

  function setScrollOffset(value: number) {
    scrollOffset.value = clampOffset(value)
  }

  /** 把某标量平移到视口中心（选中聚焦/冲突跳转用） */
  function panToScalar(scalar: number) {
    scrollOffset.value = clampOffset((scalar - timeRange.value.min) * pixelsPerBase.value - viewportWidth.value / 2)
  }

  return {
    zoomLevel,
    labelLevel,
    maxLevel,
    pixelsPerBase,
    totalWidth,
    timeRange,
    scrollOffset,
    viewportStart,
    viewportEnd,
    visible,
    majorTicks,
    minorTicks,
    pixelBands,
    scalarToPixel,
    scalarToContentX,
    pixelToScalar,
    zoomIn,
    zoomOut,
    fitAll,
    panBy,
    panToScalar,
    setScrollOffset,
  }
}
