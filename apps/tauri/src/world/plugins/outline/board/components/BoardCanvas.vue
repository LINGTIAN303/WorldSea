<template>
  <!--
    白板画布（BoardCanvas）—— DOM 绝对定位 + transform 缩放
    规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §一 / §二 / §三 / §五
    · 渲染技术选型为 DOM（表格式要复用 DataTable、就地编辑需要真实输入控件）
    · 舞台层级：背景网格 → 区 → 容器 → 组件（DOM 顺序即层级，区在容器下层）
    · 本组件只做「几何 + 事件」，一切数据变更通过 emit 上行到 BoardView
  -->
  <div
    ref="rootEl"
    class="bcv"
    :class="{
      'bcv--panning': panning,
      'bcv--drawing': sectionDrawMode,
      'bcv--space': spaceDown,
      'bcv--node-drop': nodeDropActive,
    }"
    :style="gridStyle"
    @pointerdown="onBackgroundPointerDown"
    @dblclick="onBackgroundDblClick"
    @contextmenu="onContextMenu"
    @wheel="onWheel"
    @dragover="onNodeDragOver"
    @dragleave="onNodeDragLeave"
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

      <!-- 区（在容器下层） -->
      <BoardSectionView
        v-for="s in layout.sections"
        :key="s.id"
        :section="s"
        :container-count="sectionContainerCount(s.id)"
        :rename-signal="renameSectionSignal"
        @drag-start="onSectionDragStart(s, $event)"
        @resize-start="onSectionResizeStart(s, $event)"
        @rename="(title: string) => $emit('renameSection', s.id, title)"
        @rearrange="$emit('rearrangeSection', s.id)"
        @remove="$emit('removeSection', s.id)"
      />

      <!-- 容器 -->
      <BoardContainerView
        v-for="c in layout.containers"
        :key="c.id"
        :container="c"
        :node="nodesById.get(c.nodeId)"
        :selected="selectedId === c.id" :has-manuscript="chapterNodeIds?.has(c.nodeId) ?? false" :open-form-signal="openFormSignal"
        @select="$emit('select', c.id)"
        @drag-start="onContainerDragStart(c, $event)"
        @resize-start="onContainerResizeStart(c, $event)"
        @toggle-collapse="$emit('toggleCollapse', c.id)"
        @remove="$emit('removeContainer', c.id)"
        @remove-component="(componentId: string) => $emit('removeComponent', c.id, componentId)"
        @open-manuscript="$emit('openManuscript', c.id)"
        @add-component="(form: string) => $emit('addComponent', c.id, form)"
      />

      <!-- 画区预览（虚线矩形） -->
      <div v-if="drawPreview" class="bcv-draw-preview" :style="previewStyle" />
    </div>

    <!-- 空态：空白板引导 -->
    <div v-if="!layout.containers.length && !layout.sections.length" class="bcv-empty" @pointerdown.stop @dblclick.stop="onBackgroundDblClick">
      <div class="bcv-empty-title">空白白板</div>
      <div class="bcv-empty-desc">从右侧拖节点进来，或双击空白新建节点；也可用左下角「画区」框出一块区域</div>
    </div>

    <!-- 画区模式的提示条（模式下背景拖拽不再平移，避免误操作） -->
    <div v-if="sectionDrawMode" class="bcv-draw-hint">
      在画布上拖出矩形以创建区 · <span class="bcv-draw-key">Esc</span> 取消
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 画布：视口（缩放/平移）、容器与区的拖动/尺寸、空白双击新建、右栏拖放落点、画区模式。
 * 几何计算全部来自 boardGeometry / sectionArrange 的纯函数，组件内不出现坐标公式。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import BoardContainerView from './BoardContainerView.vue'
import BoardSectionView from './BoardSectionView.vue'
import { useBoardSnap, type SnapMode } from '../composables/useBoardSnap'
import {
  clampZoom,
  normalizeRect,
  resizeRectFromHandle,
  screenToWorld,
  zoomAt,
  zoomStepFromWheel,
  type Point,
  type Rect,
  type Viewport,
} from '../boardGeometry'
import { readDndPayload, acceptsBoardDrag } from '../dnd'
import { resolveContextTarget, type ContextTarget } from '../contextMenu'
import {
  containerAtPoint,
  DEFAULT_CONTAINER_SIZE,
  rectOfContainer,
  type BoardContainer,
  type BoardSection,
  type OutlineBoardLayout,
} from '../layoutSchema'

