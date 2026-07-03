<template>
  <div
    class="sidebar"
    :class="{ collapsed: uiStore.sidebarCollapsed, dragging: isDragging, 'sidebar-drag-mode': isCustomView, 'sidebar-right': settingsStore.sidebarPosition === 'right' }"
    role="navigation"
    aria-label="视图导航"
    ref="sidebarRef"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
  >
    <div class="sidebar-inner">
      <div class="sidebar-carousel" ref="carouselRef">
        <div
          v-for="item in carouselItems"
          :key="item.realIndex"
          class="sidebar-btn"
          :class="{ active: item.view.id === settledViewId, 'sidebar-draggable': isCustomView }"
          :data-offset="item.offset"
          :title="item.view.label"
          :data-view-id="item.view.id"
          :draggable="isCustomView && item.view.id !== 'custom'"
          @dragstart="onSidebarDragStart(item.view, $event)"
        >
          <WsIcon v-if="hasIcon(item.view.icon)" :name="item.view.icon" size="md" class="sidebar-icon" />
          <span v-else class="sidebar-icon">{{ item.view.icon }}</span>
          <span v-if="!uiStore.sidebarCollapsed" class="sidebar-label">{{ item.view.label }}</span>
          <span v-if="!uiStore.sidebarCollapsed && item.count > 0" class="sidebar-count">{{ item.count }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onBeforeUnmount, watch, nextTick } from 'vue'
import { useUIStore } from '../../stores/uiStore'
import { usePluginStore } from '@worldsmith/entity-core'
import { useSettingsStore } from '../../stores/settingsStore'
import { useEntityStore, entitySchemaRegistry } from '@worldsmith/entity-core'
import type { PluginView } from '@worldsmith/entity-core/types'
import WsIcon from '../WsIcon.vue'
import { hasIcon } from '../../assets/iconRegistry'

const uiStore = useUIStore()
const pluginStore = usePluginStore()
const settingsStore = useSettingsStore()
const entityStore = useEntityStore()

const sidebarRef = ref<HTMLElement | null>(null)
const carouselRef = ref<HTMLElement | null>(null)

let pos = 0
let vel = 0
const renderTick = ref(0)
const isDragging = ref(false)

const isCustomView = computed(() => uiStore.currentView === 'custom')

function onSidebarDragStart(view: { id: string; label: string; icon: string }, e: DragEvent) {
  if (!isCustomView.value) return
  e.dataTransfer!.setData('application/worldsmith-view-id', view.id)
  e.dataTransfer!.setData('application/worldsmith-view-label', view.label)
  e.dataTransfer!.setData('application/worldsmith-view-icon', view.icon)
  e.dataTransfer!.effectAllowed = 'copy'
}

const FRICTION = 0.92
const IMPULSE = 0.32
const SNAP_SPRING = 0.22
const SNAP_DAMPING = 0.78
const SNAP_VEL_THRESHOLD = 0.15
const SETTLE_THRESHOLD = 0.0005
const DRAG_SENSITIVITY = 0.028
const FLING_MULTIPLIER = 6.5

const FALLBACK_TYPE_MAP: Record<string, string[]> = {
  'official.characters': ['character'],
  'official.regions': ['region'],
  'official.timeline': ['event'],
  'official.organizations': ['organization'],
  'official.concepts': ['concept'],
  'official.items': ['item'],
  'official.buildings': ['building'],
  'official.species': ['species'],
  'official.magic': ['magic'],
  'official.outline': ['outline_node'],
  'official.languages': ['language'],
  'official.culture': ['culture'],
  'official.conflict': ['conflict'],
  'official.inspiration': ['inspiration'],
  'official.plants': ['plant'],
  'official.combat_stats': ['combat_stat'],
  'official.weapons': ['weapon'],
  'official.apparel': ['apparel'],
  'official.tactical-board': ['tactical-board'],
  'official.notebook': ['notebook'],
  'official.manuscript': ['manuscript'],
  'official.workflow': ['workflow', 'workflow_run'],
}

const pluginEntityTypes = computed(() => {
  const map = new Map<string, string[]>()
  for (const schema of entitySchemaRegistry.getAll()) {
    if (schema.pluginId) {
      const list = map.get(schema.pluginId) || []
      list.push(schema.type)
      map.set(schema.pluginId, list)
    }
  }
  for (const [pid, types] of Object.entries(FALLBACK_TYPE_MAP)) {
    if (!map.has(pid)) {
      map.set(pid, types)
    }
  }
  return map
})

