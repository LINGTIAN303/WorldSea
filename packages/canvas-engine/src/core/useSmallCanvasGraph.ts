import { ref, onBeforeUnmount, type Ref } from 'vue'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceY, type SimulationNodeDatum, type SimulationLinkDatum, type Simulation } from 'd3-force'

export interface SGNode {
  id: string
  label: string
  color: string
  size: number
  borderColor?: string
  borderWidth?: number
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
  [key: string]: any
}

export interface SGEdge {
  id: string
  source: string
  target: string
  color?: string
  width?: number
  dashed?: boolean
  label?: string
  arrow?: boolean
  bidirectional?: boolean
  [key: string]: any
}

export interface SGCamera {
  x: number
  y: number
  k: number
}

export interface SGCallbacks {
  onNodeClick?: (node: SGNode, screenX: number, screenY: number) => void
  onNodeDoubleClick?: (node: SGNode, screenX: number, screenY: number) => void
  onNodeRightClick?: (node: SGNode, screenX: number, screenY: number) => void
  onNodeHover?: (node: SGNode | null) => void
  onBackgroundClick?: () => void
  onBackgroundRightClick?: () => void
  onNodeDrag?: (node: SGNode, x: number, y: number) => void
  onNodeDragEnd?: (node: SGNode, x: number, y: number) => void
}

interface SimNode extends SimulationNodeDatum {
  id: string
  label: string
  color: string
  size: number
  borderColor: string
  borderWidth: number
  [key: string]: any
}

interface SimEdge extends SimulationLinkDatum<SimNode> {
  id: string
  color: string
  width: number
  dashed: boolean
  label: string
  arrow: boolean
  bidirectional: boolean
  [key: string]: any
}

