<template>
  <div
    class="view-container"
    :class="{ 'sidebar-collapsed': uiStore.sidebarCollapsed, 'sidebar-right': settingsStore.sidebarPosition === 'right' }"
    @contextmenu.prevent="onViewContext"
  >
    <!-- R3 视图工具条（瘦身版，2026-08-10 方案 A）：面包屑（视图名）+ ⋯ 更多菜单（通用操作） -->
    <div v-if="hasView" class="view-toolbar">
      <nav class="vt-breadcrumb" aria-label="面包屑">
        <WsIcon v-if="currentViewIcon" :name="currentViewIcon" size="sm" class="vt-icon" />
        <span class="vt-crumb">{{ currentViewLabel }}</span>
      </nav>
      <!-- 视图控件区：活动视图（如 GenericEntityView）通过 Teleport 把自身的搜索/筛选/新建控件交到这里 -->
      <div id="view-toolbar-controls" class="vt-controls"></div>
      <div ref="moreRef" class="vta" @mouseenter="onEnter" @mouseleave="onLeave">
        <button
          class="vta-btn"
          :class="{ 'vta-btn--pinned': open }"
          aria-label="更多操作"
          title="更多操作"
          :aria-expanded="open"
          aria-haspopup="menu"
          @click="toggle"
          @keydown.enter.prevent="toggle"
          @keydown.space.prevent="toggle"
        ><WsIcon name="more-horizontal" size="sm" /></button>
        <Transition name="ws-menu">
          <div v-if="menuVisible" class="vta-menu" role="menu">
            <button class="vta-item" role="menuitem" @click="run('ws-open-doc-export')">
              <WsIcon name="print" size="sm" class="vta-icon" /><span class="vta-label">导出文档</span>
            </button>
            <button class="vta-item" role="menuitem" @click="run('ws-open-batch-edit')">
              <WsIcon name="edit" size="sm" class="vta-icon" /><span class="vta-label">批量编辑</span>
            </button>
            <button class="vta-item" role="menuitem" @click="run('ws-open-import-export')">
              <WsIcon name="trade" size="sm" class="vta-icon" /><span class="vta-label">导入/导出</span>
            </button>
            <button class="vta-item" role="menuitem" @click="run('ws-open-template')">
              <WsIcon name="list" size="sm" class="vta-icon" /><span class="vta-label">模板管理</span>
            </button>
            <div class="vta-divider"></div>
            <button class="vta-item vta-item--danger" role="menuitem" @click="run('ws-open-trash')">
              <WsIcon name="trash" size="sm" class="vta-icon" /><span class="vta-label">回收站</span>
            </button>
          </div>
        </Transition>
      </div>
    </div>
    <!-- R4 视图画布 -->
    <div class="view-content">
      <div v-if="!hasView" class="view-empty">
        <WsIcon name="globe" :size="56" class="view-empty-icon" />
        <h2>WorldSmith</h2>
        <p>选择一个视图开始管理你的世界观</p>
      </div>
      <div v-else-if="!viewComp" class="view-empty">
        <p>视图加载中...</p>
      </div>
      <component v-else :is="viewComp" :key="uiStore.currentView + ':' + uiStore.viewRefreshKey" />

      <div
        v-if="jumpBackMenu.show"
        class="vc-ctx-menu"
        :style="{ left: jumpBackMenu.x + 'px', top: jumpBackMenu.y + 'px' }"
      >
        <div class="vc-ctx-item" @click="jumpBackToCustom">↩ 跳回自定义视窗</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, provide, toRef, reactive, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useUIStore, useSettingsStore, usePluginStore } from '@worldsmith/entity-core'
import WsIcon from '../WsIcon.vue'

const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const pluginStore = usePluginStore()
provide('moduleViewId', toRef(uiStore, 'currentView'))

const hasView = computed(() => !!uiStore.currentView)
const viewComp = computed(() => {
  // 优先使用显式设置的 viewComponent
  const comp = uiStore.viewComponent
  if (comp) return comp
  // Fallback: 从 pluginStore 解析
  const viewId = uiStore.currentView
  if (!viewId) return null
  const view = pluginStore.getView(viewId)
  return view?.component ?? null
})

// R3 工具条：当前视图名 + 图标
const currentViewId = computed(() => uiStore.currentView ?? '')
const currentViewLabel = computed(() => pluginStore.getView(currentViewId.value)?.label ?? '')
const currentViewIcon = computed(() => pluginStore.getView(currentViewId.value)?.icon ?? '')

// R3 工具条瘦身：⋯ 更多菜单（方案 A，2026-08-10）
// hover 展开 / 点击固定（pin），点外部或 Esc 关闭；菜单项经全局事件分发到 Shell 各处理器
const open = ref(false)
const hovering = ref(false)
const moreRef = ref<HTMLElement | null>(null)
const menuVisible = computed(() => open.value || hovering.value)

function onEnter() { hovering.value = true }
function onLeave() { hovering.value = false }
function toggle() { open.value = !open.value }
function close() { open.value = false; hovering.value = false }
function run(eventName: string) { close(); window.dispatchEvent(new CustomEvent(eventName)) }
function onDocClick(e: MouseEvent) {
  if (moreRef.value && !moreRef.value.contains(e.target as Node)) close()
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey)
})