/** 缓存每个插件的实体数量，仅在实体增删时更新，避免动画帧中重复计算 */
const pluginEntityCounts = computed(() => {
  const counts = new Map<string, number>()
  const typesMap = pluginEntityTypes.value
  for (const [pluginId, types] of typesMap) {
    let total = 0
    for (const t of types) {
      total += entityStore.allTypeCounts.get(t) || 0
    }
    counts.set(pluginId, total)
  }
  return counts
})

const sortedViews = computed(() => {
  const order = uiStore.sidebarOrder
  // 预计算 order Map，将 O(n² log n) 降为 O(n log n)
  const orderMap = new Map<string, number>()
  for (let i = 0; i < order.length; i++) orderMap.set(order[i], i)
  return pluginStore.views
    .filter(v => !v.pluginId || settingsStore.isActive(v.pluginId))
    .slice()
    .sort((a, b) => {
      const ia = orderMap.get(a.id) ?? 999
      const ib = orderMap.get(b.id) ?? 999
      return ia - ib
    })
})

const centerIdx = computed(() => Math.round(pos))

const settledViewId = computed(() => {
  const views = sortedViews.value
  if (views.length === 0) return ''
  const idx = ((centerIdx.value % views.length) + views.length) % views.length
  return views[idx].id
})

interface CarouselItem {
  view: PluginView
  offset: number
  realIndex: number
  /** 预计算的实体数量，避免模板中调用函数 */
  count: number
}

const carouselItems = computed<CarouselItem[]>(() => {
  const views = sortedViews.value
  const counts = pluginEntityCounts.value
  const n = views.length
  if (n === 0) return []

  const center = Math.round(pos)
  const items: CarouselItem[] = []
  const seen = new Set<number>()
  const half = Math.min(Math.ceil(n / 2), 8)

  for (let offset = -half; offset <= half; offset++) {
    const realIdx = ((center + offset) % n + n) % n
    if (seen.has(realIdx)) continue
    seen.add(realIdx)
    const view = views[realIdx]
    items.push({
      view,
      offset,
      realIndex: realIdx,
      count: counts.get(view.pluginId || '') || 0,
    })
  }

  return items
})

/**
 * 命令式更新轮播按钮的位置样式（transform/opacity/zIndex）。
 * 绕过 Vue 响应式系统，避免每帧触发整个 v-for 的 reconcile。
 * 在物理循环、拖拽、以及 sortedViews/currentView 变更后的 nextTick 中调用。
 */
function syncDomStyles() {
  const container = carouselRef.value
  if (!container) return
  const buttons = container.querySelectorAll<HTMLElement>('.sidebar-btn')
  if (buttons.length === 0) return

  const center = Math.round(pos)
  const fractional = pos - center

  buttons.forEach((el) => {
    const rawOffset = el.getAttribute('data-offset')
    if (rawOffset === null) return
    const offset = parseInt(rawOffset, 10)
    const displayOffset = offset - fractional
    const absOffset = Math.abs(displayOffset)
    const opacity = Math.max(0, 1 - absOffset * 0.13)
    const scale = Math.max(0.6, 1 - absOffset * 0.04)
    el.style.opacity = String(opacity)
    el.style.transform = `scale(${scale})`
    el.style.zIndex = String(20 - Math.floor(absOffset))
  })
}

let physicsRaf: number | null = null
let isRunning = false
let lastSettledIdx = 0

function startPhysics() {
  if (isRunning) return
  isRunning = true
  tick()
}

function tick() {
  if (springTarget !== null) {
    const diff = springTarget - pos
    vel = vel * 0.72 + diff * 0.18
    pos += vel

    if (Math.abs(diff) < SETTLE_THRESHOLD && Math.abs(vel) < SETTLE_THRESHOLD) {
      pos = springTarget
      vel = 0
      springTarget = null
      isRunning = false
      physicsRaf = null
      renderTick.value++
      checkViewSwitch()
      syncDomStyles()
      return
    }
  } else {
    pos += vel

    if (Math.abs(vel) < SNAP_VEL_THRESHOLD) {
      const target = Math.round(pos)
      const diff = target - pos
      vel = vel * SNAP_DAMPING + diff * SNAP_SPRING

      if (Math.abs(diff) < SETTLE_THRESHOLD && Math.abs(vel) < SETTLE_THRESHOLD) {
        pos = target
        vel = 0
        isRunning = false
        physicsRaf = null
        renderTick.value++
        checkViewSwitch()
        syncDomStyles()
        return
      }
    } else {
      vel *= FRICTION
    }
  }

  syncDomStyles()
  checkViewSwitch()
  physicsRaf = requestAnimationFrame(tick)
}

