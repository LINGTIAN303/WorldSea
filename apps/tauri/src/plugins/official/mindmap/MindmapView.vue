<template>
  <div class="mindmap-view">
    <MindmapToolbar
      :search-query="searchQuery"
      :search-match-count="searchMatches.length"
      :search-match-index="searchMatchIndex"
      :layout="layoutName"
      :enabled-types="visibleTypes"
      :edit-mode="editMode"
      :free-draw-mode="freeDrawing.isFreeDrawMode.value"
      :zoom-level="zoomLevel"
      :can-go-back="!!mindmapStore.currentRootId"
      :detail-panel-visible="mindmapStore.ui.detailPanelVisible"
      :minimap-visible="mindmapStore.ui.minimapVisible"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :selected-count="selectedNodes.size"
      @update:search-query="searchQuery = $event; onSearchInput()"
      @search-next="searchNext"
      @search-prev="searchPrev"
      @update:layout="onLayoutChange"
      @toggle-type="toggleType"
      @update:enabled-types="visibleTypes = $event; rebuildGraph()"
      @toggle-edit-mode="toggleEditMode"
      @toggle-free-draw="toggleFreeDrawMode"
      @toggle-ai-suggest="aiSuggestions.toggle()"
      @ai-organize="onAIOrganize"
      @add-textbox="ctxAddTextbox"
      @add-image="ctxAddImage"
      @add-note="ctxAddNote"
      @add-link="ctxAddLink"
      @add-group="ctxAddGroup"
      @add-center="ctxAddCenter"
      @undo="doUndo"
      @redo="doRedo"
      @align-selection="alignSelection"
      @distribute-selection="distributeSelection"
      @create-section-from-selection="createSectionFromSelection"
      @fit="fitView"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @go-back="exitNested"
      @toggle-detail="mindmapStore.toggleDetailPanel()"
      @toggle-minimap="mindmapStore.toggleMinimap()"
      @export-png="onExportPNG"
      @export-svg="onExportSVG"
    />

    <MindmapBreadcrumb :breadcrumb="breadcrumb" @jump="jumpTo" />

    <EmptyState v-if="!entityStore.entities.length" icon="map" message="还没有实体" hint="创建第一个实体吧" />

    <div class="mm-main-area">
      <div ref="containerRef" class="mm-canvas">
        <!-- 选区矩形提示：shift+drag 期间显示 -->
        <div
          v-if="selectionRectOverlay"
          class="mm-selection-overlay"
          :style="{
            left: selectionRectOverlay.x + 'px',
            top: selectionRectOverlay.y + 'px',
            width: selectionRectOverlay.w + 'px',
            height: selectionRectOverlay.h + 'px',
          }"
        ></div>
      </div>

      <MindmapDetailPanel
        :visible="mindmapStore.ui.detailPanelVisible"
        :node-id="selectedNodeId"
        :node-name="selectedNodeName"
        :node-type="selectedNodeType"
        :node-tags="selectedNodeTags"
        :node-desc="selectedNodeDesc"
        :node-properties="selectedNodeProperties"
        @close="mindmapStore.hideDetailPanel()"
        @edit="ctxEditName"
        @enter="enterSelectedNode"
        @delete="ctxDeleteNode"
        @navigate="navigateToEntity"
      />
    </div>

    <Minimap
      v-if="mindmapStore.ui.minimapVisible && canvasNodes.length > 0"
      :nodes="canvasNodes"
      :edges="canvasEdges"
      :camera="renderer.camera.value"
      :container-size="containerSize"
      @jump="onMinimapJump"
    />

    <MindmapNodeTooltip
      :visible="hoveredNode !== null"
      :node="hoveredNode"
      :x="tooltipPos.x"
      :y="tooltipPos.y"
    />

    <MindmapKeyHint :current-sequence="currentSequence" :available-next="availableNext" :is-active="keyHintActive" />

    <!-- 自由绘图工具栏（已拆分为子组件） -->
    <MindmapFreeDrawBar
      :visible="freeDrawing.isFreeDrawMode.value"
      :color-presets="freeDrawing.colorPresets"
      :draw-color="freeDrawing.drawColor.value"
      :draw-width="freeDrawing.drawWidth.value"
      @update:draw-color="freeDrawing.drawColor.value = $event"
      @update:draw-width="freeDrawing.drawWidth.value = $event"
      @undo="undoFreeDrawStroke"
      @clear="clearFreeDrawStrokes"
      @exit="toggleFreeDrawMode"
    />

    <AISuggestionPanel
      :visible="aiSuggestions.isVisible.value"
      :items="aiSuggestions.suggestions.value"
      :loading="aiSuggestions.isLoading.value"
      :ai-analyzing="aiSuggestions.isAIAnalyzing.value"
      @close="aiSuggestions.toggle()"
      @analyze="onAISuggestionAnalyze"
      @analyze-ai="onAISuggestionAnalyzeWithAI"
      @clear="aiSuggestions.clear()"
      @dismiss="aiSuggestions.dismiss($event)"
      @accept="onAISuggestionAccept($event)"
    />

    <input ref="imageInputRef" type="file" accept="image/*" class="hidden-input" @change="onImageFileSelected" />

    <MindmapContextMenu
      :ctx-menu="ctxMenu"
      :selected-count="selectedNodes.size"
      :collapsed-text="collapsedLabel"
      @edit-name="ctxEditName"
      @edit-description="ctxEditDescription"
      @edit-tags="ctxEditTags"
      @connect="startEdgeConnect"
      @create-section="createSectionFromSelection"
      @analyze-relation="onAISuggestionAnalyzeSelection"
      @analyze-relation-ai="onAISuggestionAnalyzeSelectionWithAI"
      @toggle-collapse="ctxToggleCollapse"
      @promote-section="sectionMgr.promoteToEntity(ctxMenu.nodeId)"
      @remove-section="sectionMgr.removeSection(ctxMenu.nodeId)"
      @delete-node="ctxDeleteNode"
      @edit-edge-label="editEdgeLabel"
      @edit-edge-type="editEdgeType"
      @delete-edge="deleteEdge"
      @set-edge-style="setEdgeStyle"
      @set-center="ctxSetCenter"
      @set-center-style="ctxSetCenterStyle"
      @enter-subgraph="enterSelectedNode"
      @set-textbox-size="ctxSetTextboxSize"
      @set-textbox-style="ctxSetTextboxStyle"
      @edit-image="ctxEditImage"
      @edit-note-content="ctxEditNoteContent"
      @create-node="ctxCreateNode"
      @add-textbox="ctxAddTextbox"
      @add-image="ctxAddImage"
      @add-note="ctxAddNote"
      @add-link="ctxAddLink"
      @add-group="ctxAddGroup"
      @delete-stroke="deleteCtxStroke"
    />

    <div v-if="edgeConnecting" class="mm-connect-bar"><WsIcon name="link" size="xs" /> 点击另一个节点完成连接，点击空白处取消</div>

    <!-- 内联编辑（节点名称 / 边标签行内编辑） -->
    <div v-if="showInlineEdit" class="mm-inline-edit" :style="inlineEditStyle">
      <input v-model="inlineEditText" class="mm-inline-input" aria-label="编辑名称" @keyup.enter="commitInlineEdit" @keyup.esc="cancelInlineEdit" />
      <button class="mm-btn-sm" @click="commitInlineEdit"><WsIcon name="check" size="xs" /></button>
      <button class="mm-btn-sm" @click="cancelInlineEdit"><WsIcon name="close" size="xs" /></button>
    </div>

    <!-- 以下模态框已拆分为子组件 -->
    <MindmapTypePicker
      :visible="showTypePicker"
      :active-types="activeTypes"
      @update:visible="showTypePicker = $event"
      @pick="onPickType"
    />

    <MindmapRelationPicker
      :visible="showRelationPicker"
      :relation-types="availableRelationTypes"
      @update:visible="showRelationPicker = $event"
      @pick="onPickRelation"
    />

    <MindmapTagEditor
      :visible="showTagEditor"
      :text="tagEditorText"
      @update:visible="showTagEditor = $event"
      @update:text="tagEditorText = $event"
      @save="saveTags"
    />

    <MindmapDescEditor
      :visible="showDescEditor"
      :text="descEditorText"
      @update:visible="showDescEditor = $event"
      @update:text="descEditorText = $event"
      @save="saveDescription"
    />

    <MindmapBatchBar
      :selected-count="selectedNodes.size"
      @delete="deleteSelectedNodes"
      @cancel="clearNodeSelection"
    />

    <MindmapImageViewer
      :show="imageViewer.show"
      :url="imageViewer.url"
      @update:show="imageViewer.show = $event"
    />

    <EntityFormModal v-model="showEntityForm" :title="editingEntity ? '编辑实体' : '新建实体'" :entity="editingEntity" :fields="getFormFields(entityFormType)" :entity-type="entityFormType" @save="onEntityFormSave" />

    <MindmapColorPicker
      :visible="showColorPicker"
      :custom-color="customColor"
      :preset-colors="presetColors"
      @update:visible="showColorPicker = $event"
      @update:custom-color="customColor = $event"
      @pick="onPickColor"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useEntityStore, useRelationStore, relationSchemaRegistry } from '@worldsmith/entity-core'
