<template>
  <div class="region-map" ref="mapRoot">
    <MapToolbar
      :mode="mode"
      :scale="scale"
      :erase-mode="eraseMode"
      :borderline-active="borderlineActive"
      :legend-types="legendTypes"
      :mode-label="modeLabel"
      @update:mode="mode = $event"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @fit-all="fitAll"
      @start-draw-mode="startDrawMode"
    />
    <canvas ref="canvasRef" class="rm-canvas"
      @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp"
      @wheel.prevent="onWheel" @dblclick="onDblClick"
      @mouseleave="onMouseUp" @contextmenu.prevent="onContextMenu"></canvas>
    <MapTooltip
      :show="tooltip.show"
      :x="tooltip.x"
      :y="tooltip.y"
      :name="tooltip.name"
      :type="tooltip.type"
    />
    <MapContextMenu
      :ctx-menu="ctxMenu"
      :erase-ctx-menu="eraseCtxMenu"
      :adjoin-select-mode="adjoinSelectMode"
      :adjoin-selected-ids="adjoinSelectedIds"
      :palette-colors="paletteColors"
      @ctx-edit="ctxEdit"
      @ctx-delete="ctxDelete"
      @ctx-adjoin="ctxAdjoin"
      @ctx-set-color="ctxSetColor"
      @execute-adjoin="executeAdjoin"
      @cancel-adjoin="cancelAdjoin"
      @erase-merge="eraseMerge"
      @erase-move-line="eraseMoveLine"
      @close-erase-ctx="closeEraseCtx"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import { useConfirm, useShortcuts } from '@worldsea/ui-kit'
import MapToolbar from './map/MapToolbar.vue'
import MapTooltip from './map/MapTooltip.vue'
import MapContextMenu from './map/MapContextMenu.vue'
import { useBorderErase } from './map/useBorderErase'
import { useAdjoin } from './map/useAdjoin'
import { useDrawing } from './map/useDrawing'
import { useMapRender } from './map/useMapRender'
import { findSharedEdgeAtPoint } from './map/geometry'
import type {
  MapMode, RegionEntity, TooltipState, CtxMenuState, Point, HitTestResult,
} from './map/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const props = defineProps<{ regions: any[] }>()

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { confirm } = useConfirm()
const { register: registerShortcut, unregister: unregisterShortcut } = useShortcuts()

const mapRoot = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()
const scale = ref(1)
const tooltip = ref<TooltipState>({ show: false, x: 0, y: 0, name: '', type: '' })
const ctxMenu = ref<CtxMenuState>({ show: false, x: 0, y: 0, region: null })

const mode = ref<MapMode>('pan')
const selectedRegionId = ref<string | null>(null)

const modeLabel = computed(() => ({ pan: '浏览', edit: '编辑', draw: '绘制' })[mode.value])
const legendTypes = computed(() => {
  const seen = new Set<string>()
  const items: { type: string; color: string }[] = []
  for (const r of getRegions()) {
    const rt = r.properties?.regionType || '区域'
    if (!seen.has(rt)) { seen.add(rt); items.push({ type: rt, color: regionColor(r) }) }
  }
  return items
})

const typeColors: Record<string, string> = {
  '大陆': '#4a6cf7', '国家': '#27ae60', '行省': '#2ecc71',
  '城市': '#f39c12', '地标': '#e74c3c', '区域': '#9b59b6',
}

const paletteColors = [
  '#4a6cf7', '#27ae60', '#e74c3c', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#3498db',
  '#e91e63', '#00bcd4', '#8bc34a', '#ff5722',
]

let panX = 0, panY = 0
let dragging = false, dragStartX = 0, dragStartY = 0
let dragNode: string | null = null
let dragNodeStartX = 0, dragNodeStartY = 0
let dragRegionId: string | null = null
let draggingVertex = -1
let animFrame = 0

const pixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1

function getRegions(): RegionEntity[] {
  return props.regions || entityStore.entities.filter(e => e.type === 'region')
}

function getTerritory(r: RegionEntity): Point[] {
  if (r.properties && r.properties.territory && r.properties.territory.length >= 3) return r.properties.territory
  const cx = Number(r.properties?.mapX) || 0
  const cy = Number(r.properties?.mapY) || 0
  const radius = 30
  const pts: Point[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6
    pts.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
  }
  return pts
}

