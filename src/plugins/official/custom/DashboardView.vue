<template>
  <div
    class="dashboard-view"
    @dragover.prevent="onExternalDragOver"
    @dragleave="onExternalDragLeave"
    @drop="onExternalDrop"
    :class="{ 'dash-drop-target': isExternalDragOver }"
  >
    <div class="dash-toolbar">
      <h3><WsIcon name="notepad" size="sm" /> 面板布局</h3>
      <CreateButton label="添加面板" size="small" @click="handleAddPanel" />
      <div class="dash-controls">
        <CustomDropdown v-model="direction" :options="directionOptions" />
      </div>
    </div>

    <WsEmpty v-if="panels.length === 0" preset="no-data" description="还没有面板，点击上方按钮开始拼装你的工作台" />

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
            <button class="panel-btn" @click="movePanel(idx, -1)" :disabled="idx === 0" title="前移"><WsIcon name="arrow-up" size="xs" /></button>
            <button class="panel-btn" @click="movePanel(idx, 1)" :disabled="idx === panels.length - 1" title="后移"><WsIcon name="chevron-right" size="xs" /></button>
            <button class="panel-btn panel-close" @click="removePanel(idx)" title="移除"><WsIcon name="close" size="xs" /></button>
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

    <div v-if="showAddPanel" class="modal-overlay" @click.self="showAddPanel = false">
      <div class="modal modal-sm">
        <h3>选择面板视图</h3>
        <div class="cv-picker-list">
          <button
            v-for="view in availableViews"
            :key="view.id"
            class="view-pick-btn"
            :class="{ 'vp-selected': addPanelSelected.has(view.id) }"
            @click="toggleAddPanelSelect(view)"
          >
            <span class="vp-check"><WsIcon :name="addPanelSelected.has(view.id) ? 'check' : 'checkbox-empty'" size="xs" /></span>
            <span class="vp-icon"><WsIcon :name="view.icon" size="sm" :fallback="view.icon" /></span>
            <span class="vp-label">{{ view.label }}</span>
          </button>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showAddPanel = false">取消</button>
          <CreateButton :label="`添加 (${addPanelSelected.size})`" :disabled="addPanelSelected.size === 0" @click="addSelectedPanels" />
        </div>
      </div>
    </div>

    <div v-if="panelCtxMenu.show" class="cv-ctx-menu" :style="{ left: panelCtxMenu.x + 'px', top: panelCtxMenu.y + 'px' }">
      <div class="cv-ctx-item" role="button" tabindex="0" @click="jumpToMainView" @keydown.enter="jumpToMainView">↗ 跳转到主视图</div>
      <div class="cv-ctx-divider"></div>
      <div class="cv-ctx-item" role="button" tabindex="0" @click="movePanelCtx(-1)" @keydown.enter="movePanelCtx(-1)"><WsIcon name="arrow-up" size="xs" /> 前移</div>
      <div class="cv-ctx-item" role="button" tabindex="0" @click="movePanelCtx(1)" @keydown.enter="movePanelCtx(1)"><WsIcon name="chevron-right" size="xs" /> 后移</div>
      <div class="cv-ctx-divider"></div>
      <div class="cv-ctx-item cv-ctx-danger" role="button" tabindex="0" @click="removePanelCtx" @keydown.enter="removePanelCtx"><WsIcon name="close" size="xs" /> 移除面板</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, shallowRef, provide, defineComponent, watch, reactive } from 'vue'
import WsIcon from '../../../ui/WsIcon.vue'
import WsEmpty from '../../../ui/WsEmpty.vue'
import { usePluginStore } from '@worldsmith/entity-core'
import { useUIStore } from '../../../stores/uiStore'
import { CustomDropdown, CreateButton, toastWarn } from '@worldsmith/ui-kit'
import { useSettingsStore } from '../../../stores/settingsStore'
import type { Component } from 'vue'

const pluginStore = usePluginStore()
const settingsStore = useSettingsStore()
const uiStore = useUIStore()

const STORAGE_KEY = 'worldsmith_dashboard'

interface Panel {
  id: string
  viewId: string
  icon: string
  label: string
  width: number
}