function checkViewSwitch() {
  const current = Math.round(pos)
  if (current !== lastSettledIdx) {
    lastSettledIdx = current
    const views = sortedViews.value
    if (views.length === 0) return
    const idx = ((current % views.length) + views.length) % views.length
    const view = views[idx]
    // 性能优化:延迟 setView 到下一轮事件循环,避免在物理 RAF 帧内同步挂载/卸载插件视图组件
    // 原实现 setView + viewComponent 赋值在 tick() 中同步执行,与 width 动画叠加导致掉帧
    // 用 microtask 推迟,既保证响应性又避免阻塞动画帧
    Promise.resolve().then(() => {
      uiStore.setView(view.id)
      uiStore.viewComponent = view.component
    })
  }
}

function onWheel(e: WheelEvent) {
  const views = sortedViews.value
  if (views.length === 0) return

  const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  const direction = delta > 0 ? 1 : -1

  springTarget = null
  vel += direction * IMPULSE
  startPhysics()
}

let dragStartY = 0
let dragStartPos = 0
let dragLastY = 0
let dragLastTime = 0
let dragVelSamples: number[] = []
let dragMoved = false
let pointerTarget: EventTarget | null = null
let springTarget: number | null = null

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  if (isCustomView.value) return
  e.preventDefault()

  if (physicsRaf !== null) {
    cancelAnimationFrame(physicsRaf)
    physicsRaf = null
    isRunning = false
  }
  vel = 0

  dragStartY = e.clientY
  dragStartPos = pos
  dragLastY = e.clientY
  dragLastTime = performance.now()
  dragVelSamples = []
  dragMoved = false
  pointerTarget = e.target
  springTarget = null
  isDragging.value = true

  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)

  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  const dy = e.clientY - dragLastY
  const now = performance.now()
  const dt = now - dragLastTime

  if (dt > 0) {
    dragVelSamples.push(dy / dt)
    if (dragVelSamples.length > 5) dragVelSamples.shift()
  }

  const totalDy = e.clientY - dragStartY
  if (Math.abs(totalDy) > 25) dragMoved = true

  // 修复:阈值超过后才更新 pos,避免点击时 pos 被微小移动污染(原问题2/3)
  // 同时用 totalDy 计算绝对位置,修复原代码用 dy 增量导致 pos 每帧振荡的隐藏 BUG
  // 原代码 pos = dragStartPos - dy * SENSITIVITY,dy 是单帧增量,会让 pos 在 dragStartPos 附近振荡而非持续跟随
  if (dragMoved) {
    pos = dragStartPos - totalDy * DRAG_SENSITIVITY
    syncDomStyles()
    checkViewSwitch()
  }

  dragLastY = e.clientY
  dragLastTime = now
}

function onPointerUp(e: PointerEvent) {
  isDragging.value = false

  const el = e.currentTarget as HTMLElement
  el.releasePointerCapture(e.pointerId)
  el.removeEventListener('pointermove', onPointerMove)
  el.removeEventListener('pointerup', onPointerUp)
  el.removeEventListener('pointercancel', onPointerUp)

  if (!dragMoved) {
    const btn = (pointerTarget as HTMLElement)?.closest('.sidebar-btn') as HTMLElement | null
    if (btn) {
      const offset = parseInt(btn.dataset.offset || '0', 10)
      if (offset === 0) {
        // 修复:点击当前居中按钮给予视觉反馈(轻微弹性 pulse)
        // 原代码 offset===0 时整个 if 块被跳过,用户点击当前选中按钮无任何响应
        btn.classList.remove('pulse')
        void btn.offsetWidth  // 强制重排,重新触发 CSS animation
        btn.classList.add('pulse')
        setTimeout(() => btn.classList.remove('pulse'), 300)
      } else {
        // 修复:用 dragStartPos 计算跳转目标,避免 pos 被微小移动污染
        // 原代码用 Math.round(pos),pos 可能在 onPointerMove 中已被污染(现已修复,但双重保险)
        springTarget = Math.round(dragStartPos) + offset
        startPhysics()
      }
    }
    pointerTarget = null
    return
  }

  let avgVel = 0
  if (dragVelSamples.length > 0) {
    const recent = dragVelSamples.slice(-3)
    avgVel = recent.reduce((a, b) => a + b, 0) / recent.length
  }

  springTarget = null
  vel = -avgVel * FLING_MULTIPLIER

  if (Math.abs(vel) < 0.05) {
    vel = 0
    const target = Math.round(pos)
    const diff = target - pos
    if (Math.abs(diff) > SETTLE_THRESHOLD) {
      vel = diff * 0.45
    }
  }

  startPhysics()
}