/** 背景拖拽与单击的位移阈值（像素） */
const DRAG_THRESHOLD = 3

const props = defineProps<{
  layout: OutlineBoardLayout
  viewport: Viewport
  nodesById: Map<string, Entity>
  selectedId: string | null
  snapMode: SnapMode
  /** 背景点阵网格显示开关（与吸附模式解耦，规格 §一） */
  gridEnabled: boolean
  chapterNodeIds?: Set<string>
  /** 画区模式：背景拖拽改为拖出矩形 */
  sectionDrawMode: boolean
  /** 右键菜单请求：区改名 / 容器展开形式菜单（透传给对应子组件，本组件不解释其内容） */
  renameSectionSignal?: { id: string; token: number } | null
  openFormSignal?: { id: string; token: number } | null
}>()

const emit = defineEmits<{
  (e: 'select', containerId: string | null): void
  (e: 'moveContainer', containerId: string, pos: Point): void
  (e: 'resizeContainer', containerId: string, size: { w: number; h: number }): void
  (e: 'containerDrop', containerId: string): void
  (e: 'toggleCollapse', containerId: string): void
  (e: 'removeContainer', containerId: string): void
  (e: 'removeComponent', containerId: string, componentId: string): void
  (e: 'openManuscript', containerId: string): void
  (e: 'addComponent', containerId: string, form: string): void
  (e: 'createNodeAt', pos: Point): void
  (e: 'dropNode', nodeId: string, pos: Point): void
  /** 章节拖入：world 落点 + 命中的容器 id（null = 落在空白） */
  (e: 'dropChapter', chapterId: string, pos: Point, containerId: string | null): void
  /** 右键落点（已解析为四级上下文之一）+ 视口坐标，由装配层决定菜单与动作 */
  (e: 'contextMenu', payload: { target: ContextTarget; x: number; y: number }): void
  (e: 'viewportChange', vp: Viewport): void
  (e: 'interactionStart'): void
  (e: 'createSection', rect: Rect): void
  (e: 'sectionDrawDone'): void
  (e: 'moveSection', sectionId: string, rect: Rect): void
  (e: 'resizeSection', sectionId: string, rect: Rect): void
  (e: 'renameSection', sectionId: string, title: string): void
  (e: 'rearrangeSection', sectionId: string): void
  (e: 'removeSection', sectionId: string): void
}>()

const rootEl = ref<HTMLElement | null>(null)
const panning = ref(false)
/**
 * 是否按住 Space（规格 §八「Space + 拖拽 = 平移」）。
 * 「按住」是持续态而非离散按键动作，故不进 useShortcuts 注册表，在本组件内自监听。
 * 输入框/按钮聚焦时不进入该状态（否则会抢走「空格输入」与「空格激活按钮」）。
 */
const spaceDown = ref(false)

/** 正拖着「大纲节点」经过画布（用于落点反馈；见 onNodeDragOver） */
const nodeDropActive = ref(false)

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || el.isContentEditable
}

function onSpaceKeyDown(ev: KeyboardEvent): void {
  if (ev.key !== ' ' || ev.repeat || isTypingTarget(ev.target)) return
  ev.preventDefault() // 空格默认会滚动侧栏列表，按住平移期间应阻断
  spaceDown.value = true
}

function onSpaceKeyUp(ev: KeyboardEvent): void {
  if (ev.key !== ' ') return
  spaceDown.value = false
}

const snapGuides = useBoardSnap({
  getMode: () => props.snapMode,
  getZoom: () => props.viewport.zoom,
})

const worldStyle = computed(() => ({
  transform: `translate(${props.viewport.panX}px, ${props.viewport.panY}px) scale(${props.viewport.zoom})`,
}))