const panels = ref<Panel[]>([])
const direction = ref<'row' | 'column' | 'grid'>('row')
const directionOptions = [
  { value: 'row', label: '水平排列' },
  { value: 'column', label: '垂直排列' },
  { value: 'grid', label: '网格' }
]
const showAddPanel = ref(false)
const addPanelSelected = reactive(new Set<string>())
const isExternalDragOver = ref(false)
const panelCtxMenu = reactive({ show: false, x: 0, y: 0, panelViewId: '', panelIdx: -1 })
const mounted = shallowRef(new Set<string>())
const layoutRef = ref<HTMLElement | null>(null)

const gridCols = ref<number[]>([])
const gridRows = ref<number[]>([])

let resizingPanelId: string | null = null
let resizeStartX = 0
let resizeStartY = 0
let resizeStartWidth = 0
let resizeNeighborWidth = 0
let resizeNeighborId: string | null = null

let gridResizingType: 'col' | 'row' | 'cross' | null = null
let gridResizingIdx = -1
let gridResizeStartPos = 0
let gridResizeStartValue = 0
let gridResizeNeighborValue = 0
let gridCrossStartX = 0
let gridCrossStartY = 0
let gridCrossColIdx = -1
let gridCrossRowIdx = -1
let gridCrossColStart = 0
let gridCrossColNeighbor = 0
let gridCrossRowStart = 0
let gridCrossRowNeighbor = 0

let dragFromIdx = -1
const dragOverIdx = ref(-1)

function getGridDims(count: number): { rows: number; cols: number } {
  if (count <= 1) return { rows: 1, cols: 1 }
  if (count === 2) return { rows: 1, cols: 2 }
  if (count === 3) return { rows: 1, cols: 3 }
  if (count === 4) return { rows: 2, cols: 2 }
  if (count <= 6) return { rows: 2, cols: 3 }
  if (count <= 8) return { rows: 2, cols: 4 }
  return { rows: 3, cols: 3 }
}

const gridPositions = computed(() => {
  if (direction.value !== 'grid') return []
  const dims = getGridDims(panels.value.length)
  return panels.value.map((_, idx) => ({
    col: idx % dims.cols,
    row: Math.floor(idx / dims.cols),
    isLastCol: (idx % dims.cols) === dims.cols - 1,
    isLastRow: Math.floor(idx / dims.cols) === dims.rows - 1
  }))
})

function ensureGridTemplate() {
  const dims = getGridDims(panels.value.length)
  if (gridCols.value.length !== dims.cols) {
    gridCols.value = Array(dims.cols).fill(+(100 / dims.cols).toFixed(2))
  }
  if (gridRows.value.length !== dims.rows) {
    gridRows.value = Array(dims.rows).fill(+(100 / dims.rows).toFixed(2))
  }
}

const gridStyle = computed(() => {
  if (direction.value !== 'grid' || panels.value.length === 0) return {}
  const dims = getGridDims(panels.value.length)
  const cols = gridCols.value.length === dims.cols
    ? gridCols.value.map(v => v + '%').join(' ')
    : Array(dims.cols).fill(+(100 / dims.cols).toFixed(2) + '%').join(' ')
  const rows = gridRows.value.length === dims.rows
    ? gridRows.value.map(v => v + '%').join(' ')
    : Array(dims.rows).fill(+(100 / dims.rows).toFixed(2) + '%').join(' ')
  return { gridTemplateColumns: cols, gridTemplateRows: rows }
})

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

function setLayoutRef(el: any) {
  if (el && el.$el) {
    layoutRef.value = el.$el as HTMLElement
  } else if (el instanceof HTMLElement) {
    layoutRef.value = el
  } else {
    layoutRef.value = null
  }
}

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
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
  document.removeEventListener('mousemove', onGridResize)
  document.removeEventListener('mouseup', stopGridResize)
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

function loadPanels(): Panel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function savePanels() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(panels.value))
}

function loadDirection(): 'row' | 'column' | 'grid' {
  try {
    const val = localStorage.getItem(STORAGE_KEY + '_dir')
    if (val === 'row' || val === 'column' || val === 'grid') return val
    return 'row'
  } catch { return 'row' }
}

