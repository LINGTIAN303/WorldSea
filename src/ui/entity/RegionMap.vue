<template>
  <div class="region-map" ref="mapRoot">
    <div class="rm-toolbar">
      <button class="rm-btn" :class="{ on: mode === 'pan' }" @click="mode = 'pan'" title="浏览"><WsIcon name="image" size="xs" /></button>
      <button class="rm-btn" :class="{ on: mode === 'edit' }" @click="mode = 'edit'" title="编辑"><WsIcon name="edit" size="xs" /></button>
      <button class="rm-btn" :class="{ on: mode === 'draw' }" @click="startDrawMode" title="绘制"><WsIcon name="brush" size="xs" /></button>
      <span class="rm-sep">|</span>
      <button class="rm-btn" @click="zoomIn">+</button>
      <span class="rm-zoom">{{ Math.round(scale * 100) }}%</span>
      <button class="rm-btn" @click="zoomOut">-</button>
      <button class="rm-btn" @click="fitAll">适应</button>
      <span class="rm-mode-hint">当前: {{ modeLabel }}</span>
      <span class="rm-legend-hint" v-if="mode !== 'draw'">图例:
        <span v-for="item in legendTypes" :key="item.type" :style="{ color: item.color }">{{ item.type }} </span>
      </span>
      <template v-if="mode === 'draw'">
        <span class="rm-draw-hint" v-if="eraseMode === 'offset'">偏移模式：拖拽节点移动边境线，Enter确认，Esc取消</span>
        <span class="rm-draw-hint" v-else-if="eraseMode === 'redraw'">重划模式：绘制新的边境线</span>
        <span class="rm-draw-hint" v-else-if="!borderlineActive">点击地图开始绘制疆域边界</span>
        <span class="rm-draw-hint rm-borderline-hint" v-else>边境线模式：按住 Alt 绘制边境线（分割/增补）</span>
      </template>
    </div>
    <canvas ref="canvasRef" class="rm-canvas"
      @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp"
      @wheel.prevent="onWheel" @dblclick="onDblClick"
      @mouseleave="onMouseUp" @contextmenu.prevent="onContextMenu"></canvas>
    <div v-if="tooltip.show" class="rm-tooltip"
      :style="ctxPos(tooltip.x, tooltip.y, 180, 40)">
      <strong>{{ tooltip.name }}</strong>
      <span v-if="tooltip.type"> ({{ tooltip.type }})</span>
    </div>

    <div v-if="ctxMenu.show && !adjoinSelectMode" class="rm-context-menu"
      :style="ctxPos(ctxMenu.x, ctxMenu.y, 160, 240)">
      <div class="rm-ctx-item" @click="ctxEdit">编辑详情</div>
      <div class="rm-ctx-item" @click="ctxDelete">删除区域</div>
      <div class="rm-ctx-item" @click="ctxAdjoin">接壤</div>
      <div class="rm-ctx-divider"></div>
      <div class="rm-ctx-label">更改颜色</div>
      <div class="rm-ctx-colors">
        <button v-for="col in paletteColors" :key="col"
          class="rm-ctx-color-btn" :style="{ background: col }"
          @click="ctxSetColor(col)"></button>
      </div>
    </div>
    <div v-if="ctxMenu.show && adjoinSelectMode" class="rm-context-menu"
      :style="ctxPos(ctxMenu.x, ctxMenu.y, 160, 80)">
      <div class="rm-ctx-item" @click="executeAdjoin">确认接壤 ({{ adjoinSelectedIds.size }})</div>
      <div class="rm-ctx-item" @click="cancelAdjoin">取消</div>
    </div>
    <div v-if="eraseCtxMenu.show" class="rm-context-menu"
      :style="ctxPos(eraseCtxMenu.x, eraseCtxMenu.y, 160, 120)">
      <div class="rm-ctx-label">抹除边境线</div>
      <div class="rm-ctx-item" @click="eraseMerge">融合</div>
      <div class="rm-ctx-item" @click="eraseMoveLine">移线</div>
      <div class="rm-ctx-divider"></div>
      <div class="rm-ctx-item" @click="closeEraseCtx">取消</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'
import WsIcon from '../WsIcon.vue'
import { useRelationStore } from '@worldsmith/entity-core'
import { useDialog, useConfirm, useDuplicateNameCheck, useShortcuts, useUndoRedo } from '@worldsmith/ui-kit'
import { useSettingsStore } from '../../stores/settingsStore'
import { toastWarn } from '../../composables/useToast'
import {
  bridgeChaikinSmooth,
  bridgeSimplifyPoints,
  bridgeComputeMergedPolygon,
  bridgePolygonSplit,
  bridgePolygonAugment,
  bridgeMergePolygons,
  bridgePointInPolygon,
  crossProduct,
} from '@worldsmith/canvas-engine/geometry'

const props = defineProps<{ regions: any[] }>()

const entityStore = useEntityStore()
const { checkAndConfirmName } = useDuplicateNameCheck()
const relationStore = useRelationStore()
const dialog = useDialog()
const { confirm } = useConfirm()
const settingsStore = useSettingsStore()
const { register: registerShortcut, unregister: unregisterShortcut } = useShortcuts()
const { beginTransaction, commitTransaction } = useUndoRedo()

const mapRoot = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()
const scale = ref(1)
const tooltip = ref({ show: false, x: 0, y: 0, name: '', type: '' })
const ctxMenu = ref({ show: false, x: 0, y: 0, region: null as any })
const eraseCtxMenu = ref({ show: false, x: 0, y: 0, region1: null as any, region2: null as any, sharedEdge: null as any })

function ctxPos(mx: number, my: number, w = 160, h = 240) {
  let left = mx
  let top = my
  if (left + w > window.innerWidth - 8) left = mx - w
  if (top + h > window.innerHeight - 8) top = my - h
  left = Math.max(8, left)
  top = Math.max(8, top)
  return { left: left + 'px', top: top + 'px' }
}
const mode = ref<'pan' | 'edit' | 'draw'>('pan')
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
  '\u5927\u9646': '#4a6cf7', '\u56fd\u5bb6': '#27ae60', '\u884c\u7701': '#2ecc71',
  '\u57ce\u5e02': '#f39c12', '\u5730\u6807': '#e74c3c', '\u533a\u57df': '#9b59b6',
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

