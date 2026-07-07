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

    <div v-if="freeDrawing.isFreeDrawMode.value" class="mm-freedraw-bar">
      <span class="mm-freedraw-label"><WsIcon name="brush" size="xs" /> 绘图</span>
      <button
        v-for="c in freeDrawing.colorPresets" :key="c"
        class="mm-freedraw-color"
        :class="{ active: freeDrawing.drawColor.value === c }"
        :style="{ background: c }"
        @click="freeDrawing.drawColor.value = c"
      ></button>
      <select class="mm-freedraw-width" :value="freeDrawing.drawWidth.value" @change="freeDrawing.drawWidth.value = Number(($event.target as HTMLSelectElement).value)">
        <option value="2">细</option>
        <option value="3">中</option>
        <option value="5">粗</option>
        <option value="8">超粗</option>
      </select>
      <button class="mm-btn-sm" @click="undoFreeDrawStroke">撤销</button>
      <button class="mm-btn-sm" @click="clearFreeDrawStrokes"><WsIcon name="delete" size="xs" /> 清除</button>
      <button class="mm-btn-sm" @click="toggleFreeDrawMode"><WsIcon name="close" size="xs" /> 退出</button>
    </div>

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

    <div v-if="showInlineEdit" class="mm-inline-edit" :style="inlineEditStyle">
      <input ref="inlineInputRef" v-model="inlineEditText" class="mm-inline-input" aria-label="编辑名称" @keyup.enter="commitInlineEdit" @keyup.esc="cancelInlineEdit" />
      <button class="mm-btn-sm" @click="commitInlineEdit"><WsIcon name="check" size="xs" /></button>
      <button class="mm-btn-sm" @click="cancelInlineEdit"><WsIcon name="close" size="xs" /></button>
    </div>

    <Transition name="ws-scale-fade">
      <div v-if="showTypePicker" class="mm-modal-backdrop" @click.self="showTypePicker = false">
        <div class="mm-modal">
          <h4>选择实体类型</h4>
          <div class="mm-modal-grid">
            <button v-for="t in activeTypes" :key="t.type" class="mm-type-card" @click="onPickType(t.type)">
              <WsIcon :name="resolveIcon(t.icon)" size="lg" :fallback="t.icon" />
              <span>{{ t.label }}</span>
            </button>
          </div>
          <button class="mm-btn" @click="showTypePicker = false">取消</button>
        </div>
      </div>
    </Transition>

    <Transition name="ws-scale-fade">
      <div v-if="showRelationPicker" class="mm-modal-backdrop" @click.self="showRelationPicker = false">
        <div class="mm-modal">
          <h4>选择关系类型</h4>
          <div class="mm-modal-grid">
            <button v-for="rt in availableRelationTypes" :key="rt.type" class="mm-type-card" @click="onPickRelation(rt)">
              <span>{{ rt.label }}</span>
            </button>
          </div>
          <button class="mm-btn" @click="showRelationPicker = false">取消</button>
        </div>
      </div>
    </Transition>

    <Transition name="ws-scale-fade">
      <div v-if="showTagEditor" class="mm-modal-backdrop" @click.self="showTagEditor = false">
        <div class="mm-modal">
          <h4>编辑标签</h4>
          <textarea v-model="tagEditorText" class="mm-textarea" placeholder="每行一个标签" rows="6"></textarea>
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button class="mm-btn" @click="saveTags">保存</button>
            <button class="mm-btn" @click="showTagEditor = false">取消</button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="ws-scale-fade">
      <div v-if="showDescEditor" class="mm-modal-backdrop" @click.self="showDescEditor = false">
        <div class="mm-modal">
          <h4>编辑描述</h4>
          <textarea v-model="descEditorText" class="mm-textarea" placeholder="输入描述" rows="8"></textarea>
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button class="mm-btn" @click="saveDescription">保存</button>
            <button class="mm-btn" @click="showDescEditor = false">取消</button>
          </div>
        </div>
      </div>
    </Transition>

    <div v-if="selectedNodes.size >= 1" class="mm-batch-bar">
      已选 {{ selectedNodes.size }} 个节点
      <button class="mm-btn-sm" @click="deleteSelectedNodes"><WsIcon name="delete" size="xs" /> 删除</button>
      <button class="mm-btn-sm" @click="clearNodeSelection"><WsIcon name="close" size="xs" /> 取消</button>
    </div>

    <div v-if="imageViewer.show" class="mm-img-viewer" @click="imageViewer.show = false">
      <img :src="imageViewer.url" class="mm-img-viewer-img" />
    </div>

    <EntityFormModal v-model="showEntityForm" :title="editingEntity ? '编辑实体' : '新建实体'" :entity="editingEntity" :fields="getFormFields(entityFormType)" :entity-type="entityFormType" @save="onEntityFormSave" />

    <Transition name="ws-scale-fade">
      <div v-if="showColorPicker" class="mm-modal-backdrop" @click.self="showColorPicker = false">
        <div class="mm-modal">
          <h4>选择颜色</h4>
          <div class="mm-color-grid">
            <button v-for="c in presetColors" :key="c" class="mm-color-btn" :style="{ background: c }" @click="onPickColor(c)"></button>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
            <input v-model="customColor" type="color" class="mm-color-input" aria-label="自定义颜色" />
            <button class="mm-btn" @click="onPickColor(customColor)">自定义</button>
            <button class="mm-btn" @click="onPickColor('')">清除</button>
            <button class="mm-btn" @click="showColorPicker = false">取消</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import WsIcon from '../../../ui/WsIcon.vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import type { Entity, Relation } from '@worldsmith/entity-core'
