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

  <!-- 层 2：编辑器（画布 + 画布悬浮条 + 右栏节点侧栏） -->
  <div v-else class="bv-editor">
    <BoardCanvas
      ref="canvasRef"
      :layout="layout"
      :viewport="viewport"
      :nodes-by-id="nodesById"
      :selected-id="selection.selectedId.value"
      :snap-mode="snapMode"
      :grid-enabled="gridEnabled"
      :section-draw-mode="sectionDrawMode"
      @select="onCanvasSelect"
      @move-container="onMoveContainer"
      @resize-container="onResizeContainer"
      @container-drop="onContainerDrop"
      @toggle-collapse="onToggleCollapse"
      @remove-container="onRemoveContainer"
      @remove-component="onRemoveComponentInContainer"
      @open-manuscript="onOpenManuscript"
      @add-component="onAddComponent"
      @create-node-at="onCreateNodeAt"
      @drop-node="onDropNode"
      @viewport-change="onViewportChange"
      @interaction-start="onInteractionStart"
      @create-section="onCreateSection"
      @section-draw-done="sectionDrawMode = false"
      @move-section="onMoveSection"
      @resize-section="onResizeSection"
      @rename-section="onRenameSection"
      @rearrange-section="onRearrangeSection"
      @remove-section="askRemoveSection"
    />

    <BoardCanvasToolbar
      :snap-mode="snapMode"
      :grid-enabled="gridEnabled"
      :drawing="sectionDrawMode"
      :dangling-count="danglingIds.length"
      @toggle-draw="sectionDrawMode = !sectionDrawMode"
      @set-snap="onSetSnap"
      @toggle-grid="onToggleGrid"
      @fit-all="fitAll"
      @cleanup-dangling="onCleanupDangling"
    />

    <!-- 容器属性面板（规格 §五「属性条」）：选中容器时出现，画布内悬浮 -->
    <BoardInspector
      v-if="inspectedContainer"
      :container="inspectedContainer"
      :node="inspectedNode"
      @close="inspectorClosed = true"
      @resize="onInspectorResize"
      @reset-size="onInspectorResetSize"
      @update-config="onComponentConfig"
      @remove-component="onInspectorRemoveComponent"
      @reorder-components="onReorderComponents"
      @open-node="onOpenNodeFromInspector"
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

    <!-- 删区二选一（规格 §二）：必须显式选择容器去留，避免误删 -->
    <div v-if="removingSection" class="bv-dialog-mask" @pointerdown.self="removingSection = null">
      <div class="bv-dialog" role="dialog" aria-label="删除区">
        <div class="bv-dialog-title">删除区「{{ removingSection.title || '未命名区' }}」</div>
        <div class="bv-dialog-desc">该区当前有 {{ removingSectionContainerCount }} 个容器。请选择处理方式：</div>
        <div class="bv-dialog-actions">
          <button class="bv-dialog-btn" type="button" @click="confirmRemoveSection('detach')">
            仅删区，容器落回画布
          </button>
          <button class="bv-dialog-btn bv-dialog-btn--danger" type="button" @click="confirmRemoveSection('cascade')">
            连同区内容器一起删
          </button>
          <button class="bv-dialog-btn bv-dialog-btn--plain" type="button" @click="removingSection = null">取消</button>
        </div>
        <div class="bv-dialog-hint">两种方式都<strong>不会</strong>删除大纲节点本身，只影响白板上的摆放。</div>
      </div>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 装配层：把 composables 与组件接起来，并作为**唯一**的数据变更入口。
 * 所有写操作都遵循同一顺序：record()（撤销快照）→ 调 useBoardLayout 的原子操作 → 自动保存。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
