<template>
  <!--
    大纲白板视图（BoardView）—— 两层导航：列表层 ↔ 编辑器层
    规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md（壳）
    装配：docs/plans/2026-09-16-大纲白板-施工分解.md §1.2
    · 视图只有一个：`outline-board`（同芽的树视图是另一个视图，二者并存）
    · 工具条控件 Teleport 到视图工具条落点（与 manuscript/drawing 等芽一致）
    · 根元素必须是 flex 列容器 + height:100%（项目视图宿主要求；否则画布/空态高度为 0）
  -->
  <div class="board-view">
  <Teleport to="#view-toolbar-create">
    <CreateButton v-if="!inEditor" label="新建白板" @click="onCreate" />
  </Teleport>

  <Teleport to="#view-toolbar-actions">
    <template v-if="inEditor">
      <button class="bv-tb" type="button" title="返回白板列表" @click="onBack">
        <WsIcon name="arrow-left" size="xs" />
      </button>
      <span class="bv-tb-title">{{ currentBoard?.name || '白板' }}</span>
      <span class="bv-save" :class="saveClass">{{ saveText }}</span>
      <span class="bv-sep" />
      <button class="bv-tb" type="button" :disabled="!canUndo" title="撤销 (Ctrl+Z)" @click="onUndo">撤销</button>
      <button class="bv-tb" type="button" :disabled="!canRedo" title="重做 (Ctrl+Shift+Z)" @click="onRedo">重做</button>
      <span class="bv-sep" />
      <button class="bv-tb" type="button" title="缩小" @click="zoomBy(-1)">－</button>
      <span class="bv-zoom">{{ zoomPercent }}%</span>
      <button class="bv-tb" type="button" title="放大" @click="zoomBy(1)">＋</button>
      <button class="bv-tb" type="button" title="适配全部 (Shift+1)" @click="fitAll">适配</button>
    </template>
    <span v-else class="bv-count">共 {{ boards.length }} 块白板</span>
  </Teleport>

  <!-- 层 1：白板列表 -->
  <BoardListView
    v-if="!inEditor"
    :boards="boards"
    :container-count="containerCount"
    @open="openBoard"
    @rename="onRename"
    @remove="onRemoveBoard"
  />

  <!-- 层 2：编辑器（画布 + 右栏节点侧栏） -->
  <div v-else class="bv-editor">
    <BoardCanvas
      ref="canvasRef"
      :layout="layout"
      :viewport="viewport"
      :nodes-by-id="nodesById"
      :selected-id="selection.selectedId.value"
      :snap-mode="snapMode"
      @select="onCanvasSelect"
      @move-container="onMoveContainer"
      @toggle-collapse="onToggleCollapse"
      @remove-container="onRemoveContainer"
      @add-component="onAddComponent"
      @create-node-at="onCreateNodeAt"
      @drop-node="onDropNode"
      @viewport-change="onViewportChange"
      @interaction-start="onInteractionStart"
    />
    <NodeSidebar
      :nodes="outlineNodes"
      :placed-ids="placedIds"
      :collapsed="sidebarCollapsed"
      @toggle-collapse="sidebarCollapsed = !sidebarCollapsed"
      @add="onSidebarAdd"
      @locate="onLocate"
      @reparent="onReparent"
    />
  </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 装配层：把 composables 与组件接起来，并作为**唯一**的数据变更入口。
 * 所有写操作都遵循同一顺序：record()（撤销快照）→ 调 useBoardLayout 的原子操作 → 自动保存。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
