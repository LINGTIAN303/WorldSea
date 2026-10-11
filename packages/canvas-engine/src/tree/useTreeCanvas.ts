import { ref, shallowRef, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { drawClusterOutlines } from './canvasUtils'

export interface TreeCamera {
  x: number
  y: number
  k: number
}

export interface TreeNodeBase {
  id: string
  x: number
  y: number
  color: string
  name: string
  icon?: string
}

export interface TreeEdgeBase {
  id: string
  sourceId: string
  targetId: string
  color?: string
  dashed?: boolean
  label?: string
  arrow?: boolean
  bidir?: boolean
}

export interface NodeState {
  isSelected: boolean
  isHovered: boolean
}

export interface EdgeState {
  sourceNode: TreeNodeBase | undefined
  targetNode: TreeNodeBase | undefined
}

export type DrawNodeFn<TNode extends TreeNodeBase> = (
  ctx: CanvasRenderingContext2D,
  node: TNode,
  state: NodeState,
  nodeWidth: number,
  nodeHeight: number,
) => void

export type DrawEdgeFn<TNode extends TreeNodeBase, TEdge extends TreeEdgeBase> = (
  ctx: CanvasRenderingContext2D,
  edge: TEdge,
  source: TNode | undefined,
  target: TNode | undefined,
) => void

export type HitTestFn<TNode extends TreeNodeBase> = (
  worldX: number,
  worldY: number,
  nodes: TNode[],
) => TNode | null

export interface TreeCanvasCallbacks<TNode extends TreeNodeBase> {
  onNodeClick: (node: TNode, event: MouseEvent) => void
  onNodeDoubleClick: (node: TNode, event: MouseEvent) => void
  onBackgroundClick: () => void
  onHoverChange: (node: TNode | null) => void
}

export interface TreeCanvasOptions<TNode extends TreeNodeBase, TEdge extends TreeEdgeBase> {
  containerRef: Ref<HTMLElement | null>
  drawNode: DrawNodeFn<TNode>
  drawEdge?: DrawEdgeFn<TNode, TEdge>
  hitTest?: HitTestFn<TNode>
  nodeWidth?: number
  nodeHeight?: number
  nodeRadius?: number
  showClusters?: boolean
  clusterKey?: keyof TNode & string
  onBeforeDraw?: (ctx: CanvasRenderingContext2D, w: number, h: number, camera: TreeCamera) => void
  onAfterDraw?: (ctx: CanvasRenderingContext2D, w: number, h: number, camera: TreeCamera) => void
}

export function useTreeCanvas<TNode extends TreeNodeBase, TEdge extends TreeEdgeBase>(
  options: TreeCanvasOptions<TNode, TEdge>,
) {
  const {
    containerRef,
    drawNode,
    drawEdge,
    hitTest: customHitTest,
    nodeWidth = 160,
    nodeHeight = 60,
    showClusters = false,
    clusterKey,
    onBeforeDraw,
    onAfterDraw,
  } = options

  const canvas = shallowRef<HTMLCanvasElement | null>(null)
  const ctx = shallowRef<CanvasRenderingContext2D | null>(null)
  const camera = ref<TreeCamera>({ x: 0, y: 0, k: 1 })
  const hoveredId = ref<string | null>(null)
  const selectedId = ref<string | null>(null)

  let isRunning = false
  let animFrame = 0
  let _dirty = true
  let _forceRenderCount = 0
  let resizeObs: ResizeObserver | null = null

  let isPanning = false
  let panStartX = 0
  let panStartY = 0
  let panStartCamX = 0
  let panStartCamY = 0
  let hasMoved = false
  let lastClickTime = 0
  let lastClickNodeId: string | null = null

  let _nodes: TNode[] = []
  let _edges: TEdge[] = []

  let _callbacks: TreeCanvasCallbacks<TNode> = {
    onNodeClick: () => {},
    onNodeDoubleClick: () => {},
    onBackgroundClick: () => {},
    onHoverChange: () => {},
  }

  function setCallbacks(cb: Partial<TreeCanvasCallbacks<TNode>>): void {
    _callbacks = { ..._callbacks, ...cb }
  }

  function setData(nodes: TNode[], edges: TEdge[]): void {
    _nodes = nodes
    _edges = edges
    markDirty()
  }

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
    bindEvents()
    resizeObs = new ResizeObserver(() => { resize() })
    resizeObs.observe(containerRef.value)
  }

  function destroy(): void {
    isRunning = false
    if (animFrame) cancelAnimationFrame(animFrame)
    if (resizeObs) resizeObs.disconnect()
    unbindEvents()
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

  function markDirty(): void {
    _dirty = true
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
    const c = ctx.value
    const rect = containerRef.value.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = rect.width
    const h = rect.height
    c.setTransform(dpr, 0, 0, dpr, 0, 0)

    c.clearRect(0, 0, w, h)
    const bgColor = getComputedStyle(containerRef.value).getPropertyValue('--color-bg-base').trim() || '#0d1117'
    c.fillStyle = bgColor
    c.fillRect(0, 0, w, h)

    const cx = w / 2
    const cy = h / 2
    c.save()
    c.translate(cx, cy)
    c.scale(camera.value.k, camera.value.k)
    c.translate(-camera.value.x, -camera.value.y)

    onBeforeDraw?.(c, w, h, camera.value)

    if (showClusters && clusterKey) {
      drawClusterOutlines(c, _nodes, clusterKey, nodeWidth, nodeHeight)
    }

    if (drawEdge) {
      for (const edge of _edges) {
        const source = _nodes.find(n => n.id === edge.sourceId)
        const target = _nodes.find(n => n.id === edge.targetId)
        drawEdge(c, edge, source, target)
      }
    }

    for (const node of _nodes) {
      const state: NodeState = {
        isSelected: node.id === selectedId.value,
        isHovered: node.id === hoveredId.value,
      }
      drawNode(c, node, state, nodeWidth, nodeHeight)
    }

    onAfterDraw?.(c, w, h, camera.value)

    c.restore()
  }

  function getCamera(): TreeCamera { return { ...camera.value } }
  function setCamera(c: TreeCamera): void { camera.value = c; markDirty() }

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

  function defaultHitTest(worldX: number, worldY: number, nodes: TNode[]): TNode | null {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (
        worldX >= n.x - nodeWidth / 2 &&
        worldX <= n.x + nodeWidth / 2 &&
        worldY >= n.y - nodeHeight / 2 &&
        worldY <= n.y + nodeHeight / 2
      ) {
        return n
      }
    }
    return null
  }

  function hitTest(worldX: number, worldY: number): TNode | null {
    const fn = customHitTest ?? defaultHitTest
    return fn(worldX, worldY, _nodes)
  }

  function fitView(padding: number = 80): void {
    if (_nodes.length === 0) {
      camera.value = { x: 0, y: 0, k: 1 }
      markDirty()
      return
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of _nodes) {
      minX = Math.min(minX, n.x - nodeWidth / 2)
      minY = Math.min(minY, n.y - nodeHeight / 2)
      maxX = Math.max(maxX, n.x + nodeWidth / 2)
      maxY = Math.max(maxY, n.y + nodeHeight / 2)
    }
    if (!containerRef.value) return
    const rect = containerRef.value.getBoundingClientRect()
    const contentW = maxX - minX
    const contentH = maxY - minY
    const k = Math.min(rect.width / (contentW + padding), rect.height / (contentH + padding), 2)
    camera.value = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      k: Math.max(0.2, k),
    }
    markDirty()
  }

  function onMouseDown(e: MouseEvent): void {
    if (!canvas.value) return
    if (e.button === 2) return
    if (e.button === 0) {
      isPanning = true
      panStartX = e.clientX
      panStartY = e.clientY
      const cam = camera.value
      panStartCamX = cam.x
      panStartCamY = cam.y
      hasMoved = false
      canvas.value.style.cursor = 'grabbing'
    }
  }

  function onMouseMove(e: MouseEvent): void {
    if (!canvas.value) return

    if (isPanning) {
      const dx = e.clientX - panStartX
      const dy = e.clientY - panStartY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true
      const cam = camera.value
      camera.value = {
        ...cam,
        x: panStartCamX - dx / cam.k,
        y: panStartCamY - dy / cam.k,
      }
      markDirty()
      return
    }

    if (!canvas.value) return
    const rect = canvas.value.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const world = screenToWorld(sx + rect.left, sy + rect.top)
    const node = hitTest(world.x, world.y)

    const prevHovered = hoveredId.value
    hoveredId.value = node?.id ?? null
    if (prevHovered !== hoveredId.value) {
      const hoveredNode = node ?? null
      _callbacks.onHoverChange(hoveredNode)
      markDirty()
    }
    canvas.value.style.cursor = node ? 'pointer' : 'grab'
  }

  function onMouseUp(e: MouseEvent): void {
    if (!canvas.value) return

    if (isPanning && !hasMoved && e.button === 0) {
      const rect = canvas.value.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const world = screenToWorld(sx + rect.left, sy + rect.top)
      const node = hitTest(world.x, world.y)
      if (node) {
        const now = Date.now()
        if (now - lastClickTime < 350 && lastClickNodeId === node.id) {
          _callbacks.onNodeDoubleClick(node, e)
          lastClickTime = 0
          lastClickNodeId = null
        } else {
          _callbacks.onNodeClick(node, e)
          lastClickTime = now
          lastClickNodeId = node.id
        }
      } else {
        _callbacks.onBackgroundClick()
      }
    }

    isPanning = false
    canvas.value.style.cursor = 'grab'
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const cam = camera.value
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newK = Math.max(0.15, Math.min(5, cam.k * delta))
    camera.value = { ...cam, k: newK }
    markDirty()
  }

  function onContextMenu(e: Event): void {
    e.preventDefault()
  }

  function bindEvents(): void {
    if (!canvas.value) return
    const el = canvas.value
    el.addEventListener('mousedown', onMouseDown)
    el.addEventListener('mousemove', onMouseMove)
    el.addEventListener('mouseup', onMouseUp)
    el.addEventListener('mouseleave', onMouseUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', onContextMenu)
  }

  function unbindEvents(): void {
    if (!canvas.value) return
    const el = canvas.value
    el.removeEventListener('mousedown', onMouseDown)
    el.removeEventListener('mousemove', onMouseMove)
    el.removeEventListener('mouseup', onMouseUp)
    el.removeEventListener('mouseleave', onMouseUp)
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('contextmenu', onContextMenu)
  }

  onMounted(() => init())
  onBeforeUnmount(() => destroy())

  return {
    canvas,
    camera,
    hoveredId,
    selectedId,
    init,
    destroy,
    resize,
    markDirty,
    getCamera,
    setCamera,
    screenToWorld,
    hitTest,
    fitView,
    setData,
    setCallbacks,
  }
}

export { roundRect, hexToRgba, drawArrow, drawClusterOutlines } from './canvasUtils'
