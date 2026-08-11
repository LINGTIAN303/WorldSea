<template>
  <div
    class="dashboard-view"
    @dragover.prevent="onExternalDragOver"
    @dragleave="onExternalDragLeave"
    @drop="onExternalDrop"
    :class="{ 'dash-drop-target': isExternalDragOver }"
  >
    <!-- Dashboard 工具栏由 DashboardToolbar 内部按类型分发到 R3 工具条各落点 -->
    <DashboardToolbar
      v-model="direction"
      :options="directionOptions"
      @add="handleAddPanel"
    />

    <WsEmpty
      v-if="panels.length === 0"
      preset="no-data"
      description="还没有面板，点击上方按钮开始拼装你的工作台"
    />

    <TransitionGroup
      v-else
      :ref="setLayoutRef"
      tag="div"
      name="panel-move"
      :class="layoutClasses"
      :style="layoutStyle"
    >
      <div
        v-for="(panel, idx) in panels"
        :key="panel.id"
        class="cv-panel"
        :class="{ 'cv-panel-drag-over': dragOverIdx === idx }"
        :style="panelStyle(idx)"
        draggable="true"
        @dragstart="onDragStart(idx, $event)"
        @dragover.prevent="onDragOver(idx)"
        @dragleave="onDragLeave(idx)"
        @drop="onDrop(idx)"
        @dragend="onDragEnd"
      >
        <div class="cv-panel-header" @contextmenu.prevent="onPanelHeaderContext($event, panel, idx)">
          <span class="panel-icon"><WsIcon :name="panel.icon" size="xs" :fallback="panel.icon" /></span>
          <span class="panel-title">{{ panel.label }}</span>
          <div class="panel-actions">
            <button class="panel-btn" @click="movePanel(idx, -1)" :disabled="idx === 0" title="前移" aria-label="前移"><WsIcon name="arrow-up" size="xs" /></button>
            <button class="panel-btn" @click="movePanel(idx, 1)" :disabled="idx === panels.length - 1" title="后移" aria-label="后移"><WsIcon name="chevron-right" size="xs" /></button>
            <button class="panel-btn panel-close" @click="removePanel(idx)" title="移除" aria-label="移除面板"><WsIcon name="close" size="xs" /></button>
          </div>
        </div>
        <div class="cv-panel-content">
          <template v-if="mounted.has(panel.id)">
            <PanelWrapper :view-id="panel.viewId">
              <component :is="getViewComp(panel.viewId)" />
            </PanelWrapper>
          </template>
          <div v-else class="panel-placeholder">加载中...</div>
        </div>
        <div
          v-if="direction !== 'grid' && idx < panels.length - 1"
          class="cv-resize-handle"
          :class="{ 'cv-resize-handle-col': direction === 'column' }"
          @mousedown.stop="startResize(panel.id, $event)"
        ></div>
        <div
          v-if="direction === 'grid' && gridPositions[idx] && !gridPositions[idx].isLastCol"
          class="cv-grid-resize-col"
          @mousedown.stop="startGridResize('col', gridPositions[idx]!.col, $event)"
        ></div>
        <div
          v-if="direction === 'grid' && gridPositions[idx] && !gridPositions[idx].isLastRow"
          class="cv-grid-resize-row"
          @mousedown.stop="startGridResize('row', gridPositions[idx]!.row, $event)"
        ></div>
        <div
          v-if="direction === 'grid' && gridPositions[idx] && !gridPositions[idx].isLastCol && !gridPositions[idx].isLastRow"
          class="cv-grid-cross"
          @mousedown.stop="startGridCrossResize(gridPositions[idx]!.col, gridPositions[idx]!.row, $event)"
        ></div>
      </div>
    </TransitionGroup>

    <AddPanelModal
      :show="showAddPanel"
      :views="availableViews"
      @close="showAddPanel = false"
      @confirm="addSelectedPanels"
    />

    <PanelContextMenu
      :show="panelCtxMenu.show"
      :x="panelCtxMenu.x"
      :y="panelCtxMenu.y"
      @jump="jumpToMainView"
      @move="movePanelCtx"
      @remove="removePanelCtx"
      @action="closeCtxMenu"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, shallowRef, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { WsEmpty } from '@worldsmith/ui-kit'