// Draw mode state
let drawingPath: { x: number; y: number }[] = []
let isDrawing = false

const borderlineActive = ref(false)
const borderlineMode = ref<'split' | 'augment' | null>(null)

const eraseMode = ref<'offset' | 'redraw' | null>(null)
const eraseBorderVertices = ref<{ x: number; y: number }[]>([])
const eraseBorderFixedIndices = ref<number[]>([])
let eraseDraggingIdx = -1
const eraseRedrawPath = ref<{ x: number; y: number }[]>([])
const eraseRedrawRegion1 = ref<any>(null)
const eraseRedrawRegion2 = ref<any>(null)
const eraseRedrawSharedEdge = ref<any>(null)

const adjoinSelectMode = ref(false)
const adjoinSourceRegion = ref<any>(null)
const adjoinSelectedIds = ref<Set<string>>(new Set())

const pixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1

function getRegions() { return props.regions || entityStore.entities.filter(e => e.type === 'region') }

function getTerritory(r: any): { x: number; y: number }[] {
  if (r.properties && r.properties.territory && r.properties.territory.length >= 3) return r.properties.territory
  const cx = Number(r.properties?.mapX) || 0
  const cy = Number(r.properties?.mapY) || 0
  const radius = 30
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6
    pts.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
  }
  return pts
}

function startDrawMode() {
  mode.value = 'draw'
  drawingPath = []
  isDrawing = false
  tooltip.value.show = false
}

function findSharedEdge(mx: number, my: number): { region1: any, region2: any, startIdx1: number, startIdx2: number } | null {
  const x = (mx - panX) / scale.value
  const y = (my - panY) / scale.value
  const regions = getRegions()
  for (let ri = 0; ri < regions.length; ri++) {
    for (let rj = ri + 1; rj < regions.length; rj++) {
      const pts1 = getTerritory(regions[ri])
      const pts2 = getTerritory(regions[rj])
      for (let ei = 0; ei < pts1.length; ei++) {
        const a1 = pts1[ei], b1 = pts1[(ei + 1) % pts1.length]
        for (let ej = 0; ej < pts2.length; ej++) {
          const a2 = pts2[ej], b2 = pts2[(ej + 1) % pts2.length]
          const d1 = Math.sqrt((a1.x - a2.x) ** 2 + (a1.y - a2.y) ** 2)
          const d2 = Math.sqrt((b1.x - b2.x) ** 2 + (b1.y - b2.y) ** 2)
          const d3 = Math.sqrt((a1.x - b2.x) ** 2 + (a1.y - b2.y) ** 2)
          const d4 = Math.sqrt((b1.x - a2.x) ** 2 + (b1.y - a2.y) ** 2)
          const threshold = 8
          if ((d1 < threshold && d2 < threshold) || (d3 < threshold && d4 < threshold)) {
            const edgeLen = Math.sqrt((b1.x - a1.x) ** 2 + (b1.y - a1.y) ** 2)
            if (edgeLen < 1) continue
            const ex = b1.x - a1.x, ey = b1.y - a1.y
            const t = ((x - a1.x) * ex + (y - a1.y) * ey) / (edgeLen * edgeLen)
            if (t < -0.1 || t > 1.1) continue
            const px = a1.x + t * ex, py = a1.y + t * ey
            const dd = Math.sqrt((x - px) ** 2 + (y - py) ** 2)
            if (dd < 10) {
              return { region1: regions[ri], region2: regions[rj], startIdx1: ei, startIdx2: ej }
            }
          }
        }
      }
    }
  }
  return null
}

function findSharedEdgeBetween(r1: any, r2: any): { startIdx1: number, startIdx2: number } | null {
  const pts1 = getTerritory(r1)
  const pts2 = getTerritory(r2)
  const threshold = 8
  for (let i = 0; i < pts1.length; i++) {
    const a1 = pts1[i], b1 = pts1[(i + 1) % pts1.length]
    for (let j = 0; j < pts2.length; j++) {
      const a2 = pts2[j], b2 = pts2[(j + 1) % pts2.length]
      const d1 = Math.sqrt((a1.x - a2.x) ** 2 + (a1.y - a2.y) ** 2)
      const d2 = Math.sqrt((b1.x - b2.x) ** 2 + (b1.y - b2.y) ** 2)
      const d3 = Math.sqrt((a1.x - b2.x) ** 2 + (a1.y - b2.y) ** 2)
      const d4 = Math.sqrt((b1.x - a2.x) ** 2 + (b1.y - a2.y) ** 2)
      if ((d1 < threshold && d2 < threshold) || (d3 < threshold && d4 < threshold)) {
        return { startIdx1: i, startIdx2: j }
      }
    }
  }
  return null
}