import { EmptyState, EntityFormModal, useShortcuts } from '@worldsmith/plugin-sdk'
import { useUndoRedo, useGraphData, useTypeMapping } from '@worldsmith/ui-kit'
import MindmapToolbar from './components/MindmapToolbar.vue'
import MindmapNodeTooltip from './components/MindmapNodeTooltip.vue'
import { guessRelType, KEY_SEQUENCES } from './mindmapConfig'
import { useMindmapStore } from './mindmapStore'
import { useSection } from './composables/useSection'
import { useKeySequence } from './composables/useKeySequence'
import MindmapBreadcrumb from './MindmapBreadcrumb.vue'
import MindmapDetailPanel from './MindmapDetailPanel.vue'
import MindmapKeyHint from './MindmapKeyHint.vue'
import AISuggestionPanel from './components/AISuggestionPanel.vue'
import MindmapContextMenu from './components/MindmapContextMenu.vue'
import { useCanvasRenderer } from './composables/useCanvasRenderer'
import { useCanvasInteraction, type CanvasInteractionCallbacks } from './composables/useCanvasInteraction'
import type { CanvasNode, CanvasEdge } from './composables/canvasTypes'
import { useFreeDrawing } from './composables/useFreeDrawing'
import { useAISuggestions, type Suggestion } from './composables/useAISuggestions'
import { useAgentPluginBridge } from '@/composables/useAgentPluginBridge'
import { useAgentBridge } from './composables/useAgentBridge'
import { useMindmapNodeOps } from './composables/useMindmapNodeOps'
import { useMindmapKeyboardNav } from './composables/useMindmapKeyboardNav'
import Minimap from './composables/Minimap.vue'
import { findIsolatedNodes, findCycles, findShortestPath } from './composables/useGraphAnalysis'
import { useRustLayout } from './composables/useRustLayout'
import { useMindmapExport } from './composables/useMindmapExport'
import { useLayoutAnimation } from './composables/useLayoutAnimation'
import type { LayoutAlgorithmType } from './mindmapStore'
// 拆分出的子组件
import MindmapTypePicker from './components/MindmapTypePicker.vue'
import MindmapRelationPicker from './components/MindmapRelationPicker.vue'
import MindmapTagEditor from './components/MindmapTagEditor.vue'
import MindmapDescEditor from './components/MindmapDescEditor.vue'
import MindmapColorPicker from './components/MindmapColorPicker.vue'
import MindmapImageViewer from './components/MindmapImageViewer.vue'
import MindmapFreeDrawBar from './components/MindmapFreeDrawBar.vue'
import MindmapBatchBar from './components/MindmapBatchBar.vue'
// 拆分出的 composables
import { useMindmapModals } from './composables/useMindmapModals'
import { useMindmapLayout } from './composables/useMindmapLayout'
import { useMindmapContextActions } from './composables/useMindmapContextActions'

