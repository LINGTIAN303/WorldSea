<template>
  <Teleport to="body">
    <div class="me-overlay" @click.self="$emit('close')">
      <div class="me-dialog" role="dialog" aria-modal="true" aria-label="形象图编辑器">
        <header class="me-bar">
          <span class="me-title">形象图编辑器 · {{ entity.name }}</span>
          <div class="me-modes">
            <button :class="{ on: mode === 'region' }" @click="mode = 'region'">区域编辑</button>
            <button :class="{ on: mode === 'focus' }" @click="mode = 'focus'">焦点编辑</button>
          </div>
          <div class="me-history">
            <button class="me-undo" :disabled="undoStack.length <= 1 && !pendingSnapshot" aria-label="撤销" title="撤销 (Ctrl+Z)" @click="undo">↺</button>
            <button class="me-redo" :disabled="!redoStack.length" aria-label="重做" title="重做 (Ctrl+Y)" @click="redo">↷</button>
          </div>
          <button v-if="dirty" class="me-save" @click="save">保存改动</button>
          <button class="me-close" aria-label="关闭编辑器" @click="$emit('close')">×</button>
        </header>

        <div class="me-body">
          <!-- 画布：区域拖拽切分 / 焦点点选 -->
          <div
            ref="canvasEl"
            class="me-canvas"
            :class="{ 'me-canvas--focus': mode === 'focus', 'me-canvas--drawing': drawing }"
            @pointerdown="onCanvasPointerDown"
            @pointermove="onCanvasPointerMove"
            @pointerup="onCanvasPointerUp"
            @wheel.prevent="onCanvasWheel"
          >
            <img ref="baseImg" :src="entity.portrait!" class="me-base" @load="onBaseLoad" alt="编辑底图" />
            <!-- 焦点十字（focus 模式） -->
            <div v-if="mode === 'focus' && focusPoint" class="me-focus-cross" :style="focusCrossStyle"></div>
            <!-- 区域矩形（region 模式）：显示位置=图面区域经显示区换算到盒 -->
            <div
              v-for="r in draft.regions"
              :key="r.id"
              class="me-region"
              :class="{ selected: r.id === selectedRegionId, drawing: r.id === drawingRegionId }"
              :style="regionStyle(r)"
              @pointerdown.stop="onRegionPointerDown($event, r)"
            >
              <span v-if="r.id !== drawingRegionId" class="me-region-tag">{{ draft.tracks.filter(t => t.regionId === r.id).length }}轨</span>
              <template v-if="r.id === selectedRegionId && r.id !== drawingRegionId">
                <span class="me-handle" data-h="nw"></span>
                <span class="me-handle" data-h="ne"></span>
                <span class="me-handle" data-h="sw"></span>
                <span class="me-handle" data-h="se"></span>
                <button class="me-region-del" aria-label="删除区域" @pointerdown.stop @click.stop="removeRegion(r.id)">×</button>
              </template>
            </div>
          </div>

          <!-- 右侧：属性与轨迹（拆至 MotionEditorSide 控规模） -->
          <MotionEditorSide
            :src="entity.portrait!"
            :mode="mode"
            :draft="draft"
            :draft-focus="draftFocus"
            v-model:selected-id="selectedRegionId"
            @change="dirty = true"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 形象图画布编辑器（2026-10-25 形象图批 D4，需求 #9/#20）：区域拖拽切分（空白拖=新建、
 * 拖动=移动、四角=缩放、Delete=删）+ 焦点编辑（点选+滚轮，作封面取景）+ 轨迹精简表单
 * （含「追踪鼠标」触发=#20 内容追踪）+ MotionStage 实时预览。草稿制：内部 draft，
 * 「保存改动」一次性写 portraitMeta（对齐 DetailTabsCard 的 commit 模式，避免拖动
 * 中高频写库刷 undo）。坐标口径=图面显示区（motionMath 换算，与渲染层像素对齐）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Entity, MotionRegion } from '@worldsea/entity-core'
import { computeDisplayBox, boxPointToRegion, type DisplayBox } from '@worldsea/entity-core/core'
import MotionEditorSide from './MotionEditorSide.vue'
import { useMotionDraft } from '../composables/useMotionDraft'
import { useMotionHistoryKeys } from '../composables/useMotionHistoryKeys'

const props = defineProps<{ entity: Entity }>()
const emit = defineEmits<{ close: [] }>()

const uid = () => Math.random().toString(36).slice(2, 8)
const {
  draft, draftFocus, dirty, selectedRegionId, save,
  undoStack, redoStack, pendingSnapshot, undo, redo, cancelPendingSnapshot,
} = useMotionDraft(props.entity)