import { EmptyState, EntityFormModal, type FormFieldDef, deduplicateEdges, useShortcuts, useUndoRedo, useGraphData, useTypeMapping } from '@worldsmith/ui-kit'
import MindmapToolbar from './components/MindmapToolbar.vue'
import MindmapNodeTooltip from './components/MindmapNodeTooltip.vue'
import { nodeSize, guessRelType, resolveIcon } from './mindmapConfig'
import { relationSchemaRegistry } from '@worldsmith/entity-core'
import { useMindmapStore } from './mindmapStore'
import { useSection } from './composables/useSection'
import { useKeySequence } from './composables/useKeySequence'
import { edgeLineStyle, KEY_SEQUENCES } from './mindmapConfig'
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
import { getEdgeColor } from '@worldsmith/entity-core'
import { useAgentPluginBridge } from '../../../composables/useAgentPluginBridge'
import { useAgentBridge } from './composables/useAgentBridge'
import { useMindmapNodeOps } from './composables/useMindmapNodeOps'
import { useMindmapKeyboardNav } from './composables/useMindmapKeyboardNav'
import Minimap from './composables/Minimap.vue'
import { findIsolatedNodes, findCycles, findShortestPath } from './composables/useGraphAnalysis'
import { useRustLayout } from './composables/useRustLayout'
import { useMindmapExport } from './composables/useMindmapExport'
import { useLayoutAnimation } from './composables/useLayoutAnimation'
import type { LayoutAlgorithmType } from './mindmapStore'

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const mindmapStore = useMindmapStore()
const undoRedo = useUndoRedo()
const { nodes: graphNodes, edges: graphEdges } = useGraphData()
const { getColor, getIcon, getLabel } = useTypeMapping()

const containerRef = ref<HTMLDivElement | null>(null)
const imageInputRef = ref<HTMLInputElement>()
const inlineInputRef = ref<HTMLInputElement>()

const canvasNodes = ref<CanvasNode[]>([])
const canvasEdges = ref<CanvasEdge[]>([])

// 使用 Store 的选择/聚焦状态
const selectedNodeId = computed({
  get: () => mindmapStore.focusedNodeId || '',
  set: (v) => { mindmapStore.focusedNodeId = v || null },
})
const selectedNodes = mindmapStore.selectedNodeIds

const nodeOps = useMindmapNodeOps({ canvasNodes, canvasEdges })

const renderer = useCanvasRenderer(
  containerRef,
  () => canvasNodes.value,
  () => canvasEdges.value,
  () => mindmapStore.aiSuggestionHints,
  () => mindmapStore.highlightedNodeIds,
)

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

const rustLayout = useRustLayout()
const layoutAnim = useLayoutAnimation()