// ===== Stores & Data =====
const entityStore = useEntityStore()
const relationStore = useRelationStore()
const mindmapStore = useMindmapStore()
const undoRedo = useUndoRedo()
const { nodes: graphNodes, edges: graphEdges } = useGraphData()
const typeMapping = useTypeMapping()

// ===== Refs =====
const containerRef = ref<HTMLDivElement | null>(null)
const imageInputRef = ref<HTMLInputElement>()
const canvasNodes = ref<CanvasNode[]>([])
const canvasEdges = ref<CanvasEdge[]>([])

// ===== Selection =====
const selectedNodeId = computed({
  get: () => mindmapStore.focusedNodeId || '',
  set: (v) => { mindmapStore.focusedNodeId = v || null },
})
const selectedNodes = mindmapStore.selectedNodeIds

// ===== Node Ops & Renderer =====
const nodeOps = useMindmapNodeOps({ canvasNodes, canvasEdges })
const renderer = useCanvasRenderer(
  containerRef,
  () => canvasNodes.value,
  () => canvasEdges.value,
  () => mindmapStore.aiSuggestionHints,
  () => mindmapStore.highlightedNodeIds,
)

// ===== Layout & Animation =====
const rustLayout = useRustLayout()
const layoutAnim = useLayoutAnimation()

// ===== Modals (UI 状态集中管理) =====
const modals = useMindmapModals()
const {
  showInlineEdit, inlineEditText, inlineEditStyle,
  showTypePicker, showRelationPicker, showTagEditor, showDescEditor, showColorPicker,
  tagEditorText, descEditorText,
  showEntityForm, editingEntity, entityFormType,
  availableRelationTypes, imageViewer,
  customColor, presetColors,
} = modals

// ===== Layout Operations (布局逻辑集中管理) =====
const visibleTypes = mindmapStore.visibleEntityTypes
const layoutName = computed({
  get: () => mindmapStore.layoutAlgorithm,
  set: (v: LayoutAlgorithmType) => { mindmapStore.setLayout(v) },
})
const layoutOps = useMindmapLayout({
  mindmapStore, entityStore, relationStore,
  graphNodes, graphEdges,
  canvasNodes, canvasEdges,
  visibleTypes, layoutName,
  containerRef, renderer,
  rustLayout, layoutAnim,
  typeMapping,
})
const { buildCanvasData, rebuildGraph, applyLayout, savePositions, onLayoutChange, toggleType } = layoutOps

// ===== 嵌套导航 =====
function enterNestedNode(nodeId: string) {
  const node = canvasNodes.value.find(n => n.id === nodeId)
  if (node) {
    mindmapStore.enterNode(nodeId)
    mindmapStore.currentRootId = nodeId
    rebuildGraph()
  }
}
function exitNested() {
  mindmapStore.exitNode()
  rebuildGraph()
}
function jumpTo(id: string | null) {
  if (id === null) return
  mindmapStore.jumpToBreadcrumb(id)
  rebuildGraph()
}

// ===== Context Actions (右键菜单 / 内联编辑 / 边操作 集中管理) =====
const ctxActions = useMindmapContextActions({
  mindmapStore, entityStore, relationStore,
  canvasNodes, canvasEdges,
  selectedNodeId, selectedNodes,
  nodeOps, renderer, containerRef, imageInputRef,
  modals, rebuildGraph, enterNestedNode,
})
const {
  getFormFields, createRelationEdge,
  ctxCreateNode, onPickType, onPickRelation, onEntityFormSave,
  ctxEditName, commitInlineEdit, cancelInlineEdit,
  ctxEditDescription, saveDescription, ctxEditTags, saveTags,
  ctxToggleCollapse, ctxDeleteNode, startEdgeConnect,
  editEdgeLabel, editEdgeType, deleteEdge, setEdgeStyle,
  onPickColor,
  ctxSetCenter, ctxSetCenterStyle, ctxAddCenter,
  ctxAddTextbox, ctxAddImage, onImageFileSelected, ctxEditImage,
  ctxAddNote, ctxEditNoteContent, ctxAddLink, ctxAddGroup,
  ctxSetTextboxSize, ctxSetTextboxStyle,
  setEdgeDraft,
} = ctxActions

// ===== Keyboard Navigation =====
useMindmapKeyboardNav({
  selectedNodeId,
  canvasNodes,
  camera: renderer.camera as any,
  onEnter: (id) => enterNestedNode(id),
  onFocus: (id) => {
    const n = canvasNodes.value.find(nn => nn.id === id)
    if (n) renderer.camera.value = { x: n.x, y: n.y, k: 1.2 }
    renderer.markDirty()
  },
  onExit: () => exitNested(),
  onClear: () => { selectedNodes.clear() },
})

