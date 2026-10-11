<template>
  <div
    class="view-container"
    :class="{ 'sidebar-collapsed': uiStore.sidebarCollapsed, 'sidebar-right': settingsStore.sidebarPosition === 'right' }"
    @contextmenu.prevent="onViewContext"
  >
    <!-- R3 视图工具条（随流首子元素，2026-08-10）：占位 44px 不悬浮；两壳 v-show 常驻
         保证 ViewContainer 永不卸载，Teleport 目标 #view-toolbar-* 常驻，根治壳切换崩溃 -->
    <ViewToolbar />
    <!-- R4 视图画布（独立圆角块，随流位于工具条下方） -->
    <div class="view-content">
      <div v-if="!hasView" class="view-empty">
        <WsIcon name="globe" :size="56" class="view-empty-icon" />
        <h2>WorldSea</h2>
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
import { computed, provide, toRef, reactive, onBeforeUnmount, watch } from 'vue'
import { useUIStore, useSettingsStore, usePluginStore } from '@worldsea/entity-core'
import WsIcon from '../WsIcon.vue'
import ViewToolbar from './ViewToolbar.vue'

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
  /* overlay 模式（悬浮胶囊）以本容器为定位上下文 */
  position: relative;
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
/* ── R4 视图画布（独立圆角块，随流位于工具条下方，间隙由 view-container gap 提供） ── */
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