function saveLayout() {
  localStorage.setItem(STORAGE_KEY + '_dir', direction.value)
}

function loadGridTemplate() {
  try {
    const colsRaw = localStorage.getItem(STORAGE_KEY + '_gcols')
    const rowsRaw = localStorage.getItem(STORAGE_KEY + '_grows')
    gridCols.value = colsRaw ? JSON.parse(colsRaw) : []
    gridRows.value = rowsRaw ? JSON.parse(rowsRaw) : []
  } catch {
    gridCols.value = []
    gridRows.value = []
  }
}

function saveGridTemplate() {
  localStorage.setItem(STORAGE_KEY + '_gcols', JSON.stringify(gridCols.value))
  localStorage.setItem(STORAGE_KEY + '_grows', JSON.stringify(gridRows.value))
}

function getViewComp(viewId: string): Component | null {
  return pluginStore.getView(viewId)?.component || null
}

const availableViews = computed(() => {
  const existing = new Set(panels.value.map(p => p.viewId))
  return pluginStore.views.filter(v => !existing.has(v.id) && v.id !== 'custom')
})

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
  addPanelSelected.clear()
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

function toggleAddPanelSelect(view: { id: string; icon: string; label: string }) {
  if (addPanelSelected.has(view.id)) {
    addPanelSelected.delete(view.id)
  } else {
    addPanelSelected.add(view.id)
  }
}

function addSelectedPanels() {
  const views = pluginStore.views.filter(v => addPanelSelected.has(v.id))
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
  addPanelSelected.clear()
}

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

function onPanelHeaderContext(e: MouseEvent, panel: Panel, idx: number) {
  panelCtxMenu.x = e.clientX
  panelCtxMenu.y = e.clientY
  panelCtxMenu.panelViewId = panel.viewId
  panelCtxMenu.panelIdx = idx
  panelCtxMenu.show = true
  document.addEventListener('click', closeCtxMenu, { once: true })
}

function closeCtxMenu() {
  panelCtxMenu.show = false
}

function jumpToMainView() {
  panelCtxMenu.show = false
  const viewId = panelCtxMenu.panelViewId
  const view = pluginStore.getView(viewId)
  if (view) {
    uiStore.viewComponent = view.component
    uiStore.setView(viewId)
    uiStore._jumpBackViewId = 'custom'
  }
}

function movePanelCtx(dir: number) {
  panelCtxMenu.show = false
  movePanel(panelCtxMenu.panelIdx, dir)
}

function removePanelCtx() {
  panelCtxMenu.show = false
  removePanel(panelCtxMenu.panelIdx)
}

function redistributeWidth(newPanelWidth: number) {
  const total = panels.value.reduce((s, p) => s + p.width, 0)
  const scale = (100 - newPanelWidth) / total
  panels.value.forEach(p => {
    p.width = Math.max(10, p.width * scale)
  })
}

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