const interactionCallbacks: CanvasInteractionCallbacks = {
  onNodeClick: (node, e) => {
    mindmapStore.hideContextMenu()
    if (mindmapStore.ui.edgeConnecting) {
      const srcId = mindmapStore.connectSourceId
      if (node.id === srcId) return
      _edgeSrcId = srcId
      _edgeTgtId = node.id
      _relTypId = ''
      const srcNode = canvasNodes.value.find(n => n.id === srcId)
      const srcType = srcNode?.type || ''
      const tgtType = node.type
      const guessed = guessRelType(srcType, tgtType)
      const rels = relationSchemaRegistry.getAll().filter(rt => {
        return (rt.sourceTypes.includes(srcType) || rt.sourceTypes.includes('*')) &&
               (rt.targetTypes.includes(tgtType) || rt.targetTypes.includes('*'))
      })
      if (rels.length > 0) {
        _relTypId = rels[0].type
        availableRelationTypes.value = rels.map(r => ({ type: r.type, label: r.label || r.type }))
        if (rels.find(r => r.type === guessed)) _relTypId = guessed
      }
      mindmapStore.cancelEdgeConnect()
      if (_relTypId) createRelationEdge(_edgeSrcId, _edgeTgtId, _relTypId)
      else {
        availableRelationTypes.value = rels.map(r => ({ type: r.type, label: r.label || r.type }))
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

function toggleFreeDrawMode(): void {
  freeDrawing.toggleFreeDrawMode()
}

function undoFreeDrawStroke(): void {
  freeDrawing.undoStroke()
}

function clearFreeDrawStrokes(): void {
  freeDrawing.clearStrokes(mindmapStore.currentRootId)
}

const aiSuggestions = useAISuggestions()

function onAISuggestionAnalyze(): void {
  aiSuggestions.analyze(canvasNodes.value)
}

function onAISuggestionAnalyzeWithAI(): void {
  aiSuggestions.analyzeWithAI(canvasNodes.value)
}

function onAISuggestionAnalyzeSelection(): void {
  aiSuggestions.analyzeSelection(canvasNodes.value, selectedNodes)
}

function onAISuggestionAnalyzeSelectionWithAI(): void {
  aiSuggestions.analyzeSelectionWithAI(canvasNodes.value, selectedNodes)
}

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

const zoomLevel = computed(() => Math.round(mindmapStore.camera.k * 100))
const layoutName = computed({
  get: () => mindmapStore.layoutAlgorithm,
  set: (v: LayoutAlgorithmType) => { mindmapStore.setLayout(v) },
})
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

const visibleTypes = mindmapStore.visibleEntityTypes
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

// 右键菜单使用 Store
const ctxMenu = mindmapStore.ui.contextMenu
const collapsedLabel = computed(() =>
  isNodeCollapsed(ctxMenu.nodeId) ? '展开子节点' : '折叠子节点',
)

// ===== 新增 UI 状态：tooltip / minimap / 选区提示 =====
const hoveredNode = ref<CanvasNode | null>(null)
const tooltipPos = reactive({ x: 0, y: 0 })
const containerSize = reactive({ width: 0, height: 0 })
const selectionRectOverlay = ref<{ x: number; y: number; w: number; h: number } | null>(null)

// 全局鼠标移动 → 更新 tooltip 位置（使用 ref+watch 保持轻量）
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

const sectionMgr = useSection({
  getNodes: () => canvasNodes.value,
  getEdges: () => canvasEdges.value,
})

const breadcrumb = computed(() => mindmapStore.breadcrumb)

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
onBeforeUnmount(() => {
  shortcuts.unregister('mindmap.toggleDetail')
  shortcuts.unregister('mindmap.fitView')
  shortcuts.unregister('mindmap.exitNested')
  shortcuts.unregister('mindmap.deleteNode')
  shortcuts.unregister('mindmap.undo')
  shortcuts.unregister('mindmap.redo')
  shortcuts.unregister('mindmap.freeDraw')
  shortcuts.unregister('mindmap.aiSuggest')
})

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

const showInlineEdit = ref(false)
const inlineEditText = ref('')
const inlineEditTarget = ref<string>('')
const inlineEditStyle = ref({ left: '0px', top: '0px' })

const showTypePicker = ref(false)
const showRelationPicker = ref(false)
const showTagEditor = ref(false)
const showDescEditor = ref(false)
const showColorPicker = ref(false)
const tagEditorText = ref('')
const tagEditorTargetId = ref('')
const descEditorText = ref('')
const descEditorTargetId = ref('')

const showEntityForm = ref(false)
const editingEntity = ref<Entity | null>(null)
const entityFormType = ref('character')
const availableRelationTypes = ref<{ type: string; label: string }[]>([])

const imageViewer = reactive<{ show: boolean; url: string }>({ show: false, url: '' })

const customColor = ref('#4f46e5')
const presetColors = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#78716c', '#000000', '#ffffff']

let _relTypId = ''
let _edgeSrcId = ''
let _edgeTgtId = ''

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

function getFormFields(_type: string): FormFieldDef[] {
  return [
    { key: 'name', label: '名称', type: 'text', required: true, placeholder: '名称' },
    { key: 'description', label: '描述', type: 'textarea' },
    { key: 'tags', label: '标签', type: 'tags' },
  ]
}

function toggleEditMode() {
  editMode.value = !editMode.value
  if (!editMode.value && edgeConnecting.value) {
    edgeConnecting.value = false
    connectSourceId.value = ''
  }
}

function isNodeCollapsed(id: string): boolean { return collapsedNodes.has(id) }

function buildCanvasData(): void {
  const nodes: CanvasNode[] = []
  const edges: CanvasEdge[] = []
  const rootId = mindmapStore.currentRootId
  const saved = mindmapStore.nodePositions
  const customColors = mindmapStore.nodeCustomColors
  const collapsed = mindmapStore.collapsedNodeIds
  const focusedId = mindmapStore.focusedNodeId
  const searchMatchIds = mindmapStore.searchMatches
  const vTypes = visibleTypes

  if (rootId === null) {
    const centerId = mindmapStore.centerNodeId
    // 计算画布中心（优先使用已保存的位置）
    const canvasCenter = { x: 500, y: 350 }
    for (const e of graphNodes.value) {
      if (!(vTypes instanceof Set ? vTypes.has(e.type) : true)) continue
      const isCenter = centerId === e.id
      const color = getColor(e.type, 'warm')
      const size = isCenter ? 80 : nodeSize(e.degree)
      const pos = saved[e.id]
      nodes.push({
        id: e.id, name: e.name, type: e.type,
        x: isCenter ? (pos?.x ?? canvasCenter.x) : (pos?.x ?? Math.random() * 800),
        y: isCenter ? (pos?.y ?? canvasCenter.y) : (pos?.y ?? Math.random() * 600),
        vx: 0, vy: 0,
        fx: isCenter ? (pos?.x ?? canvasCenter.x) : (pos?.x ?? null),
        fy: isCenter ? (pos?.y ?? canvasCenter.y) : (pos?.y ?? null),
        width: isCenter ? 140 : size * 2.5,
        height: isCenter ? 80 : size * 1.5,
        color, icon: e.icon, label: e.label,
        tags: e.tags, description: e.description, degree: e.degree,
        customColor: customColors.get(e.id) || '',
        isRoot: isCenter,
        isCollapsed: collapsed.has(e.id),
        childCount: 0,
        centerStyle: isCenter ? 'gold' : '',
        textboxSize: '', textboxStyle: '',
        imageUrl: '', linkUrl: '', hidden: false,
        selected: focusedId === e.id,
        highlighted: false, searchHighlight: searchMatchIds.includes(e.id),
        sectionColor: '',
      })
    }
    const nodeIds = new Set(nodes.map(n => n.id))
    for (const me of graphEdges.value) {
      if (!nodeIds.has(me.source) || !nodeIds.has(me.target)) continue
      const override = mindmapStore.edgeStyleOverrides[me.id]
      const defaultStyle = edgeLineStyle(me.relType)
      edges.push({
        id: me.id, source: me.source, target: me.target,
        sourceId: me.source, targetId: me.target,
        label: me.relLabel, arrow: !me.symmetric, bidir: me.bidirectional || me.symmetric,
        relType: me.relType, relLabel: me.relLabel,
        bidirectional: me.bidirectional, symmetric: me.symmetric,
        color: getEdgeColor(me.relType, 'warm'),
        curveStyle: override ? override.lineStyle as any : defaultStyle,
        dashed: false, noArrow: me.symmetric,
        hidden: false, selected: false,
      })
    }
  } else {
    const rootEntity = entityStore.entities.find(e => e.id === rootId)
    if (!rootEntity) { canvasNodes.value = []; canvasEdges.value = []; return }

    const rootColor = getColor(rootEntity.type, 'warm')
    nodes.push({
      id: rootEntity.id, name: rootEntity.name, type: rootEntity.type,
      x: 400, y: 300, vx: 0, vy: 0, fx: 400, fy: 300,
      width: 120, height: 120,
      color: rootColor, icon: getIcon(rootEntity.type), label: getLabel(rootEntity.type),
      tags: rootEntity.tags || [], description: rootEntity.description || '', degree: 0,
      customColor: customColors.get(rootEntity.id) || '',
      isRoot: true, isCollapsed: false, childCount: 0,
      centerStyle: '', textboxSize: '', textboxStyle: '',
      imageUrl: '', linkUrl: '', hidden: false,
      selected: false, highlighted: false, searchHighlight: false, sectionColor: '',
    })

    const directRels = relationStore.relations.filter(r => r.sourceId === rootId || r.targetId === rootId)
    const neighborIds = new Set<string>()
    for (const r of directRels) {
      const neighborId = r.sourceId === rootId ? r.targetId : r.sourceId
      neighborIds.add(neighborId)
    }
    for (const nid of neighborIds) {
      const entity = entityStore.entities.find(e => e.id === nid)
      if (!entity || !(vTypes instanceof Set ? vTypes.has(entity.type) : true)) continue
      const color = getColor(entity.type, 'warm')
      nodes.push({
        id: entity.id, name: entity.name, type: entity.type,
        x: 400 + (Math.random() - 0.5) * 300, y: 300 + (Math.random() - 0.5) * 300,
        vx: 0, vy: 0, fx: null, fy: null,
        width: 80, height: 50,
        color, icon: getIcon(entity.type), label: getLabel(entity.type),
        tags: entity.tags || [], description: entity.description || '', degree: 0,
        customColor: customColors.get(entity.id) || '',
        isRoot: false, isCollapsed: false, childCount: 0,
        centerStyle: '', textboxSize: '', textboxStyle: '',
        imageUrl: '', linkUrl: '', hidden: false,
        selected: false, highlighted: false, searchHighlight: false, sectionColor: '',
      })
    }

    const visitedIds = new Set(nodes.map(n => n.id))
    const visibleRels = directRels.filter(r => visitedIds.has(r.sourceId) && visitedIds.has(r.targetId))
    const merged = deduplicateEdges(visibleRels, (type) => type)
    for (const me of merged) {
      const override = mindmapStore.edgeStyleOverrides[me.id]
      const defaultStyle = edgeLineStyle(me.relType)
      edges.push({
        id: me.id, source: me.source, target: me.target,
        sourceId: me.source, targetId: me.target,
        label: me.relLabel, arrow: !me.symmetric, bidir: me.bidirectional || me.symmetric,
        relType: me.relType, relLabel: me.relLabel,
        bidirectional: me.bidirectional, symmetric: me.symmetric,
        color: getEdgeColor(me.relType, 'warm'),
        curveStyle: override ? override.lineStyle as any : defaultStyle,
        dashed: false, noArrow: me.symmetric,
        hidden: false, selected: false,
      })
    }

    for (const [cnId, cn] of Object.entries(mindmapStore.customNodes)) {
      if (cn.parentId === rootId) {
        nodes.push({
          id: cnId, name: cn.name, type: cn.type,
          x: cn.position?.x || 500, y: cn.position?.y || 400,
          vx: 0, vy: 0, fx: cn.position?.x || null, fy: cn.position?.y || null,
          width: 80, height: 50,
          color: '#78909c', icon: 'edit', label: cn.type,
          tags: [], description: '', degree: 0, customColor: '',
          isRoot: false, isCollapsed: false, childCount: 0,
          centerStyle: '', textboxSize: '', textboxStyle: '',
          imageUrl: '', linkUrl: '', hidden: false,
          selected: false, highlighted: false, searchHighlight: false, sectionColor: '',
          ...cn.style,
        })
      }
    }
  }

  canvasNodes.value = nodes
  canvasEdges.value = edges
}

function mapToGraphData() {
  const gNodes = canvasNodes.value.map(n => ({
    id: n.id, name: n.name, type: n.type, label: n.label,
    icon: n.icon, shape: '', coolColor: n.color, warmColor: n.color,
    tags: n.tags || [], description: n.description || '', degree: n.degree,
  }))
  const gEdges = canvasEdges.value.map(e => ({
    id: e.id, source: e.source, target: e.target,
    relType: e.relType, relLabel: e.relLabel || '',
    bidirectional: e.bidirectional, symmetric: e.symmetric,
    relationIds: [e.id], coolColor: e.color, warmColor: e.color,
    dashed: e.dashed, noArrow: e.noArrow, curveStyle: e.curveStyle,
  }))
  return { gNodes, gEdges }
}

function onLayoutChange(v: string) {
  layoutName.value = v as LayoutAlgorithmType
  applyLayout()
}

async function applyLayout() {
  const algo = layoutName.value as LayoutAlgorithmType
  const { gNodes, gEdges } = mapToGraphData()

  try {
    let positions: { id: string; x: number; y: number }[] = []

    if (algo === 'tree') {
      if (!mindmapStore.currentRootId) return
      positions = await rustLayout.applyLayout('tree', gNodes, gEdges, { rootId: mindmapStore.currentRootId })
    } else if (algo === 'mindmapTree') {
      const centerId = mindmapStore.centerNodeId
      if (!centerId) return
      const rect = containerRef.value?.getBoundingClientRect()
      positions = await rustLayout.applyLayout('mindmapTree', gNodes, gEdges, {
        centerId,
        centerX: rect ? rect.width / 2 : 400,
        centerY: rect ? rect.height / 2 : 300,
        radiusStep: 140,
      })
    } else {
      positions = await rustLayout.applyLayout(algo, gNodes, gEdges, {})
    }

    // 构建动画目标（跳过被手动固定的节点）
    const targets: Array<{
      node: import('./composables/canvasTypes').CanvasNode
      fromX: number; fromY: number; toX: number; toY: number
    }> = []
    for (const pos of positions) {
      const node = canvasNodes.value.find(n => n.id === pos.id)
      // 中心节点 (isRoot) 不参与布局动画，始终固定
      if (node && !node.isRoot && node.fx === null && (Math.abs(node.x - pos.x) > 2 || Math.abs(node.y - pos.y) > 2)) {
        targets.push({ node, fromX: node.x, fromY: node.y, toX: pos.x, toY: pos.y })
      }
    }

    if (targets.length > 0) {
      layoutAnim.animateToTargets(targets, () => {
        renderer.markDirty()
      })
    } else {
      // 无可见变化时直接设置 + 重绘（跳过中心节点）
      for (const pos of positions) {
        const node = canvasNodes.value.find(n => n.id === pos.id)
        if (node && !node.isRoot && node.fx === null) { node.x = pos.x; node.y = pos.y }
      }
      renderer.markDirty()
    }
  } catch {
    renderer.markDirty()
  }
  savePositions()
}

function rebuildGraph() {
  buildCanvasData()
  applyLayout()
  nextTick(() => renderer.fitView(canvasNodes.value))
}

function zoomIn() { renderer.zoomIn() }
function zoomOut() { renderer.zoomOut() }
function fitView() { renderer.fitView(canvasNodes.value) }

const { exportPNG, exportSVG } = useMindmapExport()
function onExportPNG() { exportPNG(renderer.canvas.value) }
function onExportSVG() { exportSVG(canvasNodes.value, canvasEdges.value) }

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

function createRelationEdge(srcId: string, tgtId: string, relType: string) {
  const edgeId = `rel-${Date.now()}`
  const rt = relationSchemaRegistry.getAll().find(r => r.type === relType)
  canvasEdges.value.push({
    id: edgeId, source: srcId, target: tgtId,
    sourceId: srcId, targetId: tgtId,
    label: rt?.label || relType, arrow: true, bidir: false,
    relType, relLabel: rt?.label || relType,
    bidirectional: false, symmetric: false,
    color: getEdgeColor(relType, 'warm'),
    curveStyle: edgeLineStyle(relType) as any,
    dashed: false, noArrow: false, hidden: false, selected: false,
  })
  const newRel: Relation = {
    id: edgeId, type: relType,
    label: rt?.label || relType,
    sourceId: srcId, targetId: tgtId,
    properties: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  relationStore.add(newRel)
}

function ctxCreateNode() {
  ctxMenu.show = false
  showTypePicker.value = true
}

function onPickType(type: string) {
  showTypePicker.value = false
  entityFormType.value = type
  editingEntity.value = null
  showEntityForm.value = true
}

function onPickRelation(rt: { type: string; label: string }) {
  showRelationPicker.value = false
  _relTypId = rt.type
  createRelationEdge(_edgeSrcId, _edgeTgtId, _relTypId)
}

async function onEntityFormSave(data: { name: string; description: string; properties: Record<string, any>; tags: string[] }) {
  const now = new Date().toISOString()
  if (editingEntity.value) {
    await entityStore.update(editingEntity.value.id, { name: data.name, description: data.description, properties: data.properties, tags: data.tags })
  } else {
    const entity: Entity = {
      id: `${entityFormType.value.slice(0, 4)}-${Date.now()}`,
      type: entityFormType.value, name: data.name, description: data.description,
      properties: data.properties, tags: data.tags, createdAt: now, updatedAt: now,
    }
    await entityStore.add(entity)
  }
  showEntityForm.value = false
  await entityStore.loadAll()
  rebuildGraph()
}

function ctxEditName() {
  ctxMenu.show = false
  const targetId = ctxMenu.nodeId || selectedNodeId.value
  if (!targetId) return
  const node = canvasNodes.value.find(n => n.id === targetId)
  if (!node) return
  inlineEditTarget.value = targetId
  inlineEditText.value = node.name
  const rect = containerRef.value?.getBoundingClientRect()
  if (rect) {
    inlineEditStyle.value = { left: (node.x * renderer.camera.value.k + rect.width / 2 - renderer.camera.value.x * renderer.camera.value.k) + 'px', top: (node.y * renderer.camera.value.k + rect.height / 2 - renderer.camera.value.y * renderer.camera.value.k) + 'px' }
  }
  showInlineEdit.value = true
  nextTick(() => inlineInputRef.value?.focus())
}

function commitInlineEdit() {
  if (!inlineEditTarget.value) return
  nodeOps.renameNode(inlineEditTarget.value, inlineEditText.value)
  const entity = entityStore.entities.find(e => e.id === inlineEditTarget.value)
  if (entity) entityStore.update(entity.id, { name: inlineEditText.value })
  showInlineEdit.value = false
}

function cancelInlineEdit() { showInlineEdit.value = false }

function ctxEditDescription() {
  ctxMenu.show = false
  if (!ctxMenu.nodeId) return
  descEditorTargetId.value = ctxMenu.nodeId
  const entity = entityStore.entities.find(e => e.id === ctxMenu.nodeId)
  descEditorText.value = entity?.description || ''
  showDescEditor.value = true
}

async function saveDescription() {
  if (!descEditorTargetId.value) return
  await entityStore.update(descEditorTargetId.value, { description: descEditorText.value })
  showDescEditor.value = false
  await entityStore.loadAll()
  rebuildGraph()
}

function ctxEditTags() {
  ctxMenu.show = false
  if (!ctxMenu.nodeId) return
  tagEditorTargetId.value = ctxMenu.nodeId
  const entity = entityStore.entities.find(e => e.id === ctxMenu.nodeId)
  tagEditorText.value = entity?.tags?.join('\n') || ''
  showTagEditor.value = true
}

async function saveTags() {
  if (!tagEditorTargetId.value) return
  const tags = tagEditorText.value.split('\n').map(s => s.trim()).filter(Boolean)
  await entityStore.update(tagEditorTargetId.value, { tags })
  showTagEditor.value = false
  await entityStore.loadAll()
  rebuildGraph()
}

function ctxToggleCollapse() {
  ctxMenu.show = false
  if (!ctxMenu.nodeId) return
  nodeOps.toggleCollapse(ctxMenu.nodeId)
  rebuildGraph()
}

function ctxDeleteNode() {
  ctxMenu.show = false
  if (!ctxMenu.nodeId) return
  nodeOps.deleteNode(ctxMenu.nodeId)
  const entity = entityStore.entities.find(e => e.id === ctxMenu.nodeId)
  if (entity) entityStore.remove(ctxMenu.nodeId)
}

function startEdgeConnect() {
  mindmapStore.hideContextMenu()
  mindmapStore.startEdgeConnect(ctxMenu.nodeId)
}

function editEdgeLabel() {
  ctxMenu.show = false
  if (!ctxMenu.edgeId) return
  const edge = canvasEdges.value.find(e => e.id === ctxMenu.edgeId)
  if (!edge) return
  inlineEditTarget.value = ctxMenu.edgeId
  inlineEditText.value = edge.relLabel || ''
  showInlineEdit.value = true
  nextTick(() => inlineInputRef.value?.focus())
}

function editEdgeType() {
  ctxMenu.show = false
  if (!ctxMenu.edgeId) return
  const edge = canvasEdges.value.find(e => e.id === ctxMenu.edgeId)
  if (!edge) return
  _edgeSrcId = edge.source
  _edgeTgtId = edge.target
  _relTypId = edge.relType
  availableRelationTypes.value = relationSchemaRegistry.getAll().map(r => ({ type: r.type, label: r.label || r.type }))
  showRelationPicker.value = true
}

function deleteEdge() {
  ctxMenu.show = false
  if (!ctxMenu.edgeId) return
  nodeOps.deleteEdge(ctxMenu.edgeId)
}

function setEdgeStyle(style: string) {
  ctxMenu.show = false
  if (!ctxMenu.edgeId) return
  mindmapStore.setEdgeStyle(ctxMenu.edgeId, { lineStyle: style as any })
  const edge = canvasEdges.value.find(e => e.id === ctxMenu.edgeId)
  if (edge) edge.curveStyle = style as any
}

function onPickColor(color: string) {
  showColorPicker.value = false
  if (!ctxMenu.nodeId) return
  nodeOps.setCustomColor(ctxMenu.nodeId, color)
  mindmapStore.setNodeColor(ctxMenu.nodeId, color) // Store 是唯一真相源
}

function ctxSetCenter() {
  ctxMenu.show = false
  if (!ctxMenu.nodeId) return
  nodeOps.setAsCenter(ctxMenu.nodeId)
}

function ctxSetCenterStyle(style: string) {
  ctxMenu.show = false
  if (!ctxMenu.nodeId) return
  nodeOps.setCenterStyle(ctxMenu.nodeId, style)
}

function ctxAddCenter() {
  ctxMenu.show = false
  nodeOps.addCenter()
}

function ctxAddTextbox() {
  ctxMenu.show = false
  nodeOps.addTextbox()
}

function ctxAddImage() {
  ctxMenu.show = false
  imageInputRef.value?.click()
}

function onImageFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    nodeOps.addImage(reader.result as string, file.name)
    input.value = ''
  }
  reader.readAsDataURL(file)
}

function ctxEditImage() {
  ctxMenu.show = false
  imageInputRef.value?.click()
}

function ctxAddNote() {
  ctxMenu.show = false
  nodeOps.addNote()
}

function ctxEditNoteContent() {
  ctxMenu.show = false
  ctxEditName()
}

function ctxAddLink() {
  ctxMenu.show = false
  nodeOps.addLink()
}

function ctxAddGroup() {
  ctxMenu.show = false
  nodeOps.addGroup()
}

function ctxSetTextboxSize(size: string) {
  ctxMenu.show = false
  if (!ctxMenu.nodeId) return
  nodeOps.setTextboxSize(ctxMenu.nodeId, size as any)
}

function ctxSetTextboxStyle(style: string) {
  ctxMenu.show = false
  if (!ctxMenu.nodeId) return
  nodeOps.setTextboxStyle(ctxMenu.nodeId, style)
}

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

// ===== P0 小地图跳转 =====
function onMinimapJump(wx: number, wy: number): void {
  renderer.camera.value = { ...renderer.camera.value, x: wx, y: wy }
  renderer.markDirty()
}

// ===== 搜索导航 =====
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

// ===== O3 对齐/分布 =====
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

// ===== O10 撤销/重做显式入口 =====
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

// ===== Agent 整理（自动布局 + 找孤立 + 找环） =====
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

// ===== Toolbar 辅助 =====
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

function toggleType(type: string): void {
  const v = visibleTypes
  if (!(v instanceof Set)) return
  if (v.has(type)) v.delete(type)
  else v.add(type)
  rebuildGraph()
}

function savePositions() {
  const positions: Record<string, { x: number; y: number }> = {}
  for (const n of canvasNodes.value) {
    positions[n.id] = { x: n.x, y: n.y }
  }
  mindmapStore.nodePositions = positions
}

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
    const ro = new ResizeObserver(() => {
      renderer.resize()
      renderer.markDirty()
      if (containerRef.value) {
        containerSize.width = containerRef.value.clientWidth
        containerSize.height = containerRef.value.clientHeight
      }
    })
    ro.observe(containerRef.value)
    ;(onBeforeUnmount as any)._ro = ro
  }
})

