/**
 * 思维导图 Pinia Store — 唯一真相源
 *
 * 所有画布状态、导航状态、选择状态、样式状态均在此管理。
 * 组件中不得保留影响业务逻辑的局部 reactive/ref。
 *
 * Phase 2 重写 (2026-06-09)
 */
import { defineStore } from 'pinia'
import { reactive, ref, computed, watch } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { useGraphData } from '@worldsmith/canvas-engine'
import type { CameraState } from './composables/canvasTypes'

export interface Section {
  id: string
  name: string
  color: string
  childNodeIds: string[]
  isEntity: boolean
  entityId?: string
}

export interface CustomNode {
  id: string
  parentId: string
  type: 'textbox' | 'image' | 'note' | 'link'
  name: string
  content: string
  position: { x: number; y: number }
  style: Record<string, unknown>
}

export interface EdgeStyleOverride {
  lineStyle: 'bezier' | 'straight' | 'taxi' | 'unbundled-bezier'
}

export type LayoutAlgorithmType = 'force' | 'radial' | 'tree' | 'grid' | 'mindmapTree'

export interface BreadcrumbItem {
  id: string | null
  name: string
}

export interface ContextMenuState {
  show: boolean
  x: number
  y: number
  nodeId: string
  edgeId: string
  nodeType: string
  isCenter: boolean
  strokeId: string
}

const STORAGE_PREFIX = 'worldsmith_mindmap_'
const POSITION_STORAGE_KEY = 'worldsmith-mindmap-positions'

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveToStorage(key: string, value: unknown) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)) } catch { /* quota exceeded */ }
}

function loadMapFromStorage(key: string): Map<string, string> {
  const obj = loadFromStorage<Record<string, string>>(key, {})
  return new Map(Object.entries(obj))
}

function mapToObj<K, V>(m: Map<K, V>): Record<string, V> {
  const o: Record<string, V> = {}
  m.forEach((v, k) => { o[String(k)] = v })
  return o
}

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function savePositions(positions: Record<string, { x: number; y: number }>) {
  try { localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(positions)) } catch { /* quota */ }
}

const DEFAULT_VISIBLE_TYPES = [
  'character', 'region', 'event', 'organization',
  'concept', 'item', 'textbox', 'image', 'note', 'link', 'group',
]

/* ────────────────────────────────────────────────
   模块级：用户是否已主动删除「中心主题」
   由 ensureCenterNode 在检测到中心节点残留（centerNodeId 指向已删除实体）时置位，
   持久化到 localStorage，刷新/重启后仍生效，确保思维导图不再自动重建被删除的中心。
   ──────────────────────────────────────────────── */
const userDeletedCenter = ref<boolean>(loadFromStorage<boolean>('userDeletedCenter', false))
watch(userDeletedCenter, (v) => saveToStorage('userDeletedCenter', v))