/** 点阵网格随视口一起平移缩放（关闭时隐藏） */
const gridStyle = computed(() => {
  if (!props.gridEnabled) return {}
  const step = 20 * props.viewport.zoom
  return {
    backgroundImage: 'radial-gradient(circle, var(--border-light) 1px, transparent 1px)',
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${props.viewport.panX}px ${props.viewport.panY}px`,
  }
})

/** 画区预览矩形（世界坐标） */
const drawPreview = ref<Rect | null>(null)
const previewStyle = computed(() => {
  const r = drawPreview.value
  if (!r) return {}
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }
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

function sectionContainerCount(sectionId: string): number {
  return props.layout.containers.filter(c => c.sectionId === sectionId).length
}

/**
 * 吸附参照矩形：容器与区都参与（拖动区时应能与其他区/容器对齐）。
 * 排除自身——排除项用 id 区分，容器与区不会撞 id（前缀不同）。
 */
function snapRects(exclude?: { containerId?: string; sectionId?: string }): Rect[] {
  const out: Rect[] = []
  for (const c of props.layout.containers) {
    if (c.id !== exclude?.containerId) out.push(rectOfContainer(c))
  }
  for (const s of props.layout.sections) {
    if (s.id !== exclude?.sectionId) out.push({ ...s.rect })
  }
  return out
}

// ── 视口：滚轮缩放（需 passive:false 才能 preventDefault）──
function onWheel(ev: WheelEvent): void {
  ev.preventDefault()
  const anchor = localPoint(ev)
  const next = zoomStepFromWheel(props.viewport.zoom, ev.deltaY)
  emit('viewportChange', zoomAt(props.viewport, next, anchor))
}

// ── 背景：拖拽平移 / 单击取消选中 / 双击新建 / 画区 ──
let bgStart: { local: Point; vp: Viewport } | null = null
let bgMoved = false
let drawStart: Point | null = null

/**
 * 启动平移（背景拖拽、中键、以及 Space 按住时的容器/区拖拽都汇到这里）。
 * 平移不改数据，故不产生撤销快照。
 */
function startPan(ev: PointerEvent): void {
  bgStart = { local: localPoint(ev), vp: { ...props.viewport } }
  bgMoved = false
  panning.value = true
  window.addEventListener('pointermove', onBackgroundPointerMove)
  window.addEventListener('pointerup', onBackgroundPointerUp)
}

function onBackgroundPointerDown(ev: PointerEvent): void {
  if (ev.button !== 0 && ev.button !== 1) return

  // 画区模式：背景拖拽 = 拖出矩形（此时不平移，避免两种语义抢同一手势）
  if (props.sectionDrawMode && ev.button === 0 && !spaceDown.value) {
    drawStart = toWorld(localPoint(ev))
    drawPreview.value = normalizeRect(drawStart, drawStart)
    window.addEventListener('pointermove', onDrawPointerMove)
    window.addEventListener('pointerup', onDrawPointerUp)
    return
  }

  startPan(ev)
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
  if (props.sectionDrawMode) return
  emit('createNodeAt', toWorld(localPoint(ev)))
}

// ── 画区（拖出矩形）──
function onDrawPointerMove(ev: PointerEvent): void {
  if (!drawStart) return
  drawPreview.value = normalizeRect(drawStart, toWorld(localPoint(ev)))
}

function onDrawPointerUp(): void {
  window.removeEventListener('pointermove', onDrawPointerMove)
  window.removeEventListener('pointerup', onDrawPointerUp)
  const rect = drawPreview.value
  drawStart = null
  drawPreview.value = null
  if (rect) emit('createSection', rect)
  emit('sectionDrawDone') // 画完一块自动退出模式（规格：一次画一个，避免误画）
}

// ── 容器拖动 / 尺寸 ──
interface DragState {
  id: string
  startWorld: Point
  startPos: Point
}
let drag: DragState | null = null

interface ResizeState {
  id: string
  startWorld: Point
  startSize: { w: number; h: number }
}
let resize: ResizeState | null = null

function onContainerDragStart(container: BoardContainer, ev: PointerEvent): void {
  if (ev.button !== 0) return
  // Space 按住时：容器拖动转为画布平移（与 Figma 一致的手势优先级）
  if (spaceDown.value) {
    startPan(ev)
    return
  }
  emit('interactionStart') // 撤销快照：一次拖动只记一次
  drag = {
    id: container.id,
    startWorld: toWorld(localPoint(ev)),
    startPos: { ...container.pos },
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
  const container = props.layout.containers.find(c => c.id === drag?.id)
  const size = container?.size ?? DEFAULT_CONTAINER_SIZE
  const moving: Rect = { x: raw.x, y: raw.y, w: size.w, h: size.h }
  const snapped = snapGuides.resolve(moving, snapRects({ containerId: drag.id }), raw)
  emit('moveContainer', drag.id, { x: Math.round(snapped.x), y: Math.round(snapped.y) })
}

function onContainerPointerUp(): void {
  window.removeEventListener('pointermove', onContainerPointerMove)
  window.removeEventListener('pointerup', onContainerPointerUp)
  const id = drag?.id
  drag = null
  snapGuides.clearGuides()
  // 拖动结束才重算区的归属（拖动中重算会让归属随手指跳动）
  if (id) emit('containerDrop', id)
}

function onContainerResizeStart(container: BoardContainer, ev: PointerEvent): void {
  if (ev.button !== 0) return
  emit('interactionStart')
  resize = {
    id: container.id,
    startWorld: toWorld(localPoint(ev)),
    startSize: { ...(container.size ?? DEFAULT_CONTAINER_SIZE) },
  }
  window.addEventListener('pointermove', onResizePointerMove)
  window.addEventListener('pointerup', onResizePointerUp)
}

function onResizePointerMove(ev: PointerEvent): void {
  if (!resize) return
  const world = toWorld(localPoint(ev))
  // 容器尺寸只关心宽高：以 (0,0) 为原点、拖右下角，故起点矩形即「当前尺寸」
  const startRect: Rect = { x: 0, y: 0, w: resize.startSize.w, h: resize.startSize.h }
  const pointer: Point = {
    x: startRect.w + (world.x - resize.startWorld.x),
    y: startRect.h + (world.y - resize.startWorld.y),
  }
  const next = resizeRectFromHandle(startRect, 'se', pointer, { w: 120, h: 48 })
  emit('resizeContainer', resize.id, { w: next.w, h: next.h })
}

function onResizePointerUp(): void {
  window.removeEventListener('pointermove', onResizePointerMove)
  window.removeEventListener('pointerup', onResizePointerUp)
  resize = null
}

// ── 区拖动 / 尺寸 ──
interface SectionDragState {
  id: string
  mode: 'move' | 'resize'
  startWorld: Point
  startRect: Rect
}
let sectionDrag: SectionDragState | null = null

function beginSectionDrag(section: BoardSection, ev: PointerEvent, mode: 'move' | 'resize'): void {
  if (ev.button !== 0) return
  // Space 按住时：区拖动同样转为画布平移（优先于元素拖动）
  if (spaceDown.value) {
    startPan(ev)
    return
  }
  emit('interactionStart')
  sectionDrag = {
    id: section.id,
    mode,
    startWorld: toWorld(localPoint(ev)),
    startRect: { ...section.rect },
  }
  window.addEventListener('pointermove', onSectionPointerMove)
  window.addEventListener('pointerup', onSectionPointerUp)
}

function onSectionDragStart(section: BoardSection, ev: PointerEvent): void {
  beginSectionDrag(section, ev, 'move')
}

function onSectionResizeStart(section: BoardSection, ev: PointerEvent): void {
  beginSectionDrag(section, ev, 'resize')
}

function onSectionPointerMove(ev: PointerEvent): void {
  if (!sectionDrag) return
  const world = toWorld(localPoint(ev))
  const dx = world.x - sectionDrag.startWorld.x
  const dy = world.y - sectionDrag.startWorld.y

  if (sectionDrag.mode === 'move') {
    const moving: Rect = {
      ...sectionDrag.startRect,
      x: sectionDrag.startRect.x + dx,
      y: sectionDrag.startRect.y + dy,
    }
    const snapped = snapGuides.resolve(moving, snapRects({ sectionId: sectionDrag.id }), {
      x: moving.x,
      y: moving.y,
    })
    emit('moveSection', sectionDrag.id, { ...moving, x: Math.round(snapped.x), y: Math.round(snapped.y) })
    return
  }

  const next = resizeRectFromHandle(
    sectionDrag.startRect,
    'se',
    { x: sectionDrag.startRect.x + sectionDrag.startRect.w + dx, y: sectionDrag.startRect.y + sectionDrag.startRect.h + dy },
    { w: 80, h: 60 },
  )
  emit('resizeSection', sectionDrag.id, next)
}

function onSectionPointerUp(): void {
  window.removeEventListener('pointermove', onSectionPointerMove)
  window.removeEventListener('pointerup', onSectionPointerUp)
  sectionDrag = null
  snapGuides.clearGuides()
}

// ── 右栏拖放落点 ──
/**
 * 拖拽态：拖的是大纲节点时点亮画布（虚线框 + 复制光标），让「能放」在视觉上可见。
 *
 * 三个必须做对的动作（否则在 Windows/WebView2 上会表现为「拖拽没反应」）：
 * ① `dragover` 必须 `preventDefault()`——HTML5 DnD 的硬性规定，不调用则**永远不触发 drop**；
 * ② 目标侧要设 `dropEffect`，与源侧 `effectAllowed='copy'` 对齐，否则光标显示「禁止」；
 * ③ 非本类型拖拽（如从系统拖文件）不点亮画布，但仍 `preventDefault` 以阻止 webview 接管该文件。
 */
function onNodeDragOver(ev: DragEvent): void {
  ev.preventDefault()
  if (!acceptsBoardDrag(ev.dataTransfer)) return
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
  nodeDropActive.value = true
}

/** 拖出画布才清态：子元素之间移动也触发 dragleave，故用 relatedTarget 判定 */
function onNodeDragLeave(ev: DragEvent): void {
  const to = ev.relatedTarget as Node | null
  if (to && rootEl.value?.contains(to)) return
  nodeDropActive.value = false
}

function onDrop(ev: DragEvent): void {
  nodeDropActive.value = false
  const payload = readDndPayload(ev)
  if (!payload) return
  const world = toWorld(localPoint(ev))
  if (payload.kind === 'node') {
    emit('dropNode', payload.id, world)
    return
  }
  // 章节载荷：落点是否压在某个容器上决定语义（容器上 = 只关联；空白 = 新建节点 + 关联）。
  // 命中测试放在这里做——画布持有 layout，装配层无需重复几何计算。
  const hit = containerAtPoint(props.layout.containers, world)
  emit('dropChapter', payload.id, world, hit?.id ?? null)
}

// ── 右键菜单落点 ──
/**
 * 落点由**标注**决定（`data-ctx` / `data-ctx-id`，见 contextMenu.ts）：
 * 组件行 > 容器 > 区 > 画布空白，`closest` 天然取最内层。
 * 本组件只负责「解析 + 上报」，菜单长什么样与动作怎么做都在装配层（BoardView）。
 */
function onContextMenu(ev: MouseEvent): void {
  ev.preventDefault()
  emit('contextMenu', {
    target: resolveContextTarget(ev.target as Element | null),
    x: ev.clientX,
    y: ev.clientY,
  })
}

/** 供父级调用的视口能力（缩放按钮 / 定位已有容器 / 适配全部） */
defineExpose({
  /** 屏幕（client）坐标 → 世界坐标；右键「在此新建节点」用 */
  clientToWorld(clientX: number, clientY: number): Point {
    return toWorld(localPoint({ clientX, clientY }))
  },
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
  /** 把某个世界矩形带到视口中心（「已在板上」节点定位、区定位时用） */
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
  window.removeEventListener('pointermove', onResizePointerMove)
  window.removeEventListener('pointerup', onResizePointerUp)
  window.removeEventListener('pointermove', onSectionPointerMove)
  window.removeEventListener('pointerup', onSectionPointerUp)
  window.removeEventListener('pointermove', onDrawPointerMove)
  window.removeEventListener('pointerup', onDrawPointerUp)
  window.removeEventListener('keydown', onSpaceKeyDown)
  window.removeEventListener('keyup', onSpaceKeyUp)
})

// Space 平移：挂载期常驻（仅当本画布挂载时；编辑器层才渲染本组件）
onMounted(() => {
  window.addEventListener('keydown', onSpaceKeyDown)
  window.addEventListener('keyup', onSpaceKeyUp)
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
.bcv--drawing { cursor: crosshair; }
/* Space 按住：光标提示可平移（与中键拖拽一致的语义） */
.bcv--space { cursor: grab; }
.bcv--space.bcv--panning { cursor: grabbing; }
/* 拖着大纲节点经过画布：虚线内边框 + 复制光标（落点可见，否则用户以为拖拽没实现） */
.bcv--node-drop {
  cursor: copy;
  box-shadow: inset 0 0 0 2px var(--primary);
}
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
.bcv-draw-preview {
  position: absolute;
  border: 1px dashed var(--primary);
  background: var(--hover-bg);
  border-radius: var(--radius-mid);
  pointer-events: none;
}
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
.bcv-draw-hint {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  padding: 4px 10px;
  border-radius: var(--radius-mid);
  background: var(--menubar-bg, var(--bg-secondary));
  border: 1px solid var(--border-color);
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  pointer-events: none;
}
.bcv-draw-key {
  padding: 0 4px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
}
</style>