import { usePluginStore } from '@worldsmith/entity-core'
import { useUIStore } from '@/stores/uiStore'
import { toastWarn } from '@worldsmith/ui-kit'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Component } from 'vue'
import type { Panel, LayoutDirection } from './dashboard/types'
import { useDashboardStorage } from './dashboard/useDashboardStorage'
import { useGridLayout } from './dashboard/useGridLayout'
import { usePanelResize } from './dashboard/usePanelResize'
import { usePanelDragSort } from './dashboard/usePanelDragSort'
import DashboardToolbar from './dashboard/DashboardToolbar.vue'
import PanelWrapper from './dashboard/PanelWrapper.vue'
import AddPanelModal from './dashboard/AddPanelModal.vue'
import PanelContextMenu from './dashboard/PanelContextMenu.vue'

const pluginStore = usePluginStore()
const settingsStore = useSettingsStore()
const uiStore = useUIStore()

// ===== 核心状态 =====
const panels = ref<Panel[]>([])
const direction = ref<LayoutDirection>('row')
const directionOptions = [
  { value: 'row', label: '水平排列' },
  { value: 'column', label: '垂直排列' },
  { value: 'grid', label: '网格' }
]
const showAddPanel = ref(false)
const isExternalDragOver = ref(false)
const panelCtxMenu = ref({ show: false, x: 0, y: 0, panelViewId: '', panelIdx: -1 })
const mounted = shallowRef(new Set<string>())
const layoutRef = ref<HTMLElement | null>(null)

const gridCols = ref<number[]>([])
const gridRows = ref<number[]>([])

// ===== Composables 组合 =====
const {
  loadPanels, savePanels, loadDirection, saveLayout, loadGridTemplate, saveGridTemplate
} = useDashboardStorage(panels, direction, gridCols, gridRows)

const { gridPositions, gridStyle, ensureGridTemplate } = useGridLayout(
  panels, direction, gridCols, gridRows
)

const { startResize, startGridResize, startGridCrossResize, cleanup: cleanupResize } = usePanelResize(
  panels, direction, gridCols, gridRows, layoutRef, savePanels, saveGridTemplate
)

const {
  dragOverIdx, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd
} = usePanelDragSort(panels, savePanels)

// ===== 布局计算 =====
const layoutClasses = computed(() => ({
  'cv-layout': true,
  'cv-layout-col': direction.value === 'column',
  'cv-layout-grid': direction.value === 'grid'
}))

const layoutStyle = computed(() => {
  return direction.value === 'grid' ? gridStyle.value : {}
})

function panelStyle(idx: number) {
  if (direction.value === 'grid') return {}
  return { flexBasis: panels.value[idx].width + '%' }
}

function setLayoutRef(el: unknown) {
  if (el && (el as { $el?: HTMLElement }).$el) {
    layoutRef.value = (el as { $el: HTMLElement }).$el
  } else if (el instanceof HTMLElement) {
    layoutRef.value = el
  } else {
    layoutRef.value = null
  }
}

// ===== 生命周期 =====
onMounted(() => {
  panels.value = loadPanels()
  direction.value = loadDirection()
  loadGridTemplate()
  if (direction.value === 'grid') {
    ensureGridTemplate()
  }
  panels.value.forEach((p, i) => {
    setTimeout(() => {
      mounted.value = new Set([...mounted.value, p.id])
    }, i * 150)
  })
})

onBeforeUnmount(() => {
  cleanupResize()
})

watch(direction, (val) => {
  if (val === 'grid') {
    ensureGridTemplate()
    saveGridTemplate()
  }
  saveLayout()
})

watch(() => panels.value.length, () => {
  if (direction.value === 'grid') {
    ensureGridTemplate()
    saveGridTemplate()
  }
})

// ===== 视图组件获取 =====
function getViewComp(viewId: string): Component | null {
  return pluginStore.getView(viewId)?.component || null
}

const availableViews = computed(() => {
  const existing = new Set(panels.value.map(p => p.viewId))
  return pluginStore.views.filter(v => !existing.has(v.id) && v.id !== 'custom')
})

// ===== 添加面板 =====
async function handleAddPanel() {
  const newCount = panels.value.length + 1
  if (settingsStore.panelLimitEnabled) {
    if (newCount > 11) {
      toastWarn('面板数量已达上限，可在设置中调整')
      return
    }
    if (newCount > 9) {
      toastWarn('面板数量较多可能影响显示效果，上限可在设置中调整')
    }
  }
  showAddPanel.value = true
}

