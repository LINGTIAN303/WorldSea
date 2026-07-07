import type { Ref } from 'vue'
import type { BoardCamera } from './boardDraw'

export interface BoardInteractionCallbacks {
  onCellClick: (x: number, y: number, event: MouseEvent) => void
  onCellRightClick: (x: number, y: number, event: MouseEvent) => void
  onCellHover: (x: number, y: number | null) => void
  onZoom: (k: number) => void
  onPan: (camera: BoardCamera) => void
}

export function useBoardInteraction(
  canvasRef: Ref<HTMLCanvasElement | null>,
  screenToCell: (sx: number, sy: number) => { x: number; y: number } | null,
  getCamera: () => BoardCamera,
  setCamera: (c: BoardCamera) => void,
  _markDirty: () => void,
) {
  let isPanning = false
  let panStartX = 0
  let panStartY = 0
  let panStartCamX = 0
  let panStartCamY = 0
  let hasMoved = false

  // Touch state
  let touchStartDist = 0
  let touchStartK = 1
  let isTouchPanning = false

  // Inertia
  let velocityX = 0
  let velocityY = 0
  let lastMoveTime = 0
  let lastMoveX = 0
  let lastMoveY = 0
  let inertiaFrame = 0

  let callbacks: BoardInteractionCallbacks = {
    onCellClick: () => {},
    onCellRightClick: () => {},
    onCellHover: () => {},
    onZoom: () => {},
    onPan: () => {},
  }

  function setCallbacks(cb: BoardInteractionCallbacks): void {
    callbacks = cb
  }

  function startInertia() {
    if (Math.abs(velocityX) < 0.5 && Math.abs(velocityY) < 0.5) return
    cancelInertia()
    function step() {
      velocityX *= 0.92
      velocityY *= 0.92
      if (Math.abs(velocityX) < 0.3 && Math.abs(velocityY) < 0.3) return
      const cam = getCamera()
      setCamera({
        ...cam,
        x: cam.x - velocityX / cam.k,
        y: cam.y - velocityY / cam.k,
      })
      callbacks.onPan(getCamera())
      inertiaFrame = requestAnimationFrame(step)
    }
    inertiaFrame = requestAnimationFrame(step)
  }

  function cancelInertia() {
    if (inertiaFrame) {
      cancelAnimationFrame(inertiaFrame)
      inertiaFrame = 0
    }
  }

  function onMouseDown(e: MouseEvent): void {
    if (!canvasRef.value) return
    cancelInertia()
    if (e.button === 0) {
      isPanning = true
      panStartX = e.clientX
      panStartY = e.clientY
      const cam = getCamera()
      panStartCamX = cam.x
      panStartCamY = cam.y
      hasMoved = false
      lastMoveX = e.clientX
      lastMoveY = e.clientY
      lastMoveTime = performance.now()
      velocityX = 0
      velocityY = 0
    }
  }

  function onMouseMove(e: MouseEvent): void {
    if (!canvasRef.value) return

    if (isPanning) {
      const dx = e.clientX - panStartX
      const dy = e.clientY - panStartY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true
      }
      const cam = getCamera()
      setCamera({
        ...cam,
        x: panStartCamX - dx / cam.k,
        y: panStartCamY - dy / cam.k,
      })
      callbacks.onPan(getCamera())

      // Track velocity for inertia
      const now = performance.now()
      const dt = now - lastMoveTime
      if (dt > 0) {
        velocityX = (e.clientX - lastMoveX) / dt * 16
        velocityY = (e.clientY - lastMoveY) / dt * 16
      }
      lastMoveX = e.clientX
      lastMoveY = e.clientY
      lastMoveTime = now
      return
    }

    const cell = screenToCell(e.clientX, e.clientY)
    callbacks.onCellHover(cell ? cell.x : -1, cell ? cell.y : -1)
  }

  function onMouseUp(e: MouseEvent): void {
    if (!canvasRef.value) return

    if (isPanning && !hasMoved && e.button === 0) {
      const cell = screenToCell(e.clientX, e.clientY)
      if (cell) {
        callbacks.onCellClick(cell.x, cell.y, e)
      }
    } else if (isPanning && hasMoved) {
      startInertia()
    }

    isPanning = false
    hasMoved = false
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault()
    const cell = screenToCell(e.clientX, e.clientY)
    if (cell) {
      callbacks.onCellRightClick(cell.x, cell.y, e)
    }
  }

  // Zoom centered on mouse position
  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    if (!canvasRef.value) return
    const cam = getCamera()
    const rect = canvasRef.value.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const cx = rect.width / 2
    const cy = rect.height / 2

    // World position under mouse before zoom
    const worldX = (mouseX - cx) / cam.k + cam.x
    const worldY = (mouseY - cy) / cam.k + cam.y

    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newK = Math.max(0.2, Math.min(5, cam.k * delta))

    // Adjust camera so world position stays under mouse
    const newCamX = worldX - (mouseX - cx) / newK
    const newCamY = worldY - (mouseY - cy) / newK

    setCamera({ x: newCamX, y: newCamY, k: newK })
    callbacks.onZoom(newK)
  }

  // Touch support
  function getTouchDist(touches: TouchList): number {
    if (touches.length < 2) return 0
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  function onTouchStart(e: TouchEvent): void {
    if (!canvasRef.value) return
    cancelInertia()
    if (e.touches.length === 1) {
      isTouchPanning = true
      panStartX = e.touches[0].clientX
      panStartY = e.touches[0].clientY
      const cam = getCamera()
      panStartCamX = cam.x
      panStartCamY = cam.y
      hasMoved = false
    } else if (e.touches.length === 2) {
      isTouchPanning = false
      touchStartDist = getTouchDist(e.touches)
      touchStartK = getCamera().k
    }
  }

  function onTouchMove(e: TouchEvent): void {
    if (!canvasRef.value) return
    e.preventDefault()
    if (e.touches.length === 1 && isTouchPanning) {
      const dx = e.touches[0].clientX - panStartX
      const dy = e.touches[0].clientY - panStartY
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true
      const cam = getCamera()
      setCamera({ ...cam, x: panStartCamX - dx / cam.k, y: panStartCamY - dy / cam.k })
      callbacks.onPan(getCamera())
    } else if (e.touches.length === 2) {
      const dist = getTouchDist(e.touches)
      if (touchStartDist > 0) {
        const newK = Math.max(0.2, Math.min(5, touchStartK * (dist / touchStartDist)))
        const cam = getCamera()
        setCamera({ ...cam, k: newK })
        callbacks.onZoom(newK)
      }
    }
  }

  function onTouchEnd(e: TouchEvent): void {
    if (!canvasRef.value) return
    if (e.touches.length === 0) {
      if (isTouchPanning && !hasMoved) {
        const touch = e.changedTouches[0]
        const cell = screenToCell(touch.clientX, touch.clientY)
        if (cell) {
          // Simulate click
          callbacks.onCellClick(cell.x, cell.y, new MouseEvent('click'))
        }
      }
      isTouchPanning = false
    }
  }

  function bindEvents(): void {
    if (!canvasRef.value) return
    const el = canvasRef.value
    el.addEventListener('mousedown', onMouseDown as any)
    el.addEventListener('mousemove', onMouseMove as any)
    el.addEventListener('mouseup', onMouseUp as any)
    el.addEventListener('wheel', onWheel as any, { passive: false })
    el.addEventListener('contextmenu', onContextMenu as any)
    el.addEventListener('touchstart', onTouchStart as any, { passive: false })
    el.addEventListener('touchmove', onTouchMove as any, { passive: false })
    el.addEventListener('touchend', onTouchEnd as any)
  }

  function unbindEvents(): void {
    if (!canvasRef.value) return
    const el = canvasRef.value
    el.removeEventListener('mousedown', onMouseDown as any)
    el.removeEventListener('mousemove', onMouseMove as any)
    el.removeEventListener('mouseup', onMouseUp as any)
    el.removeEventListener('wheel', onWheel as any)
    el.removeEventListener('contextmenu', onContextMenu as any)
    el.removeEventListener('touchstart', onTouchStart as any)
    el.removeEventListener('touchmove', onTouchMove as any)
    el.removeEventListener('touchend', onTouchEnd as any)
    cancelInertia()
  }

  return {
    setCallbacks,
    bindEvents,
    unbindEvents,
  }
}