function scheduleDraw() {
  cancelAnimationFrame(animFrame)
  animFrame = requestAnimationFrame(draw)
}

function hideTooltip() {
  tooltip.value.show = false
}

// === 组合式函数（composables）===
// 注：closeCtx 为函数声明，会被提升，可在此处引用
const borderErase = useBorderErase({
  getRegions,
  getTerritory,
  scheduleDraw,
})

const adjoin = useAdjoin({
  getRegions,
  getTerritory,
  scheduleDraw,
  onAdjoinDone: closeCtx,
})

const drawing = useDrawing({
  getRegions,
  getTerritory,
  scheduleDraw,
  hideTooltip,
})

// 解构常用状态与方法
const {
  eraseMode, eraseBorderVertices, eraseBorderFixedIndices, eraseDraggingIdx,
  eraseRedrawPath, eraseCtxMenu,
  openEraseCtxMenu, closeEraseCtx, eraseMerge, eraseMoveLine,
  finishRedraw,
} = borderErase
const {
  adjoinSelectMode, adjoinSourceRegion, adjoinSelectedIds,
  startAdjoin, cancelAdjoin, toggleAdjoinTarget, executeAdjoin,
} = adjoin
const {
  drawingPath, isDrawing, borderlineActive, borderlineMode,
  startDrawMode, handleDrawMouseDown, handleDrawMouseMove, handleDrawMouseUp,
} = drawing

// === Canvas 渲染（纯渲染逻辑，提取到 useMapRender） ===
const { draw } = useMapRender({
  canvasRef,
  mapRoot,
  pixelRatio,
  getPanX: () => panX,
  getPanY: () => panY,
  getScale: () => scale.value,
  getRegions,
  getTerritory,
  regionColor,
  getRelations: () => relationStore.relations,
  getEntity: (id: string) => entityStore.entityMap.get(id),
  getMode: () => mode.value,
  getSelectedRegionId: () => selectedRegionId.value,
  adjoinSelectMode,
  adjoinSelectedIds,
  adjoinSourceRegion,
  eraseMode,
  eraseBorderVertices,
  eraseBorderFixedIndices,
  eraseRedrawPath,
  drawingPath,
})

// === 上下文菜单与颜色 ===

function closeCtx() { ctxMenu.value.show = false }

function regionColor(r: RegionEntity): string {
  const enclaveRel = relationStore.relations.find(rel => rel.type === 'enclave_of' && rel.sourceId === r.id)
  if (enclaveRel) {
    const parentEntity = entityStore.entityMap.get(enclaveRel.targetId)
    if (parentEntity) {
      if (parentEntity.properties?.fillColor) return parentEntity.properties.fillColor as string
      const rt = parentEntity.properties?.regionType as string || ''
      return typeColors[rt] || '#95a5a6'
    }
  }
  if (r.properties?.fillColor) return r.properties.fillColor as string
  const rt = r.properties?.regionType as string || ''
  return typeColors[rt] || '#95a5a6'
}

function addVertex(region: RegionEntity, edgeIdx: number, pos: Point) {
  const ent = entityStore.entityMap.get(region.id)
  if (!ent) return
  const pts = getTerritory(ent)
  const newPts = [...pts]
  newPts.splice(edgeIdx + 1, 0, { x: Math.round(pos.x), y: Math.round(pos.y) })
  entityStore.update(region.id, { properties: { ...(ent.properties || {}), territory: newPts } })
  scheduleDraw()
}

const emit = defineEmits<{ select: [region: RegionEntity] }>()

// === 右键菜单 ===

function onContextMenu(e: MouseEvent) {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left, my = e.clientY - rect.top

  if (mode.value === 'draw') {
    const shared = findSharedEdgeAtPoint(mx, my, panX, panY, scale.value, getRegions(), getTerritory)
    if (shared) {
      openEraseCtxMenu(shared, e.clientX, e.clientY)
    }
    return
  }

  if (mode.value !== 'edit') return
  const hit = hitTest(mx, my)
  if (adjoinSelectMode.value) {
    if (hit && hit.region.id !== adjoinSourceRegion.value?.id) {
      toggleAdjoinTarget(hit.region)
      return
    }
    ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, region: null }
    setTimeout(() => { document.addEventListener('click', closeCtx, { once: true }) }, 0)
    return
  }
  if (hit && hit.vertexIdx === -1) {
    ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, region: hit.region }
    setTimeout(() => { document.addEventListener('click', closeCtx, { once: true }) }, 0)
  }
}

