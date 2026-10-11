import type { Ref } from 'vue'
import type { MoodboardCamera, CardData } from './moodboardDraw'

export interface MoodboardInteractionCallbacks {
  onCardClick: (card: CardData, event: MouseEvent) => void
  onCardDoubleClick: (card: CardData, event: MouseEvent) => void
  onCardRightClick: (card: CardData, event: MouseEvent) => void
  onCardDrag: (card: CardData, dx: number, dy: number) => void
  onCardDragEnd: (card: CardData) => void
  onBackgroundClick: (event: MouseEvent) => void
  onZoom: (k: number) => void
  onPan: (camera: MoodboardCamera) => void
}

export function useMoodboardInteraction(
  canvasRef: Ref<HTMLCanvasElement | null>,
  screenToWorld: (sx: number, sy: number) => { x: number; y: number },
  hitTest: (wx: number, wy: number) => CardData | null,
  getCamera: () => MoodboardCamera,
  setCamera: (c: MoodboardCamera) => void,
  _markDirty: () => void,
) {
  let isPanning = false
  let isDragging = false
  let dragCard: CardData | null = null
  let panStartX = 0
  let panStartY = 0
  let panStartCamX = 0
  let panStartCamY = 0
  let dragStartWorldX = 0
  let dragStartWorldY = 0
  let dragStartCardX = 0
  let dragStartCardY = 0
  let hasMoved = false
  let lastClickTime = 0
  let lastClickCard: CardData | null = null

  let callbacks: MoodboardInteractionCallbacks = {
    onCardClick: () => {},
    onCardDoubleClick: () => {},
    onCardRightClick: () => {},
    onCardDrag: () => {},
    onCardDragEnd: () => {},
    onBackgroundClick: () => {},
    onZoom: () => {},
    onPan: () => {},
  }

  function setCallbacks(cb: MoodboardInteractionCallbacks): void { callbacks = cb }

  function onMouseDown(e: MouseEvent): void {
    if (!canvasRef.value) return
    if (e.button === 2) {
      const world = screenToWorld(e.clientX, e.clientY)
      const card = hitTest(world.x, world.y)
      if (card) callbacks.onCardRightClick(card, e)
      return
    }
    if (e.button === 0) {
      const world = screenToWorld(e.clientX, e.clientY)
      const card = hitTest(world.x, world.y)
      if (card) {
        isDragging = true
        dragCard = card
        dragStartWorldX = world.x
        dragStartWorldY = world.y
        dragStartCardX = card.x
        dragStartCardY = card.y
        hasMoved = false
        canvasRef.value.style.cursor = 'grabbing'
      } else {
        isPanning = true
        panStartX = e.clientX
        panStartY = e.clientY
        const cam = getCamera()
        panStartCamX = cam.x
        panStartCamY = cam.y
        hasMoved = false
        canvasRef.value.style.cursor = 'grabbing'
      }
    }
  }

  function onMouseMove(e: MouseEvent): void {
    if (!canvasRef.value) return

    if (isDragging && dragCard) {
      const world = screenToWorld(e.clientX, e.clientY)
      const dx = world.x - dragStartWorldX
      const dy = world.y - dragStartWorldY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasMoved = true
      if (hasMoved) {
        callbacks.onCardDrag(dragCard, dragStartCardX + dx - dragCard.x, dragStartCardY + dy - dragCard.y)
      }
      return
    }

    if (isPanning) {
      const dx = e.clientX - panStartX
      const dy = e.clientY - panStartY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true
      const cam = getCamera()
      setCamera({
        ...cam,
        x: panStartCamX - dx / cam.k,
        y: panStartCamY - dy / cam.k,
      })
      callbacks.onPan(getCamera())
      return
    }

    const world = screenToWorld(e.clientX, e.clientY)
    const card = hitTest(world.x, world.y)
    canvasRef.value.style.cursor = card ? 'pointer' : 'grab'
  }

  function onMouseUp(e: MouseEvent): void {
    if (!canvasRef.value) return

    if (isDragging && dragCard) {
      if (hasMoved) {
        callbacks.onCardDragEnd(dragCard)
      } else {
        const now = Date.now()
        if (now - lastClickTime < 350 && lastClickCard?.id === dragCard.id) {
          callbacks.onCardDoubleClick(dragCard, e)
        } else {
          callbacks.onCardClick(dragCard, e)
        }
        lastClickTime = now
        lastClickCard = dragCard
      }
      isDragging = false
      dragCard = null
      canvasRef.value.style.cursor = 'grab'
      return
    }

    if (isPanning && !hasMoved) {
      callbacks.onBackgroundClick(e)
    }

    isPanning = false
    canvasRef.value.style.cursor = 'grab'
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const cam = getCamera()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newK = Math.max(0.15, Math.min(5, cam.k * delta))
    setCamera({ ...cam, k: newK })
    callbacks.onZoom(newK)
  }

  function bindEvents(): void {
    if (!canvasRef.value) return
    const el = canvasRef.value
    el.addEventListener('mousedown', onMouseDown as any)
    el.addEventListener('mousemove', onMouseMove as any)
    el.addEventListener('mouseup', onMouseUp as any)
    el.addEventListener('wheel', onWheel as any, { passive: false })
    el.addEventListener('contextmenu', (e: MouseEvent) => e.preventDefault())
  }

  function unbindEvents(): void {
    if (!canvasRef.value) return
    const el = canvasRef.value
    el.removeEventListener('mousedown', onMouseDown as any)
    el.removeEventListener('mousemove', onMouseMove as any)
    el.removeEventListener('mouseup', onMouseUp as any)
    el.removeEventListener('wheel', onWheel as any)
  }

  return { setCallbacks, bindEvents, unbindEvents }
}
