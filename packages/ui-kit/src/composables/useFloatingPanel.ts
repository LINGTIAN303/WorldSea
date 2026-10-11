import { ref, computed, onBeforeUnmount } from 'vue'
import { useResizable } from './useResizable'

export const Z_INDEX = {
  DROPDOWN: 1000,
  FLOATING: 10000,
  MODAL: 20000,
  GLOBAL: 30000,
} as const

export type AnchorCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface FloatingPanelOptions {
  width?: number
  height?: number
  zIndex?: number
  gap?: number
  padding?: number
  panelId?: string
}

export function useFloatingPanel(options: FloatingPanelOptions = {}) {
  const {
    width = 280,
    height = 320,
    zIndex = Z_INDEX.FLOATING,
    gap = 4,
    padding = 8,
    panelId,
  } = options

  const resizable = useResizable({
    panelId: panelId || `floating-${Date.now()}`,
    defaultWidth: width,
    minWidth: 160,
    side: 'right',
  })

  const visible = ref(false)
  const pinned = ref(false)
  const panelX = ref(0)
  const panelY = ref(0)
  const anchorCorner = ref<AnchorCorner>('top-left')

  const isDragging = ref(false)
  const dragOffsetX = ref(0)
  const dragOffsetY = ref(0)

  function computeAnchor(triggerRect: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number }): AnchorCorner {
    const cx = triggerRect.left + triggerRect.width / 2
    const cy = triggerRect.top + triggerRect.height / 2
    const vw = window.innerWidth
    const vh = window.innerHeight

    const isLeft = cx < vw / 2
    const isTop = cy < vh / 2

    if (isLeft && isTop) return 'top-left'
    if (!isLeft && isTop) return 'top-right'
    if (isLeft && !isTop) return 'bottom-left'
    return 'bottom-right'
  }

  function computePosition(triggerRect: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number }) {
    const corner = computeAnchor(triggerRect)
    anchorCorner.value = corner

    const currentWidth = resizable.width.value
    let left: number
    let top: number

    switch (corner) {
      case 'top-left':
        left = triggerRect.left
        top = triggerRect.bottom + gap
        break
      case 'top-right':
        left = triggerRect.right - currentWidth
        top = triggerRect.bottom + gap
        break
      case 'bottom-left':
        left = triggerRect.left
        top = triggerRect.top - height - gap
        break
      case 'bottom-right':
        left = triggerRect.right - currentWidth
        top = triggerRect.top - height - gap
        break
    }

    left = Math.max(padding, Math.min(left, window.innerWidth - currentWidth - padding))
    top = Math.max(padding, Math.min(top, window.innerHeight - height - padding))

    panelX.value = left
    panelY.value = top
  }

  function open(triggerRect: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number }) {
    computePosition(triggerRect)
    visible.value = true
    pinned.value = false
  }

  function close() {
    if (pinned.value) return
    visible.value = false
  }

  function forceClose() {
    visible.value = false
    pinned.value = false
  }

  function togglePin() {
    pinned.value = !pinned.value
  }

  function onDragStart(e: MouseEvent) {
    isDragging.value = true
    dragOffsetX.value = e.clientX - panelX.value
    dragOffsetY.value = e.clientY - panelY.value

    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
    e.preventDefault()
  }

  function onDragMove(e: MouseEvent) {
    if (!isDragging.value) return
    let newX = e.clientX - dragOffsetX.value
    let newY = e.clientY - dragOffsetY.value

    newX = Math.max(0, Math.min(newX, window.innerWidth - 60))
    newY = Math.max(0, Math.min(newY, window.innerHeight - 30))

    panelX.value = newX
    panelY.value = newY
  }

  function onDragEnd() {
    isDragging.value = false
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragEnd)
  }

  const panelStyle = computed(() => ({
    position: 'fixed' as const,
    left: `${panelX.value}px`,
    top: `${panelY.value}px`,
    width: `${resizable.width.value}px`,
    zIndex: zIndex,
  }))

  onBeforeUnmount(() => {
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragEnd)
  })

  return {
    visible,
    pinned,
    panelX,
    panelY,
    anchorCorner,
    panelStyle,
    isDragging,
    open,
    close,
    forceClose,
    togglePin,
    onDragStart,
    computePosition,
    onResizeStart: resizable.onResizeStart,
    isResizing: resizable.isResizing,
    resetWidth: resizable.resetWidth,
  }
}
