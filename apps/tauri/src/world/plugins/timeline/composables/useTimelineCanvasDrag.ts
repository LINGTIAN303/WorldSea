/**
 * 画布指针交互：创建区间 / 单击建点 / 事件移动与两端拉伸 / 框选 / 平移。
 *
 * 口径：
 * - 左键空白拖拽 = 创建（批量态 = 框选）；Alt / 中键 = 平移。
 * - 事件条左键拖拽 = 移动；两端 6px = 拉伸；受「拖拽改时间」设置开关控制。
 * - 落点按当前标注层级吸附，写回规范文本；撤销由 entityStore 的更新记录承接。
 */
import { onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import type { Calendar } from '../calendar/types'
import type { CalendarRuntime } from '../calendar/math'
import { formatTimePoint } from '../calendar/format'
import type { EventTime } from './useTimelinePoints'
import { formatSnapped, snapCeil, snapFloor, type SnapContext } from './timelineSnap'

export interface TimelineRect {
  left: number
  top: number
  width: number
  height: number
}

export interface CanvasCreatePreset {
  date: string
  dateEnd?: string
  calendarId: string
}

export interface CanvasDragOptions {
  bodyEl: Ref<HTMLElement | undefined>
  runtime: ComputedRef<CalendarRuntime>
  calendar: ComputedRef<Calendar>
  labelLevel: ComputedRef<number>
  pixelsPerBase: ComputedRef<number>
  scrollOffset: Ref<number>
  pixelToScalar: (px: number) => number
  setScrollOffset: (value: number) => void
  sidebarWidth: number
  dragEnabled: ComputedRef<boolean>
  batchMode: ComputedRef<boolean>
  points: ComputedRef<Map<string, EventTime>>
  eventOf: (id: string) => Entity | undefined
  update: (id: string, changes: Partial<Entity>) => Promise<unknown>
  onCreate: (preset: CanvasCreatePreset) => void
  onSelectMany: (ids: string[]) => void
  selectInRect: (rect: { left: number; top: number; right: number; bottom: number }) => string[]
}

type ItemMode = 'move' | 'resize-start' | 'resize-end'

interface ItemDragState {
  id: string
  mode: ItemMode
  startX: number
  originStart: number
  originEnd: number
  currentX: number
}

interface PointerState {
  mode: 'item' | 'create' | 'marquee' | 'pan'
  startX: number
  startY: number
  currentX: number
  currentY: number
  bodyTop: number
  bodyLeft: number
  scrollTop: number
  panStartOffset: number
  item?: ItemDragState
}

const EDGE_PX = 6
const CLICK_THRESHOLD = 3

export function useTimelineCanvasDrag(options: CanvasDragOptions) {
  const previewStart = ref<Map<string, number>>(new Map())
  const previewEnd = ref<Map<string, number>>(new Map())
  const ghost = ref<TimelineRect | null>(null)
  const marquee = ref<TimelineRect | null>(null)
  /** 正在拖拽的事件 id（供事件条 is-dragging 样式） */
  const activeId = ref<string | null>(null)
  /** 拖拽结束后吞掉随后的 click（避免误开详情），下一宏任务复位 */
  const clickSuppressed = ref(false)

  let state: PointerState | null = null

  function snapContext(): SnapContext {
    return { runtime: options.runtime.value, calendar: options.calendar.value, level: options.labelLevel.value }
  }

  function contentPoint(event: MouseEvent) {
    const body = options.bodyEl.value
    if (!body) return null
    const rect = body.getBoundingClientRect()
    return {
      rect,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top + body.scrollTop,
      viewX: event.clientX - rect.left - options.sidebarWidth,
    }
  }

  function clearPreview() {
    previewStart.value = new Map()
    previewEnd.value = new Map()
  }

  function setPreview(id: string, start: number, end: number) {
    const starts = new Map(previewStart.value)
    const ends = new Map(previewEnd.value)
    starts.set(id, start)
    ends.set(id, end)
    previewStart.value = starts
    previewEnd.value = ends
  }

  function attach(onMove: (event: MouseEvent) => void) {
    const move = (event: MouseEvent) => onMove(event)
    const up = (event: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      finish(event)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function onPointerDown(event: MouseEvent) {
    const body = options.bodyEl.value
    const target = event.target as HTMLElement
    if (!body || target.closest('.lane-side, button')) return
    if (event.button !== 0 && event.button !== 1) return

    const at = contentPoint(event)
    if (!at) return
    const base = {
      startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY,
      bodyTop: at.rect.top, bodyLeft: at.rect.left, scrollTop: body.scrollTop, panStartOffset: options.scrollOffset.value,
    }

    // 平移：中键或 Alt + 拖拽（画布/轴通用）
    if (event.button === 1 || event.altKey) {
      event.preventDefault()
      state = { ...base, mode: 'pan' }
      body.style.cursor = 'grabbing'
      attach(panMove)
      return
    }

    const bar = target.closest<HTMLElement>('[data-event-id]')
    if (bar?.dataset.eventId) {
      // 周期 occurrence 是派生标记，不参与移动/拉伸（点击仍打开基础事件）
      if (bar.dataset.occurrence) return
      if (!options.dragEnabled.value) return
      const item = beginItemDrag(bar, event)
      if (!item) return
      event.preventDefault()
      state = { ...base, mode: 'item', item }
      activeId.value = item.id
      attach(itemMove)
      return
    }

    event.preventDefault()
    if (options.batchMode.value) {
      state = { ...base, mode: 'marquee' }
      marquee.value = { left: at.x, top: at.y, width: 0, height: 0 }
      attach(marqueeMove)
    } else {
      state = { ...base, mode: 'create' }
      attach(createMove)
    }
  }

  function beginItemDrag(bar: HTMLElement, event: MouseEvent): ItemDragState | null {
    const id = bar.dataset.eventId
    if (!id) return null
    const point = options.points.value.get(id)
    if (!point || !Number.isFinite(point.startScalar)) return null
    const rect = bar.getBoundingClientRect()
    const mode: ItemMode = !point.range
      ? 'move'
      : rect.width > EDGE_PX * 3 && event.clientX - rect.left <= EDGE_PX
        ? 'resize-start'
        : rect.width > EDGE_PX * 3 && rect.right - event.clientX <= EDGE_PX
          ? 'resize-end' : 'move'
    setPreview(id, point.startScalar, point.endScalar)
    return {
      id, mode, startX: event.clientX,
      originStart: point.startScalar, originEnd: point.endScalar, currentX: event.clientX,
    }
  }

  function panMove(event: MouseEvent) {
    if (!state) return
    options.setScrollOffset(state.panStartOffset - (event.clientX - state.startX))
  }

  function itemMove(event: MouseEvent) {
    if (!state?.item) return
    const item = state.item
    item.currentX = event.clientX
    const delta = (event.clientX - item.startX) / options.pixelsPerBase.value
    if (item.mode === 'move') {
      setPreview(item.id, item.originStart + delta, item.originEnd + delta)
    } else if (item.mode === 'resize-start') {
      setPreview(item.id, Math.min(item.originStart + delta, item.originEnd - 1), item.originEnd)
    } else {
      setPreview(item.id, item.originStart, Math.max(item.originEnd + delta, item.originStart + 1))
    }
  }

  function createMove(event: MouseEvent) {
    if (!state) return
    const body = options.bodyEl.value
    if (!body) return
    const rect = body.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top + body.scrollTop
    state.currentX = event.clientX
    state.currentY = event.clientY
    ghost.value = {
      left: Math.min(state.startX - state.bodyLeft, x),
      top: Math.min(state.startY - state.bodyTop + state.scrollTop, y),
      width: Math.abs(x - (state.startX - state.bodyLeft)),
      height: Math.abs(y - (state.startY - state.bodyTop + state.scrollTop)),
    }
  }

  function marqueeMove(event: MouseEvent) {
    if (!state) return
    const body = options.bodyEl.value
    if (!body) return
    const rect = body.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top + body.scrollTop
    state.currentX = event.clientX
    state.currentY = event.clientY
    marquee.value = {
      left: Math.min(state.startX - state.bodyLeft, x),
      top: Math.min(state.startY - state.bodyTop + state.scrollTop, y),
      width: Math.abs(x - (state.startX - state.bodyLeft)),
      height: Math.abs(y - (state.startY - state.bodyTop + state.scrollTop)),
    }
  }

  async function finish(event: MouseEvent) {
    const current = state
    state = null
    activeId.value = null
    const body = options.bodyEl.value
    if (body) body.style.cursor = ''
    if (!current) return

    if (current.mode === 'pan') return

    if (current.mode === 'marquee') {
      const rect = marquee.value
      marquee.value = null
      if (!rect || rect.width < 4 || rect.height < 4) return
      const ids = options.selectInRect({
        left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height,
      })
      if (ids.length) options.onSelectMany(ids)
      return
    }

    if (current.mode === 'create') {
      const moved = Math.abs(event.clientX - current.startX) >= CLICK_THRESHOLD
      ghost.value = null
      const ctx = snapContext()
      try {
        const startScalar = options.pixelToScalar(current.startX - current.bodyLeft - options.sidebarWidth)
        if (!moved) {
          const point = snapFloor(ctx, startScalar)
          options.onCreate({ date: formatSnapped(ctx, point), calendarId: options.calendar.value.id })
          return
        }
        const endScalar = options.pixelToScalar(event.clientX - current.bodyLeft - options.sidebarWidth)
        const left = Math.min(startScalar, endScalar)
        const right = Math.max(startScalar, endScalar)
        const start = snapFloor(ctx, left)
        let end = snapCeil(ctx, right)
        if (options.runtime.value.toScalar(end) <= options.runtime.value.toScalar(start)) end = snapCeil(ctx, left + 1)
        options.onCreate({
          date: formatSnapped(ctx, start),
          dateEnd: formatTimePoint(end, options.calendar.value, end.values.length),
          calendarId: options.calendar.value.id,
        })
      } catch { /* 非法落点不建事件 */ }
      return
    }

    const item = current.item
    if (!item) return
    const moved = Math.abs(item.currentX - item.startX) >= CLICK_THRESHOLD
    const startPreview = previewStart.value.get(item.id)
    const endPreview = previewEnd.value.get(item.id)
    clearPreview()
    if (!moved || startPreview === undefined || endPreview === undefined) return

    const delta = (item.currentX - item.startX) / options.pixelsPerBase.value
    clickSuppressed.value = true
    setTimeout(() => { clickSuppressed.value = false }, 0)
    await commitItem(item, delta)
  }

  async function commitItem(item: ItemDragState, delta: number) {
    const entity = options.eventOf(item.id)
    const point = options.points.value.get(item.id)
    if (!entity || !point || !point.start) return
    const ctx = snapContext()
    const runtime = options.runtime.value
    const units = options.calendar.value.units
    const properties: Record<string, unknown> = { ...entity.properties }

    try {
      if (item.mode === 'move') {
        const start = snapFloor(ctx, item.originStart + delta)
        const startScalar = runtime.toScalar(start)
        properties.date = formatSnapped(ctx, start)
        if (point.range && point.end) {
          const depth = Math.min(Math.max(point.start.values.length, point.end.values.length), units.length)
          const end = runtime.fromScalar(startScalar + Math.max(1, item.originEnd - item.originStart), depth)
          properties.dateEnd = formatTimePoint(end, options.calendar.value, end.values.length)
        }
      } else if (item.mode === 'resize-start') {
        const start = snapFloor(ctx, item.originStart + delta)
        if (runtime.toScalar(start) >= item.originEnd) return
        properties.date = formatSnapped(ctx, start)
      } else {
        let end = snapCeil(ctx, item.originEnd + delta)
        if (runtime.toScalar(end) <= item.originStart) end = snapCeil(ctx, item.originStart + 1)
        properties.dateEnd = formatTimePoint(end, options.calendar.value, end.values.length)
      }
    } catch {
      return
    }

    await options.update(item.id, { properties })
  }

  function onAxisPanStart(event: MouseEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    state = {
      mode: 'pan', startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY,
      bodyTop: 0, bodyLeft: 0, scrollTop: 0, panStartOffset: options.scrollOffset.value,
    }
    const body = options.bodyEl.value
    if (body) body.style.cursor = 'grabbing'
    attach(panMove)
  }

  function cancel() {
    state = null
    activeId.value = null
    clearPreview()
    ghost.value = null
    marquee.value = null
  }

  onBeforeUnmount(cancel)

  return { previewStart, previewEnd, ghost, marquee, activeId, clickSuppressed, onPointerDown, onAxisPanStart, cancel }
}

/** 供 Canvas 计算框选命中（纯函数：矩形相交） */
export function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom
}