// ===== Canvas Interaction =====
const interactionCallbacks: CanvasInteractionCallbacks = {
  onNodeClick: (node, e) => {
    mindmapStore.hideContextMenu()
    if (mindmapStore.ui.edgeConnecting) {
      const srcId = mindmapStore.connectSourceId
      if (node.id === srcId) return
      const srcNode = canvasNodes.value.find(n => n.id === srcId)
      const srcType = srcNode?.type || ''
      const tgtType = node.type
      const guessed = guessRelType(srcType, tgtType)
      const rels = relationSchemaRegistry.getAll().filter(rt => {
        return (rt.sourceTypes.includes(srcType) || rt.sourceTypes.includes('*')) &&
               (rt.targetTypes.includes(tgtType) || rt.targetTypes.includes('*'))
      })
      let relTypId = ''
      if (rels.length > 0) {
        relTypId = rels[0].typeKey
        if (rels.find(r => r.typeKey === guessed)) relTypId = guessed
      }
      availableRelationTypes.value = rels.map(r => ({ type: r.typeKey, label: r.label || r.typeKey }))
      mindmapStore.cancelEdgeConnect()
      if (relTypId) {
        createRelationEdge(srcId, node.id, relTypId)
      } else {
        setEdgeDraft(srcId, node.id, '')
        showRelationPicker.value = true
      }
      return
    }
    mindmapStore.selectNode(node.id, e.shiftKey || e.metaKey)
  },
  onNodeDoubleClick: (node, e) => {
    if (e.ctrlKey || e.metaKey) {
      const type = node.type
      if (!['textbox', 'image', 'note', 'link', 'group', 'center', 'section'].includes(type)) {
        enterNestedNode(node.id)
      }
    } else if (node.type === 'image') {
      imageViewer.url = node.imageUrl || ''
      imageViewer.show = true
    } else if (node.type === 'link') {
      if (node.linkUrl) window.open(node.linkUrl, '_blank')
    } else {
      ctxEditName()
    }
  },
  onNodeRightClick: (node, e) => {
    mindmapStore.showContextMenu({
      x: e.clientX, y: e.clientY,
      nodeId: node.id, nodeType: node.type,
      isCenter: node.isRoot || node.type === 'center',
    })
  },
  onNodeHover: (node) => {
    renderer.hoveredNodeId.value = node?.id || null
    hoveredNode.value = node
  },
  onEdgeClick: () => {},
  onEdgeRightClick: (edge, e) => {
    mindmapStore.showContextMenu({
      x: e.clientX, y: e.clientY, edgeId: edge.id,
    })
  },
  onBackgroundClick: () => {
    mindmapStore.hideContextMenu()
    if (!canvasInteraction.isSelecting.value) {
      mindmapStore.clearSelection()
      selectedNodeId.value = ''
    }
    mindmapStore.clearHighlight()
    if (mindmapStore.ui.edgeConnecting) {
      mindmapStore.cancelEdgeConnect()
    }
  },
  onBackgroundRightClick: (e) => {
    const rect = containerRef.value?.getBoundingClientRect()
    let strokeId = ''
    if (rect) {
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const { x: wx, y: wy } = renderer.screenToWorld(sx, sy)
      const hitStroke = freeDrawing.hitTestStroke(wx, wy)
      strokeId = hitStroke?.id || ''
    }
    mindmapStore.showContextMenu({
      x: e.clientX, y: e.clientY, strokeId,
    })
  },
  onNodeDrag: (node, dx, dy) => {
    if (node.isRoot) return // 中心节点不可拖拽
    node.x += dx
    node.y += dy
    node.fx = node.x
    node.fy = node.y
    renderer.markDirty()
  },
  onNodeDragEnd: (node) => {
    if (node.isRoot) return
    node.fx = node.x
    node.fy = node.y
  },
  onZoom: (k) => {
    mindmapStore.setCamera({ ...mindmapStore.camera, k })
    renderer.markDirty()
  },
  onPan: () => {
    renderer.markDirty()
  },
  onSelectionRect: (_worldRect, hit) => {
    mindmapStore.selectAll(hit.map(n => n.id))
    if (hit.length === 1) selectedNodeId.value = hit[0].id
    else if (hit.length > 1) selectedNodeId.value = hit[hit.length - 1].id
    else selectedNodeId.value = ''
    renderer.markDirty()
  },
  onSelectionRectMove: (startWorld, endWorld) => {
    if (!startWorld || !endWorld) {
      selectionRectOverlay.value = null
      return
    }
    // 转屏幕坐标
    const cam = renderer.camera.value
    const rect = containerRef.value?.getBoundingClientRect()
    if (!rect) return
    const camCx = rect.width / 2
    const camCy = rect.height / 2
    const x1 = (startWorld.x - cam.x) * cam.k + camCx
    const y1 = (startWorld.y - cam.y) * cam.k + camCy
    const x2 = (endWorld.x - cam.x) * cam.k + camCx
    const y2 = (endWorld.y - cam.y) * cam.k + camCy
    selectionRectOverlay.value = {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    }
  },
}

const canvasInteraction = useCanvasInteraction(
  renderer.canvas,
  () => renderer.camera.value,
  (c) => { renderer.camera.value = c },
  renderer.hitTestNode,
  renderer.hitTestEdge,
  renderer.screenToWorld,
  interactionCallbacks,
)
canvasInteraction.setGetAllNodes(() => canvasNodes.value)

// ===== Free Drawing =====
const freeDrawing = useFreeDrawing()

function updateFreeDrawInterceptor(): void {
  if (freeDrawing.isFreeDrawMode.value) {
    canvasInteraction.setInterceptor({
      onMouseDown: (e, wx, wy) => {
        if (e.button !== 0) return false
        freeDrawing.startStroke(wx, wy, mindmapStore.currentRootId)
        renderer.markDirty()
        return true
      },
      onMouseMove: (_e, wx, wy) => {
        if (freeDrawing.isDrawing.value) {
          freeDrawing.continueStroke(wx, wy)
          renderer.markDirty()
          return true
        }
        return false
      },
      onMouseUp: () => {
        if (freeDrawing.isDrawing.value) {
          freeDrawing.endStroke()
          renderer.markDirty()
          return true
        }
        return false
      },
    })
  } else {
    canvasInteraction.setInterceptor(null)
  }
}

