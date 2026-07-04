<template>
  <div
    class="sidebar"
    :class="{
      collapsed: uiStore.sidebarCollapsed,
      dragging: interaction.isDragging.value,
      'sidebar-drag-mode': isCustomView,
      'sidebar-right': settingsStore.sidebarPosition === 'right',
    }"
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
          :class="{
            active: item.view.id === settledViewId,
            'sidebar-draggable': dragHandler.isDraggable.value,
          }"
          :data-offset="item.offset"
          :title="item.view.label"
          :data-view-id="item.view.id"
          :draggable="dragHandler.getDraggable(item.view)"
          @dragstart="dragHandler.onDragStart(item.view, $event)"
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
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useUIStore } from '../../../stores/uiStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { usePluginStore, useEntityStore, entitySchemaRegistry } from '@worldsmith/entity-core'
import type { PluginView } from '@worldsmith/entity-core/types'
import WsIcon from '../../WsIcon.vue'
import { hasIcon } from '../../../assets/iconRegistry'
import { useSidebarPhysics } from './useSidebarPhysics'
import { useSidebarInteraction } from './useSidebarInteraction'
import { useSidebarDragHandler } from './useSidebarDragHandler'

const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const pluginStore = usePluginStore()
const entityStore = useEntityStore()

const sidebarRef = ref<HTMLElement | null>(null)
const carouselRef = ref<HTMLElement | null>(null)

const isCustomView = computed(() => uiStore.currentView === 'custom')

/* ── 视图列表 + 实体计数(从原 Sidebar.vue 提取,保持行为一致) ── */

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

/** 缓存每个插件的实体数量,仅在实体增删时更新,避免动画帧中重复计算 */
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

/* ── 物理引擎 ── */

const physics = useSidebarPhysics({
  getViewCount: () => sortedViews.value.length,
  onTick: () => {
    // 物理更新后同步 DOM 样式(命令式,绕过 Vue 响应式)
    syncDomStyles()
  },
  onSettle: (viewIdx) => {
    // 落到新整数位置,切换视图(microtask 延迟,避免阻塞动画帧)
    const views = sortedViews.value
    if (views.length === 0) return
    const view = views[viewIdx]
    Promise.resolve().then(() => {
      uiStore.setView(view.id)
      uiStore.viewComponent = view.component
    })
  },
})

const settledViewId = computed(() => {
  const views = sortedViews.value
  if (views.length === 0) return ''
  const idx = ((physics.getSettledIdx() % views.length) + views.length) % views.length
  return views[idx].id
})

/* ── 交互处理 ── */

const interaction = useSidebarInteraction({
  onDragStart: () => {
    // 拖拽开始:停止当前物理动画(避免与手动拖拽冲突)
    physics.stopPhysics()
  },
  onDragMove: (newPos) => {
    // 拖拽中:直接设置 pos(跳过物理)
    physics.setPosition(newPos, false)
    syncDomStyles()
  },
  onDragEnd: (velocity) => {
    // 拖拽结束:根据释放速度 fling
    physics.fling(velocity)
  },
  onClick: (offset, startPos) => {
    // 点击:offset=0 给 pulse 反馈,offset≠0 跳转
    if (offset === 0) {
      triggerPulse()
    } else {
      physics.springTo(Math.round(startPos) + offset)
    }
  },
})

function onPointerDown(e: PointerEvent) {
  // 自定义视图模式下禁用轮播交互(让 HTML5 拖拽接管)
  if (isCustomView.value) return
  interaction.onPointerDown(e, physics.pos.value)
}

/* ── HTML5 拖拽处理(自定义视图模式) ── */

const dragHandler = useSidebarDragHandler(() => isCustomView.value)

/* ── 滚轮处理 ── */

function onWheel(e: WheelEvent) {
  const views = sortedViews.value
  if (views.length === 0) return
  const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  const direction = delta > 0 ? 1 : -1
  physics.applyImpulse(direction)
}

/* ── 轮播项计算 ── */

interface CarouselItem {
  view: PluginView
  offset: number
  realIndex: number
  count: number
}

const carouselItems = computed<CarouselItem[]>(() => {
  const views = sortedViews.value
  const counts = pluginEntityCounts.value
  const n = views.length
  if (n === 0) return []

  const center = physics.getSettledIdx()
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

/* ── 命令式 DOM 样式更新(性能优化,绕过 Vue 响应式) ── */

function syncDomStyles() {
  const container = carouselRef.value
  if (!container) return
  const buttons = container.querySelectorAll<HTMLElement>('.sidebar-btn')
  if (buttons.length === 0) return

  const center = Math.round(physics.pos.value)
  const fractional = physics.pos.value - center

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

/* ── 点击 pulse 反馈(offset=0 时) ── */

function triggerPulse() {
  const container = carouselRef.value
  if (!container) return
  const centerBtn = container.querySelector<HTMLElement>('.sidebar-btn[data-offset="0"]')
  if (!centerBtn) return
  centerBtn.classList.remove('pulse')
  void centerBtn.offsetWidth // 强制重排,重新触发 CSS animation
  centerBtn.classList.add('pulse')
  setTimeout(() => centerBtn.classList.remove('pulse'), 300)
}

/* ── 视图列表变化时同步 pos ── */

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
      physics.setPosition(idx)
      physics.syncSettledIdx(idx)
    } else {
      physics.setPosition(0)
      physics.syncSettledIdx(0)
      const view = views[0]
      uiStore.setView(view.id)
      uiStore.viewComponent = view.component
    }
    nextTick(() => syncDomStyles())
  },
  { immediate: true, flush: 'post' },
)

/* ── 外部 currentView 变化时同步 pos(如快捷键切换) ── */

watch(
  () => uiStore.currentView,
  (newId) => {
    if (!newId) return
    const views = sortedViews.value
    const idx = views.findIndex(v => v.id === newId)
    if (idx !== -1 && idx !== physics.getSettledIdx()) {
      physics.setPosition(idx)
      physics.syncSettledIdx(idx)
      nextTick(() => syncDomStyles())
    }
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  physics.stopPhysics()
})
</script>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
  /* 性能优化:脱离 flex 文档流(与原 Sidebar.vue 一致) */
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 10;
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
  transition: none;
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
  will-change: transform, opacity;
  transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.15s ease;
}
.sidebar.collapsed .sidebar-inner {
  transform: translateX(-100%);
  opacity: 0;
}
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
/* 点击当前居中按钮(offset=0)的视觉反馈动画 */
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