function startResize(panelId: string, e: MouseEvent) {
  e.preventDefault()
  resizingPanelId = panelId
  resizeStartX = e.clientX
  resizeStartY = e.clientY
  const panelIdx = panels.value.findIndex(p => p.id === panelId)
  const panel = panels.value[panelIdx]
  resizeStartWidth = panel?.width || 50
  if (panelIdx < panels.value.length - 1) {
    resizeNeighborId = panels.value[panelIdx + 1].id
    resizeNeighborWidth = panels.value[panelIdx + 1].width
  } else {
    resizeNeighborId = null
    resizeNeighborWidth = 0
  }
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

function onResize(e: MouseEvent) {
  if (!resizingPanelId) return
  const container = layoutRef.value
  if (!container) return
  const isHorizontal = direction.value === 'row'
  const containerSize = isHorizontal ? container.clientWidth : container.clientHeight
  const delta = isHorizontal
    ? ((e.clientX - resizeStartX) / containerSize) * 100
    : ((e.clientY - resizeStartY) / containerSize) * 100

  const panel = panels.value.find(p => p.id === resizingPanelId)
  if (panel) {
    const newWidth = Math.max(15, Math.min(85, resizeStartWidth + delta))
    const actualDelta = newWidth - resizeStartWidth
    panel.width = newWidth

    if (resizeNeighborId) {
      const neighbor = panels.value.find(p => p.id === resizeNeighborId)
      if (neighbor) {
        neighbor.width = Math.max(15, resizeNeighborWidth - actualDelta)
      }
    }
  }
}

function stopResize() {
  resizingPanelId = null
  resizeNeighborId = null
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
  savePanels()
}

function startGridResize(type: 'col' | 'row', idx: number, e: MouseEvent) {
  e.preventDefault()
  gridResizingType = type
  gridResizingIdx = idx
  if (type === 'col') {
    gridResizeStartPos = e.clientX
    gridResizeStartValue = gridCols.value[idx]
    gridResizeNeighborValue = gridCols.value[idx + 1]
  } else {
    gridResizeStartPos = e.clientY
    gridResizeStartValue = gridRows.value[idx]
    gridResizeNeighborValue = gridRows.value[idx + 1]
  }
  document.addEventListener('mousemove', onGridResize)
  document.addEventListener('mouseup', stopGridResize)
}

function startGridCrossResize(colIdx: number, rowIdx: number, e: MouseEvent) {
  e.preventDefault()
  gridResizingType = 'cross'
  gridCrossStartX = e.clientX
  gridCrossStartY = e.clientY
  gridCrossColIdx = colIdx
  gridCrossRowIdx = rowIdx
  gridCrossColStart = gridCols.value[colIdx]
  gridCrossColNeighbor = gridCols.value[colIdx + 1]
  gridCrossRowStart = gridRows.value[rowIdx]
  gridCrossRowNeighbor = gridRows.value[rowIdx + 1]
  document.addEventListener('mousemove', onGridResize)
  document.addEventListener('mouseup', stopGridResize)
}

function onGridResize(e: MouseEvent) {
  if (!gridResizingType) return
  const container = layoutRef.value
  if (!container) return
  if (gridResizingType === 'col') {
    const delta = ((e.clientX - gridResizeStartPos) / container.clientWidth) * 100
    const newVal = Math.max(10, gridResizeStartValue + delta)
    const actualDelta = newVal - gridResizeStartValue
    gridCols.value[gridResizingIdx] = newVal
    gridCols.value[gridResizingIdx + 1] = Math.max(10, gridResizeNeighborValue - actualDelta)
  } else if (gridResizingType === 'row') {
    const delta = ((e.clientY - gridResizeStartPos) / container.clientHeight) * 100
    const newVal = Math.max(10, gridResizeStartValue + delta)
    const actualDelta = newVal - gridResizeStartValue
    gridRows.value[gridResizingIdx] = newVal
    gridRows.value[gridResizingIdx + 1] = Math.max(10, gridResizeNeighborValue - actualDelta)
  } else if (gridResizingType === 'cross') {
    const dx = ((e.clientX - gridCrossStartX) / container.clientWidth) * 100
    const dy = ((e.clientY - gridCrossStartY) / container.clientHeight) * 100
    const newColVal = Math.max(10, gridCrossColStart + dx)
    const colDelta = newColVal - gridCrossColStart
    gridCols.value[gridCrossColIdx] = newColVal
    gridCols.value[gridCrossColIdx + 1] = Math.max(10, gridCrossColNeighbor - colDelta)
    const newRowVal = Math.max(10, gridCrossRowStart + dy)
    const rowDelta = newRowVal - gridCrossRowStart
    gridRows.value[gridCrossRowIdx] = newRowVal
    gridRows.value[gridCrossRowIdx + 1] = Math.max(10, gridCrossRowNeighbor - rowDelta)
  }
}

function stopGridResize() {
  gridResizingType = null
  gridResizingIdx = -1
  document.removeEventListener('mousemove', onGridResize)
  document.removeEventListener('mouseup', stopGridResize)
  saveGridTemplate()
}

function onDragStart(idx: number, e: DragEvent) {
  dragFromIdx = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
}

function onDragOver(idx: number) {
  if (dragFromIdx !== -1 && dragFromIdx !== idx) {
    dragOverIdx.value = idx
  }
}

function onDragLeave(_idx: number) {
  if (dragOverIdx.value === _idx) {
    dragOverIdx.value = -1
  }
}

function onDrop(idx: number) {
  if (dragFromIdx !== -1 && dragFromIdx !== idx) {
    const [item] = panels.value.splice(dragFromIdx, 1)
    panels.value.splice(idx, 0, item)
    savePanels()
  }
  dragFromIdx = -1
  dragOverIdx.value = -1
}

function onDragEnd() {
  dragFromIdx = -1
  dragOverIdx.value = -1
}

const PanelWrapper = defineComponent({
  props: { viewId: String },
  setup(props, { slots }) {
    provide('moduleViewId', computed(() => props.viewId || ''))
    return () => slots.default ? slots.default() : null
  }
})
</script>

<style scoped>
.dashboard-view { display: flex; flex-direction: column; height: 100%; }
.dash-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-shrink: 0; flex-wrap: wrap; }
.dash-toolbar h3 { margin: 0; }
.btn-sm { padding: 6px 14px; font-size: var(--font-size-sm); }
.dash-controls { margin-left: auto; }
.dash-controls label { font-size: var(--font-size-sm); color: var(--text-tertiary); display: flex; align-items: center; gap: 4px; }
.dash-controls select { padding: 4px 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-sm); }

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
  border-radius: 8px;
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