watch(freeDrawing.isFreeDrawMode, () => {
  updateFreeDrawInterceptor()
})

function toggleFreeDrawMode(): void { freeDrawing.toggleFreeDrawMode() }
function undoFreeDrawStroke(): void { freeDrawing.undoStroke() }
function clearFreeDrawStrokes(): void { freeDrawing.clearStrokes(mindmapStore.currentRootId) }

// ===== AI Suggestions =====
const aiSuggestions = useAISuggestions()

function onAISuggestionAnalyze(): void { aiSuggestions.analyze(canvasNodes.value) }
function onAISuggestionAnalyzeWithAI(): void { aiSuggestions.analyzeWithAI(canvasNodes.value) }
function onAISuggestionAnalyzeSelection(): void { aiSuggestions.analyzeSelection(canvasNodes.value, selectedNodes) }
function onAISuggestionAnalyzeSelectionWithAI(): void { aiSuggestions.analyzeSelectionWithAI(canvasNodes.value, selectedNodes) }
function onAISuggestionAccept(sug: Suggestion): void {
  createRelationEdge(sug.sourceId, sug.targetId, sug.relType)
  aiSuggestions.dismiss(sug.id)
}

function deleteCtxStroke(): void {
  mindmapStore.hideContextMenu()
  const sid = mindmapStore.ui.contextMenu.strokeId
  if (sid) {
    freeDrawing.deleteStroke(sid)
    mindmapStore.ui.contextMenu.strokeId = ''
  }
}

// ===== Computed Properties =====
const zoomLevel = computed(() => Math.round(mindmapStore.camera.k * 100))
const searchQuery = computed({
  get: () => mindmapStore.searchQuery,
  set: (v) => { mindmapStore.setSearchQuery(v) },
})
const searchMatchIndex = computed({
  get: () => mindmapStore.searchMatchIndex,
  set: (v) => { mindmapStore.setSearchMatchIndex(v) },
})
const editMode = computed({
  get: () => mindmapStore.ui.editMode,
  set: (v) => { mindmapStore.ui.editMode = v },
})
const edgeConnecting = computed({
  get: () => mindmapStore.ui.edgeConnecting,
  set: (v) => { mindmapStore.ui.edgeConnecting = v },
})
const connectSourceId = computed({
  get: () => mindmapStore.connectSourceId,
  set: (v) => { mindmapStore.connectSourceId = v },
})
const collapsedNodes = mindmapStore.collapsedNodeIds
const searchMatches = mindmapStore.searchMatches
const ctxMenu = mindmapStore.ui.contextMenu
const collapsedLabel = computed(() =>
  isNodeCollapsed(ctxMenu.nodeId) ? '展开子节点' : '折叠子节点',
)
const breadcrumb = computed(() => mindmapStore.breadcrumb)

// ===== UI State: tooltip / minimap / selection =====
const hoveredNode = ref<CanvasNode | null>(null)
const tooltipPos = reactive({ x: 0, y: 0 })
const containerSize = reactive({ width: 0, height: 0 })
const selectionRectOverlay = ref<{ x: number; y: number; w: number; h: number } | null>(null)

let _mouseMoveHandler: ((e: MouseEvent) => void) | null = null
function attachMouseTracker(): void {
  if (_mouseMoveHandler) return
  _mouseMoveHandler = (e: MouseEvent) => {
    tooltipPos.x = e.clientX
    tooltipPos.y = e.clientY
  }
  window.addEventListener('mousemove', _mouseMoveHandler)
}
function detachMouseTracker(): void {
  if (_mouseMoveHandler) {
    window.removeEventListener('mousemove', _mouseMoveHandler)
    _mouseMoveHandler = null
  }
}

// 监听 store 高亮变化 → 触发重画
watch(() => mindmapStore.highlightedNodeIds.size, () => renderer.markDirty())
watch(() => mindmapStore.aiSuggestionHints.length, () => renderer.markDirty())

// ===== Section Manager =====
const sectionMgr = useSection({
  getNodes: () => canvasNodes.value,
  getEdges: () => canvasEdges.value,
})

// ===== Selected Node Computed =====
const selectedNodeName = computed(() => {
  const n = canvasNodes.value.find(n => n.id === selectedNodeId.value)
  return n?.name || ''
})
const selectedNodeType = computed(() => {
  const n = canvasNodes.value.find(n => n.id === selectedNodeId.value)
  return n?.type || ''
})
const selectedNodeTags = computed(() => {
  const n = canvasNodes.value.find(n => n.id === selectedNodeId.value)
  return n?.tags?.join(', ') || ''
})
const selectedNodeDesc = computed(() => {
  const n = canvasNodes.value.find(n => n.id === selectedNodeId.value)
  return n?.description || ''
})
const selectedNodeProperties = computed(() => {
  if (!selectedNodeId.value) return {}
  const entity = entityStore.entities.find(e => e.id === selectedNodeId.value)
  return entity?.properties || {}
})

// ===== Active Types（实体类型选择器候选）=====
const activeTypes = computed(() => {
  const customTypes = new Set(['textbox', 'image', 'note', 'link', 'group', 'center', 'section'])
  const used = new Set(entityStore.entities.map(e => e.type))
  return graphNodes.value
    .filter(n => used.has(n.type) && !customTypes.has(n.type))
    .reduce((acc, n) => {
      if (!acc.find(a => a.type === n.type)) {
        acc.push({ type: n.type, label: n.label, icon: n.icon })
      }
      return acc
    }, [] as { type: string; label: string; icon: string }[])
})