export function useSmallCanvasGraph(
  containerRef: Ref<HTMLElement | null>,
  callbacks: SGCallbacks = {},
) {
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  let animId = 0
  let simulation: Simulation<SimNode, SimEdge> | null = null

  const nodes = ref<SGNode[]>([])
  const edges = ref<SGEdge[]>([])
  const camera: SGCamera = { x: 0, y: 0, k: 1 }
  const hoveredNodeId = ref<string | null>(null)
  const selectedNodeId = ref<string | null>(null)

  let isDragging = false
  let dragNodeId: string | null = null
  let isPanning = false
  let lastMouseX = 0
  let lastMouseY = 0
  let clickTimer: ReturnType<typeof setTimeout> | null = null
  let lastClickTime = 0
  let lastClickNodeId: string | null = null
  let _dirty = true

  const dpr = window.devicePixelRatio || 1

  function init(): void {
    if (!containerRef.value) return
    canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.cursor = 'grab'
    containerRef.value.appendChild(canvas)
    ctx = canvas.getContext('2d')
    resizeCanvas()
    bindEvents()
    startRenderLoop()
  }

  function destroy(): void {
    cancelAnimationFrame(animId)
    simulation?.stop()
    unbindEvents()
    canvas?.remove()
    canvas = null
    ctx = null
  }

  function resizeCanvas(): void {
    if (!canvas || !containerRef.value) return
    const rect = containerRef.value.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    _dirty = true
  }

  function setData(n: SGNode[], e: SGEdge[], layout: 'force' | 'tree' | 'radial' = 'force'): void {
    nodes.value = n
    edges.value = e

    const simNodes: SimNode[] = n.map((nd, i) => ({
      ...nd,
      borderColor: nd.borderColor || '#fff',
      borderWidth: nd.borderWidth ?? 1,
      x: nd.x ?? (layout === 'radial' ? Math.cos(i * 2 * Math.PI / Math.max(n.length, 1)) * 150 : Math.random() * 400),
      y: nd.y ?? (layout === 'radial' ? Math.sin(i * 2 * Math.PI / Math.max(n.length, 1)) * 150 : Math.random() * 300),
      fx: nd.fx ?? null,
      fy: nd.fy ?? null,
    }))

    const nodeMap = new Map(simNodes.map(sn => [sn.id, sn]))
    const simEdges: SimEdge[] = e.map(ed => ({
      ...ed,
      source: nodeMap.get(ed.source) || ed.source,
      target: nodeMap.get(ed.target) || ed.target,
      color: ed.color || '#aaa',
      width: ed.width ?? 1.5,
      dashed: ed.dashed ?? false,
      label: ed.label || '',
      arrow: ed.arrow ?? true,
      bidirectional: ed.bidirectional ?? false,
    }))

    simulation?.stop()
    simulation = forceSimulation<SimNode>(simNodes)

    if (layout === 'tree') {
      const linkForce = forceLink<SimNode, SimEdge>(simEdges).distance(80).strength(1)
      simulation
        .force('link', linkForce)
        .force('charge', forceManyBody().strength(-200))
        .force('collide', forceCollide<SimNode>().radius(d => d.size + 10))
        .force('y', forceY<SimNode>().strength(0.05))
    } else if (layout === 'radial') {
      const centerNode = simNodes.find(sn => sn.fx !== null && sn.fy !== null) || simNodes[0]
      simulation
        .force('link', forceLink<SimNode, SimEdge>(simEdges).distance(100).strength(0.5))
        .force('charge', forceManyBody().strength(-300))
        .force('collide', forceCollide<SimNode>().radius(d => d.size + 8))
        .force('center', forceCenter(centerNode?.x ?? 200, centerNode?.y ?? 150))
    } else {
      simulation
        .force('link', forceLink<SimNode, SimEdge>(simEdges).distance(100).strength(0.3))
        .force('charge', forceManyBody().strength(-200))
        .force('collide', forceCollide<SimNode>().radius(d => d.size + 8))
        .force('center', forceCenter(200, 150))
    }

    simulation.alpha(1).restart()

    simulation.on('tick', () => {
      _dirty = true
      nodes.value = simNodes.map(sn => ({
        ...sn,
        x: sn.x,
        y: sn.y,
      }))
    })

    simulation.on('end', () => {
      fitView()
    })
  }

  function fitView(): void {
    if (nodes.value.length === 0) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of nodes.value) {
      if (n.x == null || n.y == null) continue
      minX = Math.min(minX, n.x - n.size)
      maxX = Math.max(maxX, n.x + n.size)
      minY = Math.min(minY, n.y - n.size)
      maxY = Math.max(maxY, n.y + n.size)
    }
    if (!isFinite(minX)) return
    const cw = canvas ? canvas.width / dpr : 400
    const ch = canvas ? canvas.height / dpr : 300
    const gw = maxX - minX || 1
    const gh = maxY - minY || 1
    const padding = 60
    camera.k = Math.min((cw - padding * 2) / gw, (ch - padding * 2) / gh, 2)
    camera.x = (minX + maxX) / 2 - cw / (2 * camera.k)
    camera.y = (minY + maxY) / 2 - ch / (2 * camera.k)
  }

  function screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx / camera.k + camera.x, y: sy / camera.k + camera.y }
  }

  function worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - camera.x) * camera.k, y: (wy - camera.y) * camera.k }
  }

  function hitTestNode(wx: number, wy: number): SGNode | null {
    for (let i = nodes.value.length - 1; i >= 0; i--) {
      const n = nodes.value[i]
      if (n.x == null || n.y == null) continue
      const dx = wx - n.x
      const dy = wy - n.y
      if (dx * dx + dy * dy <= n.size * n.size) return n
    }
    return null
  }

  function render(): void {
    if (!ctx || !canvas) return
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    ctx.save()
    ctx.translate(-camera.x * camera.k, -camera.y * camera.k)
    ctx.scale(camera.k, camera.k)

    for (const e of edges.value) {
      drawEdge(e)
    }
    for (const n of nodes.value) {
      drawNode(n)
    }

    ctx.restore()
    ctx.restore()
  }

  function drawEdge(e: SGEdge): void {
    if (!ctx) return
    const src = nodes.value.find(n => n.id === (typeof e.source === 'string' ? e.source : (e.source as any).id))
    const tgt = nodes.value.find(n => n.id === (typeof e.target === 'string' ? e.target : (e.target as any).id))
    if (!src || !tgt || src.x == null || src.y == null || tgt.x == null || tgt.y == null) return

    ctx.beginPath()
    ctx.strokeStyle = e.color || '#aaa'
    ctx.lineWidth = e.width || 1.5
    if (e.dashed) ctx.setLineDash([6, 4])
    else ctx.setLineDash([])

    const dx = tgt.x - src.x
    const dy = tgt.y - src.y
    const cx = (src.x + tgt.x) / 2 - dy * 0.15
    const cy = (src.y + tgt.y) / 2 + dx * 0.15
    ctx.moveTo(src.x, src.y)
    ctx.quadraticCurveTo(cx, cy, tgt.x, tgt.y)
    ctx.stroke()
    ctx.setLineDash([])

    if (e.arrow) {
      const t = 0.85
      const ax = (1 - t) * (1 - t) * src.x + 2 * (1 - t) * t * cx + t * t * tgt.x
      const ay = (1 - t) * (1 - t) * src.y + 2 * (1 - t) * t * cy + t * t * tgt.y
      const t2 = 0.84
      const bx = (1 - t2) * (1 - t2) * src.x + 2 * (1 - t2) * t2 * cx + t2 * t2 * tgt.x
      const by = (1 - t2) * (1 - t2) * src.y + 2 * (1 - t2) * t2 * cy + t2 * t2 * tgt.y
      const angle = Math.atan2(ay - by, ax - bx)
      const arrowSize = 8
      ctx.beginPath()
      ctx.fillStyle = e.color || '#aaa'
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax - arrowSize * Math.cos(angle - Math.PI / 6), ay - arrowSize * Math.sin(angle - Math.PI / 6))
      ctx.lineTo(ax - arrowSize * Math.cos(angle + Math.PI / 6), ay - arrowSize * Math.sin(angle + Math.PI / 6))
      ctx.closePath()
      ctx.fill()
    }

    if (e.bidirectional) {
      const t = 0.15
      const ax = (1 - t) * (1 - t) * src.x + 2 * (1 - t) * t * cx + t * t * tgt.x
      const ay = (1 - t) * (1 - t) * src.y + 2 * (1 - t) * t * cy + t * t * tgt.y
      const t2 = 0.16
      const bx = (1 - t2) * (1 - t2) * src.x + 2 * (1 - t2) * t2 * cx + t2 * t2 * tgt.x
      const by = (1 - t2) * (1 - t2) * src.y + 2 * (1 - t2) * t2 * cy + t2 * t2 * tgt.y
      const angle = Math.atan2(ay - by, ax - bx)
      const arrowSize = 8
      ctx.beginPath()
      ctx.fillStyle = e.color || '#aaa'
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax - arrowSize * Math.cos(angle - Math.PI / 6), ay - arrowSize * Math.sin(angle - Math.PI / 6))
      ctx.lineTo(ax - arrowSize * Math.cos(angle + Math.PI / 6), ay - arrowSize * Math.sin(angle + Math.PI / 6))
      ctx.closePath()
      ctx.fill()
    }

    if (e.label) {
      const mx = (src.x + tgt.x) / 2
      const my = (src.y + tgt.y) / 2
      ctx.font = '9px sans-serif'
      ctx.fillStyle = '#888'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(e.label).width
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillRect(mx - tw / 2 - 2, my - 6, tw + 4, 12)
      ctx.fillStyle = '#888'
      ctx.fillText(e.label, mx, my)
    }
  }

  function drawNode(n: SGNode): void {
    if (!ctx || n.x == null || n.y == null) return
    const isHovered = hoveredNodeId.value === n.id
    const isSelected = selectedNodeId.value === n.id
    const r = n.size + (isHovered ? 3 : 0)

    if (isHovered || isSelected) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2)
      ctx.fillStyle = isSelected ? 'rgba(245,166,35,0.2)' : 'rgba(255,255,255,0.1)'
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
    ctx.fillStyle = n.color
    ctx.fill()

    if (n.borderWidth && n.borderWidth > 0) {
      ctx.strokeStyle = n.borderColor || '#fff'
      ctx.lineWidth = n.borderWidth
      ctx.stroke()
    }

    ctx.font = `${isHovered ? 12 : 11}px sans-serif`
    ctx.fillStyle = 'var(--text-color, #333)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(n.label, n.x, n.y + r + 4)
  }

  function startRenderLoop(): void {
    function loop() {
      if (_dirty) {
        render()
        _dirty = false
      }
      animId = requestAnimationFrame(loop)
    }
    loop()
  }

  function onMouseDown(e: MouseEvent): void {
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x: wx, y: wy } = screenToWorld(sx, sy)
    const hit = hitTestNode(wx, wy)

    if (e.button === 2) {
      if (hit) callbacks.onNodeRightClick?.(hit, e.clientX, e.clientY)
      else callbacks.onBackgroundRightClick?.()
      return
    }

    if (hit) {
      isDragging = true
      dragNodeId = hit.id
      if (!canvas) return
      canvas.style.cursor = 'grabbing'

      const now = Date.now()
      if (now - lastClickTime < 350 && lastClickNodeId === hit.id) {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
        callbacks.onNodeDoubleClick?.(hit, e.clientX, e.clientY)
        lastClickTime = 0
        lastClickNodeId = null
      } else {
        lastClickTime = now
        lastClickNodeId = hit.id
        const capturedId = hit.id
        clickTimer = setTimeout(() => {
          callbacks.onNodeClick?.(nodes.value.find(n => n.id === capturedId)!, e.clientX, e.clientY)
        }, 250)
      }
    } else {
      isPanning = true
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      if (canvas) canvas.style.cursor = 'grabbing'
    }
  }

  function onMouseMove(e: MouseEvent): void {
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x: wx, y: wy } = screenToWorld(sx, sy)

    if (isDragging && dragNodeId) {
      const node = nodes.value.find(n => n.id === dragNodeId)
      if (node) {
        node.x = wx
        node.y = wy
        _dirty = true
        callbacks.onNodeDrag?.(node, wx, wy)
      }
      return
    }

    if (isPanning) {
      const dx = e.clientX - lastMouseX
      const dy = e.clientY - lastMouseY
      camera.x -= dx / camera.k
      camera.y -= dy / camera.k
      _dirty = true
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      return
    }

    const hit = hitTestNode(wx, wy)
    const prevHovered = hoveredNodeId.value
    hoveredNodeId.value = hit?.id ?? null
    if (prevHovered !== hoveredNodeId.value) {
      _dirty = true
      callbacks.onNodeHover?.(hit ?? null)
    }
    if (canvas) canvas.style.cursor = hit ? 'pointer' : 'grab'
  }

  function onMouseUp(): void {
    if (isDragging && dragNodeId) {
      const node = nodes.value.find(n => n.id === dragNodeId)
      if (node) callbacks.onNodeDragEnd?.(node, node.x!, node.y!)
    }
    isDragging = false
    dragNodeId = null
    isPanning = false
    if (canvas) canvas.style.cursor = 'grab'
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x: wx, y: wy } = screenToWorld(sx, sy)
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    camera.k = Math.max(0.2, Math.min(5, camera.k * factor))
    camera.x = wx - sx / camera.k
    camera.y = wy - sy / camera.k
    _dirty = true
  }

  function onContextMenu(e: Event): void {
    e.preventDefault()
  }

  function bindEvents(): void {
    canvas?.addEventListener('mousedown', onMouseDown)
    canvas?.addEventListener('mousemove', onMouseMove)
    canvas?.addEventListener('mouseup', onMouseUp)
    canvas?.addEventListener('mouseleave', onMouseUp)
    canvas?.addEventListener('wheel', onWheel, { passive: false })
    canvas?.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('resize', resizeCanvas)
  }

  function unbindEvents(): void {
    canvas?.removeEventListener('mousedown', onMouseDown)
    canvas?.removeEventListener('mousemove', onMouseMove)
    canvas?.removeEventListener('mouseup', onMouseUp)
    canvas?.removeEventListener('mouseleave', onMouseUp)
    canvas?.removeEventListener('wheel', onWheel)
    canvas?.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('resize', resizeCanvas)
  }

  onBeforeUnmount(() => destroy())

  return {
    nodes,
    edges,
    hoveredNodeId,
    selectedNodeId,
    init,
    destroy,
    setData,
    fitView,
    screenToWorld,
    worldToScreen,
  }
}