// 芽视图里的 UI 组件必须显式导入：它们**不是全局组件**，未导入时 vue-tsc 不报错、
// 只在渲染时静默变成空节点（2026-09-16 真机走查踩坑）
import { CreateButton } from '@worldsea/plugin-sdk'
import { WsIcon } from '@worldsea/ui-kit'
import BoardCanvas from './components/BoardCanvas.vue'
import BoardListView from './BoardListView.vue'
import NodeSidebar from './components/NodeSidebar.vue'
import { useBoardDocs } from './composables/useBoardDocs'
import { useBoardLayout } from './composables/useBoardLayout'
import { useBoardSelection } from './composables/useBoardSelection'
import { useBoardUndo } from './composables/useBoardUndo'
import { parseSnapMode, type SnapMode } from './composables/useBoardSnap'
import { contentBounds, fitViewport, type Point } from './boardGeometry'
import { containerRects, genBoardId } from './layoutSchema'
import { captureHierarchy, diffHierarchy, planReparent, type DropMode } from './outlineHierarchy'
import { initializeForms } from './forms/initializeForms'
// 复用既有的 parent_child 关系同步（单一实现，避免第二份漂移）
import { useOutlineTree } from '../composables/useOutlineTree'

/** 容器自适应尺寸的估算值（与画布一致） */
const FALLBACK_SIZE = { w: 200, h: 80 }

initializeForms()

const es = useEntityStore()
const docs = useBoardDocs()
const layoutApi = useBoardLayout()
const selection = useBoardSelection()
const { syncParentChildRelation } = useOutlineTree()

const undoApi = useBoardUndo({
  // 快照含布局 + 层级：Ctrl+Z 既能撤画布布局操作，也能撤右栏的层级重排（原树视图的能力已并入白板）
  getSnapshot: () => ({
    layout: layoutApi.layout.value,
    hierarchy: captureHierarchy(outlineNodes.value),
  }),
  applySnapshot: snap => {
    layoutApi.replaceLayout(snap.layout)
    if (snap.hierarchy) void restoreHierarchy(snap.hierarchy)
  },
})

const canvasRef = ref<InstanceType<typeof BoardCanvas> | null>(null)
const sidebarCollapsed = ref(false)

// ── 派生数据 ────────────────────────────────
const { boards, currentBoard, inEditor } = docs
const layout = layoutApi.layout
const viewport = layoutApi.viewport
const saveState = layoutApi.saveState
const canUndo = undoApi.canUndo
const canRedo = undoApi.canRedo

const outlineNodes = computed<Entity[]>(
  () => (es.entities ?? []).filter(e => e.type === 'outline_node'),
)
const nodesById = computed(() => new Map(outlineNodes.value.map(n => [n.id, n] as const)))
const placedIds = computed(() => new Set(layout.value.containers.map(c => c.nodeId)))
const snapMode = computed<SnapMode>(() =>
  parseSnapMode(currentBoard.value?.properties?.snap),
)
const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100))

const saveText = computed(() => {
  switch (saveState.value) {
    case 'saving': return '保存中…'
    case 'saved': return '已保存'
    case 'error': return '保存失败'
    default: return ''
  }
})
const saveClass = computed(() => ({
  'bv-save--saving': saveState.value === 'saving',
  'bv-save--saved': saveState.value === 'saved',
  'bv-save--error': saveState.value === 'error',
}))

// ── 进入 / 退出编辑器 ───────────────────────
function containerCount(boardId: string): number {
  return docs.containerCount(boardId)
}

async function openBoard(boardId: string): Promise<void> {
  docs.openBoard(boardId)
  await layoutApi.load(boardId)
  undoApi.clear()
  selection.clear()
}

async function onBack(): Promise<void> {
  await layoutApi.saveNow() // 退出编辑器立即落盘（规格 §七）
  docs.backToList()
  selection.clear()
  undoApi.clear()
}

async function onCreate(): Promise<void> {
  const id = await docs.createBoard('未命名白板')
  await openBoard(id)
}

async function onRename(boardId: string, name: string): Promise<void> {
  await docs.renameBoard(boardId, name)
}

async function onRemoveBoard(boardId: string): Promise<void> {
  await docs.deleteBoard(boardId)
}

// ── 画布事件 ────────────────────────────────
function onCanvasSelect(containerId: string | null): void {
  selection.select(containerId)
}