// 芽视图里的 UI 组件必须显式导入：它们**不是全局组件**，未导入时 vue-tsc 不报错、
// 只在渲染时静默变成空节点（2026-09-16 真机走查踩坑）
import { CreateButton } from '@worldsea/plugin-sdk'
import { WsIcon, useShortcuts } from '@worldsea/ui-kit'
import BoardCanvas from './components/BoardCanvas.vue'
import BoardCanvasToolbar from './components/BoardCanvasToolbar.vue'
import BoardInspector from './components/BoardInspector.vue'
import BoardListView from './BoardListView.vue'
import NodeSidebar from './components/NodeSidebar.vue'
import { useBoardDocs } from './composables/useBoardDocs'
import { useBoardLayout } from './composables/useBoardLayout'
import { useBoardSelection } from './composables/useBoardSelection'
import { useBoardUndo, provideBoardUndo } from './composables/useBoardUndo'
import { parseSnapMode, type SnapMode } from './composables/useBoardSnap'
import { contentBounds, fitViewport, type Point, type Rect } from './boardGeometry'
import { DEFAULT_CONTAINER_SIZE, danglingContainerIds, genBoardId, rectOfContainer, type BoardSection } from './layoutSchema'
import { captureHierarchy, diffHierarchy, planReparent, type DropMode } from './outlineHierarchy'
import { renderBoardThumbnail } from './thumbnail'
import { initializeForms } from './forms/initializeForms'
// 复用既有的 parent_child 关系同步（单一实现，避免第二份漂移）
import { useOutlineTree } from '../composables/useOutlineTree'

/** 容器自适应尺寸的估算值统一取 layoutSchema.DEFAULT_CONTAINER_SIZE（避免多处漂移） */

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
  // 字段条目回放：就地编辑（改名 / 改描述）的撤销也归白板栈（规格 §六「内容写入统一单步」）
  applyField: (nodeId, values) => { void applyNodeFields(nodeId, values) },
})

/**
 * 回放内容编辑：直接写节点字段。带 `{ skipUndo }`——白板栈自己记了这一步，
 * 不能再进实体全局栈（否则两套撤销历史会互相打架）。节点已删则静默跳过。
 */
async function applyNodeFields(nodeId: string, values: Record<string, unknown>): Promise<void> {
  const node = (es.entities ?? []).find(e => e.id === nodeId)
  if (!node) return
  await es.update(nodeId, values, 'user', { skipUndo: true })
}

// 形式组件（标题式 / 树式 / 句子式…）通过注入拿撤销能力，不必逐层透传 props
provideBoardUndo({ recordContentEdit: undoApi.recordContentEdit })

const canvasRef = ref<InstanceType<typeof BoardCanvas> | null>(null)
const sidebarCollapsed = ref(false)
/** 画区模式：开启后画布背景拖拽 = 拖出矩形（画完一个自动退出，避免连续误画） */
const sectionDrawMode = ref(false)
/** 待确认删除的区（弹层二选一，规格 §二） */
const removingSection = ref<BoardSection | null>(null)

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
/** 现存节点 id 集合：判定悬空容器用 */
const existingNodeIds = computed(() => new Set(outlineNodes.value.map(n => n.id)))
/** 悬空容器（节点已删）：只在悬浮条上给清理入口，绝不自动删 */
const danglingIds = computed(() => danglingContainerIds(layout.value, existingNodeIds.value))
const snapMode = computed<SnapMode>(() =>
  parseSnapMode(currentBoard.value?.properties?.snap),
)
/** 背景网格开关（白板级，默认开）；与吸附模式解耦（规格 §一） */
const gridEnabled = computed(() => currentBoard.value?.properties?.gridEnabled !== false)
const removingSectionContainerCount = computed(() => {
  const s = removingSection.value
  if (!s) return 0
  return layout.value.containers.filter(c => c.sectionId === s.id).length
})
/** 当前选中的容器（选中粒度 = 容器；属性面板据此显示） */
const selectedContainer = computed(() =>
  selection.selectedId.value
    ? layout.value.containers.find(c => c.id === selection.selectedId.value) ?? null
    : null,
)
/** 面板可手动关闭；切换选中时自动重新展开（否则换了容器面板仍不出现，像坏了） */
const inspectorClosed = ref(false)
const inspectedContainer = computed(() => (inspectorClosed.value ? null : selectedContainer.value))
const inspectedNode = computed(() =>
  inspectedContainer.value ? nodesById.value.get(inspectedContainer.value.nodeId) : undefined,
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
  sectionDrawMode.value = false
  removingSection.value = null
  // 首次进入（该白板从未保存过视口）→ 把已有内容带进视野；否则按保存的视口恢复
  if (layoutApi.pendingFit.value) await fitAllWhenReady()
}

/** 等画布具备真实尺寸后再适配（挂载首帧 clientWidth 可能还是 0，直接算会得到错误的 zoom/pan） */
async function fitAllWhenReady(attempts = 6): Promise<void> {
  await nextTick()
  const size = canvasRef.value?.size() ?? { w: 0, h: 0 }
  if (size.w === 0 || size.h === 0) {
    if (attempts > 0) requestAnimationFrame(() => void fitAllWhenReady(attempts - 1))
    return
  }
  fitAll()
}

