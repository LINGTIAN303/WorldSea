import { ref, shallowRef, type Ref } from 'vue'
import { drawMoodboard, hitTestCard, type MoodboardCamera, type MoodboardRenderData, type CardData } from './moodboardDraw'

export function useMoodboardRenderer(
  containerRef: Ref<HTMLElement | null>,
  renderData: Ref<MoodboardRenderData>,
) {
  const canvas = shallowRef<HTMLCanvasElement | null>(null)
  const ctx = shallowRef<CanvasRenderingContext2D | null>(null)
  const camera = ref<MoodboardCamera>({ x: 0, y: 0, k: 1 })

  let isRunning = false
  let animFrame = 0
  let _dirty = true
  let _forceRenderCount = 0
  let resizeObs: ResizeObserver | null = null

  function init(): void {
    if (!containerRef.value) return
    const el = document.createElement('canvas')
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.display = 'block'
    el.style.cursor = 'grab'
    containerRef.value.appendChild(el)
    canvas.value = el
    const c = el.getContext('2d')
    if (!c) return
    ctx.value = c
    resize()
    startRenderLoop()
    resizeObs = new ResizeObserver(() => { resize() })
    resizeObs.observe(containerRef.value)
  }

  function destroy(): void {
    isRunning = false
    if (animFrame) cancelAnimationFrame(animFrame)
    if (resizeObs) resizeObs.disconnect()
    if (canvas.value && canvas.value.parentNode) {
      canvas.value.parentNode.removeChild(canvas.value)
    }
    canvas.value = null
    ctx.value = null
  }

  function resize(): void {
    if (!canvas.value || !containerRef.value) return
    const rect = containerRef.value.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.value.width = rect.width * dpr
    canvas.value.height = rect.height * dpr
    canvas.value.style.width = rect.width + 'px'
    canvas.value.style.height = rect.height + 'px'
    ctx.value?.scale(dpr, dpr)
    markDirty()
  }

  function markDirty(): void { _dirty = true }

  function startRenderLoop(): void {
    isRunning = true
    _forceRenderCount = 3
    function frame() {
      if (!isRunning) return
      if (_dirty || _forceRenderCount > 0) {
        render()
        _dirty = false
        if (_forceRenderCount > 0) _forceRenderCount--
      }
      animFrame = requestAnimationFrame(frame)
    }
    frame()
  }

  function render(): void {
    if (!ctx.value || !canvas.value || !containerRef.value) return
    const rect = containerRef.value.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    ctx.value.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawMoodboard(ctx.value, rect.width, rect.height, renderData.value, camera.value)
  }

  function getCanvasElement(): HTMLCanvasElement | null { return canvas.value }
  function getCamera(): MoodboardCamera { return { ...camera.value } }
  function setCamera(c: MoodboardCamera): void { camera.value = c; markDirty() }

  function screenToWorld(sx: number, sy: number): { x: number; y: number } {
    if (!containerRef.value) return { x: sx, y: sy }
    const rect = containerRef.value.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    return {
      x: (sx - rect.left - cx) / camera.value.k + camera.value.x,
      y: (sy - rect.top - cy) / camera.value.k + camera.value.y,
    }
  }

  function hitTest(worldX: number, worldY: number): CardData | null {
    return hitTestCard(worldX, worldY, renderData.value.cards)
  }

  return {
    canvas, camera, init, destroy, resize, markDirty,
    getCanvasElement, getCamera, setCamera, screenToWorld, hitTest,
  }
}