// ===== Helper Functions =====
function toggleEditMode() {
  editMode.value = !editMode.value
  if (!editMode.value && edgeConnecting.value) {
    edgeConnecting.value = false
    connectSourceId.value = ''
  }
}

function isNodeCollapsed(id: string): boolean { return collapsedNodes.has(id) }

function zoomIn() { renderer.zoomIn() }
function zoomOut() { renderer.zoomOut() }
function fitView() { renderer.fitView(canvasNodes.value) }

const { exportPNG, exportSVG } = useMindmapExport()
function onExportPNG() { exportPNG(renderer.canvas.value) }
function onExportSVG() { exportSVG(canvasNodes.value, canvasEdges.value) }

// ===== Search =====
let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchMatches.length = 0
    if (!searchQuery.value) {
      canvasNodes.value.forEach(n => n.searchHighlight = false)
      return
    }
    const q = searchQuery.value.toLowerCase()
    canvasNodes.value.forEach(n => {
      n.searchHighlight = n.name.toLowerCase().includes(q)
      if (n.searchHighlight) searchMatches.push(n.id)
    })
    renderer.markDirty()
  }, 300)
}

// ===== Selection Operations =====
function deleteSelectedNodes() {
  for (const id of selectedNodes) {
    const entity = entityStore.entities.find(e => e.id === id)
    if (entity) entityStore.remove(id)
  }
  nodeOps.deleteSelected(selectedNodes)
  mindmapStore.clearSelection()
  rebuildGraph()
}

function clearNodeSelection() { mindmapStore.clearSelection() }

function createSectionFromSelection() {
  if (selectedNodes.size === 0) return
  sectionMgr.createFromSelection([...selectedNodes])
  mindmapStore.clearSelection()
}

function enterSelectedNode() {
  if (!selectedNodeId.value) return
  const node = canvasNodes.value.find(n => n.id === selectedNodeId.value)
  if (node && !['textbox', 'image', 'note', 'link', 'group', 'center', 'section'].includes(node.type)) {
    enterNestedNode(node.id)
  }
}

function focusSelectedNode() {
  if (!selectedNodeId.value) return
  const node = canvasNodes.value.find(n => n.id === selectedNodeId.value)
  if (node) {
    renderer.camera.value = { x: node.x, y: node.y, k: 1.5 }
  }
}

function navigateToEntity(entityId: string) {
  const node = canvasNodes.value.find(n => n.id === entityId)
  if (node) {
    renderer.camera.value = { x: node.x, y: node.y, k: 1.5 }
    selectedNodeId.value = entityId
  }
}

// ===== Minimap & Search Navigation =====
function onMinimapJump(wx: number, wy: number): void {
  renderer.camera.value = { ...renderer.camera.value, x: wx, y: wy }
  renderer.markDirty()
}

function searchNext(): void {
  if (searchMatches.length === 0) return
  searchMatchIndex.value = (searchMatchIndex.value + 1) % searchMatches.length
  focusSearchMatch()
}
function searchPrev(): void {
  if (searchMatches.length === 0) return
  searchMatchIndex.value = (searchMatchIndex.value - 1 + searchMatches.length) % searchMatches.length
  focusSearchMatch()
}
function focusSearchMatch(): void {
  const id = searchMatches[searchMatchIndex.value]
  const node = canvasNodes.value.find(n => n.id === id)
  if (!node) return
  renderer.camera.value = { x: node.x, y: node.y, k: Math.max(renderer.camera.value.k, 1) }
  selectedNodeId.value = id
  renderer.markDirty()
}

// ===== Align & Distribute =====
function alignSelection(direction: 'h' | 'v'): void {
  const sel = canvasNodes.value.filter(n => selectedNodes.has(n.id))
  if (sel.length < 2) return
  if (direction === 'h') {
    const targetY = sel.reduce((s, n) => s + n.y, 0) / sel.length
    for (const n of sel) n.y = targetY
  } else {
    const targetX = sel.reduce((s, n) => s + n.x, 0) / sel.length
    for (const n of sel) n.x = targetX
  }
  renderer.markDirty()
}
function distributeSelection(): void {
  const sel = canvasNodes.value.filter(n => selectedNodes.has(n.id))
  if (sel.length < 3) return
  // 按 x 排序后均匀分布
  sel.sort((a, b) => a.x - b.x)
  const minX = sel[0].x
  const maxX = sel[sel.length - 1].x
  const step = (maxX - minX) / (sel.length - 1)
  sel.forEach((n, i) => { n.x = minX + i * step })
  renderer.markDirty()
}

// ===== Undo/Redo =====
const canUndo = ref(false)
const canRedo = ref(false)
function refreshUndoRedoState(): void {
  canUndo.value = (undoRedo as any).history?.length > 0
  canRedo.value = (undoRedo as any).future?.length > 0
}
function doUndo(): void {
  undoRedo.undo(entityStore, relationStore)
  refreshUndoRedoState()
  rebuildGraph()
}
function doRedo(): void {
  undoRedo.redo(entityStore, relationStore)
  refreshUndoRedoState()
  rebuildGraph()
}