async function onBack(): Promise<void> {
  captureThumbnail() // 退出编辑器时生成缩略图（规格 §七）
  await layoutApi.saveNow() // 立即落盘（不等防抖）
  docs.backToList()
  selection.clear()
  undoApi.clear()
  sectionDrawMode.value = false
  removingSection.value = null
}

/**
 * 生成并暂存缩略图（退出编辑器 / 卸载时调用）。
 * 白板是 DOM 画布，无法截屏——改为按布局体绘制**结构示意图**（区虚线框 + 容器实心块），
 * 详见 board/thumbnail.ts 的模块注释。落盘由随后的 saveNow 一并完成（不做第二条写路径）。
 */
function captureThumbnail(): void {
  const dataUrl = renderBoardThumbnail(layout.value)
  if (dataUrl) layoutApi.setThumbnail(dataUrl)
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

/** 尺寸手柄拖动（拖动开始时已 record，故这里只改数据） */
function onResizeContainer(containerId: string, size: { w: number; h: number }): void {
  layoutApi.resizeContainer(containerId, size)
}

/** 拖动结束才重算归属：拖动中重算会让容器的区归属随手指反复跳动 */
function onContainerDrop(containerId: string): void {
  void layoutApi.settleContainerSection(containerId)
}

/** 打开正文：复用既有 ws-navigate 链路（与旧树视图的「跳转到正文」同一实现） */
function onOpenManuscript(containerId: string): void {
  const container = layout.value.containers.find(c => c.id === containerId)
  if (!container) return
  const manuscriptId = (nodesById.value.get(container.nodeId)?.properties?.manuscriptId as string) || ''
  if (!manuscriptId) return
  window.dispatchEvent(new CustomEvent('ws-navigate', {
    detail: { type: 'entity', entityId: manuscriptId, entityType: 'manuscript' },
  }))
}

function onAddComponent(containerId: string, form: string): void {
  undoApi.record()
  layoutApi.addComponent(containerId, form)
}

// ── 属性面板（容器尺寸 / 组件配置 / 排序 / 打开节点）──
// 全部遵循同一纪律：先 record() 入白板撤销栈，再走 useBoardLayout 的原子操作。

function onInspectorResize(size: { w: number; h: number }): void {
  const c = inspectedContainer.value
  if (!c) return
  undoApi.record()
  layoutApi.resizeContainer(c.id, size)
}

/** 恢复内容自适应：清掉显式尺寸（容器重新按内容撑开） */
function onInspectorResetSize(): void {
  const c = inspectedContainer.value
  if (!c) return
  undoApi.record()
  layoutApi.resizeContainer(c.id, undefined)
}

function onComponentConfig(componentId: string, patch: Record<string, unknown>): void {
  const c = inspectedContainer.value
  if (!c) return
  undoApi.record()
  layoutApi.updateComponentConfig(c.id, componentId, patch)
}

function onInspectorRemoveComponent(componentId: string): void {
  const c = inspectedContainer.value
  if (!c) return
  undoApi.record()
  layoutApi.removeComponent(c.id, componentId)
}

/** 容器内组件行的悬停移除：与属性面板同一原子操作，只是入口不同 */
function onRemoveComponentInContainer(containerId: string, componentId: string): void {
  undoApi.record()
  layoutApi.removeComponent(containerId, componentId)
}

function onReorderComponents(orderedIds: string[]): void {
  const c = inspectedContainer.value
  if (!c) return
  undoApi.record()
  layoutApi.reorderContainerComponents(c.id, orderedIds)
}

/** 面板里的「打开节点正文」与容器头同一链路（避免两份实现） */
function onOpenNodeFromInspector(): void {
  const c = inspectedContainer.value
  if (c) onOpenManuscript(c.id)
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
    x: (-viewport.value.panX + size.w / 2) / viewport.value.zoom - DEFAULT_CONTAINER_SIZE.w / 2,
    y: (-viewport.value.panY + size.h / 2) / viewport.value.zoom - DEFAULT_CONTAINER_SIZE.h / 2,
  }
  onDropNode(nodeId, { x: Math.round(center.x), y: Math.round(center.y) })
}

/** 右栏对「已在板上」节点的操作 → 定位并选中其容器 */
function onLocate(nodeId: string): void {
  const container = layout.value.containers.find(c => c.nodeId === nodeId)
  if (container) locateContainer(container.id)
}

