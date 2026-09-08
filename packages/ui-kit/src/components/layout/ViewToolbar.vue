<template>
  <!-- R3 视图工具条（2026-08-10 随流常驻 + 模式化）：
       容器始终挂载（不卸载），保证 Teleport 目标 #view-toolbar-* 常驻，根治壳切换崩溃。
       显示形态由视图声明的 toolbar 模式决定（见 ViewToolbarMode）：
         - bar（默认）：随流 44px 占位条
         - none：display:none 完全折叠（目标仍常驻）
         - overlay：position:absolute 悬浮胶囊，不占高度，hover 顶部触发条浮现 -->
  <div
    class="view-toolbar"
    :class="{
      'view-toolbar--hidden': !hasView,
      'view-toolbar--none': toolbarMode === 'none',
      'view-toolbar--overlay': toolbarMode === 'overlay',
      'view-toolbar--visible': toolbarMode === 'overlay' && overlayOpen,
    }"
    @mouseenter="overlayOpen = true"
    @mouseleave="overlayOpen = false"
  >
    <nav class="vt-breadcrumb" aria-label="面包屑">
      <WsIcon v-if="currentViewIcon" :name="currentViewIcon" size="sm" class="vt-icon" />
      <span class="vt-crumb">{{ currentViewLabel }}</span>
    </nav>
    <!-- 搜索框落点：紧跟标题右侧 -->
    <div id="view-toolbar-search" class="vt-search"></div>
    <!-- 筛选收束控件：默认收缩，点击展开 -->
    <ViewToolbarFilter />
    <!-- 弹性空隙：把右侧动作/新建/更多菜单推到最右 -->
    <div class="vt-spacer"></div>
    <!-- 动作类落点：在新建类左侧 -->
    <div id="view-toolbar-actions" class="vt-actions"></div>
    <!-- 新建类落点：紧贴更多菜单左侧 -->
    <div id="view-toolbar-create" class="vt-create"></div>
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
  <!-- overlay 模式的浮现触发条：悬停顶部区域显示悬浮胶囊（bar/none 模式不渲染） -->
  <div
    v-if="toolbarMode === 'overlay'"
    class="vt-overlay-trigger"
    aria-hidden="true"
    @mouseenter="overlayOpen = true"
    @mouseleave="overlayOpen = false"
  ></div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useUIStore, usePluginStore } from '@worldsea/entity-core'
import WsIcon from '../WsIcon.vue'
import ViewToolbarFilter from './ViewToolbarFilter.vue'

// ViewContainer 随流工具条：面包屑 / 筛选 / 搜索 / 动作 / 新建 / 更多菜单。
// 视图组件（GenericEntityView 等）经 Teleport 把各自控件注入 #view-toolbar-*。
const uiStore = useUIStore()
const pluginStore = usePluginStore()

const hasView = computed(() => !!uiStore.currentView)

const currentViewId = computed(() => uiStore.currentView ?? '')
const currentViewLabel = computed(() => pluginStore.getView(currentViewId.value)?.label ?? '')
const currentViewIcon = computed(() => pluginStore.getView(currentViewId.value)?.icon ?? '')

// 视图工具条模式（ViewToolbarMode）：bar 随流 / none 折叠 / overlay 悬浮胶囊。
// 容器始终挂载保证 Teleport 目标常驻，仅显示形态按模式切换。
const toolbarMode = computed<'bar' | 'none' | 'overlay'>(() => pluginStore.getView(currentViewId.value)?.toolbar ?? 'bar')
// overlay 模式：默认隐藏，hover 顶部触发条（或悬浮条本身）时浮现
const overlayOpen = ref(false)

// ⋯ 更多菜单：hover 展开 / 点击固定（pin），点外部或 Esc 关闭
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
  if (e.key === 'Escape') {
    // capture 阶段消费：下拉打开时 Esc 归下拉（抢在注册表 view 层命中消费之前，
    // 否则会被 entity.close 等视图键阻断）；未打开时放行给注册表
    if (open.value) { e.stopPropagation(); close() }
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey, true)
})
</script>

<style scoped>
/* 三区双线：view-toolbar 独立圆角块（随流占位 44px），与 view-content 间留缝隙透出 app 底色 */
.view-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  flex-shrink: 0;
  height: 44px;
  padding: 0 8px 0 12px;
  background: var(--region-bg, var(--bg-surface));
  border: 1px solid var(--region-border, var(--border));
  border-radius: var(--region-radius, var(--radius-md));
}
/* ── 模式：无视图 / none 折叠 ──（容器仍挂载，Teleport 目标 #view-toolbar-* 常驻） */
.view-toolbar--hidden,
.view-toolbar--none {
  display: none;
}
/* ── 模式：overlay 悬浮胶囊 ──
   脱离文档流（position:absolute，以 ViewContainer 为定位上下文），不占高度；
   默认上移隐藏、无指针事件；hover 顶部触发条浮现。背景/阴影使其读作悬浮面板。 */
.view-toolbar--overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  z-index: 60;
  transform: translateY(-120%);
  opacity: 0;
  pointer-events: none;
  box-shadow: var(--shadow-dropdown);
  transition: transform var(--transition-fast), opacity var(--transition-fast);
}
.view-toolbar--overlay.view-toolbar--visible {
  transform: translateY(0);
  opacity: 1;
  pointer-events: auto;
}
/* overlay 浮现触发条：位于画布顶部细条，悬停即浮现悬浮胶囊（bar/none 模式不渲染） */
.vt-overlay-trigger {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  height: 16px;
  z-index: 59;
  cursor: default;
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
/* ── 视图控件落点：搜索/动作/新建，各自横向排列 ── */
.vt-search,
.vt-actions,
.vt-create {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-shrink: 0;
}
/* 弹性空隙：把右侧动作/新建/更多菜单推到最右 */
.vt-spacer {
  flex: 1;
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
</style>
