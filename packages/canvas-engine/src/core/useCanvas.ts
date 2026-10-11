import { ref, onMounted, onBeforeUnmount } from 'vue'

export interface CanvasState {
  panX: ReturnType<typeof ref<number>>
  panY: ReturnType<typeof ref<number>>
  scale: ReturnType<typeof ref<number>>
}

export function useCanvas() {
  const canvasRef = ref<HTMLCanvasElement>()
  let ctx: CanvasRenderingContext2D | null = null

  const panX = ref(0)
  const panY = ref(0)
  const scale = ref(1)
  const isPanning = ref(false)
  const spaceHeld = ref(false)

  function getCtx() {
    if (!ctx) {
      const canvas = canvasRef.value
      if (canvas) ctx = canvas.getContext('2d')
    }
    return ctx
  }

  function getDrawPos(e: MouseEvent) {
    const canvas = canvasRef.value
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  function resizeCanvas(width?: number, height?: number) {
    const canvas = canvasRef.value
    if (!canvas) return
    const viewport = canvas.parentElement
    canvas.width = width ?? viewport?.clientWidth ?? 800
    canvas.height = height ?? viewport?.clientHeight ?? 500
    getCtx()
  }

  function fillCanvas(color: string = '#ffffff') {
    const c = getCtx()
    const canvas = canvasRef.value
    if (!c || !canvas) return
    c.fillStyle = color
    c.fillRect(0, 0, canvas.width, canvas.height)
  }

  function saveState(history: ImageData[], future?: ImageData[], maxHistory: number = 50) {
    const c = getCtx()
    const canvas = canvasRef.value
    if (!c || !canvas) return
    history.push(c.getImageData(0, 0, canvas.width, canvas.height))
    if (history.length > maxHistory) history.shift()
    if (future) future.length = 0
  }

  function restoreState(data: ImageData) {
    const c = getCtx()
    if (!c) return
    c.putImageData(data, 0, 0)
  }

  function onWheel(e: WheelEvent) {
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const newScale = Math.min(5, Math.max(0.1, scale.value * factor))
    const viewport = canvasRef.value?.parentElement
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    panX.value = mx - (mx - panX.value) * (newScale / scale.value)
    panY.value = my - (my - panY.value) * (newScale / scale.value)
    scale.value = newScale
  }

  function zoomIn() { scale.value = Math.min(5, scale.value * 1.3) }
  function zoomOut() { scale.value = Math.max(0.1, scale.value * 0.7) }
  function fitView() { scale.value = 1; panX.value = 0; panY.value = 0 }

  // 【规范登记】Space 按住平移是「持续态键」（keydown 置位 / keyup 复位），
  // 不进 useShortcuts 注册表（注册表只分发单次按键）。改动前见 docs 快捷键系统文档。
  function setupKeyboard() {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        spaceHeld.value = true
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.value = false
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }

  function startPan(e: MouseEvent) {
    isPanning.value = true
    const startX = e.clientX - panX.value
    const startY = e.clientY - panY.value
    return { startX, startY }
  }

  function doPan(e: MouseEvent, startX: number, startY: number) {
    if (!isPanning.value) return
    panX.value = e.clientX - startX
    panY.value = e.clientY - startY
  }

  function endPan() { isPanning.value = false }

  function saveAsImage(filename?: string) {
    const canvas = canvasRef.value
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = filename || ('canvas-' + Date.now() + '.png')
    a.click()
  }

  let removeResizeListener: (() => void) | null = null

  onMounted(() => {
    const handler = () => resizeCanvas()
    window.addEventListener('resize', handler)
    removeResizeListener = () => window.removeEventListener('resize', handler)
  })

  onBeforeUnmount(() => {
    removeResizeListener?.()
  })

  return {
    canvasRef,
    getCtx,
    getDrawPos,
    resizeCanvas,
    fillCanvas,
    saveState,
    restoreState,
    panX,
    panY,
    scale,
    isPanning,
    spaceHeld,
    onWheel,
    zoomIn,
    zoomOut,
    fitView,
    setupKeyboard,
    startPan,
    doPan,
    endPan,
    saveAsImage,
  }
}