onBeforeUnmount(() => {
  savePositions()
  canvasInteraction.unbindEvents()
  renderer.destroy()
  detachMouseTracker()
  ;(onBeforeUnmount as any)._ro?.disconnect()
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
.mm-connect-bar { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); background: var(--primary); color: white; padding: 6px 16px; border-radius: var(--radius-md); font-size: var(--font-size-sm); z-index: var(--z-detail); }
.mm-inline-edit { position: absolute; z-index: var(--z-detail); display: flex; gap: 4px; background: var(--card-bg); padding: 4px; border-radius: var(--radius-md); box-shadow: var(--shadow-lg); border: 1px solid var(--border-color); }
.mm-inline-input { border: none; border-bottom: 1px solid var(--border-color); background: transparent; color: var(--text-color); padding: 2px 6px; font-size: var(--font-size-sm); outline: none; }
.mm-inline-input:focus { border-bottom-color: var(--primary); }
.mm-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: var(--z-overlay); display: flex; align-items: center; justify-content: center; }
.mm-modal { background: var(--card-bg); border-radius: var(--radius-xl); padding: 20px; min-width: 280px; max-width: 480px; box-shadow: var(--shadow-xl); }
.mm-modal h4 { margin-bottom: 12px; }
.mm-modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; margin-bottom: 12px; }
.mm-type-card { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: none; cursor: pointer; font-size: var(--font-size-sm); transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast); }
.mm-type-card:hover { border-color: var(--primary); background: var(--primary-light); }
.mm-textarea { width: 100%; border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 8px; font-size: var(--font-size-sm); resize: vertical; background: var(--bg); color: var(--text-color); }
.mm-batch-bar { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 6px 16px; box-shadow: var(--shadow-lg); display: flex; align-items: center; gap: 8px; font-size: var(--font-size-sm); z-index: 100; }
.mm-img-viewer { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: calc(var(--z-overlay) + 1); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.mm-img-viewer-img { max-width: 90vw; max-height: 90vh; border-radius: var(--radius-md); }
.mm-color-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.mm-color-btn { width: 36px; height: 36px; border-radius: var(--radius-sm); border: 2px solid var(--border-color); cursor: pointer; }
.mm-color-input { width: 36px; height: 36px; border: none; cursor: pointer; padding: 0; border-radius: var(--radius-sm); }
.mm-btn { padding: 6px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: transparent; cursor: pointer; font-size: var(--font-size-sm); }
.mm-btn:hover { background: var(--hover-bg); }
.mm-btn.active { background: var(--primary-light); border-color: var(--primary); }
.mm-btn-sm { padding: 4px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; cursor: pointer; font-size: var(--font-size-sm); }
.mm-btn-sm:hover { background: var(--hover-bg); }

.mm-freedraw-bar {
  position: absolute; top: 50px; left: 50%; transform: translateX(-50%);
  background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: var(--radius-lg); padding: 6px 12px;
  box-shadow: var(--shadow-xl); display: flex; align-items: center; gap: 6px;
  z-index: 100;
}
.mm-freedraw-label { font-size: var(--font-size-sm); color: var(--text-tertiary); white-space: nowrap; }
.mm-freedraw-color {
  width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent;
  cursor: pointer; transition: border-color 0.15s;
}
.mm-freedraw-color.active { border-color: #fff; }
.mm-freedraw-color:hover { border-color: rgba(255,255,255,0.5); }
.mm-freedraw-width {
  background: var(--bg); border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  color: var(--text-color); font-size: var(--font-size-xs); padding: 2px 4px;
}
</style>