function onInteractionStart(): void {
  undoApi.record() // 一次拖动/一次操作只记一次快照
}

function onMoveContainer(containerId: string, pos: Point): void {
  layoutApi.moveContainer(containerId, pos)
}

function onToggleCollapse(containerId: string): void {
  undoApi.record()
  layoutApi.toggleCollapsed(containerId)
}

function onRemoveContainer(containerId: string): void {
  undoApi.record()
  layoutApi.removeContainerById(containerId)
  selection.dropIfMissing(new Set(layout.value.containers.map(c => c.id)))
}

function onAddComponent(containerId: string, form: string): void {
  undoApi.record()
  layoutApi.addComponent(containerId, form)
}

function onViewportChange(vp: typeof viewport.value): void {
  layoutApi.setViewport(vp)
}

/** 空白处双击 = 新建节点 + 容器（一步到位） */
async function onCreateNodeAt(pos: Point): Promise<void> {
  if (!inEditor.value) return
  undoApi.record()
  const now = new Date().toISOString()
  const nodeId = genBoardId('out')
  const siblings = outlineNodes.value.filter(n => !((n.properties?.parentId as string) || ''))
  await es.add({
    id: nodeId,
    type: 'outline_node',
    name: '新节点',
    description: '',
    properties: {
      status: '未写',
      order: siblings.length + 1,
      parentId: '',
      storylines: '',
      summary: '',
      manuscriptId: '',
      content: '',
    },
    tags: [],
    createdAt: now,
    updatedAt: now,
  })
  layoutApi.addContainer(nodeId, pos)
  const created = layout.value.containers.find(c => c.nodeId === nodeId)
  if (created) selection.select(created.id)
}

/** 从右栏拖入：已在板上 → 定位已有容器；否则新建容器 */
function onDropNode(nodeId: string, pos: Point): void {
  const existing = layout.value.containers.find(c => c.nodeId === nodeId)
  if (existing) {
    locateContainer(existing.id)
    return
  }
  undoApi.record()
  const id = layoutApi.addContainer(nodeId, pos)
  if (id) selection.select(id)
}

/** 右栏双击/单击：未入板 → 落到视口中心 */
function onSidebarAdd(nodeId: string): void {
  const size = canvasRef.value?.size() ?? { w: 0, h: 0 }
  const center: Point = {
    x: (-viewport.value.panX + size.w / 2) / viewport.value.zoom - FALLBACK_SIZE.w / 2,
    y: (-viewport.value.panY + size.h / 2) / viewport.value.zoom - FALLBACK_SIZE.h / 2,
  }
  onDropNode(nodeId, { x: Math.round(center.x), y: Math.round(center.y) })
}

/** 右栏对「已在板上」节点的操作 → 定位并选中其容器 */
function onLocate(nodeId: string): void {
  const container = layout.value.containers.find(c => c.nodeId === nodeId)
  if (container) locateContainer(container.id)
}

function locateContainer(containerId: string): void {
  const rect = containerRects(layout.value, FALLBACK_SIZE).find(
    (_, idx) => layout.value.containers[idx]?.id === containerId,
  )
  selection.select(containerId)
  if (rect) canvasRef.value?.centerOn(rect)
}

// ── 层级重排（右栏拖拽）────────────────────

/**
 * 执行右栏的重排计划：按 planReparent 的结果写回 parentId/order，并同步 parent_child 关系。
 * 写入带 `{ skipUndo }`——撤销由白板栈负责（快照里带了层级表，见 useBoardUndo）。
 */
async function onReparent(draggedId: string, targetId: string, mode: DropMode): Promise<void> {
  const plan = planReparent(outlineNodes.value, draggedId, targetId, mode)
  if (!plan) return
  undoApi.record()
  for (const u of plan) {
    const node = outlineNodes.value.find(n => n.id === u.id)
    if (!node) continue
    await es.update(
      u.id,
      { properties: { ...node.properties, parentId: u.parentId, order: u.order } },
      'user',
      { skipUndo: true },
    )
  }
  const dragged = plan.find(u => u.id === draggedId)
  await syncParentChildRelation(draggedId, dragged?.parentId ?? '')
}