function addPanel(view: { id: string; icon: string; label: string }) {
  const pid = `panel-${Date.now()}`
  const width = panels.value.length === 0 ? 100 : Math.max(20, 100 / (panels.value.length + 1))
  if (panels.value.length > 0) {
    redistributeWidth(width)
  }
  panels.value.push({ id: pid, viewId: view.id, icon: view.icon, label: view.label, width })
  savePanels()
  saveGridTemplate()
  showAddPanel.value = false
  setTimeout(() => {
    mounted.value = new Set([...mounted.value, pid])
  }, 100)
}

function addSelectedPanels(viewIds: string[]) {
  const views = pluginStore.views.filter(v => viewIds.includes(v.id))
  for (const view of views) {
    const pid = `panel-${Date.now()}-${view.id}`
    const width = panels.value.length === 0 ? 100 : Math.max(20, 100 / (panels.value.length + 1))
    if (panels.value.length > 0) {
      redistributeWidth(width)
    }
    panels.value.push({ id: pid, viewId: view.id, icon: view.icon, label: view.label, width })
    setTimeout(() => {
      mounted.value = new Set([...mounted.value, pid])
    }, 100)
  }
  savePanels()
  saveGridTemplate()
  showAddPanel.value = false
}

function redistributeWidth(newPanelWidth: number) {
  const total = panels.value.reduce((s, p) => s + p.width, 0)
  const scale = (100 - newPanelWidth) / total
  panels.value.forEach(p => {
    p.width = Math.max(10, p.width * scale)
  })
}

// ===== 外部拖拽（从视图列表拖入） =====
function onExternalDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('application/worldsmith-view-id')) {
    isExternalDragOver.value = true
    e.dataTransfer.dropEffect = 'copy'
  }
}

function onExternalDragLeave() {
  isExternalDragOver.value = false
}

function onExternalDrop(e: DragEvent) {
  isExternalDragOver.value = false
  const viewId = e.dataTransfer?.getData('application/worldsmith-view-id')
  if (!viewId) return
  const viewLabel = e.dataTransfer!.getData('application/worldsmith-view-label') || viewId
  const viewIcon = e.dataTransfer!.getData('application/worldsmith-view-icon') || 'outline'
  if (panels.value.some(p => p.viewId === viewId)) {
    toastWarn('该视图已在面板中')
    return
  }
  addPanel({ id: viewId, icon: viewIcon, label: viewLabel })
}

// ===== 面板右键菜单 =====
function onPanelHeaderContext(e: MouseEvent, panel: Panel, idx: number) {
  panelCtxMenu.value = {
    show: true,
    x: e.clientX,
    y: e.clientY,
    panelViewId: panel.viewId,
    panelIdx: idx
  }
  document.addEventListener('click', closeCtxMenu, { once: true })
}

function closeCtxMenu() {
  panelCtxMenu.value.show = false
}

function jumpToMainView() {
  const viewId = panelCtxMenu.value.panelViewId
  const view = pluginStore.getView(viewId)
  if (view) {
    uiStore.viewComponent = view.component
    uiStore.setView(viewId)
    uiStore._jumpBackViewId = 'custom'
  }
}

function movePanelCtx(dir: number) {
  movePanel(panelCtxMenu.value.panelIdx, dir)
}

function removePanelCtx() {
  removePanel(panelCtxMenu.value.panelIdx)
}

// ===== 面板操作 =====
function removePanel(idx: number) {
  const pid = panels.value[idx].id
  const removedWidth = panels.value[idx].width
  panels.value.splice(idx, 1)
  if (panels.value.length > 0) {
    const total = panels.value.reduce((s, p) => s + p.width, 0)
    const scale = (total + removedWidth) / total
    panels.value.forEach(p => {
      p.width = Math.min(80, p.width * scale)
    })
  }
  const s = new Set(mounted.value)
  s.delete(pid)
  mounted.value = s
  savePanels()
  saveGridTemplate()
}

function movePanel(idx: number, dir: number) {
  const target = idx + dir
  if (target < 0 || target >= panels.value.length) return
  const [item] = panels.value.splice(idx, 1)
  panels.value.splice(target, 0, item)
  savePanels()
}
</script>

<style scoped>
.dashboard-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.btn-sm {
  padding: 6px 14px;
  font-size: var(--font-size-sm);
}

