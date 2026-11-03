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
      @mouseleave="onMouseUp" @contextmenu.prevent="handleContextMenu"></canvas>
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
import { useConfirm, useShortcuts, normalizeKeys } from '@worldsea/ui-kit'
import MapToolbar from './map/MapToolbar.vue'
import MapTooltip from './map/MapTooltip.vue'
import MapContextMenu from './map/MapContextMenu.vue'
import { useBorderErase } from './map/useBorderErase'
import { useAdjoin } from './map/useAdjoin'
import { useDrawing } from './map/useDrawing'
import { useMapRender } from './map/useMapRender'
import { useMapContextMenu } from './map/useMapContextMenu'
import { useMapInteraction } from './map/useMapInteraction'
import { useMapBorderlineKeys } from './map/useMapBorderlineKeys'
import { hitTest as rawHitTest, toWorldCoords as rawToWorldCoords } from './map/hitTest'
import type {
  MapMode, RegionEntity, TooltipState, CtxMenuState, Point,
} from './map/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const props = defineProps<{ regions: any[] }>()

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { confirm } = useConfirm()
const { register: registerShortcut, unregister: unregisterShortcut, getRegisteredKeys } = useShortcuts()

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

function hitTest(mx: number, my: number) {
  return rawHitTest(mx, my, panX, panY, scale.value, getRegions(), getTerritory)
}

function toWorldCoords(mx: number, my: number) {
  return rawToWorldCoords(mx, my, panX, panY, scale.value)
}

// === 组合式函数（composables）===
// closeCtx 由下面的 useMapContextMenu 提供；adjoin 的完成回调晚于其声明，
// 故用转发函数承接（函数声明提升，装配顺序不受影响）
function closeCtx() { ctxMenu.value.show = false }

const borderErase = useBorderErase({
  getRegions,
  getTerritory,
  scheduleDraw,
})

const adjoin = useAdjoin({
  getRegions,
  getTerritory,
  scheduleDraw,
  onAdjoinDone: () => closeCtx(),
})

const drawing = useDrawing({
  getRegions,
  getTerritory,
  scheduleDraw,
  hideTooltip,
})

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

// === 区域配色 ===
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

// === 右键菜单（开合与菜单动作在 useMapContextMenu） ===
const menu = useMapContextMenu({
  mode, ctxMenu, adjoinSelectMode, adjoinSourceRegion,
  getRegions, getTerritory,
  getPanX: () => panX, getPanY: () => panY, getScale: () => scale.value,
  hitTest, openEraseCtxMenu, toggleAdjoinTarget, startAdjoin, scheduleDraw,
  onSelect: (region) => emit('select', region),
  onDeleteRegion: async (region) => {
    const name = region.name
    const ok = await confirm({ type: 'danger', title: '删除区域', description: `确定删除 "${name}"？` })
    if (ok) await entityStore.remove(region.id)
  },
  onSetColor: (region, color) => {
    const existing = entityStore.entityMap.get(region.id)
    if (existing) {
      entityStore.update(region.id, { properties: { ...(existing.properties || {}), fillColor: color } })
    }
  },
})
const { onContextMenu, ctxEdit, ctxDelete, ctxSetColor, ctxAdjoin } = menu

function handleContextMenu(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  onContextMenu(e, canvas.getBoundingClientRect())
}

// === 鼠标交互（按下/移动/抬起/滚轮/双击在 useMapInteraction） ===
function rectWidth() { return mapRoot.value?.getBoundingClientRect().width || 800 }
function rectHeight() { return mapRoot.value?.getBoundingClientRect().height || 600 }

const { onMouseDown, onMouseMove, onMouseUp, onWheel, onDblClick, zoomIn, zoomOut, fitAll } = useMapInteraction({
  canvasRef, mode, scale, tooltip, ctxMenu, selectedRegionId,
  eraseMode, eraseDraggingIdx, eraseBorderVertices, eraseBorderFixedIndices, eraseRedrawPath,
  isDrawing, adjoinSelectMode, adjoinSourceRegion,
  getPanX: () => panX, getPanY: () => panY,
  setPan: (x, y) => { panX = x; panY = y },
  hitTest, toWorldCoords, getRegions, getTerritory,
  getEntity: (id) => entityStore.entityMap.get(id),
  updateEntity: (id, patch) => entityStore.update(id, patch),
  addVertex, toggleAdjoinTarget,
  handleDrawMouseDown, handleDrawMouseMove, handleDrawMouseUp, finishRedraw,
  scheduleDraw, rectWidth, rectHeight,
})

// === 监听 ===
watch(() => props.regions, scheduleDraw, { deep: true })
watch(() => relationStore.relations.length, scheduleDraw)

// === 键盘事件（边境线持续态键在 useMapBorderlineKeys） ===
const { onBorderlineKeyDown, onBorderlineKeyUp } = useMapBorderlineKeys({
  mode, borderlineActive, borderlineMode, getRegisteredKeys, normalizeKeys, scheduleDraw,
})

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