// 确保 viewComponent 始终与 currentView 同步
watch(() => uiStore.currentView, (viewId) => {
  if (viewId && !uiStore.viewComponent) {
    const view = pluginStore.getView(viewId)
    if (view) uiStore.viewComponent = view.component
  }
})

const jumpBackMenu = reactive({ show: false, x: 0, y: 0 })

function onViewContext(e: MouseEvent) {
  if (!uiStore._jumpBackViewId) return
  jumpBackMenu.x = e.clientX
  jumpBackMenu.y = e.clientY
  jumpBackMenu.show = true
  document.addEventListener('click', closeJumpBackMenu, { once: true })
}

function closeJumpBackMenu() {
  jumpBackMenu.show = false
}

function jumpBackToCustom() {
  jumpBackMenu.show = false
  const targetView = uiStore._jumpBackViewId
  if (targetView) {
    uiStore._jumpBackViewId = null
    const v = pluginStore.getView(targetView)
    if (v) uiStore.viewComponent = v.component
    uiStore.setView(targetView)
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('click', closeJumpBackMenu)
})
</script>

<style scoped>
.view-container {
  flex: 1;
  overflow: hidden;
  /* 三区双线：view-toolbar 与 view-content 各自独立圆角块，间留缝隙透出 app 底色 */
  background: var(--bg-app);
  padding: var(--region-gap, 8px);
  gap: var(--region-gap, 8px);
  display: flex;
  flex-direction: column;
  contain: layout style;
  /* 固定最小高度防止空状态→内容切换时的布局偏移 */
  min-height: 0;
  /* 性能优化:Sidebar 脱离 flex 文档流后,用 margin-left 占位 */
  /* margin-left 瞬变(无 transition),仅 1 次 layout(Sidebar width 瞬变独立,不触发 flex 重排) */
  /* 预留 region-gap 缝隙，与侧边栏圆角块形成双线分隔 */
  margin-left: calc(var(--layout-sidebar-width) + var(--region-gap, 8px));
}
.view-container.sidebar-collapsed {
  margin-left: calc(var(--layout-sidebar-collapsed-width) + var(--region-gap, 8px));
}
/* sidebar-right 模式:用 margin-right 占位 */
.view-container.sidebar-right {
  margin-left: 0;
  margin-right: calc(var(--layout-sidebar-width) + var(--region-gap, 8px));
}
.view-container.sidebar-right.sidebar-collapsed {
  margin-right: calc(var(--layout-sidebar-collapsed-width) + var(--region-gap, 8px));
}
/* ── R3 视图工具条（独立圆角块，与视图内容留缝隙形成双线分隔） ── */
.view-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  height: 44px;
  padding: 0 8px 0 12px;
  background: var(--region-bg, var(--bg-surface));
  border: 1px solid var(--region-border, var(--border));
  border-radius: var(--region-radius, var(--radius-md));
}
.vt-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.vt-icon {
  color: var(--text-secondary);
}
.vt-crumb {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* ── 视图控件区：承载 Teleport 上移的视图内控件（搜索/筛选/新建） ── */
.vt-controls {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
}
/* Teleport 上移的工具条撑满控件区，使内部 spacer / margin-left:auto 能正确推送到最右 */
.vt-controls :deep(> *) {
  flex: 1 1 auto;
  min-width: 0;
}
/* ── ⋯ 更多菜单（R3 通用操作承载，方案 A） ── */
.vta {
  position: relative;
}
.vta-btn {
  width: 28px;
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
.vta-btn:hover,
.vta-btn--pinned {
  background: var(--hover-bg);
  color: var(--text-color);
}
.vta-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  padding: 4px;
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-dropdown);
  z-index: 300;
}
.vta-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  font-size: var(--font-size-sm);
  color: var(--text-color);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
}
.vta-item:hover {
  background: var(--hover-bg);
}
.vta-item--danger {
  color: var(--danger);
}
.vta-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
}
.vta-item--danger .vta-icon {
  color: var(--danger);
}
.vta-label {
  line-height: 1;
}
.vta-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--border-color);
}
.ws-menu-enter-active,
.ws-menu-leave-active {
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}
.ws-menu-enter-from,
.ws-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
/* ── R4 视图画布（独立圆角块） ── */
.view-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
  background: var(--region-bg, var(--bg-surface));
  border: 1px solid var(--region-border, var(--border));
  border-radius: var(--region-radius, var(--radius-md));
}
.view-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  /* 防止空状态→视图切换时的布局偏移 */
  min-height: 300px;
}
.view-empty-icon {
  font-size: var(--icon-2xl);
  margin-bottom: 16px;
  opacity: 0.5;
}
.view-empty h2 {
  margin: 0 0 8px;
  font-size: var(--font-size-2xl);
  background: var(--gradient-accent);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.view-empty p {
  margin: 0;
  font-size: var(--font-size-base);
}

.vc-ctx-menu {
  position: fixed;
  z-index: 200;
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 4px 0;
  min-width: 160px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}
.vc-ctx-item {
  padding: 7px 14px;
  font-size: var(--font-size-sm);
  cursor: pointer;
  color: var(--text-color);
  display: flex;
  align-items: center;
  gap: 6px;
}
.vc-ctx-item:hover {
  background: var(--hover-bg);
}
</style>
