import { ref, onBeforeUnmount, type Ref } from 'vue'
import type { CanvasNode, CanvasEdge, CameraState } from './canvasTypes'

export interface CanvasInteractionCallbacks {
  onNodeClick: (node: CanvasNode, event: MouseEvent) => void
  onNodeDoubleClick: (node: CanvasNode, event: MouseEvent) => void
  onNodeRightClick: (node: CanvasNode, event: MouseEvent) => void
  onNodeHover: (node: CanvasNode | null) => void
  onEdgeClick: (edge: CanvasEdge, event: MouseEvent) => void
  onEdgeRightClick: (edge: CanvasEdge, event: MouseEvent) => void
  onBackgroundClick: (event: MouseEvent) => void
  onBackgroundRightClick: (event: MouseEvent) => void
  onNodeDrag: (node: CanvasNode, dx: number, dy: number) => void
  onNodeDragEnd: (node: CanvasNode) => void
  onZoom: (k: number) => void
  onPan: (camera: CameraState) => void
  /** 框选 (shift + drag) 完成，回传世界坐标矩形与命中节点列表 */
  onSelectionRect?: (worldRect: { x1: number; y1: number; x2: number; y2: number }, hitNodes: CanvasNode[]) => void
  /** 框选进行中：开始/结束坐标，结束为 null */
  onSelectionRectMove?: (startWorld: { x: number; y: number } | null, endWorld: { x: number; y: number } | null) => void
}

export type InteractionInterceptor = {
  onMouseDown?: (e: MouseEvent, wx: number, wy: number) => boolean
  onMouseMove?: (e: MouseEvent, wx: number, wy: number) => boolean
  onMouseUp?: (e: MouseEvent, wx: number, wy: number) => boolean
}

