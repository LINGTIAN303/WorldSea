import { ref, reactive } from 'vue'
import type { CameraState } from './canvasTypes'

export interface FreehandPoint {
  x: number
  y: number
}

export interface FreehandStroke {
  id: string
  points: FreehandPoint[]
  color: string
  width: number
  parentId: string | null
}

const STORAGE_KEY = 'worldsea-mindmap-freehand'

export function useFreeDrawing() {
  const isFreeDrawMode = ref(false)
  const isDrawing = ref(false)
  const drawColor = ref('#f59e0b')
  const drawWidth = ref(3)
  const strokes = reactive<FreehandStroke[]>([])
  const currentStroke = ref<FreehandStroke | null>(null)

  const colorPresets = [
    '#f59e0b', '#ef4444', '#22c55e', '#3b82f6',
    '#8b5cf6', '#ec4899', '#ffffff', '#78716c',
  ]

  function loadStrokes(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as FreehandStroke[]
        strokes.splice(0, strokes.length, ...parsed)
      }
    } catch { /* noop */ }
  }

  function saveStrokes(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(strokes))
    } catch { /* quota */ }
  }

  function startStroke(wx: number, wy: number, parentId: string | null): void {
    const stroke: FreehandStroke = {
      id: `stroke-${Date.now()}`,
      points: [{ x: wx, y: wy }],
      color: drawColor.value,
      width: drawWidth.value,
      parentId,
    }
    currentStroke.value = stroke
    isDrawing.value = true
  }

  function continueStroke(wx: number, wy: number): void {
    if (!currentStroke.value) return
    const pts = currentStroke.value.points
    const last = pts[pts.length - 1]
    const dx = wx - last.x
    const dy = wy - last.y
    if (dx * dx + dy * dy > 4) {
      pts.push({ x: wx, y: wy })
    }
  }

  function endStroke(): void {
    if (!currentStroke.value) return
    if (currentStroke.value.points.length >= 2) {
      strokes.push(currentStroke.value)
      saveStrokes()
    }
    currentStroke.value = null
    isDrawing.value = false
  }

  function undoStroke(): void {
    if (strokes.length > 0) {
      strokes.pop()
      saveStrokes()
    }
  }

  function clearStrokes(parentId: string | null): void {
    if (parentId === null) {
      strokes.splice(0, strokes.length)
    } else {
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (strokes[i].parentId === parentId) strokes.splice(i, 1)
      }
    }
    saveStrokes()
  }

  function deleteStroke(id: string): void {
    const idx = strokes.findIndex(s => s.id === id)
    if (idx >= 0) {
      strokes.splice(idx, 1)
      saveStrokes()
    }
  }

  function toggleFreeDrawMode(): void {
    isFreeDrawMode.value = !isFreeDrawMode.value
    if (!isFreeDrawMode.value && isDrawing.value) {
      endStroke()
    }
  }

  function getStrokesForParent(parentId: string | null): FreehandStroke[] {
    return strokes.filter(s => s.parentId === parentId)
  }

  function drawFreehandStrokes(
    ctx: CanvasRenderingContext2D,
    _camera: CameraState,
    parentId: string | null,
  ): void {
    const visible = parentId === null
      ? strokes.filter(s => s.parentId === null)
      : strokes.filter(s => s.parentId === parentId)

    const allStrokes = currentStroke.value
      ? [...visible, currentStroke.value]
      : visible

    for (const stroke of allStrokes) {
      if (stroke.points.length < 2) continue
      ctx.save()
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.85

      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)

      if (stroke.points.length === 2) {
        ctx.lineTo(stroke.points[1].x, stroke.points[1].y)
      } else {
        for (let i = 1; i < stroke.points.length - 1; i++) {
          const xc = (stroke.points[i].x + stroke.points[i + 1].x) / 2
          const yc = (stroke.points[i].y + stroke.points[i + 1].y) / 2
          ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, xc, yc)
        }
        const last = stroke.points[stroke.points.length - 1]
        ctx.lineTo(last.x, last.y)
      }

      ctx.stroke()
      ctx.restore()
    }
  }

  function hitTestStroke(wx: number, wy: number, threshold: number = 8): FreehandStroke | null {
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i]
      for (let j = 0; j < stroke.points.length - 1; j++) {
        const dist = pointToSegmentDist(
          wx, wy,
          stroke.points[j].x, stroke.points[j].y,
          stroke.points[j + 1].x, stroke.points[j + 1].y,
        )
        if (dist < threshold + stroke.width / 2) return stroke
      }
    }
    return null
  }

  loadStrokes()

  return {
    isFreeDrawMode,
    isDrawing,
    drawColor,
    drawWidth,
    strokes,
    currentStroke,
    colorPresets,
    startStroke,
    continueStroke,
    endStroke,
    undoStroke,
    clearStrokes,
    deleteStroke,
    toggleFreeDrawMode,
    getStrokesForParent,
    drawFreehandStrokes,
    hitTestStroke,
  }
}

function pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}
