import { ref, watch, onBeforeUnmount, onMounted, type Ref } from 'vue'
import type { CameraState, CanvasNode, CanvasEdge } from './canvasTypes'
import { drawGraph, invalidateThemeCache, type FreehandDrawFn } from './canvasDraw'

export function useCanvasRenderer(
  containerRef: Ref<HTMLElement | null>,
  getNodes: () => CanvasNode[],
  getEdges: () => CanvasEdge[],
  getAISuggestions?: () => Array<{ sourceId: string; targetId: string; relType: string }>,
  getHighlightedIds?: () => Set<string>,
) {
  const canvas = ref<HTMLCanvasElement | null>(null)
  const ctx = ref<CanvasRenderingContext2D | null>(null)
  const camera = ref<CameraState>({ x: 0, y: 0, k: 1 })
  const hoveredNodeId = ref<string | null>(null)
  const selectedNodeId = ref<string | null>(null)
  let animFrame = 0
  let isRunning = false
  let _freehandDrawFn: FreehandDrawFn | null = null
  let _dirty = true
  let _forceRenderCount = 0

  function markDirty(): void {
    _dirty = true
    // 如果循环已停止，重新启动一帧
    if (isRunning && !animFrame) {
      animFrame = requestAnimationFrame(() => {
        animFrame = 0
        if (_dirty) {
          render()
          _dirty = false
        }
      })
    }
  }

  function init(): void {
    if (!containerRef.value) return
    const el = document.createElement('canvas')
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.display = 'block'
    containerRef.value.appendChild(el)
    canvas.value = el
    const c = el.getContext('2d')
    if (!c) return
    ctx.value = c
    resize()
    startRenderLoop()
  }

  function destroy(): void {
    isRunning = false
    if (animFrame) cancelAnimationFrame(animFrame)
    if (canvas.value && canvas.value.parentNode) {
      canvas.value.parentNode.removeChild(canvas.value)
    }
    canvas.value = null
    ctx.value = null
  }

  function resize(): void {
    if (!canvas.value || !containerRef.value) return
    const cw = containerRef.value.clientWidth
    const ch = containerRef.value.clientHeight
    if (!cw || !ch) return
    const dpr = window.devicePixelRatio || 1
    canvas.value.width = cw * dpr
    canvas.value.height = ch * dpr
    // 保持 CSS 100% 不设置像素值，确保自适应
    if (ctx.value) {
      ctx.value.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    markDirty()
  }

  function startRenderLoop(): void {
    isRunning = true
    _forceRenderCount = 10
    function frame() {
      if (!isRunning) return
      if (_dirty || _forceRenderCount > 0) {
        render()
        _dirty = false
        if (_forceRenderCount > 0) _forceRenderCount--
      }
      // 只在有变化时继续循环
      if (_dirty || _forceRenderCount > 0) {
        animFrame = requestAnimationFrame(frame)
      } else {
        animFrame = 0
      }
    }
    frame()
  }

  function render(): void {
    if (!ctx.value || !canvas.value || !containerRef.value) return
    const cw = containerRef.value.clientWidth
    const ch = containerRef.value.clientHeight
    if (!cw || !ch) return
    drawGraph(
      ctx.value,
      cw,
      ch,
      getNodes(),
      getEdges(),
      camera.value,
      hoveredNodeId.value,
      selectedNodeId.value,
      _freehandDrawFn,
      getAISuggestions?.(),
      getHighlightedIds?.(),
    )
  }

  function setFreehandDrawFn(fn: FreehandDrawFn | null): void {
    _freehandDrawFn = fn
    markDirty()
  }

  function fitView(nodes: CanvasNode[]): void {
    if (nodes.length === 0 || !containerRef.value) return
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    for (const n of nodes) {
      if (n.hidden) continue
      if (n.x - n.width / 2 < minX) minX = n.x - n.width / 2
      if (n.x + n.width / 2 > maxX) maxX = n.x + n.width / 2
      if (n.y - n.height / 2 < minY) minY = n.y - n.height / 2
      if (n.y + n.height / 2 > maxY) maxY = n.y + n.height / 2
    }
    const cw = containerRef.value.clientWidth
    const ch = containerRef.value.clientHeight
    const graphW = maxX - minX || 1
    const graphH = maxY - minY || 1
    const padding = 80
    const k = Math.min(
      (cw - padding * 2) / graphW,
      (ch - padding * 2) / graphH,
      2,
    )
    camera.value = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      k: Math.max(0.1, k),
    }
  }

  function screenToWorld(sx: number, sy: number): { x: number; y: number } {
    // 必须与 useCanvasInteraction.getCanvasRect() 使用同一元素，
    // 否则侧边栏收缩/展开后 clientWidth 与 BCR.width 的偏差导致命中偏移。
    const el = (canvas.value || containerRef.value) as HTMLElement | null
    if (!el) return { x: sx, y: sy }
    const rect = el.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    return {
      x: (sx - cx) / camera.value.k + camera.value.x,
      y: (sy - cy) / camera.value.k + camera.value.y,
    }
  }

  function hitTestNode(wx: number, wy: number): CanvasNode | null {
    const nodes = getNodes()
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (n.hidden) continue
      const hw = n.width / 2
      const hh = n.height / 2
      if (wx >= n.x - hw && wx <= n.x + hw && wy >= n.y - hh && wy <= n.y + hh) {
        return n
      }
    }
    return null
  }

  function hitTestEdge(wx: number, wy: number): CanvasEdge | null {
    const nodes = getNodes()
    const edges = getEdges()
    const threshold = 8
    for (const edge of edges) {
      if (edge.hidden) continue
      const src = nodes.find(n => n.id === edge.source)
      const tgt = nodes.find(n => n.id === edge.target)
      if (!src || !tgt) continue
      const dist = pointToSegmentDist(wx, wy, src.x, src.y, tgt.x, tgt.y)
      if (dist < threshold) return edge
    }
    return null
  }

  function pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1
    const dy = y2 - y1
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return Math.hypot(px - x1, py - y1)
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    const projX = x1 + t * dx
    const projY = y1 + t * dy
    return Math.hypot(px - projX, py - projY)
  }

  function zoomIn(): void {
    camera.value.k = Math.min(camera.value.k * 1.2, 5)
  }

  function zoomOut(): void {
    camera.value.k = Math.max(camera.value.k / 1.2, 0.1)
  }

  watch(camera, () => markDirty(), { deep: true })
  watch(hoveredNodeId, () => markDirty())
  watch(selectedNodeId, () => markDirty())

  // 监听主题切换 — 颜色编辑器和主题按钮会改 CSS 变量
  let _themeObserver: MutationObserver | null = null
  onMounted(() => {
    if (typeof MutationObserver === 'undefined') return
    _themeObserver = new MutationObserver(() => {
      invalidateThemeCache()
      markDirty()
    })
    _themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    })
  })

  onBeforeUnmount(() => {
    destroy()
    _themeObserver?.disconnect()
  })

  return {
    canvas,
    ctx,
    camera,
    hoveredNodeId,
    selectedNodeId,
    init,
    destroy,
    resize,
    render,
    fitView,
    screenToWorld,
    hitTestNode,
    hitTestEdge,
    zoomIn,
    zoomOut,
    setFreehandDrawFn,
    markDirty,
  }
}