function ctxEdit() {
  if (!ctxMenu.value.region) return
  const r = ctxMenu.value.region
  emit('select', r)
  closeCtx()
}

async function ctxDelete() {
  if (!ctxMenu.value.region) return
  const name = ctxMenu.value.region.name
  const ok = await confirm({ type: 'danger', title: '删除区域', description: `确定删除 "${name}"？` })
  if (ok) {
    await entityStore.remove(ctxMenu.value.region.id)
    closeCtx()
    scheduleDraw()
  }
}

function ctxSetColor(color: string) {
  if (!ctxMenu.value.region) return
  const r = ctxMenu.value.region
  const existing = entityStore.entityMap.get(r.id)
  if (existing) {
    entityStore.update(r.id, {
      properties: { ...(existing.properties || {}), fillColor: color }
    })
  }
  closeCtx()
  scheduleDraw()
}

function ctxAdjoin() {
  if (!ctxMenu.value.region) return
  startAdjoin(ctxMenu.value.region)
}

// === 命中测试 ===

function hitTest(mx: number, my: number): HitTestResult | null {
  const x = (mx - panX) / scale.value
  const y = (my - panY) / scale.value
  const regions = getRegions()
  for (const r of regions) {
    const pts = getTerritory(r)
    for (let vi = 0; vi < pts.length; vi++) {
      const dx = x - pts[vi].x, dy = y - pts[vi].y
      if (dx * dx + dy * dy < 64) { return { region: r, vertexIdx: vi } }
    }
    // 边命中检测
    for (let ei = 0; ei < pts.length; ei++) {
      const a = pts[ei], b = pts[(ei + 1) % pts.length]
      const ex = b.x - a.x, ey = b.y - a.y
      const len = Math.sqrt(ex * ex + ey * ey)
      if (len < 1) continue
      const t = ((x - a.x) * ex + (y - a.y) * ey) / (len * len)
      if (t < 0 || t > 1) continue
      const px = a.x + t * ex, py = a.y + t * ey
      const ddx = x - px, ddy = y - py
      if (ddx * ddx + ddy * ddy < 36) { return { region: r, vertexIdx: -2, edgeIdx: ei } }
    }
  }
  for (const r of regions) {
    const pts = getTerritory(r)
    if (pts.length < 3) continue
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y
      const xj = pts[j].x, yj = pts[j].y
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) { inside = !inside }
    }
    if (inside) return { region: r, vertexIdx: -1 }
  }
  return null
}

function toWorldCoords(mx: number, my: number): Point {
  return { x: (mx - panX) / scale.value, y: (my - panY) / scale.value }
}

// === 鼠标事件 ===

function onMouseDown(e: MouseEvent) {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left, my = e.clientY - rect.top

  if (mode.value === 'draw') {
    const wp = toWorldCoords(mx, my)

    // 偏移模式：拖拽节点
    if (eraseMode.value === 'offset') {
      for (let i = 0; i < eraseBorderVertices.value.length; i++) {
        const p = eraseBorderVertices.value[i]
        const dx = wp.x - p.x, dy = wp.y - p.y
        if (dx * dx + dy * dy < 64) {
          eraseDraggingIdx.value = i
          dragging = true
          scheduleDraw()
          return
        }
      }
      return
    }

    // 重划模式
    if (eraseMode.value === 'redraw') {
      if (!isDrawing.value) {
        isDrawing.value = true
        eraseRedrawPath.value = [wp]
      } else {
        eraseRedrawPath.value.push(wp)
      }
      dragging = isDrawing.value
      scheduleDraw()
      return
    }

    // 普通绘制模式
    handleDrawMouseDown(wp)
    dragging = isDrawing.value
    return
  }

  const hit = hitTest(mx, my)
  if (mode.value === 'edit' && adjoinSelectMode.value) {
    if (hit && hit.region.id !== adjoinSourceRegion.value?.id) {
      toggleAdjoinTarget(hit.region)
    }
    return
  }
  if (mode.value === 'edit' && hit) {
    dragRegionId = hit.region.id
    if (hit.vertexIdx >= 0) {
      draggingVertex = hit.vertexIdx
      dragStartX = mx
      dragStartY = my
      dragging = true
    } else if (hit.vertexIdx === -2 && hit.edgeIdx !== undefined && hit.edgeIdx >= 0) {
      // 点击边 - 添加顶点
      addVertex(hit.region, hit.edgeIdx, toWorldCoords(mx, my))
    } else {
      dragNode = hit.region.id
      dragNodeStartX = mx
      dragNodeStartY = my
      dragging = true
      selectedRegionId.value = hit.region.id
    }
  } else if (mode.value === 'edit' && !hit) {
    selectedRegionId.value = null
  } else if (mode.value === 'pan') {
    dragNode = null; dragRegionId = null; draggingVertex = -1
    dragging = true
    dragStartX = mx - panX
    dragStartY = my - panY
  }
}