function locateContainer(containerId: string): void {
  const container = layout.value.containers.find(c => c.id === containerId)
  if (!container) return
  selection.select(containerId)
  canvasRef.value?.centerOn(rectOfContainer(container))
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

// ── 区（Section）事件 ────────────────────────

/** 画区完成：新建区，并把中心落在区内的既有容器一并纳入归属（与拖动结束的归属规则一致） */
function onCreateSection(rect: Rect): void {
  undoApi.record()
  layoutApi.addSection(rect)
}

function onMoveSection(sectionId: string, rect: Rect): void {
  layoutApi.moveSectionTo(sectionId, rect)
}

function onResizeSection(sectionId: string, rect: Rect): void {
  layoutApi.resizeSection(sectionId, rect)
}

function onRenameSection(sectionId: string, title: string): void {
  undoApi.record()
  layoutApi.renameSection(sectionId, title)
}

function onRearrangeSection(sectionId: string): void {
  undoApi.record()
  layoutApi.rearrangeSection(sectionId)
}

/** 删区前先问容器去留（规格 §二：二选一，不静默决定） */
function askRemoveSection(sectionId: string): void {
  const s = layout.value.sections.find(x => x.id === sectionId)
  if (s) removingSection.value = s
}

function confirmRemoveSection(mode: 'detach' | 'cascade'): void {
  const s = removingSection.value
  removingSection.value = null
  if (!s) return
  undoApi.record()
  layoutApi.removeSectionById(s.id, mode)
  selection.dropIfMissing(new Set(layout.value.containers.map(c => c.id)))
}

// ── 白板级设置（吸附模式 / 网格开关）与悬空容器清理 ──

async function onSetSnap(mode: SnapMode): Promise<void> {
  const id = currentBoard.value?.id
  if (!id) return
  await docs.setBoardSnap(id, mode)
}

async function onToggleGrid(): Promise<void> {
  const id = currentBoard.value?.id
  if (!id) return
  await docs.setBoardGridEnabled(id, !gridEnabled.value)
}

/** 清理悬空容器：必须用户显式点击（绝不自动删），且只删容器、不删节点 */
function onCleanupDangling(): void {
  if (!danglingIds.value.length) return
  undoApi.record()
  layoutApi.cleanupDangling(existingNodeIds.value)
  selection.dropIfMissing(new Set(layout.value.containers.map(c => c.id)))
}

// ── 视口控件 ────────────────────────────────
function zoomBy(dir: 1 | -1): void {
  canvasRef.value?.zoomStep(dir > 0 ? -1 : 1)
}

function fitAll(): void {
  const size = canvasRef.value?.size() ?? { w: 0, h: 0 }
  // 适配全部要**包含区**（规格 §一：zoom to fit，含全部容器与区）
  const rects: Rect[] = [
    ...layout.value.containers.map(c => rectOfContainer(c)),
    ...layout.value.sections.map(s => ({ ...s.rect })),
  ]
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

// ── 快捷键（批次 4：收编进 useShortcuts 注册表，规格 §八）──
/**
 * 收编收益（替代批次 1 的 window 常驻监听）：
 * · 注册表内置**输入焦点保护**——焦点在 INPUT/TEXTAREA/SELECT/contentEditable 时 view 层全部失效
 *   （`useShortcuts.ts:267`），不必再手写 inField 判断；
 * · IME 组合期一律忽略（`:246`），中文输入法选词时按 Enter/Esc 不会误触发；
 * · view 层命中后 `stopImmediatePropagation`（`:287-289`），阻断残留的 window 级监听；
 * · 可被「设置 → 快捷键」面板读取与改键（这才是走注册表的核心价值）。
 *
 * 注册时机：**仅编辑器层**（列表层没有画布语义）。用 watch 控制注册/注销，
 * 避免列表层按 Del/Ctrl+Z 误触发画布操作。
 */
const { register: registerShortcut, unregister: unregisterShortcut } = useShortcuts()

const BOARD_SHORTCUT_IDS = [
  'outline-board.undo',
  'outline-board.redo',
  'outline-board.delete-container',
  'outline-board.reset-zoom',
  'outline-board.fit-all',
  'outline-board.draw-section',
  'outline-board.escape',
] as const

function unregisterShortcuts(): void {
  for (const id of BOARD_SHORTCUT_IDS) unregisterShortcut(id)
}

/** Esc 的优先级链：画区模式 → 删区弹层 → 清选中（行内编辑的 Esc 由组件自处理，不进注册表） */
function onEscapeKey(): void {
  if (sectionDrawMode.value) {
    sectionDrawMode.value = false
    return
  }
  if (removingSection.value) {
    removingSection.value = null
    return
  }
  selection.clear()
}

function registerShortcuts(): void {
  registerShortcut({
    id: 'outline-board.undo',
    keys: ['ctrl', 'z'],
    scope: 'view',
    description: '大纲白板：撤销',
    preventDefault: true,
    handler: onUndo,
  })
  registerShortcut({
    id: 'outline-board.redo',
    keys: ['ctrl', 'shift', 'z'],
    scope: 'view',
    description: '大纲白板：重做',
    preventDefault: true,
    handler: onRedo,
  })
  registerShortcut({
    id: 'outline-board.delete-container',
    keys: ['delete'],
    scope: 'view',
    description: '大纲白板：删除选中容器（不删节点）',
    preventDefault: true,
    handler: () => {
      const id = selection.selectedId.value
      if (id) onRemoveContainer(id)
    },
  })
  registerShortcut({
    id: 'outline-board.reset-zoom',
    keys: ['ctrl', '0'],
    scope: 'view',
    description: '大纲白板：缩放重置为 100%',
    preventDefault: true,
    handler: () => canvasRef.value?.zoomTo(1),
  })
  registerShortcut({
    id: 'outline-board.fit-all',
    // Shift+1 经 normalizeKeys 归一为单键 '!'（非字母可打印字符不叠加 shift 修饰，见 useShortcuts.ts:79-85）
    keys: ['!'],
    scope: 'view',
    description: '大纲白板：适配全部',
    handler: fitAll,
  })
  registerShortcut({
    id: 'outline-board.draw-section',
    keys: ['s'],
    scope: 'view',
    description: '大纲白板：画区',
    handler: () => { sectionDrawMode.value = !sectionDrawMode.value },
  })
  registerShortcut({
    id: 'outline-board.escape',
    keys: ['escape'],
    scope: 'view',
    description: '大纲白板：取消选中 / 退出画区',
    handler: onEscapeKey,
  })
}

// ── 生命周期 ────────────────────────────────
onMounted(async () => {
  await docs.loadAll()
})

onBeforeUnmount(() => {
  unregisterShortcuts()
  if (layoutApi.boardId.value) {
    captureThumbnail() // 关闭视图前也刷新缩略图（等价于退出编辑器）
    void layoutApi.saveNow()
  }
  layoutApi.dispose()
})

// 编辑器层 ↔ 列表层切换时注册/注销快捷键（列表层无画布语义）
watch(inEditor, val => {
  if (val) registerShortcuts()
  else unregisterShortcuts()
}, { immediate: true })

// 当前白板切换时清空撤销（撤销不跨板）
watch(() => layoutApi.boardId.value, () => {
  undoApi.clear()
})

// 容器列表变化后清理失效选中
watch(() => layout.value.containers.length, () => {
  selection.dropIfMissing(new Set(layout.value.containers.map(c => c.id)))
})

// 切换到另一个容器时重新展开属性面板（关闭动作只针对当时那个容器）
watch(() => selection.selectedId.value, () => {
  inspectorClosed.value = false
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
  /* 画布悬浮条与删区弹层以本层为定位参照 */
  position: relative;
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
/* 删区二选一弹层（居中，覆盖画布与右栏） */
.bv-dialog-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
}
.bv-dialog {
  width: 360px;
  max-width: calc(100% - 32px);
  padding: 14px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  background: var(--menubar-bg, var(--bg-secondary));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
.bv-dialog-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-color);
  margin-bottom: 6px;
}
.bv-dialog-desc { font-size: var(--font-size-xs); color: var(--text-secondary); margin-bottom: 12px; }
.bv-dialog-actions { display: flex; flex-direction: column; gap: 6px; }
.bv-dialog-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  /* 按钮文字必须显式设色 */
  color: var(--text-color);
  font-size: var(--font-size-xs);
  text-align: left;
  cursor: pointer;
}
.bv-dialog-btn:hover { background: var(--hover-bg); border-color: var(--primary); color: var(--primary); }
.bv-dialog-btn--danger:hover { border-color: var(--error, #dc2626); color: var(--error, #dc2626); }
.bv-dialog-btn--plain { text-align: center; color: var(--text-secondary); }
.bv-dialog-hint { margin-top: 10px; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
</style>