// ── 画布几何：显示区换算（与 MotionStage 同口径） ──
const canvasEl = ref<HTMLElement | null>(null)
const baseImg = ref<HTMLImageElement | null>(null)
const displayBox = ref<DisplayBox>({ oX: 0, oY: 0, dW: 100, dH: 100 })

function onBaseLoad() {
  const img = baseImg.value
  recalcBox(img?.naturalWidth ?? 0, img?.naturalHeight ?? 0)
}
function recalcBox(nw: number, nh: number) {
  displayBox.value = computeDisplayBox(nw, nh, canvasEl.value?.clientWidth ?? 0, canvasEl.value?.clientHeight ?? 0)
}

/** 图面区域 → 画布盒内样式（left/top/w/h 盒百分比） */
function regionStyle(r: MotionRegion) {
  const b = displayBox.value
  return {
    left: `${b.oX + r.x * b.dW / 100}%`,
    top: `${b.oY + r.y * b.dH / 100}%`,
    width: `${r.w * b.dW / 100}%`,
    height: `${r.h * b.dH / 100}%`,
  }
}

/** 盒内像素点 → 图面百分比 */
function toRegionPoint(e: PointerEvent): { x: number; y: number } {
  const rect = canvasEl.value!.getBoundingClientRect()
  const px = ((e.clientX - rect.left) / rect.width) * 100
  const py = ((e.clientY - rect.top) / rect.height) * 100
  return boxPointToRegion(px, py, displayBox.value)
}

// ── 区域编辑交互 ──
const mode = ref<'region' | 'focus'>('region')
type DragState =
  | { kind: 'draw'; startX: number; startY: number }
  | { kind: 'move'; region: MotionRegion; grabX: number; grabY: number }
  | { kind: 'resize'; region: MotionRegion; corner: 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; orig: MotionRegion }
  | null
let drag: DragState = null
const drawing = ref(false)
const drawingRegionId = ref<string | null>(null)

function onCanvasPointerDown(e: PointerEvent) {
  if (mode.value !== 'region') {
    // 焦点模式：点击设焦点
    const p = toRegionPoint(e)
    draftFocus.position = `${Math.round(p.x)}% ${Math.round(p.y)}%`
    dirty.value = true
    return
  }
  const p = toRegionPoint(e)
  drag = { kind: 'draw', startX: p.x, startY: p.y }
  drawing.value = true
  const id = uid()
  drawingRegionId.value = id
  draft.regions.push({ id, x: p.x, y: p.y, w: 0.5, h: 0.5 })
  selectedRegionId.value = id
  canvasEl.value?.setPointerCapture(e.pointerId)
}

function onRegionPointerDown(e: PointerEvent, r: MotionRegion) {
  if (mode.value !== 'region') return
  e.preventDefault()
  selectedRegionId.value = r.id
  const handle = (e.target as HTMLElement).dataset.h as 'nw' | 'ne' | 'sw' | 'se' | undefined
  const p = toRegionPoint(e)
  drag = handle
    ? { kind: 'resize', region: r, corner: handle, startX: p.x, startY: p.y, orig: { ...r } }
    : { kind: 'move', region: r, grabX: p.x - r.x, grabY: p.y - r.y }
  canvasEl.value?.setPointerCapture(e.pointerId)
}

function onCanvasPointerMove(e: PointerEvent) {
  if (!drag) return
  const p = toRegionPoint(e)
  if (drag.kind === 'draw') {
    const r = draft.regions.find(x => x.id === drawingRegionId.value)
    if (!r) return
    r.x = Math.min(drag.startX, p.x); r.y = Math.min(drag.startY, p.y)
    r.w = Math.max(1, Math.abs(p.x - drag.startX)); r.h = Math.max(1, Math.abs(p.y - drag.startY))
  } else if (drag.kind === 'move') {
    drag.region.x = Math.max(0, Math.min(100 - drag.region.w, p.x - drag.grabX))
    drag.region.y = Math.max(0, Math.min(100 - drag.region.h, p.y - drag.grabY))
  } else if (drag.kind === 'resize') {
    const { region: r, corner, orig, startX, startY } = drag
    const dx = p.x - startX, dy = p.y - startY
    if (corner === 'se' || corner === 'ne') r.w = Math.max(1, Math.min(100 - orig.x, orig.w + dx))
    if (corner === 'sw' || corner === 'nw') { const nx = Math.max(0, orig.x + dx); r.x = nx; r.w = Math.max(1, orig.x + orig.w - nx) }
    if (corner === 'se' || corner === 'sw') r.h = Math.max(1, Math.min(100 - orig.y, orig.h + dy))
    if (corner === 'ne' || corner === 'nw') { const ny = Math.max(0, orig.y + dy); r.y = ny; r.h = Math.max(1, orig.y + orig.h - ny) }
  }
  dirty.value = true
}