watch(
  () => sortedViews.value,
  (views) => {
    if (views.length === 0) {
      uiStore.setView('')
      uiStore.viewComponent = null
      return
    }
    const currentId = uiStore.currentView
    const idx = views.findIndex(v => v.id === currentId)
    if (idx !== -1) {
      pos = idx
      lastSettledIdx = idx
    } else {
      pos = 0
      lastSettledIdx = 0
      const view = views[0]
      uiStore.setView(view.id)
      uiStore.viewComponent = view.component
    }
    renderTick.value++
    nextTick(() => syncDomStyles())
  },
  { immediate: true, flush: 'post' },
)

watch(
  () => uiStore.currentView,
  (newId) => {
    if (!newId) return
    const views = sortedViews.value
    const idx = views.findIndex(v => v.id === newId)
    if (idx !== -1 && idx !== lastSettledIdx) {
      pos = idx
      lastSettledIdx = idx
      vel = 0
      springTarget = null
      nextTick(() => syncDomStyles())
    }
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  isRunning = false
  if (physicsRaf !== null) {
    cancelAnimationFrame(physicsRaf)
    physicsRaf = null
  }
})
</script>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
  /* 性能优化:脱离 flex 文档流,避免 width 变化触发 shell-body flex 重排 */
  /* Sidebar width 瞬变只影响自身,ViewContainer 用 margin-left 独立响应 */
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 10;
  /* contain: strict 严格隔离 sidebar 内部重排 */
  contain: strict;
  flex-shrink: 0;
}
.sidebar:not(.collapsed) {
  width: var(--layout-sidebar-width);
}
.sidebar.collapsed {
  width: var(--layout-sidebar-collapsed-width);
}
/* sidebar-right 模式:定位到右侧 */
.sidebar.sidebar-right {
  left: auto;
  right: 0;
}
.sidebar:not(.dragging) {
  /* 性能优化:width 瞬变(无 transition),仅 1 次 layout */
  /* 视觉平滑动画由 .sidebar-inner 的 transform + opacity 过渡,合成层 0 layout */
  transition: none;
}
.sidebar.dragging {
  cursor: grabbing;
}
.sidebar.dragging .sidebar-btn {
  cursor: grabbing;
  pointer-events: none;
}
.sidebar-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
  contain: layout paint style;
  /* 性能优化:内层用 transform 平滑滑出,合成层不重排 */
  /* collapsed 时内层向左滑出 + 淡出,视觉强化收缩效果 */
  will-change: transform, opacity;
  transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.15s ease;
}
/* collapsed 时内层向左滑出,因为外层 overflow:hidden 会裁剪掉滑出部分 */
.sidebar.collapsed .sidebar-inner {
  transform: translateX(-100%);
  opacity: 0;
}
/* sidebar-right 模式:collapsed 时内层向右滑出 */
.sidebar.sidebar-right.collapsed .sidebar-inner {
  transform: translateX(100%);
}
.sidebar-carousel {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  height: 100%;
  gap: 2px;
  padding: 4px 6px;
  position: relative;
  /* 防止空→有内容时的布局偏移 */
  min-height: 200px;
}
.sidebar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  cursor: grab;
  color: var(--text-color);
  font-size: var(--font-size-base);
  transition: background 0.15s ease;
  white-space: nowrap;
  position: relative;
  user-select: none;
  border-radius: 6px;
  flex-shrink: 0;
}
.sidebar-btn:hover {
  background: var(--hover-bg);
}
.sidebar-btn.active {
  background: var(--active-bg);
  font-weight: var(--font-weight-semibold);
}
.sidebar-btn.sidebar-draggable {
  cursor: grab;
}
.sidebar-btn.sidebar-draggable:active {
  cursor: grabbing;
}
/* 修复:点击当前居中按钮(offset=0)的视觉反馈动画 */
/* CSS animation 优先级高于 syncDomStyles 的 inline transform,播放期间不会被覆盖 */
@keyframes sidebar-btn-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.15); }
  100% { transform: scale(1); }
}
.sidebar-btn.pulse {
  animation: sidebar-btn-pulse 0.3s ease;
}
.sidebar-drag-mode .sidebar-btn.sidebar-draggable:hover {
  background: var(--hover-bg);
  outline: 1px dashed var(--primary);
  outline-offset: -1px;
}
.sidebar-icon {
  font-size: var(--font-size-xl);
  width: 24px;
  text-align: center;
  flex-shrink: 0;
}
.sidebar-label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.sidebar-count {
  font-size: var(--font-size-xs);
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
  border-radius: 8px;
  padding: 1px 6px;
  min-width: 18px;
  text-align: center;
  margin-left: auto;
  flex-shrink: 0;
  line-height: 16px;
}
</style>
