<template>
  <!--
    白板画布（BoardCanvas）—— DOM 绝对定位 + transform 缩放
    规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §一 / §三 / §五
    · 渲染技术选型为 DOM（表格式要复用 DataTable、就地编辑需要真实输入控件）
    · 本组件只做「几何 + 事件」，一切数据变更通过 emit 上行到 BoardView
  -->
  <div
    ref="rootEl"
    class="bcv"
    :class="{ 'bcv--panning': panning }"
    :style="gridStyle"
    @pointerdown="onBackgroundPointerDown"
    @dblclick="onBackgroundDblClick"
    @contextmenu.prevent
    @wheel="onWheel"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <div class="bcv-world" :style="worldStyle">
      <!-- 对齐辅助线（世界坐标，随 world 层一起变换） -->
      <div
        v-for="(gx, i) in snapGuides.verticalGuides.value"
        :key="`v${i}`"
        class="bcv-guide bcv-guide--v"
        :style="{ left: `${gx}px` }"
      />
      <div
        v-for="(gy, i) in snapGuides.horizontalGuides.value"
        :key="`h${i}`"
        class="bcv-guide bcv-guide--h"
        :style="{ top: `${gy}px` }"
      />

      <BoardContainerView
        v-for="c in layout.containers"
        :key="c.id"
        :container="c"
        :node="nodesById.get(c.nodeId)"
        :selected="selectedId === c.id"
        @select="$emit('select', c.id)"
        @drag-start="onContainerDragStart(c, $event)"
        @toggle-collapse="$emit('toggleCollapse', c.id)"
        @remove="$emit('removeContainer', c.id)"
        @add-component="(form: string) => $emit('addComponent', c.id, form)"
      />
    </div>

    <!-- 空态：空白板引导 -->
    <div v-if="!layout.containers.length" class="bcv-empty" @pointerdown.stop @dblclick.stop="onBackgroundDblClick">
      <div class="bcv-empty-title">空白白板</div>
      <div class="bcv-empty-desc">从右侧拖节点进来，或双击空白新建节点</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 画布：视口（缩放/平移）、容器拖动（含吸附）、空白双击新建、右栏拖放落点。
 * 几何计算全部来自 boardGeometry / useBoardSnap 的纯函数，组件内不出现坐标公式。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import BoardContainerView from './BoardContainerView.vue'
import { useBoardSnap, type SnapMode } from '../composables/useBoardSnap'
import {
  clampZoom,
  screenToWorld,
  zoomAt,
  zoomStepFromWheel,
  type Point,
  type Rect,
  type Viewport,
} from '../boardGeometry'
import { readNodeIdFromDnD } from '../dnd'
import type { BoardContainer, OutlineBoardLayout } from '../layoutSchema'

/** 容器未设尺寸时的估算矩形（仅用于吸附与包围盒） */
const FALLBACK_SIZE = { w: 200, h: 80 }
/** 背景拖拽与单击的位移阈值（像素） */
const DRAG_THRESHOLD = 3

const props = defineProps<{
  layout: OutlineBoardLayout
  viewport: Viewport
  nodesById: Map<string, Entity>
  selectedId: string | null
  snapMode: SnapMode
}>()

const emit = defineEmits<{
  (e: 'select', containerId: string | null): void
  (e: 'moveContainer', containerId: string, pos: Point): void
  (e: 'toggleCollapse', containerId: string): void
  (e: 'removeContainer', containerId: string): void
  (e: 'addComponent', containerId: string, form: string): void
  (e: 'createNodeAt', pos: Point): void
  (e: 'dropNode', nodeId: string, pos: Point): void
  (e: 'viewportChange', vp: Viewport): void
  (e: 'interactionStart'): void
}>()

const rootEl = ref<HTMLElement | null>(null)
const panning = ref(false)

const snapGuides = useBoardSnap({
  getMode: () => props.snapMode,
  getZoom: () => props.viewport.zoom,
})

const worldStyle = computed(() => ({
  transform: `translate(${props.viewport.panX}px, ${props.viewport.panY}px) scale(${props.viewport.zoom})`,
}))