function onContextMenu(e: MouseEvent) {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left, my = e.clientY - rect.top

  if (mode.value === 'draw') {
    const shared = findSharedEdge(mx, my)
    if (shared) {
      eraseCtxMenu.value = {
        show: true, x: e.clientX, y: e.clientY,
        region1: shared.region1, region2: shared.region2,
        sharedEdge: { startIdx1: shared.startIdx1, startIdx2: shared.startIdx2 }
      }
      setTimeout(() => { document.addEventListener('click', closeEraseCtx, { once: true }) }, 0)
    }
    return
  }

  if (mode.value !== 'edit') return
  const hit = hitTest(mx, my)
  if (adjoinSelectMode.value) {
    if (hit && hit.region.id !== adjoinSourceRegion.value?.id) {
      const newSet = new Set(adjoinSelectedIds.value)
      if (newSet.has(hit.region.id)) newSet.delete(hit.region.id)
      else newSet.add(hit.region.id)
      adjoinSelectedIds.value = newSet
      scheduleDraw()
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

function closeCtx() { ctxMenu.value.show = false }

function closeEraseCtx() { eraseCtxMenu.value.show = false }

async function eraseMerge() {
  const r1 = eraseCtxMenu.value.region1
  const r2 = eraseCtxMenu.value.region2
  if (!r1 || !r2) return
  closeEraseCtx()

  const choice = await dialog.prompt(
    `选择继承哪个实体的信息：\n1 - ${r1.name}\n2 - ${r2.name}`,
    '融合实体', '1'
  )
  if (!choice) return

  const keeper = choice === '2' ? r2 : r1
  const removed = choice === '2' ? r1 : r2

  const ok = await confirm({ type: 'danger', title: '合并区域', description: `该操作将会删除「${removed.name}」，确定继续？` })
  if (!ok) return

  beginTransaction()

  const pts1 = getTerritory(keeper)
  const pts2 = getTerritory(removed)
  const mergedPolygon = await bridgeMergePolygons(pts1, pts2)

  if (mergedPolygon.length >= 3) {
    let cx = 0, cy = 0
    for (const p of mergedPolygon) { cx += p.x; cy += p.y }
    cx = Math.round(cx / mergedPolygon.length)
    cy = Math.round(cy / mergedPolygon.length)
    const ent = entityStore.entityMap.get(keeper.id)
    if (ent) {
      entityStore.update(keeper.id, {
        properties: { ...(ent.properties || {}), mapX: cx, mapY: cy, territory: mergedPolygon }
      })
    }
  }

  await entityStore.remove(removed.id)

  const bordersRels = relationStore.relations.filter(r =>
    r.type === 'borders' &&
    ((r.sourceId === keeper.id && r.targetId === removed.id) ||
     (r.sourceId === removed.id && r.targetId === keeper.id))
  )
  for (const rel of bordersRels) {
    await relationStore.remove(rel.id)
  }

  commitTransaction()

  scheduleDraw()
}

async function eraseMoveLine() {
  const r1 = eraseCtxMenu.value.region1
  const r2 = eraseCtxMenu.value.region2
  if (!r1 || !r2) return
  closeEraseCtx()

  const choice = await dialog.prompt('选择移线方式：\n1 - 偏移（拖拽节点移动边境线）\n2 - 重划（重新绘制边境线）', '移线方式', '1')
  if (!choice) return

  if (choice === '1') {
    startOffsetMode(r1, r2)
  } else {
    startRedrawMode(r1, r2)
  }
}

function startOffsetMode(r1: any, r2: any) {
  eraseMode.value = 'offset'
  eraseRedrawRegion1.value = r1
  eraseRedrawRegion2.value = r2
  const shared = findSharedEdgeBetween(r1, r2)
  if (!shared) {
    toastWarn('未找到共享边境线')
    eraseMode.value = null
    return
  }
  const pts1 = getTerritory(r1)
  const edgePts = [pts1[shared.startIdx1], pts1[(shared.startIdx1 + 1) % pts1.length]]
  eraseBorderVertices.value = [...edgePts]
  eraseBorderFixedIndices.value = [0, edgePts.length - 1]
  eraseDraggingIdx = -1
  scheduleDraw()
}

function startRedrawMode(r1: any, r2: any) {
  eraseMode.value = 'redraw'
  eraseRedrawRegion1.value = r1
  eraseRedrawRegion2.value = r2
  eraseRedrawSharedEdge.value = findSharedEdgeBetween(r1, r2)
  eraseRedrawPath.value = []
  isDrawing = false
  drawingPath = []
  scheduleDraw()
}

async function confirmOffset() {
  const r1 = eraseRedrawRegion1.value
  const r2 = eraseRedrawRegion2.value
  if (!r1 || !r2) { eraseMode.value = null; return }

  const shared = findSharedEdgeBetween(r1, r2)
  if (!shared) { eraseMode.value = null; eraseBorderVertices.value = []; scheduleDraw(); return }

  const pts1 = getTerritory(r1)
  const newPts1 = [...pts1]
  const idx1Start = shared.startIdx1
  const idx1End = (shared.startIdx1 + 1) % pts1.length
  if (eraseBorderVertices.value.length >= 2) {
    newPts1[idx1Start] = { ...eraseBorderVertices.value[0] }
    newPts1[idx1End] = { ...eraseBorderVertices.value[eraseBorderVertices.value.length - 1] }
    if (eraseBorderVertices.value.length > 2) {
      const midPts = eraseBorderVertices.value.slice(1, -1)
      newPts1.splice(idx1End, 0, ...midPts)
    }
  }
  const ent1 = entityStore.entityMap.get(r1.id)
  if (ent1) {
    let cx = 0, cy = 0
    for (const p of newPts1) { cx += p.x; cy += p.y }
    entityStore.update(r1.id, {
      properties: { ...(ent1.properties || {}), mapX: Math.round(cx / newPts1.length), mapY: Math.round(cy / newPts1.length), territory: newPts1 }
    })
  }

  const pts2 = getTerritory(r2)
  const newPts2 = [...pts2]
  const idx2Start = shared.startIdx2
  const idx2End = (shared.startIdx2 + 1) % pts2.length
  if (eraseBorderVertices.value.length >= 2) {
    newPts2[idx2Start] = { ...eraseBorderVertices.value[eraseBorderVertices.value.length - 1] }
    newPts2[idx2End] = { ...eraseBorderVertices.value[0] }
    if (eraseBorderVertices.value.length > 2) {
      const midPts = [...eraseBorderVertices.value].slice(1, -1).reverse()
      newPts2.splice(idx2End, 0, ...midPts)
    }
  }
  const ent2 = entityStore.entityMap.get(r2.id)
  if (ent2) {
    let cx = 0, cy = 0
    for (const p of newPts2) { cx += p.x; cy += p.y }
    entityStore.update(r2.id, {
      properties: { ...(ent2.properties || {}), mapX: Math.round(cx / newPts2.length), mapY: Math.round(cy / newPts2.length), territory: newPts2 }
    })
  }

  eraseMode.value = null
  eraseBorderVertices.value = []
  scheduleDraw()
}

async function finishRedraw() {
  if (eraseRedrawPath.value.length < 2) {
    eraseMode.value = null
    eraseRedrawPath.value = []
    return
  }

  const r1 = eraseRedrawRegion1.value
  const r2 = eraseRedrawRegion2.value
  if (!r1 || !r2) { eraseMode.value = null; return }

  const smooth = await bridgeChaikinSmooth(eraseRedrawPath.value, 1)
  const simplified = await bridgeSimplifyPoints(smooth, 3)

  const choice = await dialog.prompt(
    `新线与旧线之间的范围划入：\n1 - ${r1.name}\n2 - ${r2.name}`,
    '重划边境线', '1'
  )
  if (!choice) {
    eraseMode.value = null
    eraseRedrawPath.value = []
    scheduleDraw()
    return
  }

  const targetRegion = choice === '2' ? r2 : r1
  const otherRegion = choice === '2' ? r1 : r2
  const shared = eraseRedrawSharedEdge.value || findSharedEdgeBetween(r1, r2)
  if (!shared) {
    toastWarn('未找到共享边境线')
    eraseMode.value = null
    eraseRedrawPath.value = []
    scheduleDraw()
    return
  }

  const targetPts = getTerritory(targetRegion)
  const otherPts = getTerritory(otherRegion)
  const isTargetR1 = targetRegion.id === r1.id
  const isOtherR1 = otherRegion.id === r1.id

  const newTargetPts = replaceEdgeWithLine(targetPts, isTargetR1 ? shared.startIdx1 : shared.startIdx2, simplified)
  const reversedLine = [...simplified].reverse()
  const newOtherPts = replaceEdgeWithLine(otherPts, isOtherR1 ? shared.startIdx1 : shared.startIdx2, reversedLine)

  if (newTargetPts.length >= 3) {
    const ent = entityStore.entityMap.get(targetRegion.id)
    if (ent) {
      let cx = 0, cy = 0
      for (const p of newTargetPts) { cx += p.x; cy += p.y }
      entityStore.update(targetRegion.id, {
        properties: { ...(ent.properties || {}), mapX: Math.round(cx / newTargetPts.length), mapY: Math.round(cy / newTargetPts.length), territory: newTargetPts }
      })
    }
  }

  if (newOtherPts.length >= 3) {
    const ent = entityStore.entityMap.get(otherRegion.id)
    if (ent) {
      let cx = 0, cy = 0
      for (const p of newOtherPts) { cx += p.x; cy += p.y }
      entityStore.update(otherRegion.id, {
        properties: { ...(ent.properties || {}), mapX: Math.round(cx / newOtherPts.length), mapY: Math.round(cy / newOtherPts.length), territory: newOtherPts }
      })
    }
  }

  eraseMode.value = null
  eraseRedrawPath.value = []
  scheduleDraw()
}

function replaceEdgeWithLine(
  polygon: { x: number; y: number }[],
  edgeIdx: number,
  newLine: { x: number; y: number }[]
): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = []
  for (let i = 0; i < polygon.length; i++) {
    if (i === edgeIdx) {
      result.push(polygon[i])
      for (const p of newLine) {
        result.push(p)
      }
    } else if (i !== (edgeIdx + 1) % polygon.length) {
      result.push(polygon[i])
    }
  }
  return result
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
  adjoinSourceRegion.value = ctxMenu.value.region
  adjoinSelectMode.value = true
  adjoinSelectedIds.value = new Set()
  closeCtx()
  toastWarn('请点击要接壤的区域（可多选），完成后右键确认')
  scheduleDraw()
}

function cancelAdjoin() {
  adjoinSelectMode.value = false
  adjoinSourceRegion.value = null
  adjoinSelectedIds.value = new Set()
  closeCtx()
  scheduleDraw()
}

async function executeAdjoin() {
  const source = adjoinSourceRegion.value
  const targetIds = [...adjoinSelectedIds.value]

  if (targetIds.length === 0) {
    toastWarn('请至少选择一个区域进行接壤')
    return
  }

  let method: 'extend' | 'be-extended' = 'extend'
  if (targetIds.length > 1) {
    method = 'be-extended'
  } else {
    const choice = await dialog.prompt('选择接壤方式：\n1 - 选中区域延伸去接壤\n2 - 选中区域被延伸补齐', '接壤方式', '2')
    method = choice === '1' ? 'extend' : 'be-extended'
  }

  const now = new Date().toISOString()

  beginTransaction()

  for (const targetId of targetIds) {
    const targetRegion = getRegions().find(r => r.id === targetId)
    if (!targetRegion) continue

    relationStore.add({
      id: 'rel-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: 'borders',
      sourceId: source.id,
      targetId: targetId,
      label: '',
      properties: {},
      createdAt: now,
      updatedAt: now,
    })

    if (method === 'extend') {
      await mergeTerritories(targetRegion, source)
    } else {
      await mergeTerritories(source, targetRegion)
    }
  }

  commitTransaction()

  adjoinSelectMode.value = false
  adjoinSourceRegion.value = null
  adjoinSelectedIds.value = new Set()
  closeCtx()
  scheduleDraw()
}

async function mergeTerritories(extender: any, extended: any) {
  const extPts = getTerritory(extender)
  const extdPts = getTerritory(extended)

  let cx1 = 0, cy1 = 0
  for (const p of extPts) { cx1 += p.x; cy1 += p.y }
  cx1 /= extPts.length; cy1 /= extPts.length

  let cx2 = 0, cy2 = 0
  for (const p of extdPts) { cx2 += p.x; cy2 += p.y }
  cx2 /= extdPts.length; cy2 /= extdPts.length

  const dx = cx2 - cx1, dy = cy2 - cy1
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 1) return

  const mergedPolygon = await bridgeComputeMergedPolygon(extPts, extdPts)

  if (mergedPolygon.length >= 3) {
    let mcx = 0, mcy = 0
    for (const p of mergedPolygon) { mcx += p.x; mcy += p.y }
    mcx = Math.round(mcx / mergedPolygon.length)
    mcy = Math.round(mcy / mergedPolygon.length)

    const ent = entityStore.entityMap.get(extender.id)
    if (ent) {
      await entityStore.update(extender.id, {
        properties: {
          ...(ent.properties || {}),
          mapX: mcx,
          mapY: mcy,
          territory: mergedPolygon,
        }
      })
    }
  }
}

function regionColor(r: any): string {
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

function addVertex(region: any, edgeIdx: number, pos: { x: number; y: number }) {
  const ent = entityStore.entityMap.get(region.id)
  if (!ent) return
  const pts = getTerritory(ent)
  const newPts = [...pts]
  newPts.splice(edgeIdx + 1, 0, { x: Math.round(pos.x), y: Math.round(pos.y) })
  entityStore.update(region.id, { properties: { ...(ent.properties || {}), territory: newPts } })
  scheduleDraw()
}

const emit = defineEmits<{ select: [region: any] }>()

/* ─── Geometry helpers (sync, used by hitTest & interaction) ─── */

function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    if ((yi > point.y) !== (yj > point.y) && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function segmentsIntersect(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, p4: { x: number; y: number }): boolean {
  const d1 = crossProduct(p3, p4, p1)
  const d2 = crossProduct(p3, p4, p2)
  const d3 = crossProduct(p1, p2, p3)
  const d4 = crossProduct(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

function lineIntersectsPolygonEdges(line: { x: number; y: number }[], polygon: { x: number; y: number }[]): boolean {
  for (let i = 0; i < line.length - 1; i++) {
    for (let j = 0; j < polygon.length; j++) {
      const a = polygon[j], b = polygon[(j + 1) % polygon.length]
      if (segmentsIntersect(line[i], line[i + 1], a, b)) return true
    }
  }
  return false
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas || !mapRoot.value) return
  const rect = mapRoot.value.getBoundingClientRect()
  canvas.width = rect.width * pixelRatio
  canvas.height = rect.height * pixelRatio
  canvas.style.width = rect.width + 'px'
  canvas.style.height = rect.height + 'px'
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

  // Parchment background
  ctx.fillStyle = '#f5ecd7'
  ctx.fillRect(0, 0, rect.width, rect.height)
  ctx.fillStyle = 'rgba(200,180,140,0.05)'
  for (let i = 0; i < 60; i++) {
    ctx.fillRect(Math.random() * rect.width, Math.random() * rect.height, Math.random() * 40 + 5, 1)
  }

  ctx.save()
  ctx.translate(panX, panY)
  ctx.scale(scale.value, scale.value)

  const regions = getRegions()
  const regionPositions: Record<string, { x: number; y: number }> = {}

  // Draw connections
  const rels = relationStore.relations
  for (const r of rels) {
    if (!['borders', 'route', 'located_in', 'contains', 'enclave_of'].includes(r.type)) continue
    const src = entityStore.entityMap.get(r.sourceId)
    const tgt = entityStore.entityMap.get(r.targetId)
    if (!src || !tgt) continue
    const p1 = { x: Number(src.properties?.mapX) || 0, y: Number(src.properties?.mapY) || 0 }
    const p2 = { x: Number(tgt.properties?.mapX) || 0, y: Number(tgt.properties?.mapY) || 0 }
    if (p1.x === 0 && p1.y === 0) continue
    if (p2.x === 0 && p2.y === 0) continue
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    if (r.type === 'route') {
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = '#c4a95a'
    } else if (r.type === 'borders') {
      ctx.setLineDash([])
      ctx.strokeStyle = '#8b4513'
    } else {
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = '#aaa'
    }
    ctx.lineWidth = r.type === 'borders' ? 2 : 1.5
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Draw regions
  for (const r of regions) {
    const x = Number(r.properties?.mapX) || 0
    const y = Number(r.properties?.mapY) || 0
    if (x === 0 && y === 0) continue
    regionPositions[r.id] = { x, y }
    const color = regionColor(r)

    const pts = getTerritory(r)
    if (pts.length >= 3) {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y)
      ctx.closePath()
      ctx.fillStyle = color + '60'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()

      // Vertices only in edit mode
      if (mode.value === 'edit') {
        for (const p of pts) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
          ctx.fillStyle = '#fff'
          ctx.fill()
          ctx.strokeStyle = color
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      }
    }

    // Label
    ctx.fillStyle = '#3a2a1a'
    ctx.font = '11px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(r.name, x, y + 4)

    const rt2 = r.properties?.regionType as string || ''
    if (rt2) {
      ctx.fillStyle = '#9a8050'
      ctx.font = '8px Georgia, serif'
      ctx.fillText(rt2, x, y + 16)
    }
  }

  if (mode.value === 'edit' && selectedRegionId.value) {
    const selRegion = getRegions().find(r => r.id === selectedRegionId.value)
    if (selRegion) {
      const selPts = getTerritory(selRegion)
      if (selPts.length >= 3) {
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(selPts[0].x, selPts[0].y)
        for (let k = 1; k < selPts.length; k++) ctx.lineTo(selPts[k].x, selPts[k].y)
        ctx.closePath()
        ctx.strokeStyle = '#FFD700'
        ctx.lineWidth = 4
        ctx.shadowColor = '#FFD700'
        ctx.shadowBlur = 12
        ctx.stroke()
        ctx.restore()
      }
      const enclaveRels = relationStore.relations.filter(r => r.type === 'enclave_of')
      for (const rel of enclaveRels) {
        let linkedId: string | null = null
        if (rel.sourceId === selectedRegionId.value) linkedId = rel.targetId
        else if (rel.targetId === selectedRegionId.value) linkedId = rel.sourceId
        if (linkedId) {
          const linkedRegion = getRegions().find(r => r.id === linkedId)
          if (linkedRegion) {
            const linkedPts = getTerritory(linkedRegion)
            if (linkedPts.length >= 3) {
              ctx.save()
              ctx.beginPath()
              ctx.moveTo(linkedPts[0].x, linkedPts[0].y)
              for (let k = 1; k < linkedPts.length; k++) ctx.lineTo(linkedPts[k].x, linkedPts[k].y)
              ctx.closePath()
              ctx.strokeStyle = '#FFD700'
              ctx.lineWidth = 3
              ctx.shadowColor = '#FFD700'
              ctx.shadowBlur = 8
              ctx.stroke()
              ctx.restore()
            }
          }
        }
      }
    }
  }

  if (adjoinSelectMode.value) {
    for (const r of regions) {
      if (!adjoinSelectedIds.value.has(r.id)) continue
      const pts = getTerritory(r)
      if (pts.length < 3) continue
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y)
      ctx.closePath()
      ctx.setLineDash([6, 3])
      ctx.strokeStyle = '#2ecc71'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }
    const srcPts = adjoinSourceRegion.value ? getTerritory(adjoinSourceRegion.value) : []
    if (srcPts.length >= 3) {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(srcPts[0].x, srcPts[0].y)
      for (let k = 1; k < srcPts.length; k++) ctx.lineTo(srcPts[k].x, srcPts[k].y)
      ctx.closePath()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#e74c3c'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }
  }

  if (eraseMode.value === 'offset' && eraseBorderVertices.value.length > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(eraseBorderVertices.value[0].x, eraseBorderVertices.value[0].y)
    for (let i = 1; i < eraseBorderVertices.value.length; i++) {
      ctx.lineTo(eraseBorderVertices.value[i].x, eraseBorderVertices.value[i].y)
    }
    ctx.strokeStyle = '#e74c3c'
    ctx.lineWidth = 3
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.setLineDash([])
    for (let i = 0; i < eraseBorderVertices.value.length; i++) {
      const p = eraseBorderVertices.value[i]
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
      ctx.fillStyle = eraseBorderFixedIndices.value.includes(i) ? '#999' : '#e74c3c'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    ctx.restore()
  }

  if (eraseMode.value === 'redraw' && eraseRedrawPath.value.length > 1) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(eraseRedrawPath.value[0].x, eraseRedrawPath.value[0].y)
    for (let i = 1; i < eraseRedrawPath.value.length; i++) {
      ctx.lineTo(eraseRedrawPath.value[i].x, eraseRedrawPath.value[i].y)
    }
    ctx.strokeStyle = '#3498db'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.restore()
  }

  // Draw drawing path preview (in draw mode)
  if (drawingPath.length > 1) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(drawingPath[0].x, drawingPath[0].y)
    for (let i = 1; i < drawingPath.length; i++) {
      ctx.lineTo(drawingPath[i].x, drawingPath[i].y)
    }
    ctx.strokeStyle = '#e74c3c'
    ctx.lineWidth = 3
    ctx.stroke()

    // If drawing complete-ish, show preview fill
    if (drawingPath.length > 3) {
      ctx.beginPath()
      ctx.moveTo(drawingPath[0].x, drawingPath[0].y)
      for (let i = 1; i < drawingPath.length; i++) {
        ctx.lineTo(drawingPath[i].x, drawingPath[i].y)
      }
      ctx.closePath()
      ctx.fillStyle = 'rgba(231,76,60,0.08)'
      ctx.fill()
    }
    ctx.restore()
  }

  ctx.restore()

  // Legend
  // Dynamic legend - collect types from actual regions
  const seenTypes = new Set<string>()
  const legendItems: { type: string; color: string }[] = []
  for (const r of regions) {
    const rt = r.properties?.regionType || '区域'
    if (!seenTypes.has(rt)) {
      seenTypes.add(rt)
      const col = regionColor(r)
      legendItems.push({ type: rt, color: col })
    }
  }
  if (legendItems.length > 0) {
    ctx.fillStyle = 'rgba(245,236,215,0.9)'
    ctx.strokeStyle = '#c4a95a'
    ctx.lineWidth = 1
    const lh = legendItems.length * 18 + 10
    roundedRect(ctx, rect.width - 140, 8, 130, lh, 4)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#3a2a1a'
    ctx.font = '10px Georgia, serif'
    let ly = 14
    for (const item of legendItems) {
      ctx.fillStyle = item.color
      ctx.fillRect(rect.width - 132, ly + 1, 8, 8)
      ctx.fillStyle = '#3a2a1a'
      ctx.fillText(item.type.length > 8 ? item.type.slice(0, 7) + '..' : item.type, rect.width - 120, ly + 1)
      ly += 18
    }
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function hitTest(mx: number, my: number) {
  const x = (mx - panX) / scale.value
  const y = (my - panY) / scale.value
  const regions = getRegions()
  for (const r of regions) {
    const pts = getTerritory(r)
    for (let vi = 0; vi < pts.length; vi++) {
      const dx = x - pts[vi].x, dy = y - pts[vi].y
      if (dx * dx + dy * dy < 64) { return { region: r, vertexIdx: vi } }
    }
    // Edge hit detection
    for (let ei = 0; ei < pts.length; ei++) {
      const a = pts[ei], b = pts[(ei + 1) % pts.length]
      const ex = b.x - a.x, ey = b.y - a.y
      const len = Math.sqrt(ex * ex + ey * ey)
      if (len < 1) continue
      // Project point onto edge
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

function toWorldCoords(mx: number, my: number): { x: number; y: number } {
  return { x: (mx - panX) / scale.value, y: (my - panY) / scale.value }
}

function onMouseDown(e: MouseEvent) {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left, my = e.clientY - rect.top

  if (mode.value === 'draw') {
    const wp = toWorldCoords(mx, my)

    if (eraseMode.value === 'offset') {
      for (let i = 0; i < eraseBorderVertices.value.length; i++) {
        const p = eraseBorderVertices.value[i]
        const dx = wp.x - p.x, dy = wp.y - p.y
        if (dx * dx + dy * dy < 64) {
          eraseDraggingIdx = i
          dragging = true
          scheduleDraw()
          return
        }
      }
      return
    }

    if (eraseMode.value === 'redraw') {
      if (!isDrawing) {
        isDrawing = true
        eraseRedrawPath.value = [wp]
      } else {
        eraseRedrawPath.value.push(wp)
      }
      dragging = isDrawing
      scheduleDraw()
      return
    }

    if (!isDrawing) {
      isDrawing = true
      drawingPath = [wp]
      if (borderlineActive.value) {
        const regions = getRegions()
        for (const r of regions) {
          const pts = getTerritory(r)
          if (pointInPolygon(wp, pts)) {
            borderlineMode.value = 'split'
            break
          }
        }
        if (!borderlineMode.value) {
          for (const r of regions) {
            const pts = getTerritory(r)
            if (lineIntersectsPolygonEdges([wp, wp], pts)) {
              borderlineMode.value = 'augment'
              break
            }
          }
        }
        if (!borderlineMode.value) {
          borderlineMode.value = 'augment'
        }
      }
    } else {
      drawingPath.push(wp)
    }
    dragging = isDrawing
    scheduleDraw()
    return
  }

  const hit = hitTest(mx, my)
  if (mode.value === 'edit' && adjoinSelectMode.value) {
    if (hit && hit.region.id !== adjoinSourceRegion.value?.id) {
      const newSet = new Set(adjoinSelectedIds.value)
      if (newSet.has(hit.region.id)) newSet.delete(hit.region.id)
      else newSet.add(hit.region.id)
      adjoinSelectedIds.value = newSet
      scheduleDraw()
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
      // Click on edge - add vertex
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

  if (mode.value === 'draw' && eraseMode.value === 'offset' && eraseDraggingIdx >= 0 && dragging) {
    const wp = toWorldCoords(mx, my)
    if (!eraseBorderFixedIndices.value.includes(eraseDraggingIdx)) {
      eraseBorderVertices.value[eraseDraggingIdx] = { x: Math.round(wp.x), y: Math.round(wp.y) }
    }
    scheduleDraw()
    return
  }

  if (mode.value === 'draw' && eraseMode.value === 'redraw' && isDrawing && dragging) {
    const wp = toWorldCoords(mx, my)
    const last = eraseRedrawPath.value[eraseRedrawPath.value.length - 1]
    if (Math.abs(wp.x - last.x) > 2 || Math.abs(wp.y - last.y) > 2) {
      eraseRedrawPath.value.push(wp)
    }
    scheduleDraw()
    return
  }

  if (mode.value === 'draw' && isDrawing && dragging) {
    const wp = toWorldCoords(mx, my)
    // Add point if it's far enough from the last one (avoid too many points)
    const last = drawingPath[drawingPath.length - 1]
    if (Math.abs(wp.x - last.x) > 2 || Math.abs(wp.y - last.y) > 2) {
      drawingPath.push(wp)
    }
    scheduleDraw()
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
      // Use getTerritory() so auto-generated hex vertices are draggable too
      const currentPts = getTerritory(ent)
      const territory = currentPts.map((p: { x: number; y: number }, i: number) =>
        i === draggingVertex ? { x: Math.round(worldX), y: Math.round(worldY) } : { x: p.x, y: p.y }
      )
      entityStore.update(dragRegionId, { properties: { ...(ent.properties || {}), territory } })
    }
  } else if (dragNode) {
    const dx = mx - dragNodeStartX, dy = my - dragNodeStartY
    const wdx = dx / scale.value, wdy = dy / scale.value
    const ent = entityStore.entityMap.get(dragNode)
    if (ent) {
      // Also shift territory points if custom territory exists
      const props = ent.properties || {}
      const shifted = Array.isArray(props.territory) ? (props.territory as { x: number; y: number }[]).map((p) => ({
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
  if (mode.value === 'draw' && eraseMode.value === 'offset') {
    eraseDraggingIdx = -1
    dragging = false
    scheduleDraw()
    return
  }

  if (mode.value === 'draw' && eraseMode.value === 'redraw' && isDrawing) {
    isDrawing = false
    dragging = false
    finishRedraw()
    scheduleDraw()
    return
  }

  if (mode.value === 'draw' && isDrawing) {
    isDrawing = false
    dragging = false
    if (borderlineActive.value || borderlineMode.value) {
      finishBorderline()
    } else {
      finishDrawing()
    }
    scheduleDraw()
    return
  }
  dragging = false; dragNode = null; dragRegionId = null; draggingVertex = -1
  scheduleDraw()
}

async function finishDrawing() {
  if (drawingPath.length < 5) {
    drawingPath = []
    return
  }

  const smooth = await bridgeChaikinSmooth(drawingPath, 2)
  const simplified = await bridgeSimplifyPoints(smooth, 3)

  if (simplified.length < 3) {
    drawingPath = []
    return
  }

  const name = await dialog.prompt('输入区域名称:', '新建区域', '')
  if (!name) { drawingPath = []; scheduleDraw(); return }

  const checkedName = await checkAndConfirmName(name, undefined, 'region')
  if (!checkedName) { drawingPath = []; scheduleDraw(); return }

  let cx = 0, cy = 0
  for (const p of simplified) { cx += p.x; cy += p.y }
  cx = Math.round(cx / simplified.length)
  cy = Math.round(cy / simplified.length)

  const now = new Date().toISOString()
  entityStore.add({
    id: 'region-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    type: 'region',
    name: checkedName,
    description: '',
    tags: [],
    properties: {
      regionType: '区域',
      mapX: cx,
      mapY: cy,
      territory: simplified,
    },
    createdAt: now,
    updatedAt: now,
  })

  drawingPath = []
  scheduleDraw()
}

async function finishBorderline() {
  if (drawingPath.length < 2) { drawingPath = []; borderlineMode.value = null; return }

  const smooth = await bridgeChaikinSmooth(drawingPath, 1)
  const simplified = await bridgeSimplifyPoints(smooth, 3)
  if (simplified.length < 2) { drawingPath = []; borderlineMode.value = null; return }

  const regions = getRegions()
  let targetRegion = null
  let isSplit = false

  const startPoint = simplified[0]
  for (const r of regions) {
    const pts = getTerritory(r)
    if (await bridgePointInPolygon(startPoint, pts)) {
      targetRegion = r
      isSplit = true
      break
    }
  }

  if (!targetRegion) {
    for (const r of regions) {
      const pts = getTerritory(r)
      if (lineIntersectsPolygonEdges(simplified, pts)) {
        targetRegion = r
        isSplit = false
        break
      }
    }
  }

  if (!targetRegion) {
    drawingPath = []
    borderlineMode.value = null
    scheduleDraw()
    return
  }

  if (isSplit) {
    await performSplit(targetRegion, simplified)
  } else {
    await performAugment(targetRegion, simplified)
  }

  drawingPath = []
  borderlineMode.value = null
  scheduleDraw()
}

async function performSplit(originalRegion: any, cuttingLine: { x: number; y: number }[]) {
  const polygon = getTerritory(originalRegion)

  const subPolygons = await bridgePolygonSplit(polygon, cuttingLine)
  if (subPolygons.length < 2) {
    toastWarn('分割失败，请确保边境线贯穿整个区域')
    return
  }

  const now = new Date().toISOString()
  const originalProps = originalRegion.properties || {}

  beginTransaction()

  for (let i = 0; i < subPolygons.length; i++) {
    const subPts = subPolygons[i]
    let cx = 0, cy = 0
    for (const p of subPts) { cx += p.x; cy += p.y }
    cx = Math.round(cx / subPts.length)
    cy = Math.round(cy / subPts.length)

    const baseName = i === 0 ? `${originalRegion.name}（东）` : `${originalRegion.name}（西）`
    const checkedName = await checkAndConfirmName(baseName, originalRegion.id, 'region')
    if (!checkedName) continue

    entityStore.add({
      id: 'region-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: 'region',
      name: checkedName,
      description: originalRegion.description || '',
      tags: [...(originalRegion.tags || []), '待更改范围'],
      properties: {
        ...originalProps,
        mapX: cx,
        mapY: cy,
        territory: subPts,
      },
      createdAt: now,
      updatedAt: now,
    })
  }

  await entityStore.remove(originalRegion.id)

  commitTransaction()
}

async function performAugment(originalRegion: any, addingLine: { x: number; y: number }[]) {
  const polygon = getTerritory(originalRegion)

  const augmentedPolygon = await bridgePolygonAugment(polygon, addingLine)
  if (augmentedPolygon.length < 3) {
    toastWarn('增补区域无效')
    return
  }

  let cx = 0, cy = 0
  for (const p of augmentedPolygon) { cx += p.x; cy += p.y }
  cx = Math.round(cx / augmentedPolygon.length)
  cy = Math.round(cy / augmentedPolygon.length)

  const name = await dialog.prompt('输入增补区域名称:', '新建增补区域', '')
  if (!name) return
  const checkedName = await checkAndConfirmName(name, undefined, 'region')
  if (!checkedName) return

  const now = new Date().toISOString()
  const originalProps = originalRegion.properties || {}

  beginTransaction()

  const newId = 'region-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
  entityStore.add({
    id: newId,
    type: 'region',
    name: checkedName,
    description: '',
    tags: ['待更改范围'],
    properties: {
      ...originalProps,
      regionType: '区域',
      mapX: cx,
      mapY: cy,
      territory: augmentedPolygon,
    },
    createdAt: now,
    updatedAt: now,
  })

  relationStore.add({
    id: 'rel-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    type: 'borders',
    sourceId: originalRegion.id,
    targetId: newId,
    label: '',
    properties: {},
    createdAt: now,
    updatedAt: now,
  })

  commitTransaction()
}

function onWheel(e: WheelEvent) {
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  scale.value = Math.min(5, Math.max(0.1, scale.value * delta))
  scheduleDraw()
}

function onDblClick(e: MouseEvent) {
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

function scheduleDraw() {
  cancelAnimationFrame(animFrame)
  animFrame = requestAnimationFrame(draw)
}

watch(() => props.regions, scheduleDraw, { deep: true })
watch(() => relationStore.relations.length, scheduleDraw)

function onBorderlineKeyDown(e: KeyboardEvent) {
  if (mode.value !== 'draw') return
  const keys = settingsStore.getShortcut('region.borderline')
  if (keys.includes('alt') && e.altKey) {
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

function onEraseKeyDown(e: KeyboardEvent) {
  if (eraseMode.value === 'offset') {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmOffset()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      eraseMode.value = null
      eraseBorderVertices.value = []
      scheduleDraw()
    }
  } else if (eraseMode.value === 'redraw') {
    if (e.key === 'Escape') {
      e.preventDefault()
      eraseMode.value = null
      eraseRedrawPath.value = []
      isDrawing = false
      scheduleDraw()
    }
  }
}

onMounted(() => {
  registerShortcut({
    id: 'region.borderline',
    keys: settingsStore.getShortcut('region.borderline'),
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
  document.addEventListener('keydown', onEraseKeyDown)
  fitAll()
  scheduleDraw()
})
onBeforeUnmount(() => {
  unregisterShortcut('region.borderline')
  document.removeEventListener('keydown', onBorderlineKeyDown)
  document.removeEventListener('keyup', onBorderlineKeyUp)
  document.removeEventListener('keydown', onEraseKeyDown)
  cancelAnimationFrame(animFrame)
})
</script>

<style scoped>
.region-map { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; }
.rm-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border-strong); flex-shrink: 0; flex-wrap: wrap; }
.rm-btn { padding: 4px 10px; border: 1px solid var(--color-border-strong); border-radius: 4px; background: var(--color-bg-elevated); cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-primary); }
.rm-btn:hover { background: #e8d8a8; }
.rm-btn.on { background: #c4a95a; color: #fff; }
.rm-sep { color: var(--color-border-strong); font-size: var(--font-size-base); margin: 0 2px; }
.rm-zoom { font-size: var(--font-size-xs); color: var(--color-text-secondary); width: 40px; text-align: center; }
.rm-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); display: flex; align-items: center; gap: 3px; cursor: pointer; }
.rm-mode-hint { font-size: var(--font-size-xs); color: #8b4513; margin-left: 4px; font-weight: var(--font-weight-semibold); }
.rm-legend-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-left: auto; display: flex; gap: 4px; }
.rm-legend-hint span { font-weight: bold; }
.rm-draw-hint { font-size: var(--font-size-xs); color: #e74c3c; margin-left: auto; font-style: italic; }
.rm-canvas { flex: 1; cursor: grab; }
.rm-tooltip { position: fixed; z-index: var(--z-overlay); background: var(--color-bg-surface); border: 1px solid var(--color-border-strong); border-radius: 4px; padding: 4px 8px; font-size: var(--font-size-sm); color: var(--color-text-primary); pointer-events: none; }
.rm-context-menu { position: fixed; z-index: calc(var(--z-overlay) + 1); background: var(--color-bg-surface); border: 1px solid var(--color-border-strong); border-radius: 8px; padding: 6px 0; min-width: 130px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); }
.rm-ctx-item { padding: 6px 14px; font-size: var(--font-size-sm); color: var(--color-text-primary); cursor: pointer; animation: ws-staircase 0.15s ease-out forwards; opacity: 0; }
.rm-ctx-item:nth-child(1) { animation-delay: 0ms; }
.rm-ctx-item:nth-child(2) { animation-delay: 25ms; }
.rm-ctx-item:nth-child(3) { animation-delay: 50ms; }
.rm-ctx-item:nth-child(4) { animation-delay: 75ms; }
.rm-ctx-item:nth-child(5) { animation-delay: 100ms; }
.rm-ctx-item:nth-child(6) { animation-delay: 125ms; }
.rm-ctx-item:nth-child(7) { animation-delay: 150ms; }

.rm-ctx-item:hover { background: #efe3c3; }
.rm-ctx-divider { height: 1px; background: #c4a95a; margin: 4px 8px; }
.rm-ctx-label { padding: 4px 14px 2px; font-size: var(--font-size-xs); color: #9a8050; }
.rm-ctx-colors { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 10px 8px; }
.rm-ctx-color-btn { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.rm-ctx-color-btn:hover { border-color: var(--color-text-primary); }
</style>