.panel-icon { font-size: var(--font-size-base); }
.panel-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); flex: 1; color: var(--text-color); }
.panel-actions { display: flex; gap: 2px; }
.panel-btn { width: 22px; height: 22px; border: none; background: transparent; cursor: pointer; border-radius: 4px; font-size: var(--font-size-xs); color: var(--text-secondary); display: flex; align-items: center; justify-content: center; }
.panel-btn:hover { background: var(--hover-bg); }
.panel-btn:disabled { opacity: 0.3; cursor: default; }
.panel-close { color: var(--danger); }

.cv-panel-content {
  flex: 1;
  overflow: auto;
  position: relative;
  min-height: 0;
}

.panel-placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); font-size: var(--font-size-sm); }

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

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: var(--z-sticky); }
.modal-sm { background: var(--modal-bg); border-radius: 12px; padding: 20px; max-width: 360px; width: 90%; display: flex; flex-direction: column; max-height: 85vh; }
.modal-sm h3 { margin: 0 0 12px; font-size: var(--font-size-lg); flex-shrink: 0; }

.cv-picker-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 60vh;
  overflow-y: auto;
  min-height: 0;
  flex: 1;
  padding-right: 4px;
}

.view-pick-btn { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--border-color); background: var(--card-bg); border-radius: 6px; cursor: pointer; font-size: var(--font-size-base); color: var(--text-color); flex-shrink: 0; }
.view-pick-btn:hover { background: var(--active-bg); border-color: var(--primary); }
.vp-icon { font-size: var(--font-size-xl); }
.vp-label { font-weight: var(--font-weight-medium); }
.modal-actions { margin-top: 12px; display: flex; justify-content: flex-end; flex-shrink: 0; }

.dash-drop-target {
  outline: 2px dashed var(--primary);
  outline-offset: -2px;
  background: rgba(74, 108, 247, 0.04);
}

.vp-selected {
  border-color: var(--primary) !important;
  background: var(--active-bg) !important;
}
.vp-check {
  font-size: var(--font-size-base);
  width: 18px;
  text-align: center;
  flex-shrink: 0;
  color: var(--primary);
}

.cv-ctx-menu {
  position: fixed;
  z-index: var(--z-sticky);
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 4px 0;
  min-width: 160px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}
.cv-ctx-item {
  padding: 7px 14px;
  font-size: var(--font-size-sm);
  cursor: pointer;
  color: var(--text-color);
  display: flex;
  align-items: center;
  gap: 6px;
}
.cv-ctx-item:hover {
  background: var(--hover-bg);
}
.cv-ctx-divider {
  height: 1px;
  background: var(--border-light);
  margin: 4px 0;
}
.cv-ctx-danger {
  color: var(--danger);
}
.cv-ctx-danger:hover {
  background: rgba(220, 53, 69, 0.08);
}
</style>