/** 点阵网格随视口一起平移缩放（关闭时隐藏） */
const gridStyle = computed(() => {
  if (props.snapMode === 'off') return {}
  const step = 20 * props.viewport.zoom
  return {
    backgroundImage: 'radial-gradient(circle, var(--border-light) 1px, transparent 1px)',
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${props.viewport.panX}px ${props.viewport.panY}px`,
  }
})

/** 画布内相对坐标 */
function localPoint(ev: { clientX: number; clientY: number }): Point {
  const rect = rootEl.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
}

function toWorld(p: Point): Point {
  return screenToWorld(p, props.viewport)
}

/** 其他容器的估算矩形（用于吸附；排除自身） */
function otherRects(excludeId?: string): Rect[] {
  return props.layout.containers
    .filter(c => c.id !== excludeId)
    .map(c => ({
      x: c.pos.x,
      y: c.pos.y,
      w: c.size?.w ?? FALLBACK_SIZE.w,
      h: c.size?.h ?? FALLBACK_SIZE.h,
    }))
}

// ── 视口：滚轮缩放（需 passive:false 才能 preventDefault）──
function onWheel(ev: WheelEvent): void {
  ev.preventDefault()
  const anchor = localPoint(ev)
  const next = zoomStepFromWheel(props.viewport.zoom, ev.deltaY)
  emit('viewportChange', zoomAt(props.viewport, next, anchor))
}

// ── 背景：拖拽平移 / 单击取消选中 / 双击新建 ──
let bgStart: { local: Point; vp: Viewport } | null = null
let bgMoved = false

function onBackgroundPointerDown(ev: PointerEvent): void {
  // 只处理空白处（容器自身会 stopPropagation）
  if (ev.button !== 0 && ev.button !== 1) return
  bgStart = { local: localPoint(ev), vp: { ...props.viewport } }
  bgMoved = false
  panning.value = true
  window.addEventListener('pointermove', onBackgroundPointerMove)
  window.addEventListener('pointerup', onBackgroundPointerUp)
}

function onBackgroundPointerMove(ev: PointerEvent): void {
  if (!bgStart) return
  const dx = ev.clientX - (rootEl.value?.getBoundingClientRect().left ?? 0) - bgStart.local.x
  const dy = ev.clientY - (rootEl.value?.getBoundingClientRect().top ?? 0) - bgStart.local.y
  if (!bgMoved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) bgMoved = true
  if (!bgMoved) return
  emit('viewportChange', { ...bgStart.vp, panX: bgStart.vp.panX + dx, panY: bgStart.vp.panY + dy })
}

function onBackgroundPointerUp(): void {
  window.removeEventListener('pointermove', onBackgroundPointerMove)
  window.removeEventListener('pointerup', onBackgroundPointerUp)
  panning.value = false
  if (bgStart && !bgMoved) emit('select', null) // 纯点击 → 取消选中
  bgStart = null
}

function onBackgroundDblClick(ev: MouseEvent): void {
  emit('createNodeAt', toWorld(localPoint(ev)))
}

// ── 容器拖动（指针事件 + 吸附）──
interface DragState {
  id: string
  startWorld: Point
  startPos: Point
  size: { w: number; h: number }
}
let drag: DragState | null = null

function onContainerDragStart(container: BoardContainer, ev: PointerEvent): void {
  if (ev.button !== 0) return
  emit('interactionStart') // 撤销快照：一次拖动只记一次
  drag = {
    id: container.id,
    startWorld: toWorld(localPoint(ev)),
    startPos: { ...container.pos },
    size: { w: container.size?.w ?? FALLBACK_SIZE.w, h: container.size?.h ?? FALLBACK_SIZE.h },
  }
  window.addEventListener('pointermove', onContainerPointerMove)
  window.addEventListener('pointerup', onContainerPointerUp)
}

function onContainerPointerMove(ev: PointerEvent): void {
  if (!drag) return
  const world = toWorld(localPoint(ev))
  const raw: Point = {
    x: drag.startPos.x + (world.x - drag.startWorld.x),
    y: drag.startPos.y + (world.y - drag.startWorld.y),
  }
  const moving: Rect = { x: raw.x, y: raw.y, w: drag.size.w, h: drag.size.h }
  const snapped = snapGuides.resolve(moving, otherRects(drag.id), raw)
  emit('moveContainer', drag.id, { x: Math.round(snapped.x), y: Math.round(snapped.y) })
}

function onContainerPointerUp(): void {
  window.removeEventListener('pointermove', onContainerPointerMove)
  window.removeEventListener('pointerup', onContainerPointerUp)
  drag = null
  snapGuides.clearGuides()
}

// ── 右栏拖放落点 ──
function onDrop(ev: DragEvent): void {
  const nodeId = readNodeIdFromDnD(ev)
  if (!nodeId) return
  emit('dropNode', nodeId, toWorld(localPoint(ev)))
}

/** 供父级调用的视口能力（缩放按钮 / 定位已有容器 / 适配全部） */
defineExpose({
  zoomStep(deltaY: number): void {
    const local = {
      x: (rootEl.value?.clientWidth ?? 0) / 2,
      y: (rootEl.value?.clientHeight ?? 0) / 2,
    }
    const next = zoomStepFromWheel(props.viewport.zoom, deltaY)
    emit('viewportChange', zoomAt(props.viewport, next, local))
  },
  zoomTo(zoom: number): void {
    const local = {
      x: (rootEl.value?.clientWidth ?? 0) / 2,
      y: (rootEl.value?.clientHeight ?? 0) / 2,
    }
    emit('viewportChange', zoomAt(props.viewport, clampZoom(zoom), local))
  },
  size(): { w: number; h: number } {
    return { w: rootEl.value?.clientWidth ?? 0, h: rootEl.value?.clientHeight ?? 0 }
  },
  /** 把某个世界矩形带到视口中心（「已在板上」节点定位时用） */
  centerOn(rect: Rect): void {
    const w = rootEl.value?.clientWidth ?? 0
    const h = rootEl.value?.clientHeight ?? 0
    const zoom = props.viewport.zoom
    emit('viewportChange', {
      zoom,
      panX: w / 2 - (rect.x + rect.w / 2) * zoom,
      panY: h / 2 - (rect.y + rect.h / 2) * zoom,
    })
  },
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onBackgroundPointerMove)
  window.removeEventListener('pointerup', onBackgroundPointerUp)
  window.removeEventListener('pointermove', onContainerPointerMove)
  window.removeEventListener('pointerup', onContainerPointerUp)
})
</script>

<style scoped>
.bcv {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: var(--bg-color, var(--bg-secondary));
  cursor: default;
}
.bcv--panning { cursor: grabbing; }
.bcv-world {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}
.bcv-guide {
  position: absolute;
  background: var(--primary);
  opacity: 0.7;
  pointer-events: none;
}
.bcv-guide--v { top: -5000px; width: 1px; height: 10000px; }
.bcv-guide--h { left: -5000px; height: 1px; width: 10000px; }
.bcv-empty {
  position: absolute;
  left: 50%;
  top: 45%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: auto;
}
.bcv-empty-title { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: 4px; }
.bcv-empty-desc { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
</style>