export const useMindmapStore = defineStore('mindmap', () => {
  // ========================================================================
  // 外部数据源
  // ========================================================================
  const entityStore = useEntityStore()
  const relationStore = useRelationStore()
  const { nodes: graphNodes, edges: graphEdges } = useGraphData()

  // ========================================================================
  // 导航状态
  // ========================================================================
  const navigationStack = ref<string[]>([])
  const currentRootId = ref<string | null>(null)

  /** 面包屑：显示从全局图到当前根节点的路径，含实体名 */
  const breadcrumb = computed<BreadcrumbItem[]>(() => {
    const items: BreadcrumbItem[] = [{ id: null, name: '全局图' }]
    for (const eid of navigationStack.value) {
      const entity = entityStore.entities.find(e => e.id === eid)
      items.push({ id: eid, name: entity?.name || eid })
    }
    return items
  })

  // ========================================================================
  // 中心节点（思维导图根节点）
  // ========================================================================
  const centerNodeId = ref<string | null>(loadFromStorage<string | null>('centerNodeId', null))

  /** 清理重复的「中心主题」概念实体：保留 1 个（优先 centerNodeId 指向的），删除其余 */
  async function deduplicateCenterNodes(): Promise<void> {
    const centers = entityStore.entities.filter(
      e => e.type === 'concept' && e.name === '中心主题'
    )
    if (centers.length <= 1) return
    const keepId = centers.find(c => c.id === centerNodeId.value)?.id ?? centers[0].id
    await Promise.all(
      centers.filter(c => c.id !== keepId).map(c => entityStore.remove(c.id))
    )
    centerNodeId.value = keepId
  }

  /** 自动创建中心主题实体（若尚不存在则新建）。用户删除过中心节点时不自动重建 */
  async function ensureCenterNode(): Promise<string | null> {
    // 先清理历史遗留的重复「中心主题」，再决定是否新建
    await deduplicateCenterNodes()
    const existing = centerNodeId.value
    if (existing && entityStore.entities.find(e => e.id === existing)) {
      return existing
    }
    // 中心节点残留：centerNodeId 曾指向一个已不存在的实体 → 中心被删除过。
    // 尊重删除，置位标记，不自动重建「中心主题」
    if (centerNodeId.value !== null) {
      userDeletedCenter.value = true
    }
    // 用户已主动删除中心节点 → 尊重删除，不再自动创建「中心主题」，
    // 优先以用户手动新建的「中心主题」/现有首个实体为中心；无任何实体则返回 null（思维导图空）
    if (userDeletedCenter.value) {
      const manualCenter = entityStore.entities.find(
        e => e.type === 'concept' && e.name === '中心主题'
      )
      if (manualCenter) {
        centerNodeId.value = manualCenter.id
        return manualCenter.id
      }
      if (entityStore.entities.length > 0) {
        centerNodeId.value = entityStore.entities[0].id
        return centerNodeId.value
      }
      centerNodeId.value = null
      return null
    }
    // 优先复用已存在的「中心主题」概念实体，避免重复创建（防污染概念/设定库）
    const existingCenter = entityStore.entities.find(
      e => e.type === 'concept' && e.name === '中心主题'
    )
    if (existingCenter) {
      centerNodeId.value = existingCenter.id
      return existingCenter.id
    }
    // 若已有其他实体但无中心节点，取第一个作为中心
    if (entityStore.entities.length > 0) {
      centerNodeId.value = entityStore.entities[0].id
      return centerNodeId.value!
    }
    // 否则新建
    const id = `concept-center-${Date.now()}`
    await entityStore.add({
      id,
      type: 'concept',
      name: '中心主题',
      description: '',
      properties: {},
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    centerNodeId.value = id
    return id
  }

  // ========================================================================
  // 选择状态
  // ========================================================================
  const selectedNodeIds = reactive(new Set<string>())
  const focusedNodeId = ref<string | null>(null)

  // ========================================================================
  // 画布相机
  // ========================================================================
  const camera = ref<CameraState>({ x: 0, y: 0, k: 1 })

  // ========================================================================
  // 视觉 / 样式状态
  // ========================================================================
  const collapsedNodeIds = reactive(new Set<string>())
  const nodeCustomColors = reactive(loadMapFromStorage('customColors'))
  const edgeStyleOverrides = ref<Record<string, EdgeStyleOverride>>(
    loadFromStorage('edgeStyleOverrides', {}),
  )

  // ========================================================================
  // 分组 / 自定义节点（持久化）
  // ========================================================================
  const sections = ref<Record<string, Section>>(loadFromStorage('sections', {}))
  const customNodes = ref<Record<string, CustomNode>>(loadFromStorage('customNodes', {}))

  // ========================================================================
  // 视图配置
  // ========================================================================
  const layoutAlgorithm = ref<LayoutAlgorithmType>(
    loadFromStorage<LayoutAlgorithmType>('layoutAlgorithm', 'mindmapTree'),
  )
  const visibleEntityTypes = ref<Set<string>>(
    new Set(loadFromStorage<string[]>('visibleTypes', DEFAULT_VISIBLE_TYPES)),
  )

  // ========================================================================
  // 搜索
  // ========================================================================
  const searchQuery = ref('')
  const searchMatches = ref<string[]>([])
  const searchMatchIndex = ref(0)

  // ========================================================================
  // AI 高亮 / 建议
  // ========================================================================
  const highlightedNodeIds = reactive(new Set<string>())
  const highlightedPath = ref<{
    sourceId: string; targetId: string; path: string[]
  } | null>(null)
  const aiSuggestionHints = ref<Array<{
    sourceId: string; targetId: string; relType: string
  }>>([])

  // ========================================================================
  // UI 状态（纯展示，不被数据逻辑依赖）
  // ========================================================================
  const ui = reactive({
    minimapVisible: true,
    detailPanelVisible: false,
    detailPanelAutoMode: true,
    editMode: false,
    freeDrawMode: false,
    showTooltip: false,
    aiPanelVisible: false,
    edgeConnecting: false,
    contextMenu: {
      show: false, x: 0, y: 0,
      nodeId: '', edgeId: '', nodeType: '', isCenter: false, strokeId: '',
    } as ContextMenuState,
  })

  // ========================================================================
  // 键盘流
  // ========================================================================
  const keySequence = ref('')
  const keySequenceTimer = ref<ReturnType<typeof setTimeout> | null>(null)

  // ========================================================================
  // 连线创建临时状态
  // ========================================================================
  const connectSourceId = ref('')

  // ========================================================================
  // 节点位置缓存
  // ========================================================================
  const nodePositions = ref<Record<string, { x: number; y: number }>>(loadPositions())

  // ========================================================================
  // 持久化 watchers
  // ========================================================================
  watch(sections, (v) => saveToStorage('sections', v), { deep: true })
  watch(customNodes, (v) => saveToStorage('customNodes', v), { deep: true })
  watch(edgeStyleOverrides, (v) => saveToStorage('edgeStyleOverrides', v), { deep: true })
  watch(nodeCustomColors, (v) => saveToStorage('customColors', mapToObj(v)), { deep: true })
  watch(layoutAlgorithm, (v) => saveToStorage('layoutAlgorithm', v))
  watch(visibleEntityTypes, (v) => saveToStorage('visibleTypes', [...v]))
  watch(nodePositions, (v) => savePositions(v), { deep: true })
  watch(centerNodeId, (v) => saveToStorage('centerNodeId', v))

  // ========================================================================
  // 导航 actions
  // ========================================================================
  function enterNode(entityId: string, _entityName?: string) {
    navigationStack.value.push(entityId)
    currentRootId.value = entityId
  }

  function exitNode() {
    navigationStack.value.pop()
    currentRootId.value = navigationStack.value.length > 0
      ? navigationStack.value[navigationStack.value.length - 1]
      : null
  }

  function exitToGlobal() {
    navigationStack.value = []
    currentRootId.value = null
  }

  function jumpToBreadcrumb(id: string | null) {
    if (id === null) { exitToGlobal(); return }
    const idx = navigationStack.value.indexOf(id)
    if (idx >= 0) {
      navigationStack.value = navigationStack.value.slice(0, idx + 1)
      currentRootId.value = id
    }
  }

  // ========================================================================
  // 选择 actions
  // ========================================================================
  function selectNode(nodeId: string, multi: boolean = false) {
    if (multi) {
      if (selectedNodeIds.has(nodeId)) selectedNodeIds.delete(nodeId)
      else selectedNodeIds.add(nodeId)
    } else {
      selectedNodeIds.clear()
      selectedNodeIds.add(nodeId)
    }
    focusedNodeId.value = nodeId
  }

  function clearSelection() {
    selectedNodeIds.clear()
    focusedNodeId.value = null
  }

  function selectAll(nodeIds: string[]) {
    selectedNodeIds.clear()
    for (const id of nodeIds) selectedNodeIds.add(id)
    if (nodeIds.length > 0) focusedNodeId.value = nodeIds[nodeIds.length - 1]
  }

  // ========================================================================
  // 相机 actions
  // ========================================================================
  function setCamera(c: CameraState) { camera.value = c }
  function zoomIn() { camera.value.k = Math.min(camera.value.k * 1.2, 5) }
  function zoomOut() { camera.value.k = Math.max(camera.value.k / 1.2, 0.1) }
  function focusOn(x: number, y: number, k: number = 1.5) {
    camera.value = { x, y, k }
  }

  // ========================================================================
  // 样式 actions
  // ========================================================================
  function setNodeColor(nodeId: string, color: string) {
    if (color) nodeCustomColors.set(nodeId, color)
    else nodeCustomColors.delete(nodeId)
  }

  function getNodeColor(nodeId: string): string | undefined {
    return nodeCustomColors.get(nodeId)
  }

  function toggleCollapsed(nodeId: string) {
    if (collapsedNodeIds.has(nodeId)) collapsedNodeIds.delete(nodeId)
    else collapsedNodeIds.add(nodeId)
  }

  function isCollapsed(nodeId: string): boolean {
    return collapsedNodeIds.has(nodeId)
  }

  function setEdgeStyle(edgeId: string, style: EdgeStyleOverride) {
    edgeStyleOverrides.value[edgeId] = style
  }

  function removeEdgeStyle(edgeId: string) {
    delete edgeStyleOverrides.value[edgeId]
  }

  // ========================================================================
  // Section actions
  // ========================================================================
  function addSection(section: Section) { sections.value[section.id] = section }
  function removeSection(id: string) { delete sections.value[id] }
  function updateSection(id: string, patch: Partial<Section>) {
    if (sections.value[id]) sections.value[id] = { ...sections.value[id], ...patch }
  }

  // ========================================================================
  // Custom node actions
  // ========================================================================
  function addCustomNode(node: CustomNode) { customNodes.value[node.id] = node }
  function removeCustomNode(id: string) { delete customNodes.value[id] }
  function getCustomNodesForParent(parentId: string | null): CustomNode[] {
    if (parentId === null) return Object.values(customNodes.value).filter(cn => cn.parentId === '')
    return Object.values(customNodes.value).filter(cn => cn.parentId === parentId)
  }

  // ========================================================================
  // Layout / filter actions
  // ========================================================================
  function setLayout(algorithm: LayoutAlgorithmType) { layoutAlgorithm.value = algorithm }
  function toggleEntityType(type: string) {
    if (visibleEntityTypes.value.has(type)) visibleEntityTypes.value.delete(type)
    else visibleEntityTypes.value.add(type)
  }
  function setVisibleTypes(types: string[]) {
    visibleEntityTypes.value = new Set(types)
  }

  // ========================================================================
  // Search actions
  // ========================================================================
  function setSearchQuery(q: string) { searchQuery.value = q }
  function setSearchMatches(ids: string[]) { searchMatches.value = ids }
  function setSearchMatchIndex(i: number) { searchMatchIndex.value = i }

  // ========================================================================
  // AI highlight actions
  // ========================================================================
  function setHighlighted(nodeIds: string[], path?: {
    sourceId: string; targetId: string; path: string[]
  } | null) {
    highlightedNodeIds.clear()
    for (const id of nodeIds) highlightedNodeIds.add(id)
    highlightedPath.value = path || null
  }

  function clearHighlight() {
    highlightedNodeIds.clear()
    highlightedPath.value = null
  }

  function setAISuggestionHints(hints: Array<{
    sourceId: string; targetId: string; relType: string
  }>) {
    aiSuggestionHints.value = hints
  }

  function clearAISuggestionHints() {
    aiSuggestionHints.value = []
  }

  // ========================================================================
  // UI toggle actions
  // ========================================================================
  function toggleDetailPanel() {
    ui.detailPanelVisible = !ui.detailPanelVisible
  }

  function showDetailPanel() {
    ui.detailPanelVisible = true
    ui.detailPanelAutoMode = true
  }

  function hideDetailPanel() {
    ui.detailPanelVisible = false
    ui.detailPanelAutoMode = false
  }

  function toggleMinimap() { ui.minimapVisible = !ui.minimapVisible }
  function toggleEditMode() {
    ui.editMode = !ui.editMode
    if (!ui.editMode) ui.edgeConnecting = false
  }

  function toggleFreeDrawMode() { ui.freeDrawMode = !ui.freeDrawMode }
  function toggleAIPanel() { ui.aiPanelVisible = !ui.aiPanelVisible }

  function showContextMenu(opts: {
    x: number; y: number
    nodeId?: string; edgeId?: string
    nodeType?: string; isCenter?: boolean; strokeId?: string
  }) {
    ui.contextMenu = {
      show: true,
      x: opts.x, y: opts.y,
      nodeId: opts.nodeId || '',
      edgeId: opts.edgeId || '',
      nodeType: opts.nodeType || '',
      isCenter: opts.isCenter || false,
      strokeId: opts.strokeId || '',
    }
  }

  function hideContextMenu() {
    ui.contextMenu.show = false
  }

  // ========================================================================
  // 连线创建
  // ========================================================================
  function startEdgeConnect(sourceId: string) {
    ui.edgeConnecting = true
    connectSourceId.value = sourceId
  }

  function cancelEdgeConnect() {
    ui.edgeConnecting = false
    connectSourceId.value = ''
  }

  // ========================================================================
  // 位置缓存
  // ========================================================================
  function getNodePosition(nodeId: string): { x: number; y: number } | undefined {
    return nodePositions.value[nodeId]
  }

  function setNodePosition(nodeId: string, x: number, y: number) {
    nodePositions.value[nodeId] = { x, y }
  }

  function clearPositions() { nodePositions.value = {} }

  // ========================================================================
  // 键盘流
  // ========================================================================
  function setKeySequence(seq: string) { keySequence.value = seq }
  function setKeySequenceTimer(t: ReturnType<typeof setTimeout> | null) {
    keySequenceTimer.value = t
  }

  return {
    // 状态
    centerNodeId, ensureCenterNode, deduplicateCenterNodes, userDeletedCenter,
    navigationStack, currentRootId, breadcrumb,
    selectedNodeIds, focusedNodeId,
    camera,
    collapsedNodeIds, nodeCustomColors, edgeStyleOverrides,
    sections, customNodes,
    layoutAlgorithm, visibleEntityTypes,
    searchQuery, searchMatches, searchMatchIndex,
    highlightedNodeIds, highlightedPath, aiSuggestionHints,
    ui, connectSourceId,
    keySequence, keySequenceTimer,
    nodePositions,
    // 数据源（只读，用于组件 computed 派生）
    graphNodes, graphEdges, entityStore, relationStore,
    // actions
    enterNode, exitNode, exitToGlobal, jumpToBreadcrumb,
    selectNode, clearSelection, selectAll,
    setCamera, zoomIn, zoomOut, focusOn,
    setNodeColor, getNodeColor, toggleCollapsed, isCollapsed,
    setEdgeStyle, removeEdgeStyle,
    addSection, removeSection, updateSection,
    addCustomNode, removeCustomNode, getCustomNodesForParent,
    setLayout, toggleEntityType, setVisibleTypes,
    setSearchQuery, setSearchMatches, setSearchMatchIndex,
    setHighlighted, clearHighlight,
    setAISuggestionHints, clearAISuggestionHints,
    toggleDetailPanel, showDetailPanel, hideDetailPanel,
    toggleMinimap, toggleEditMode, toggleFreeDrawMode, toggleAIPanel,
    showContextMenu, hideContextMenu,
    startEdgeConnect, cancelEdgeConnect,
    getNodePosition, setNodePosition, clearPositions,
    setKeySequence, setKeySequenceTimer,
  }
})