export function useCanvasInteraction(
  canvasRef: Ref<HTMLCanvasElement | null>,
  getCamera: () => CameraState,
  setCamera: (c: CameraState) => void,
  hitTestNode: (wx: number, wy: number) => CanvasNode | null,
  hitTestEdge: (wx: number, wy: number) => CanvasEdge | null,
  screenToWorld: (sx: number, sy: number) => { x: number; y: number },
  callbacks: CanvasInteractionCallbacks,
) {
  const isDragging = ref(false)
  const isPanning = ref(false)
  const isSelecting = ref(false)
  let selStartWorld = { x: 0, y: 0 }
  let selEndWorld = { x: 0, y: 0 }
  let dragNodeId: string | null = null
  let lastMouseX = 0
  let lastMouseY = 0
  let lastClickTime = 0
  let lastClickNodeId: string | null = null
  let panStartX = 0
  let panStartY = 0
  let panStartCamera: CameraState | null = null

  function getCanvasRect(): DOMRect | undefined {
    return canvasRef.value?.getBoundingClientRect()
  }

  function onMouseDown(e: MouseEvent): void {
    if (!canvasRef.value) return
    const rect = getCanvasRect()
    if (!rect) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x: wx, y: wy } = screenToWorld(sx, sy)

    if (_interceptor?.onMouseDown?.(e, wx, wy)) return

    if (e.button === 2) {
      const node = hitTestNode(wx, wy)
      if (node) {
        callbacks.onNodeRightClick(node, e)
      } else {
        const edge = hitTestEdge(wx, wy)
        if (edge) {
          callbacks.onEdgeRightClick(edge, e)
        } else {
          callbacks.onBackgroundRightClick(e)
        }
      }
      return
    }

    const node = hitTestNode(wx, wy)
    if (node) {
      dragNodeId = node.id
      isDragging.value = true
      lastMouseX = e.clientX
      lastMouseY = e.clientY
    } else {
      // 框选模式：shift + 空白区拖动
      if (e.shiftKey && e.button === 0 && callbacks.onSelectionRect) {
        isSelecting.value = true
        selStartWorld = { x: wx, y: wy }
        selEndWorld = { x: wx, y: wy }
      } else {
        isPanning.value = true
        panStartX = e.clientX
        panStartY = e.clientY
        panStartCamera = { ...getCamera() }
      }
    }
  }

  function onMouseMove(e: MouseEvent): void {
    if (!canvasRef.value) return
    const rect = getCanvasRect()
    if (!rect) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x: wx, y: wy } = screenToWorld(sx, sy)

    if (_interceptor?.onMouseMove?.(e, wx, wy)) return

    if (isSelecting.value) {
      selEndWorld = { x: wx, y: wy }
      callbacks.onSelectionRectMove?.(selStartWorld, selEndWorld)
      return
    }

    if (isDragging.value && dragNodeId) {
      const dx = (e.clientX - lastMouseX) / getCamera().k
      const dy = (e.clientY - lastMouseY) / getCamera().k
      const nodes = getAllNodes()
      const node = nodes.find(n => n.id === dragNodeId)
      if (node) {
        callbacks.onNodeDrag(node, dx, dy)
      }
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      return
    }

    if (isPanning.value && panStartCamera) {
      const dx = (e.clientX - panStartX) / getCamera().k
      const dy = (e.clientY - panStartY) / getCamera().k
      setCamera({
        ...panStartCamera,
        x: panStartCamera.x - dx,
        y: panStartCamera.y - dy,
      })
      callbacks.onPan(getCamera())
      return
    }

    const node = hitTestNode(wx, wy)
    callbacks.onNodeHover(node)
  }

  function onMouseUp(e: MouseEvent): void {
    if (!canvasRef.value) return
    const rect = getCanvasRect()
    if (!rect) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x: wx, y: wy } = screenToWorld(sx, sy)

    if (_interceptor?.onMouseUp?.(e, wx, wy)) {
      isDragging.value = false
      isPanning.value = false
      isSelecting.value = false
      dragNodeId = null
      return
    }

    // 框选结束：计算矩形 + 命中节点 + 回调
    if (isSelecting.value && callbacks.onSelectionRect) {
      const x1 = Math.min(selStartWorld.x, selEndWorld.x)
      const y1 = Math.min(selStartWorld.y, selEndWorld.y)
      const x2 = Math.max(selStartWorld.x, selEndWorld.x)
      const y2 = Math.max(selStartWorld.y, selEndWorld.y)
      if (Math.abs(x2 - x1) > 6 && Math.abs(y2 - y1) > 6) {
        const nodes = getAllNodes()
        const hit = nodes.filter(n => {
          if (n.hidden) return false
          return n.x >= x1 && n.x <= x2 && n.y >= y1 && n.y <= y2
        })
        callbacks.onSelectionRect({ x1, y1, x2, y2 }, hit)
      }
      callbacks.onSelectionRectMove?.(null, null)
      isSelecting.value = false
      isDragging.value = false
      isPanning.value = false
      dragNodeId = null
      return
    }

    if (isDragging.value && dragNodeId) {
      const nodes = getAllNodes()
      const node = nodes.find(n => n.id === dragNodeId)
      if (node) {
        callbacks.onNodeDragEnd(node)
      }
    }

    if (!isDragging.value && !isPanning.value && e.button === 0) {
      const rect = getCanvasRect()
      if (!rect) return
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const { x: wx, y: wy } = screenToWorld(sx, sy)

      const node = hitTestNode(wx, wy)
      const now = Date.now()
      if (node) {
        if (now - lastClickTime < 350 && lastClickNodeId === node.id) {
          callbacks.onNodeDoubleClick(node, e)
        } else {
          callbacks.onNodeClick(node, e)
        }
        lastClickTime = now
        lastClickNodeId = node.id
      } else {
        const edge = hitTestEdge(wx, wy)
        if (edge) {
          callbacks.onEdgeClick(edge, e)
        } else {
          callbacks.onBackgroundClick(e)
        }
        lastClickNodeId = null
      }
    }

    isDragging.value = false
    isPanning.value = false
    dragNodeId = null
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const cam = getCamera()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newK = Math.max(0.1, Math.min(5, cam.k * delta))
    setCamera({ ...cam, k: newK })
    callbacks.onZoom(newK)
  }

  function onContextMenu(e: Event): void {
    e.preventDefault()
  }

  let _getAllNodes: () => CanvasNode[] = () => []
  let _interceptor: InteractionInterceptor | null = null

  function setGetAllNodes(fn: () => CanvasNode[]): void {
    _getAllNodes = fn
  }

  function setInterceptor(interceptor: InteractionInterceptor | null): void {
    _interceptor = interceptor
  }

  function getAllNodes(): CanvasNode[] {
    return _getAllNodes()
  }

  function bindEvents(): void {
    if (!canvasRef.value) return
    canvasRef.value.addEventListener('mousedown', onMouseDown as any)
    canvasRef.value.addEventListener('mousemove', onMouseMove as any)
    canvasRef.value.addEventListener('mouseup', onMouseUp as any)
    canvasRef.value.addEventListener('wheel', onWheel as any, { passive: false })
    canvasRef.value.addEventListener('contextmenu', onContextMenu)
  }

  function unbindEvents(): void {
    if (!canvasRef.value) return
    canvasRef.value.removeEventListener('mousedown', onMouseDown as any)
    canvasRef.value.removeEventListener('mousemove', onMouseMove as any)
    canvasRef.value.removeEventListener('mouseup', onMouseUp as any)
    canvasRef.value.removeEventListener('wheel', onWheel as any)
    canvasRef.value.removeEventListener('contextmenu', onContextMenu)
  }

  onBeforeUnmount(() => {
    unbindEvents()
  })

  return {
    isDragging,
    isPanning,
    isSelecting,
    bindEvents,
    unbindEvents,
    setGetAllNodes,
    setInterceptor,
  }
}
