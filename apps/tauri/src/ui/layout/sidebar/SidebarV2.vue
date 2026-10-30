<template>
  <div
    class="sidebar"
    :class="{
      collapsed: uiStore.sidebarCollapsed,
      dragging: interaction.isDragging.value,
      'sidebar-drag-mode': isCustomView,
      'sidebar-right': effectiveSide === 'right',
    }"
    role="navigation"
    aria-label="视图导航"
    ref="sidebarRef"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
  >
    <button
      v-if="uiStore.sidebarCollapsed"
      class="sidebar-toggle"
      aria-label="展开侧边栏"
      title="展开侧边栏"
      data-ws-tip-keys="Ctrl+B"
      @pointerdown.stop
      @click="uiStore.toggleSidebar()"
    >
      <WsIcon name="menu" size="md" />
    </button>
    <div class="sidebar-inner">
      <!-- 展开态头部：收起侧边栏按钮 -->
      <div v-if="!uiStore.sidebarCollapsed" class="sidebar-header">
        <QuickAccess :side="effectiveSide" />
        <button
          class="sidebar-collapse"
          aria-label="收起侧边栏"
          title="收起侧边栏"
          data-ws-tip-keys="Ctrl+B"
          @pointerdown.stop
          @click="uiStore.toggleSidebar()"
        >
          <WsIcon :name="effectiveSide === 'right' ? 'chevron-right' : 'chevron-left'" size="sm" />
        </button>
      </div>
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
          <CountBadge v-if="!uiStore.sidebarCollapsed && uiStore.sproutCountEnabled && item.count > 0" :value="item.count" />
        </div>
      </div>
    </div>
    <!-- 侧边栏底部：⋯ 更多操作菜单（原窗口栏左端迁入），与顶部收缩按钮上下对齐对称 -->
    <div class="sidebar-footer">
      <AppMenu />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEntityStore } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core/types'
import { WsIcon } from '@worldsea/ui-kit'
import { hasIcon } from '@/assets/iconRegistry'
import CountBadge from './CountBadge.vue'
import QuickAccess from './QuickAccess.vue'
import { countEntitiesByPlugin } from './sproutEntityCounts'
import { visibleViewsInSidebarOrder } from './viewOrder'
import { useSidebarPhysics } from './useSidebarPhysics'
import { useSidebarInteraction } from './useSidebarInteraction'
import { useSidebarDragHandler } from './useSidebarDragHandler'
import AppMenu from '@/ui/layout/AppMenu.vue'

const props = defineProps<{ forceSide?: 'left' | 'right' }>()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const entityStore = useEntityStore()

/** 左右侧栏形态由双栏顺序强制芽栏侧；其余形态继续用「芽侧边栏位置」。 */
const effectiveSide = computed<'left' | 'right'>(() => (
  props.forceSide ?? (settingsStore.sidebarPosition === 'right' ? 'right' : 'left')
))
const carouselRef = ref<HTMLElement | null>(null)

const isCustomView = computed(() => uiStore.currentView === 'custom')

/* ── 视图列表 + 实体计数(从原 Sidebar.vue 提取,保持行为一致) ── */

/** 缓存每个芽的实体数量,仅在实体增删时更新,避免动画帧中重复计算 */
const pluginEntityCounts = computed(() => countEntitiesByPlugin(entityStore.allTypeCounts))

const sortedViews = computed(() => visibleViewsInSidebarOrder())

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
  /* 三区双线：独立圆角块（边框 + 底色），内缩 region-pad 与其余区域隔出缝隙 */
  --region-bg: var(--sf-nav-bg);
  background: var(--region-bg, var(--bg-surface));
  -webkit-backdrop-filter: var(--sf-nav-filter, none);
  backdrop-filter: var(--sf-nav-filter, none);
  overflow: hidden;
  /* 性能优化:脱离 flex 文档流(与原 Sidebar.vue 一致) */
  position: absolute;
  left: var(--region-pad, 8px);
  top: var(--region-pad, 8px);
  bottom: var(--region-pad, 8px);
  border: 1px solid var(--region-border, var(--border));
  border-radius: var(--region-radius, var(--radius-md));
  z-index: 10;
  contain: layout paint;
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
  right: var(--region-pad, 8px);
}
.sidebar:not(.dragging) {
  transition: width 180ms var(--ease-out);
}
.sidebar.dragging .sidebar-btn {
  cursor: grabbing;
  pointer-events: none;
}
/* 折叠窄条内的展开按钮（flex 子项，占多数比例；位于 sidebar-inner 之外，不随 inner 隐藏） */
.sidebar-toggle {
  flex: 3;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.sidebar-toggle:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}
/* 展开态头部：收起侧边栏按钮 */
.sidebar-header {
  position: relative;
  flex-shrink: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 8px;
  border-bottom: 1px solid var(--region-border, var(--border));
}
.sidebar-collapse {
  width: 250px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.sidebar-collapse:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}
/* 侧边栏底部：⋯ 更多操作菜单，与顶部收缩按钮上下对齐对称（双线分隔独立块） */
.sidebar-footer {
  flex-shrink: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-top: 1px solid var(--region-border, var(--border));
}
/* 收缩态：展开按钮占多数（flex:3），底部 ⋯ 菜单区域高度与展开态一致（40px），不各占一半 */
.sidebar.collapsed .sidebar-footer {
  height: 40px;
  border-top: none;
}
/* 收缩态窄条：⋯ 按钮保持短宽度（不随展开态拉伸到整宽），适配 36px 窄条 */
.sidebar.collapsed .sidebar-footer :deep(.appmenu-btn) {
  width: 34px;
}
.sidebar-inner {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  contain: layout paint style;
  will-change: transform, opacity;
  transition: opacity 120ms var(--ease);
}
.sidebar.collapsed .sidebar-inner {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 120ms var(--ease), visibility 0s linear 120ms;
}
.sidebar-carousel {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  flex: 1;
  min-height: 200px;
  gap: 2px;
  padding: 4px 6px;
  position: relative;
  /* 治本裁剪：芽按钮在轮播边界即被裁剪，不再溢出覆盖头部收缩按钮 */
  overflow: hidden;
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
  border-radius: var(--radius-sm);
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
/* 数量徽记已组件化（CountBadge.vue，Tabler 数字图标逐位拼接），旧 .sidebar-count 样式移除 */

/* ── 减弱动态偏好（prefers-reduced-motion）：停用点击脉冲与折叠位移 ──
   与 TuiButton/TuiModal/TuiDrawer/AgentWorkspace 同一可访问性语言：仅保留静态状态。 */
:root[data-anim-status='off'] .sidebar-btn.pulse {
  animation: none;
}
:root[data-anim-status='off'] .sidebar-inner {
  transition: none;
}
:root[data-anim-panels='off'] .sidebar,
:root[data-reduce-motion='on'] .sidebar { transition: none; }
:root[data-anim-panels='off'] .sidebar-inner,
:root[data-reduce-motion='on'] .sidebar-inner { transition: none; }
</style>