.cv-layout {
  display: flex;
  flex-direction: row;
  gap: 0;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.cv-layout-col {
  flex-direction: column;
}

.cv-layout-grid {
  display: grid;
  gap: 4px;
}

.cv-panel {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  overflow: hidden;
  background: var(--card-bg);
  position: relative;
  min-width: 15%;
  min-height: 100px;
  flex-shrink: 0;
  flex-grow: 0;
  transition: box-shadow 0.15s;
}

.cv-layout-col .cv-panel {
  min-width: unset;
  min-height: 80px;
}

.cv-layout-grid .cv-panel {
  min-width: 0;
  min-height: 0;
  flex-shrink: 1;
  flex-grow: 1;
}

.cv-panel-drag-over {
  box-shadow: 0 0 0 2px var(--primary), 0 0 12px rgba(74, 108, 247, 0.25);
}

.cv-panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-light);
  background: var(--menubar-bg);
  flex-shrink: 0;
  cursor: grab;
  user-select: none;
}

.cv-panel-header:active {
  cursor: grabbing;
}

.panel-icon {
  font-size: var(--font-size-base);
}

.panel-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  flex: 1;
  color: var(--text-color);
}

.panel-actions {
  display: flex;
  gap: 2px;
}

.panel-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-btn:hover {
  background: var(--hover-bg);
}

.panel-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.panel-close {
  color: var(--danger);
}

.cv-panel-content {
  flex: 1;
  overflow: auto;
  position: relative;
  min-height: 0;
}

.panel-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

/* 面板内嵌套的各类视图统一样式覆盖 */
.cv-panel-content :deep(.character-view),
.cv-panel-content :deep(.region-view),
.cv-panel-content :deep(.timeline-view),
.cv-panel-content :deep(.org-view),
.cv-panel-content :deep(.concept-view),
.cv-panel-content :deep(.item-view),
.cv-panel-content :deep(.mindmap-view),
.cv-panel-content :deep(.graph-view),
.cv-panel-content :deep(.custom-view) {
  padding: 8px !important;
  height: auto !important;
  min-height: 100px;
}

.cv-resize-handle {
  position: absolute;
  top: 0;
  right: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: var(--z-sticky);
  background: transparent;
  transition: background 0.15s;
}

.cv-resize-handle:hover,
.cv-resize-handle:active {
  background: var(--primary);
  opacity: 0.3;
}

.cv-resize-handle-col {
  top: auto;
  bottom: -4px;
  left: 0;
  right: auto;
  width: 100%;
  height: 8px;
  cursor: row-resize;
}

.cv-grid-resize-col {
  position: absolute;
  top: 0;
  right: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: var(--z-sticky);
  background: transparent;
  transition: background 0.15s;
}

.cv-grid-resize-col:hover,
.cv-grid-resize-col:active {
  background: var(--primary);
  opacity: 0.3;
}

.cv-grid-resize-row {
  position: absolute;
  bottom: -4px;
  left: 0;
  width: 100%;
  height: 8px;
  cursor: row-resize;
  z-index: var(--z-sticky);
  background: transparent;
  transition: background 0.15s;
}

.cv-grid-resize-row:hover,
.cv-grid-resize-row:active {
  background: var(--primary);
  opacity: 0.3;
}

.cv-grid-cross {
  position: absolute;
  right: -10px;
  bottom: -10px;
  width: 20px;
  height: 20px;
  cursor: move;
  z-index: calc(var(--z-sticky) + 1);
  background: transparent;
  border-radius: 50%;
  transition: background 0.15s;
}

.cv-grid-cross:hover,
.cv-grid-cross:active {
  background: var(--primary);
  opacity: 0.5;
}

.cv-grid-cross::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  background: var(--primary);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  opacity: 0.4;
}

.cv-grid-cross:hover::before {
  opacity: 1;
}

.panel-move-move {
  transition: transform 0.3s ease;
}

.panel-move-enter-active {
  transition: opacity 0.2s ease;
}

.panel-move-leave-active {
  transition: opacity 0.2s ease;
}

.panel-move-enter-from,
.panel-move-leave-to {
  opacity: 0;
}

.dash-drop-target {
  outline: 2px dashed var(--primary);
  outline-offset: -2px;
  background: var(--accent-soft, rgba(74, 108, 247, 0.04));
}
</style>