function onCanvasPointerUp() {
  // 空拖（<2%）=误触，丢弃
  if (drag?.kind === 'draw') {
    const r = draft.regions.find(x => x.id === drawingRegionId.value)
    if (r && (r.w < 2 || r.h < 2)) removeRegion(r.id)
  }
  drag = null
  drawing.value = false
  drawingRegionId.value = null
}

function onCanvasWheel(e: WheelEvent) {
  if (mode.value !== 'focus') return
  draftFocus.zoom = Math.round(Math.max(1, Math.min(3, (draftFocus.zoom ?? 1) + (e.deltaY < 0 ? 0.1 : -0.1))) * 10) / 10
  dirty.value = true
}

function removeRegion(id: string) {
  draft.regions = draft.regions.filter(r => r.id !== id)
  draft.tracks = draft.tracks.filter(t => t.regionId !== id)
  if (selectedRegionId.value === id) selectedRegionId.value = draft.regions[0]?.id ?? null
  dirty.value = true
}

const focusPoint = computed(() => {
  const m = /([\d.]+)%\s+([\d.]+)%/.exec(draftFocus.position ?? '')
  return m ? { x: +m[1], y: +m[2] } : null
})
const focusCrossStyle = computed(() => {
  const p = focusPoint.value
  if (!p) return {}
  const b = displayBox.value
  return { left: `${b.oX + p.x * b.dW / 100}%`, top: `${b.oY + p.y * b.dH / 100}%` }
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Delete' && mode.value === 'region' && selectedRegionId.value) removeRegion(selectedRegionId.value)
  if (e.key === 'Escape') {
    // 有未保存改动先保存再关（防误丢）
    if (dirty.value) save()
    emit('close')
  }
}

useMotionHistoryKeys(undo, redo)
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  cancelPendingSnapshot()
  window.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.me-overlay {
  position: fixed;
  inset: 0;
  z-index: 2300;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.me-dialog {
  width: min(1180px, 96vw);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface, #fff);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
}
.me-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-color);
}
.me-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); }
.me-modes { display: flex; gap: 4px; }
.me-modes button {
  padding: 3px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.me-modes button.on { border-color: var(--primary); color: var(--primary); }
.me-history { display: flex; gap: 2px; }
.me-history button {
  width: 24px; height: 22px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: none; color: var(--text-secondary); font-size: 13px; line-height: 1; cursor: pointer;
}
.me-history button:disabled { opacity: 0.35; cursor: default; }
.me-save {
  margin-left: auto;
  padding: 3px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--primary);
  color: #fff;
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.me-close {
  border: none;
  background: none;
  font-size: 16px;
  color: var(--text-tertiary);
  cursor: pointer;
}
.me-body { display: flex; min-height: 0; flex: 1; }
.me-canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  height: clamp(560px, 74vh, 860px);
  background: var(--bg-secondary, #f3f4f6);
  touch-action: none;
  user-select: none;
  cursor: crosshair;
}
.me-canvas--focus { cursor: cell; }
.me-canvas--drawing { cursor: crosshair; }
.me-base { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.me-region {
  position: absolute;
  border: 1.5px solid var(--primary);
  border-radius: 2px;
  cursor: move;
  background: rgba(79, 70, 229, 0.06);
}
.me-region.selected { border-width: 2px; box-shadow: 0 0 0 1px var(--primary); }
.me-region.drawing { border-style: dashed; }
.me-region-tag {
  position: absolute;
  top: -8px;
  left: 2px;
  padding: 0 4px;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  font-size: 10px;
  line-height: 14px;
  pointer-events: none;
  white-space: nowrap;
}
.me-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1.5px solid #fff;
  border-radius: 50%;
  background: var(--primary);
}
.me-handle[data-h='nw'] { left: -5px; top: -5px; cursor: nwse-resize; }
.me-handle[data-h='ne'] { right: -5px; top: -5px; cursor: nesw-resize; }
.me-handle[data-h='sw'] { left: -5px; bottom: -5px; cursor: nesw-resize; }
.me-handle[data-h='se'] { right: -5px; bottom: -5px; cursor: nwse-resize; }
.me-region-del {
  position: absolute;
  top: -9px;
  right: -9px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.me-focus-cross {
  position: absolute;
  width: 22px;
  height: 22px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.me-focus-cross::before,
.me-focus-cross::after {
  content: '';
  position: absolute;
  background: var(--primary);
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.4);
}
.me-focus-cross::before { left: 0; right: 0; top: 10px; height: 2px; }
.me-focus-cross::after { top: 0; bottom: 0; left: 10px; width: 2px; }

</style>