function onMouseMove(e: MouseEvent) {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left, my = e.clientY - rect.top

  // 偏移模式：拖拽节点
  if (mode.value === 'draw' && eraseMode.value === 'offset' && eraseDraggingIdx.value >= 0 && dragging) {
    const wp = toWorldCoords(mx, my)
    if (!eraseBorderFixedIndices.value.includes(eraseDraggingIdx.value)) {
      eraseBorderVertices.value[eraseDraggingIdx.value] = { x: Math.round(wp.x), y: Math.round(wp.y) }
    }
    scheduleDraw()
    return
  }

  // 重划模式：拖拽绘制
  if (mode.value === 'draw' && eraseMode.value === 'redraw' && isDrawing.value && dragging) {
    const wp = toWorldCoords(mx, my)
    const last = eraseRedrawPath.value[eraseRedrawPath.value.length - 1]
    if (Math.abs(wp.x - last.x) > 2 || Math.abs(wp.y - last.y) > 2) {
      eraseRedrawPath.value.push(wp)
    }
    scheduleDraw()
    return
  }

  // 普通绘制模式：委托给 composable
  if (mode.value === 'draw' && isDrawing.value && dragging) {
    handleDrawMouseMove(toWorldCoords(mx, my))
    return
  }

  if (!dragging) {
    const hit = mode.value !== 'draw' ? hitTest(mx, my) : null
    if (!hit && e.button === 0) ctxMenu.value.show = false
    if (canvasRef.value) canvasRef.value.style.cursor = hit && mode.value === 'edit' ? 'pointer' : mode.value === 'draw' ? 'crosshair' : 'grab'
    if (hit) {
      const r = hit.region
      tooltip.value = { show: true, x: e.clientX + 12, y: e.clientY + 12, name: r.name, type: r.properties?.regionType }
    } else {
      tooltip.value.show = false
    }
    return
  }

  if (draggingVertex >= 0 && dragRegionId) {
    const ent = entityStore.entityMap.get(dragRegionId)
    if (ent) {
      const worldX = (mx - panX) / scale.value
      const worldY = (my - panY) / scale.value
      // 用 getTerritory() 以便自动生成的六边形顶点也可拖动
      const currentPts = getTerritory(ent)
      const territory = currentPts.map((p: Point, i: number) =>
        i === draggingVertex ? { x: Math.round(worldX), y: Math.round(worldY) } : { x: p.x, y: p.y }
      )
      entityStore.update(dragRegionId, { properties: { ...(ent.properties || {}), territory } })
    }
  } else if (dragNode) {
    const dx = mx - dragNodeStartX, dy = my - dragNodeStartY
    const wdx = dx / scale.value, wdy = dy / scale.value
    const ent = entityStore.entityMap.get(dragNode)
    if (ent) {
      // 同时平移 territory 点（若存在自定义 territory）
      const props = ent.properties || {}
      const shifted = Array.isArray(props.territory) ? (props.territory as Point[]).map((p) => ({
        x: Math.round(p.x + wdx),
        y: Math.round(p.y + wdy),
      })) : undefined
      entityStore.update(dragNode, {
        properties: {
          ...props,
          mapX: Math.round((Number(props.mapX) || 0) + wdx),
          mapY: Math.round((Number(props.mapY) || 0) + wdy),
          ...(shifted ? { territory: shifted } : {}),
        }
      })
    }
    dragNodeStartX = mx
    dragNodeStartY = my
  } else {
    panX = mx - dragStartX
    panY = my - dragStartY
  }
  scheduleDraw()
}