/** 按层级快照回放（撤销/重做用）：只写差异项 */
async function restoreHierarchy(
  snapshot: Record<string, { parentId: string; order: number }>,
): Promise<void> {
  const updates = diffHierarchy(outlineNodes.value, snapshot)
  for (const u of updates) {
    const node = outlineNodes.value.find(n => n.id === u.id)
    if (!node) continue
    await es.update(
      u.id,
      { properties: { ...node.properties, parentId: u.parentId, order: u.order } },
      'user',
      { skipUndo: true },
    )
    await syncParentChildRelation(u.id, u.parentId)
  }
}

// ── 视口控件 ────────────────────────────────
function zoomBy(dir: 1 | -1): void {
  canvasRef.value?.zoomStep(dir > 0 ? -1 : 1)
}

function fitAll(): void {
  const size = canvasRef.value?.size() ?? { w: 0, h: 0 }
  const rects = containerRects(layout.value, FALLBACK_SIZE)
  layoutApi.setViewport(fitViewport(contentBounds(rects), size))
}

// ── 撤销 / 重做 ─────────────────────────────
function onUndo(): void {
  if (undoApi.undo()) {
    selection.dropIfMissing(new Set(layout.value.containers.map(c => c.id)))
  }
}

function onRedo(): void {
  if (undoApi.redo()) {
    selection.dropIfMissing(new Set(layout.value.containers.map(c => c.id)))
  }
}

// ── 快捷键（批次 1 用 window 监听；批次 4 收编进 useShortcuts 注册表）──
function onKeydown(ev: KeyboardEvent): void {
  if (!inEditor.value) return
  const target = ev.target as HTMLElement | null
  const inField = !!target && (
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  )

  if (ev.key === 'Escape') {
    selection.clear()
    return
  }
  const mod = ev.ctrlKey || ev.metaKey
  if (mod && ev.key.toLowerCase() === 'z') {
    ev.preventDefault()
    if (ev.shiftKey) onRedo()
    else onUndo()
    return
  }
  if (!inField && (ev.key === 'Delete' || ev.key === 'Backspace') && selection.selectedId.value) {
    // Backspace 可能是输入意图，故只在非输入态处理
    if (ev.key === 'Backspace') return
    ev.preventDefault()
    onRemoveContainer(selection.selectedId.value)
  }
}

// ── 生命周期 ────────────────────────────────
onMounted(async () => {
  await docs.loadAll()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (layoutApi.boardId.value) void layoutApi.saveNow()
  layoutApi.dispose()
})

// 当前白板切换时清空撤销（撤销不跨板）
watch(() => layoutApi.boardId.value, () => {
  undoApi.clear()
})

// 容器列表变化后清理失效选中
watch(() => layout.value.containers.length, () => {
  selection.dropIfMissing(new Set(layout.value.containers.map(c => c.id)))
})
</script>

<style scoped>
/* 根容器：项目视图宿主是 flex 布局，视图根需自行撑满（照 ManuscriptView 的 .manuscript-view） */
.board-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.bv-editor {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.bv-tb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  /* 图标/文字按钮必须显式设色（WsIcon 走 currentColor） */
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.bv-tb:hover:not(:disabled) { background: var(--hover-bg); color: var(--primary); }
.bv-tb:disabled { color: var(--text-tertiary); cursor: default; opacity: 0.6; }
.bv-tb-title {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-color);
}
.bv-save { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bv-save--saved { color: var(--success, #059669); }
.bv-save--error { color: var(--error, #dc2626); }
.bv-sep { width: 1px; height: 14px; background: var(--border-light); }
.bv-zoom { font-size: var(--font-size-2xs); color: var(--text-tertiary); min-width: 34px; text-align: center; }
.bv-count { font-size: var(--font-size-xs); color: var(--text-secondary); }
</style>