// ===== AI Organize（自动布局 + 找孤立 + 找环）=====
function onAIOrganize(): void {
  // 1. 自动布局
  layoutName.value = 'force'
  applyLayout()
  // 2. 找孤立 + 找环 + 把高亮发给 Agent
  const isolated = findIsolatedNodes(canvasNodes.value, canvasEdges.value)
  const cycles = findCycles(canvasNodes.value, canvasEdges.value)
  const cycleNodes = new Set<string>()
  for (const c of cycles) for (const id of c) cycleNodes.add(id)
  mindmapStore.setHighlighted([...isolated, ...cycleNodes])
  // 3. 把信息回传给 agent
  const detail = {
    isolatedCount: isolated.length,
    cycleCount: cycles.length,
    cycleNodes: [...cycleNodes],
    suggestedAction: 'autoLayout + highlightIssues',
  }
  window.dispatchEvent(new CustomEvent('worldsmith:agent:plugin-action', {
    detail: { pluginId: 'mindmap', action: 'ai_organize_result', payload: detail, timestamp: Date.now() },
  }))
  // 4. 弹 toast
  if (isolated.length > 0 || cycles.length > 0) {
    console.info(`[Mindmap AI 整理] 发现 ${isolated.length} 个孤立节点、${cycles.length} 个环，已高亮`)
  } else {
    console.info('[Mindmap AI 整理] 节点结构良好')
  }
}

// ===== Agent 通信 =====
const _isMindmapActive = ref(true)
useAgentBridge(_isMindmapActive, {
  autoLayout: (algorithm) => {
    layoutName.value = algorithm
    applyLayout()
  },
  findIsolated: () => {
    const ids = findIsolatedNodes(canvasNodes.value, canvasEdges.value)
    mindmapStore.setHighlighted(ids)
    mindmapStore.selectAll(ids)
    if (ids.length > 0) selectedNodeId.value = ids[0]
    renderer.markDirty()
  },
  findCycles: () => {
    const cycles = findCycles(canvasNodes.value, canvasEdges.value)
    const ids = new Set<string>()
    for (const c of cycles) for (const id of c) ids.add(id)
    mindmapStore.setHighlighted([...ids])
    mindmapStore.selectAll([...ids])
    renderer.markDirty()
  },
  highlightPath: (sourceId, targetId) => {
    const path = findShortestPath(canvasNodes.value, canvasEdges.value, sourceId, targetId)
    if (!path) {
      mindmapStore.setHighlighted([])
      return
    }
    mindmapStore.setHighlighted(path, { sourceId, targetId, path })
    mindmapStore.selectAll(path)
    if (path[0]) selectedNodeId.value = path[0]
    // 视图聚焦路径中点
    const midNode = canvasNodes.value.find(n => n.id === path[Math.floor(path.length / 2)])
    if (midNode) renderer.camera.value = { x: midNode.x, y: midNode.y, k: 1.2 }
    renderer.markDirty()
  },
  suggestMoveToGroup: (nodeId, _groupId) => {
    // 简单实现：把节点的 sectionColor 临时设为 group 的颜色
    const group = canvasNodes.value.find(n => n.id === _groupId)
    if (!group) return
    const node = canvasNodes.value.find(n => n.id === nodeId)
    if (!node) return
    const color = (group as any).color || (group as any).sectionColor || '#6c5ce7'
    node.sectionColor = color
    mindmapStore.setNodeColor(nodeId, color)
    renderer.markDirty()
  },
  selectNode: (nodeId) => {
    selectedNodeId.value = nodeId
    const node = canvasNodes.value.find(n => n.id === nodeId)
    if (node) renderer.camera.value = { x: node.x, y: node.y, k: 1.5 }
    renderer.markDirty()
  },
  fitView: () => { fitView() },
  aiOrganize: () => onAIOrganize(),
})

// ===== Toolbar: 快捷创建思维导图实体 =====
async function createMindmapEntity(parentId: string | null, relationType?: string): Promise<string> {
  const id = `concept-${Date.now()}`
  const now = new Date().toISOString()
  await entityStore.add({
    id, type: 'concept', name: '新主题',
    description: '', properties: {}, tags: [],
    createdAt: now, updatedAt: now,
  })
  if (parentId) {
    const relType = relationType || 'associated_with'
    const relId = `rel-${Date.now()}`
    await relationStore.add({
      id: relId, type: relType,
      label: '关联',
      sourceId: parentId, targetId: id,
      properties: {},
      createdAt: now,
      updatedAt: now,
    })
  }
  await nextTick()
  rebuildGraph()
  // 自动选中并进入内联编辑
  selectedNodeId.value = id
  nextTick(() => {
    ctxEditName()
  })
  return id
}

function addChildNode() {
  const parentId = mindmapStore.focusedNodeId
  if (!parentId) return
  createMindmapEntity(parentId)
}

function addSiblingNode() {
  const focusedId = mindmapStore.focusedNodeId
  if (!focusedId) return
  // 找到选中节点的父节点
  const rels = relationStore.relations.filter(r => r.targetId === focusedId)
  const parentId = rels.length > 0 ? rels[0].sourceId : null
  createMindmapEntity(parentId)
}

// ===== Key Sequence =====
function handleKeySequence(seq: string) {
  switch (seq) {
    case 'n c': entityFormType.value = 'character'; showTypePicker.value = false; showEntityForm.value = true; break
    case 'n r': entityFormType.value = 'region'; showTypePicker.value = false; showEntityForm.value = true; break
    case 'n e': entityFormType.value = 'event'; showTypePicker.value = false; showEntityForm.value = true; break
    case 'n t': ctxAddTextbox(); break
    case 'e n': ctxEditName(); break
    case 'e d': ctxEditDescription(); break
    case 'c l': startEdgeConnect(); break
    case 'd n': ctxDeleteNode(); break
    case 'g s': createSectionFromSelection(); break
    case 'f n': focusSelectedNode(); break
    case 'j i': enterSelectedNode(); break
  }
}

