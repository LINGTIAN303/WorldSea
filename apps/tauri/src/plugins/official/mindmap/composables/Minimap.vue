<template>
  <div v-show="visible" class="mm-minimap" :style="wrapStyle">
    <canvas
      ref="canvasRef"
      :width="width"
      :height="height"
      class="mm-minimap-canvas"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseLeave"
    />
    <div class="mm-minimap-label">小地图</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import type { CanvasNode, CanvasEdge, CameraState } from './canvasTypes'
import { getThemeColors } from './canvasDraw'

const props = defineProps<{
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  camera: CameraState
  containerSize: { width: number; height: number }
  visible?: boolean
}>()

const emit = defineEmits<{
  jump: [worldX: number, worldY: number]
}>()

const WIDTH = 200
const HEIGHT = 130
const width = ref(WIDTH)
const height = ref(HEIGHT)
const canvasRef = ref<HTMLCanvasElement | null>(null)

let worldBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 }
let scale = 1

const wrapStyle = computed(() => ({ width: width.value + 'px', height: height.value + 'px' }))

function recomputeBounds(): void {
  const visible = props.nodes.filter(n => !n.hidden)
  if (visible.length === 0) {
    worldBounds = { minX: 0, maxX: 800, minY: 0, maxY: 600 }
  } else {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of visible) {
      if (n.x - n.width / 2 < minX) minX = n.x - n.width / 2
      if (n.x + n.width / 2 > maxX) maxX = n.x + n.width / 2
      if (n.y - n.height / 2 < minY) minY = n.y - n.height / 2
      if (n.y + n.height / 2 > maxY) maxY = n.y + n.height / 2
    }
    // 加 padding
    const padX = (maxX - minX || 200) * 0.08
    const padY = (maxY - minY || 200) * 0.08
    worldBounds = { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY }
  }
  const w = worldBounds.maxX - worldBounds.minX
  const h = worldBounds.maxY - worldBounds.minY
  scale = Math.min(WIDTH / w, HEIGHT / h)
}

function worldToMini(wx: number, wy: number): { x: number; y: number } {
  return {
    x: (wx - worldBounds.minX) * scale,
    y: (wy - worldBounds.minY) * scale,
  }
}

function miniToWorld(mx: number, my: number): { x: number; y: number } {
  return {
    x: mx / scale + worldBounds.minX,
    y: my / scale + worldBounds.minY,
  }
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const theme = getThemeColors()

  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  // 背景
  ctx.fillStyle = theme.isDark ? 'rgba(15,19,24,0.85)' : 'rgba(255,255,255,0.95)'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  ctx.strokeStyle = theme.border
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1)

  // 边（淡灰）
  ctx.strokeStyle = theme.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'
  ctx.lineWidth = 0.6
  for (const e of props.edges) {
    if (e.hidden) continue
    const s = props.nodes.find(n => n.id === e.source)
    const t = props.nodes.find(n => n.id === e.target)
    if (!s || !t) continue
    const a = worldToMini(s.x, s.y)
    const b = worldToMini(t.x, t.y)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  // 节点
  for (const n of props.nodes) {
    if (n.hidden) continue
    const c = worldToMini(n.x, n.y)
    const w = Math.max(2, n.width * scale)
    const h = Math.max(2, n.height * scale)
    ctx.fillStyle = n.customColor || n.color
    ctx.globalAlpha = 0.85
    if (n.type === 'section' || n.type === 'group') {
      ctx.fillRect(c.x - w / 2, c.y - h / 2, w, h)
    } else {
      ctx.beginPath()
      ctx.arc(c.x, c.y, Math.max(2, w / 2), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // 视口框
  const cam = props.camera
  const rect = props.containerSize
  // 视口的世界尺寸：屏幕尺寸 / zoom
  const wW = rect.width / cam.k
  const wH = rect.height / cam.k
  // 视口中心世界坐标
  const cx = cam.x
  const cy = cam.y
  const tl = worldToMini(cx - wW / 2, cy - wH / 2)
  const br = worldToMini(cx + wW / 2, cy + wH / 2)
  const vw = br.x - tl.x
  const vh = br.y - tl.y
  ctx.strokeStyle = theme.selectedStroke
  ctx.fillStyle = hexToRgba(theme.selectedStroke, 0.12)
  ctx.lineWidth = 1.5
  ctx.fillRect(tl.x, tl.y, vw, vh)
  ctx.strokeRect(tl.x, tl.y, vw, vh)
}

function hexToRgba(hex: string, a: number): string {
  if (!hex || hex.length < 7) return `rgba(74,108,247,${a})`
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

let dragging = false
function onMouseDown(e: MouseEvent): void {
  dragging = true
  jumpToMouse(e)
}
function onMouseMove(e: MouseEvent): void {
  if (!dragging) return
  jumpToMouse(e)
}
function onMouseUp(): void { dragging = false }
function onMouseLeave(): void { dragging = false }
function jumpToMouse(e: MouseEvent): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const w = miniToWorld(mx, my)
  emit('jump', w.x, w.y)
}

watch([() => props.nodes, () => props.edges, () => props.camera, () => props.containerSize], () => {
  recomputeBounds()
  draw()
}, { deep: true })

onMounted(() => {
  recomputeBounds()
  draw()
})
</script>

<style scoped>
.mm-minimap {
  position: absolute;
  bottom: 12px;
  right: 12px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  z-index: 50;
}
.mm-minimap-canvas {
  display: block;
  cursor: crosshair;
}
.mm-minimap-label {
  position: absolute;
  top: 4px; left: 6px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  background: var(--card-bg);
  padding: 1px 6px;
  border-radius: 3px;
  pointer-events: none;
}
</style>
