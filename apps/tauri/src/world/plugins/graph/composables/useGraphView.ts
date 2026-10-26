/**
 * 全局图谱视图装配。
 *
 * 视图壳只保留模板与样式；数据装配、加载状态、选择/搜索/过滤/聚焦/主题等交互逻辑
 * 全部收敛在此，避免 GlobalGraph.vue 再次长成 500 行巨石。
 * 可见性、路径、时间轴各自在独立 composable 中维护，这里只做装配与事件编排。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAsyncTask, useGraphData, type LoadingStatus } from '@worldsea/ui-kit'
import { getNodeTypeInfo, useEntityStore, useRelationStore, useSettingsStore } from '@worldsea/entity-core'
import GraphCanvas from '../view/GraphCanvas.vue'
import { analyzeOverview } from '../model/overview'
import { layoutOverview } from '../model/layout'
import { buildG6Data } from '../model/g6Data'
import { buildInspectorRelations, type InspectorRelation } from '../model/inspector'
import { graphTheme } from '../graphTheme'
import type { OverviewNode, TypeMeta } from '../model/types'
import { useGraphVisibility } from './useGraphVisibility'
import { useGraphSearch } from './useGraphSearch'
import { useGraphTooltip } from './useGraphTooltip'
import { useGraphCommunities } from './useGraphCommunities'
import { usePathSearch } from './usePathSearch'
import { useTimelineFilter } from './useTimelineFilter'

export function useGraphView() {
  const entityStore = useEntityStore()
  const relationStore = useRelationStore()
  const settingsStore = useSettingsStore()
  const { nodes: graphNodes, edges: graphEdges } = useGraphData()

  const viewRef = ref<HTMLElement | null>(null)
  const canvasRef = ref<InstanceType<typeof GraphCanvas> | null>(null)

  const graphThemeMode = computed<'dark' | 'theme'>(() =>
    settingsStore.graphBackgroundMode === 'theme' ? 'theme' : 'dark',
  )
  const theme = computed(() => graphTheme(graphThemeMode.value))

  function metaOf(type: string): TypeMeta {
    const info = getNodeTypeInfo(type)
    return { label: info.label, icon: info.icon, shape: info.shape }
  }

  const overview = computed(() => analyzeOverview(graphNodes.value, graphEdges.value, metaOf))
  const layout = computed(() => layoutOverview(overview.value))
  const g6Data = computed(() => buildG6Data(overview.value, layout.value, theme.value))
  const nodeMap = computed(() => new Map(overview.value.nodes.map(node => [node.id, node])))
  const entityCount = computed(() => entityStore.entities.length)
  const { visible: graphLoading, status: graphLoadStatus, error: graphError, run: runGraphLoad } = useAsyncTask({ successHold: 0 })
  const graphStage = ref(0)
  const graphLoaded = ref(false)
  const renderError = ref('')
  const graphStatus = computed<LoadingStatus>(() => {
    if (graphLoadStatus.value === 'error') return 'error'
    if (graphLoadStatus.value === 'success' || graphLoadStatus.value === 'empty') return 'success'
    return 'loading'
  })
  const zoomPct = ref(100)
  const legendOpen = ref(true)
  const mode = ref<'overview' | 'relations'>('overview')
  const hiddenTypes = ref(new Set<string>())
  const selectedNodeId = ref<string | null>(null)
  const activeGroupId = ref<string | null>(null)
  const focus = ref<{ id: string; name: string; count: number } | null>(null)
  const selectedNode = computed<OverviewNode | null>(() =>
    selectedNodeId.value ? nodeMap.value.get(selectedNodeId.value) ?? null : null,
  )
  const inspectorRelations = computed<InspectorRelation[]>(() =>
    selectedNodeId.value ? buildInspectorRelations(selectedNodeId.value, overview.value) : [],
  )
  const activeGroup = computed(() =>
    activeGroupId.value ? overview.value.groups.find(group => group.id === activeGroupId.value) ?? null : null,
  )
  const activeGroupNodes = computed(() =>
    activeGroupId.value ? overview.value.nodes.filter(node => node.groupId === activeGroupId.value) : [],
  )

  const timeline = useTimelineFilter(() => entityStore.entities)

  const visibility = useGraphVisibility({
    overview,
    mode,
    hiddenTypes,
    canvasRef,
    selectedNodeId,
    activeGroupId,
    exitFocus,
    isTimelineHidden: timeline.isTimelineHidden,
  })
  const { hiddenFamilies, emptyStates, applyVisibility, toggleFamily, isNodeFiltered } = visibility

  const search = useGraphSearch({
    overview,
    canvasRef,
    emptyStates,
    selectedNodeId,
    focus,
    activeGroupId,
    path: () => path,
    selectNode: selectNodeById,
  })
  const {
    searchQuery, searchCount, neighborSet, applySelection, applySearchHighlight,
    restoreInteractionStates, onSearch, onSearchEnter, clearSearch, dispose: disposeSearch,
  } = search

  const path = usePathSearch({ overview, canvasRef, restoreStates: restoreInteractionStates })

  const { communities, communityCount, showCommunities, syncHulls, toggleCommunities } =
    useGraphCommunities({
      overview,
      canvasRef,
      themeMode: graphThemeMode,
      loaded: graphLoaded,
      typeLabel: type => metaOf(type).label,
    })

  const { hover, tooltipText, tooltipStyle, onHover, clearHover } =
    useGraphTooltip({ viewRef, overview, nodeMap })

  /** 路径结果被类型/时间轴过滤掉时主动收回，避免面板指向看不见的节点 */
  async function ensurePathVisible(): Promise<void> {
    const result = path.pathResult.value
    if (!result) return
    if (!result.nodeIds.some(id => isNodeFiltered(id))) return
    await path.clearPath()
    path.pathMessage.value = '路径已被当前过滤隐藏'
  }

  async function onTimelineRange(start: number, end: number): Promise<void> {
    timeline.setTimelineRange(start, end)
    await applyVisibility()
    await ensurePathVisible()
  }

  async function resetTimeline(): Promise<void> {
    timeline.resetTimeline()
    await applyVisibility()
  }

  async function selectNodeById(id: string, center: boolean): Promise<void> {
    const node = nodeMap.value.get(id)
    if (!node) return
    // 显式导航优先于时间轴过滤：目标被日期挡掉时先解除过滤再展开
    if (isNodeFiltered(id)) {
      timeline.resetTimeline()
      await applyVisibility()
    }
    if (canvasRef.value?.isCollapsed(node.groupId)) {
      await canvasRef.value?.expandElement(node.groupId)
      await applyVisibility()
    }
    selectedNodeId.value = id
    focus.value = null
    await applySelection(id)
    if (center) void canvasRef.value?.focusElement(id, 0.9)
  }
  let lastElementClickAt = 0

  /** G6 某些版本会把元素点击继续冒泡到 canvas:click；用时间窗隔开，
   *  避免点星座/节点后立刻被「点空白退出」清掉。 */
  function onBackgroundClick(): void {
    if (Date.now() - lastElementClickAt < 250) return
    exitFocus()
  }

  async function onNodeClick(id: string): Promise<void> {
    lastElementClickAt = Date.now()
    clearHover()
    await selectNodeById(id, false)
  }

  async function onNodeDblClick(id: string): Promise<void> {
    await selectNodeById(id, true)
    const node = nodeMap.value.get(id)
    if (node) focus.value = { id, name: node.name, count: neighborSet(id).size }
  }

  async function onComboClick(id: string): Promise<void> {
    lastElementClickAt = Date.now()
    clearHover()
    if (path.pathOpen.value) await path.closePath()
    activeGroupId.value = id
    selectedNodeId.value = null
    focus.value = null
    if (canvasRef.value?.isCollapsed(id)) await canvasRef.value?.expandElement(id)
    await applyVisibility()
    void canvasRef.value?.focusElement(id, 0.45)
  }
  async function onSelectTypeNode(node: OverviewNode): Promise<void> {
    activeGroupId.value = node.groupId
    await selectNodeById(node.id, true)
  }

  function exitFocus(): void {
    selectedNodeId.value = null
    focus.value = null
    activeGroupId.value = null
    clearHover()
    if (searchQuery.value) void applySearchHighlight()
    else if (path.pathResult.value) void path.refreshPath()
    else void canvasRef.value?.setStates(emptyStates())
  }

  async function toggleType(type: string): Promise<void> {
    const next = new Set(hiddenTypes.value)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    hiddenTypes.value = next
    await applyVisibility()
    await ensurePathVisible()
  }

  function setMode(next: 'overview' | 'relations'): void {
    if (mode.value === next) return
    mode.value = next
    void applyVisibility().then(() => {
      if (next === 'relations' && overview.value.stats.connected > 0) void canvasRef.value?.focusElement('core', 0.8)
      else canvasRef.value?.fitView()
    })
  }

  async function onFocusType(type: string): Promise<void> {
    const groupId = `island:${type}`
    if (overview.value.groups.some(group => group.id === groupId)) {
      activeGroupId.value = groupId
      if (canvasRef.value?.isCollapsed(groupId)) await canvasRef.value?.expandElement(groupId)
      await applyVisibility()
      void canvasRef.value?.focusElement(groupId, 0.45)
    } else if (overview.value.stats.connected > 0) {
      activeGroupId.value = 'core'
      void canvasRef.value?.focusElement('core', 0.8)
    }
  }

  async function onFocusNode(node: OverviewNode): Promise<void> {
    await selectNodeById(node.id, true)
    focus.value = { id: node.id, name: node.name, count: neighborSet(node.id).size }
  }

  async function onSelectRelation(row: InspectorRelation): Promise<void> {
    await selectNodeById(row.otherId, true)
  }

  function goTo(node: OverviewNode): void {
    window.dispatchEvent(new CustomEvent('ws-navigate', {
      detail: { entityType: node.type, entityId: node.id },
    }))
  }

  function onZoomChange(percent: number): void {
    zoomPct.value = percent
  }

  function onRenderError(message: string): void {
    renderError.value = message
  }
  function zoomIn(): void {
    canvasRef.value?.zoomBy(1.25)
  }
  function zoomOut(): void {
    canvasRef.value?.zoomBy(0.8)
  }

  function fitView(): void {
    canvasRef.value?.fitView()
  }

  async function togglePathPanel(): Promise<void> {
    activeGroupId.value = null
    path.togglePath()
  }

  async function toggleFamilyFilter(family: Parameters<typeof toggleFamily>[0]): Promise<void> {
    await toggleFamily(family)
    await ensurePathVisible()
  }

  /** `useGraphData` 对 >500 元素有 200ms 防抖；首载必须等它把实体/关系落到计算属性，
   *  否则 overlay 会先关闭、首帧是空图。 */
  async function waitForGraphData(): Promise<void> {
    const started = Date.now()
    while (graphNodes.value.length !== entityStore.entities.length && Date.now() - started < 1500) {
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  }

  async function initializeGraph(): Promise<void> {
    try {
      await runGraphLoad(async () => {
        graphStage.value = 0
        await entityStore.loadAll()
        await relationStore.loadAll()
        selectedNodeId.value = null
        focus.value = null
        activeGroupId.value = null
        renderError.value = ''
        await waitForGraphData()
        await nextTick()
        graphStage.value = 1
        await nextTick()
        const ok = await canvasRef.value?.setData(g6Data.value)
        if (ok === false) throw new Error(renderError.value || '图谱渲染失败')
        graphLoaded.value = true
        await applyVisibility()
        await syncHulls()
      })
    } catch (error) {
      console.warn('[GlobalGraph]', error)
    }
  }

  function retry(): void {
    canvasRef.value?.destroy()
    graphLoaded.value = false
    renderError.value = ''
    void initializeGraph()
  }

  let dataTimer: ReturnType<typeof setTimeout> | null = null
  async function refreshGraphData(): Promise<void> {
    if (!canvasRef.value) return
    const ok = await canvasRef.value.setData(g6Data.value)
    if (!ok) return
    await applyVisibility()
    await syncHulls()
    if (searchQuery.value) await applySearchHighlight()
    else if (selectedNodeId.value && nodeMap.value.has(selectedNodeId.value)) await applySelection(selectedNodeId.value)
    else if (path.pathResult.value) await path.refreshPath()
    else if (focus.value) exitFocus()
  }

  watch([() => graphNodes.value, () => graphEdges.value], () => {
    if (!graphLoaded.value) return
    if (dataTimer) clearTimeout(dataTimer)
    dataTimer = setTimeout(() => { void refreshGraphData() }, 200)
  })

  watch(graphThemeMode, async () => {
    if (!graphLoaded.value) return
    await nextTick()
    const ok = await canvasRef.value?.setData(g6Data.value)
    if (ok === false) return
    await applyVisibility()
    await syncHulls()
    if (searchQuery.value) await applySearchHighlight()
    else if (path.pathResult.value) await path.refreshPath()
  })

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    if (path.pathOpen.value) { void path.closePath(); return }
    if (timeline.timelineOpen.value) { timeline.closeTimelinePanel(); return }
    if (focus.value || selectedNodeId.value) { exitFocus(); return }
    if (activeGroupId.value) { activeGroupId.value = null; return }
    if (legendOpen.value) legendOpen.value = false
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    void initializeGraph()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    if (dataTimer) clearTimeout(dataTimer)
    disposeSearch()
  })

  return {
    viewRef, canvasRef, graphThemeMode, overview, entityCount, graphLoading, graphStage,
    graphStatus, graphError, graphLoaded, renderError, zoomPct, legendOpen, mode, hiddenTypes,
    hiddenFamilies, communities, communityCount, showCommunities, searchQuery, searchCount,
    activeGroupId, activeGroup, activeGroupNodes, selectedNode, inspectorRelations, focus,
    hover, tooltipText, tooltipStyle, pathOpen: path.pathOpen, pathResult: path.pathResult,
    pathMessage: path.pathMessage, timelineOpen: timeline.timelineOpen,
    timelineStart: timeline.timelineStart, timelineEnd: timeline.timelineEnd,
    timelineMin: timeline.timelineMin, timelineMax: timeline.timelineMax,
    timelineActive: timeline.timelineActive, timelineDated: timeline.timelineDated,
    onNodeClick, onNodeDblClick, onComboClick, onBackgroundClick, onSelectTypeNode, onSearch,
    onSearchEnter, clearSearch, toggleType, toggleFamilyFilter, toggleCommunities, setMode,
    onFocusType, onFocusNode, onSelectRelation, goTo, onHover, onZoomChange, onRenderError,
    exitFocus, zoomIn, zoomOut, fitView, retry, togglePathPanel, closePath: path.closePath,
    runPath: path.runPath, clearPath: path.clearPath, onTimelineRange, resetTimeline,
    toggleTimelinePanel: timeline.toggleTimelinePanel, closeTimelinePanel: timeline.closeTimelinePanel,
  }
}
