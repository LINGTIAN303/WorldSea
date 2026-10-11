import { type Ref } from 'vue'

interface DragOptions {
  x: Ref<number>
  y: Ref<number>
  clampX?: (x: number) => number
  clampY?: (y: number) => number
  onDragEnd?: () => void
  excludeSelector?: string
}

interface ResizeOptions {
  w: Ref<number>
  h: Ref<number>
  minW?: number
  maxW?: number
  minH?: number
  maxH?: () => number
  onResizeEnd?: () => void
}

export function usePanelDrag(opts: DragOptions) {
  const { x, y, clampX = (v: number) => v, clampY = (v: number) => v, onDragEnd, excludeSelector } = opts
  let state: { startX: number; startY: number; origX: number; origY: number } | null = null

  function onStart(e: MouseEvent): void {
    if (excludeSelector && (e.target as HTMLElement).closest(excludeSelector)) return
    state = { startX: e.clientX, startY: e.clientY, origX: x.value, origY: y.value }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onEnd)
    e.preventDefault()
  }

  function onMove(e: MouseEvent): void {
    if (!state) return
    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY
    x.value = clampX(state.origX + dx)
    y.value = clampY(state.origY + dy)
  }

  function onEnd(): void {
    state = null
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
    onDragEnd?.()
  }

  return { onDragStart: onStart }
}

export function usePanelResize(opts: ResizeOptions) {
  const { w, h, minW = 200, maxW = 800, minH = 200, maxH = () => window.innerHeight, onResizeEnd } = opts
  let state: { startX: number; startY: number; origW: number; origH: number } | null = null

  function onStart(e: MouseEvent): void {
    state = { startX: e.clientX, startY: e.clientY, origW: w.value, origH: h.value }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onEnd)
    e.preventDefault()
  }

  function onMove(e: MouseEvent): void {
    if (!state) return
    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY
    w.value = Math.max(minW, Math.min(maxW, state.origW + dx))
    h.value = Math.max(minH, Math.min(maxH(), state.origH + dy))
  }

  function onEnd(): void {
    state = null
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
    onResizeEnd?.()
  }

  return { onResizeStart: onStart }
}