function onMouseUp() {
  // 偏移模式：结束拖拽节点
  if (mode.value === 'draw' && eraseMode.value === 'offset') {
    eraseDraggingIdx.value = -1
    dragging = false
    scheduleDraw()
    return
  }

  // 重划模式：结束一段绘制
  if (mode.value === 'draw' && eraseMode.value === 'redraw' && isDrawing.value) {
    isDrawing.value = false
    dragging = false
    finishRedraw()
    scheduleDraw()
    return
  }

  // 普通绘制模式
  if (mode.value === 'draw' && isDrawing.value) {
    handleDrawMouseUp()
    dragging = false
    return
  }
  dragging = false; dragNode = null; dragRegionId = null; draggingVertex = -1
  scheduleDraw()
}

function onWheel(e: WheelEvent) {
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  scale.value = Math.min(5, Math.max(0.1, scale.value * delta))
  scheduleDraw()
}

function onDblClick(e: MouseEvent) {
  // 偏移模式：双击边中点插入新节点
  if (mode.value === 'draw' && eraseMode.value === 'offset') {
    if (!canvasRef.value) return
    const rect = canvasRef.value.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    const wp = toWorldCoords(mx, my)
    let bestDist = Infinity, bestIdx = -1
    for (let i = 0; i < eraseBorderVertices.value.length - 1; i++) {
      const a = eraseBorderVertices.value[i], b = eraseBorderVertices.value[i + 1]
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2
      const d = Math.sqrt((wp.x - midX) ** 2 + (wp.y - midY) ** 2)
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    if (bestIdx >= 0 && bestDist < 30) {
      eraseBorderVertices.value.splice(bestIdx + 1, 0, { x: Math.round(wp.x), y: Math.round(wp.y) })
      eraseBorderFixedIndices.value = eraseBorderFixedIndices.value.map(idx => idx > bestIdx ? idx + 1 : idx)
      scheduleDraw()
    }
    return
  }
}

function zoomIn() { scale.value = Math.min(5, scale.value * 1.3); scheduleDraw() }
function zoomOut() { scale.value = Math.max(0.1, scale.value * 0.7); scheduleDraw() }
function fitAll() {
  const regions = getRegions()
  if (!regions.length) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of regions) {
    const x = Number(r.properties?.mapX) || 0
    const y = Number(r.properties?.mapY) || 0
    if (x === 0 && y === 0) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  if (minX === Infinity) return
  const w = maxX - minX + 100, h = maxY - minY + 100
  const sx = rectWidth() / w, sy = rectHeight() / h
  scale.value = Math.min(sx, sy) * 0.85
  panX = -minX * scale.value + 50
  panY = -minY * scale.value + 50
  scheduleDraw()
}

function rectWidth() { return mapRoot.value?.getBoundingClientRect().width || 800 }
function rectHeight() { return mapRoot.value?.getBoundingClientRect().height || 600 }

// === 监听 ===

watch(() => props.regions, scheduleDraw, { deep: true })
watch(() => relationStore.relations.length, scheduleDraw)

// === 键盘事件 ===

function onBorderlineKeyDown(e: KeyboardEvent) {
  if (mode.value !== 'draw') return
  if (e.altKey) {
    e.preventDefault()
    borderlineActive.value = true
    scheduleDraw()
  }
}

function onBorderlineKeyUp(e: KeyboardEvent) {
  if (e.key === 'Alt') {
    borderlineActive.value = false
    borderlineMode.value = null
    scheduleDraw()
  }
}

// === 生命周期 ===

onMounted(() => {
  registerShortcut({
    id: 'region.borderline',
    keys: ['alt'],
    description: '边境线模式',
    scope: 'view',
    handler: () => {
      if (mode.value === 'draw') {
        borderlineActive.value = true
      }
    },
  })
  document.addEventListener('keydown', onBorderlineKeyDown)
  document.addEventListener('keyup', onBorderlineKeyUp)
  fitAll()
  scheduleDraw()
})

onBeforeUnmount(() => {
  unregisterShortcut('region.borderline')
  document.removeEventListener('keydown', onBorderlineKeyDown)
  document.removeEventListener('keyup', onBorderlineKeyUp)
  cancelAnimationFrame(animFrame)
})
</script>

<style scoped>
.region-map { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; }
.rm-canvas { flex: 1; cursor: grab; }
</style>