const { currentSequence, availableNext, isActive: keyHintActive } = useKeySequence({
  sequences: KEY_SEQUENCES.map(ks => ({
    sequence: ks.sequence,
    description: ks.description,
    action: () => handleKeySequence(ks.sequence),
  })),
  singleKeys: {
    delete: () => deleteSelectedNodes(),
    escape: () => { if (mindmapStore.currentRootId) exitNested(); ctxMenu.show = false },
    i: () => mindmapStore.toggleDetailPanel(),
    f: () => fitView(),
  },
})

// ===== Shortcuts =====
const shortcuts = useShortcuts()
onMounted(() => {
  shortcuts.register({ id: 'mindmap.toggleDetail', keys: ['i'], description: '切换详情侧栏', scope: 'view', handler: () => mindmapStore.toggleDetailPanel() })
  shortcuts.register({ id: 'mindmap.fitView', keys: ['f'], description: '适应视图', scope: 'view', handler: () => fitView() })
  shortcuts.register({ id: 'mindmap.exitNested', keys: ['escape'], description: '返回上层', scope: 'view', handler: () => { if (mindmapStore.currentRootId) exitNested(); ctxMenu.show = false } })
  shortcuts.register({ id: 'mindmap.deleteNode', keys: ['delete'], description: '删除节点', scope: 'view', handler: () => deleteSelectedNodes() })
  shortcuts.register({ id: 'mindmap.undo', keys: ['ctrl', 'z'], description: '撤销', scope: 'view', handler: () => undoRedo.undo(entityStore, relationStore) })
  shortcuts.register({ id: 'mindmap.redo', keys: ['ctrl', 'y'], description: '重做', scope: 'view', handler: () => undoRedo.redo(entityStore, relationStore) })
  shortcuts.register({ id: 'mindmap.freeDraw', keys: ['d'], description: '自由绘图', scope: 'view', handler: () => toggleFreeDrawMode() })
  shortcuts.register({ id: 'mindmap.aiSuggest', keys: ['ctrl', 'j'], description: 'AI 关系建议', scope: 'view', handler: () => aiSuggestions.toggle() })
  // 思维导图快捷创建
  shortcuts.register({ id: 'mindmap.addChild', keys: ['tab'], description: '添加子主题', scope: 'view', handler: () => addChildNode() })
  shortcuts.register({ id: 'mindmap.addSibling', keys: ['enter'], description: '添加同级主题', scope: 'view', handler: () => addSiblingNode() })
})
onBeforeUnmount(() => {
  shortcuts.unregister('mindmap.toggleDetail')
  shortcuts.unregister('mindmap.fitView')
  shortcuts.unregister('mindmap.exitNested')
  shortcuts.unregister('mindmap.deleteNode')
  shortcuts.unregister('mindmap.undo')
  shortcuts.unregister('mindmap.redo')
  shortcuts.unregister('mindmap.freeDraw')
  shortcuts.unregister('mindmap.aiSuggest')
  shortcuts.unregister('mindmap.addChild')
  shortcuts.unregister('mindmap.addSibling')
})

// ===== Lifecycle =====
let _resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await entityStore.loadAll()
  await relationStore.loadAll()
  // 确保中心主题存在
  await mindmapStore.ensureCenterNode()
  await nextTick()
  buildCanvasData()
  renderer.init()
  canvasInteraction.bindEvents()
  applyLayout()
  renderer.setFreehandDrawFn((ctx, camera) => {
    freeDrawing.drawFreehandStrokes(ctx, camera, mindmapStore.currentRootId)
  })
  nextTick(() => renderer.fitView(canvasNodes.value))
  attachMouseTracker()
  refreshUndoRedoState()
  // 监听容器尺寸变化 → 同步物理 buffer + minimap
  if (containerRef.value) {
    _resizeObserver = new ResizeObserver(() => {
      renderer.resize()
      renderer.markDirty()
      if (containerRef.value) {
        containerSize.width = containerRef.value.clientWidth
        containerSize.height = containerRef.value.clientHeight
      }
    })
    _resizeObserver.observe(containerRef.value)
  }
})

onBeforeUnmount(() => {
  savePositions()
  canvasInteraction.unbindEvents()
  renderer.destroy()
  detachMouseTracker()
  _resizeObserver?.disconnect()
})

watch([graphNodes, graphEdges], () => {
  rebuildGraph()
}, { deep: true })

useAgentPluginBridge('mindmap', (event) => {
  console.log(`[Agent→${event.pluginId}] ${event.action}`, event.payload)
})
</script>

<style scoped>
.mindmap-view { display: flex; flex-direction: column; height: 100%; position: relative; overflow: hidden; }
.mm-canvas { flex: 1; min-height: 0; }
.mm-main-area { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.hidden-input { display: none; }
.mm-selection-overlay { position: absolute; background: rgba(79, 70, 229, 0.15); border: 1px solid rgba(79, 70, 229, 0.5); pointer-events: none; z-index: 10; }
.mm-connect-bar { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); background: var(--primary); color: var(--on-accent); padding: 6px 16px; border-radius: var(--radius-md); font-size: var(--font-size-sm); z-index: var(--z-detail); display: flex; align-items: center; gap: 4px; }
.mm-inline-edit { position: absolute; z-index: var(--z-detail); display: flex; gap: 4px; background: var(--card-bg); padding: 4px; border-radius: var(--radius-md); box-shadow: var(--shadow-lg); border: 1px solid var(--border-color); }
.mm-inline-input { border: none; border-bottom: 1px solid var(--border-color); background: transparent; color: var(--text-color); padding: 2px 6px; font-size: var(--font-size-sm); outline: none; }
.mm-inline-input:focus { border-bottom-color: var(--primary); }
.mm-btn-sm { padding: 4px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; cursor: pointer; font-size: var(--font-size-sm); display: flex; align-items: center; gap: 2px; }
.mm-btn-sm:hover { background: var(--hover-bg); }
</style>
