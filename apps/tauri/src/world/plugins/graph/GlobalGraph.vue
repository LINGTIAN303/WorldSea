<template>
  <div class="graph-view" :class="{ 'graph-view--theme': graphThemeMode }">
    <GraphToolbar
      :layout="layoutName"
      :layout-options="layoutOptions"
      :entity-types="toolbarTypes"
      :enabled-types="shownTypes"
      :zoom-pct="zoomPct"
      :clustering-on="clustering.clusteringEnabled.value"
      :search-query="searchQuery"
      :search-count="searchCount"
      @update:layout="switchLayout"
      @update:search="onSearch"
      @search-enter="onSearchEnter"
      @toggle-type="toggleType"
      @toggle-clustering="toggleClustering"
      @open-path-search="showPathSearch = true"
      @open-timeline="showTimeline = true"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @fit="fitView"
    />
    <div ref="containerRef" class="g-canvas"></div>

    <div v-if="entityStore.entities.length === 0" class="g-empty">
      <WsEmpty preset="no-data" title="图谱为空" description="创建实体后会自动显示在这里">
        <template #icon><WsIcon name="graph" size="xl" /></template>
      </WsEmpty>
    </div>

    <PathSearchPanel
      :visible="showPathSearch"
      :nodes="graphNodes"
      :path-length="interaction.pathResult.value.length"
      :not-found="pathNotFound"
      @close="showPathSearch = false; interaction.clearHighlight(); resetVisuals()"
      @search="onPathSearch"
    />

    <div v-if="focus" class="g-focus-chip">
      <WsIcon name="target" size="xs" />
      <span class="g-focus-chip__text">已聚焦「{{ focus.name }}」· {{ focus.count }} 个邻居</span>
      <button class="g-focus-chip__exit" @click="exitFocus">返回全图</button>
    </div>

    <div
      v-if="algorithms.backendUsed.value === 'js-fallback' && backendNoticeVisible"
      class="g-wasm-notice"
      role="alert"
    >
      <WsIcon name="warning" size="14" class="g-wasm-notice__icon" :stroke-width="1.7" />
      <span class="g-wasm-notice__text">WASM 图算法不可用，当前使用 JS 降级实现（无权 Dijkstra），路径结果可能不是最短路径。</span>
      <button class="g-wasm-notice__close" aria-label="关闭提示" @click="backendNoticeVisible = false">
        <WsIcon name="close" size="12" :stroke-width="1.7" />
      </button>
    </div>

    <NodeDetailPanel
      :visible="!!selectedNode"
      :node="selectedNode"
      @close="interaction.clearHighlight(); resetVisuals()"
      @navigate="goTo"
    />

    <ClusterPanel
      :visible="clustering.clusteringEnabled.value"
      :clusters="clustering.clusters.value"
      @close="clustering.toggleClustering()"
      @focus-cluster="focusCluster"
    />

    <TimelineSlider
      :visible="showTimeline"
      :min-year="timelineMinYear"
      :max-year="timelineMaxYear"
      :filtered-count="timelineFilteredCount"
      @close="showTimeline = false"
      @filter="onTimelineFilter"
      @reset="onTimelineReset"
    />

    <GraphLegend
      :visible="showLegend"
      :types="toolbarTypes"
    />

    <div v-if="tooltip.show" class="g-tooltip" :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">{{ tooltip.text }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { WsIcon, WsEmpty } from '@worldsea/ui-kit'
import Graph from 'graphology'
import { useEntityStore, useRelationStore, useSettingsStore, entitySchemaRegistry, getNodeTypeInfo } from '@worldsea/entity-core'
import { useGraphData, type GraphNode, useTypeMapping, useGraphFilter, useGraphAlgorithms } from '@worldsea/ui-kit'
import { useSigmaRenderer } from './composables/useSigmaRenderer'
import { useGraphModel } from './composables/useGraphModel'
import { useGraphLayout, type LayoutType } from './composables/useGraphLayout'
import { useGraphClustering } from './composables/useGraphClustering'
import { useGraphInteraction } from './composables/useGraphInteraction'
import { usePathParticles } from './composables/usePathParticles'
import { useNodeDrag } from './composables/useNodeDrag'
import { labelThresholdFor, matchNodeIds, tooltipPosition } from './graphStyle'
import GraphToolbar from './components/GraphToolbar.vue'
import GraphLegend from './components/GraphLegend.vue'
import PathSearchPanel from './components/PathSearchPanel.vue'
import NodeDetailPanel from './components/NodeDetailPanel.vue'
import ClusterPanel from './components/ClusterPanel.vue'
import TimelineSlider from './components/TimelineSlider.vue'
import type { ClusterInfo } from './composables/useGraphClustering'

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const settingsStore = useSettingsStore()
const { nodes: graphNodes, edges: graphEdges, getNode } = useGraphData()
const { getColor } = useTypeMapping()
void useGraphFilter(() => graphNodes.value, () => graphEdges.value)

/** 底色双档（批 D）：`dark`＝深色星图（默认）；`theme`＝跟随主题（画布/浮层走令牌） */
const graphThemeMode = computed(() => settingsStore.graphBackgroundMode === 'theme')

const containerRef = ref<HTMLElement | null>(null)
const graph = new Graph({ multi: false })
const { sigma, createRenderer, destroyRenderer } = useSigmaRenderer(containerRef, () => graph)
const layout = useGraphLayout()
const clustering = useGraphClustering()
const interaction = useGraphInteraction()
const algorithms = useGraphAlgorithms()
const pathParticles = usePathParticles()
const nodeDrag = useNodeDrag()

const layoutName = ref<LayoutType>('forceatlas2')
/** WASM 降级提示条可见性（NAlert 替换后本地状态，E2） */
const backendNoticeVisible = ref(true)
const layoutOptions = [
  { value: 'forceatlas2', label: '力导向布局' },
  { value: 'circular', label: '圆圈' },
  { value: 'random', label: '随机' },
]
const shownTypes = ref(new Set<string>())
const zoomPct = ref(100)
const showLegend = ref(true)
const showPathSearch = ref(false)
const showTimeline = ref(false)
const pathNotFound = ref(false)
const tooltip = ref({ show: false, x: 0, y: 0, text: '' })
const searchQuery = ref('')
const searchCount = ref(0)
/** 聚焦模式（批 B）：双击进入，芯片/Esc/点空白三通道退出 */
const focus = ref<{ name: string; count: number } | null>(null)

/** 数据模型（2026-10-09 图谱改进批 A：组装/双过滤/增量更新/视觉复位自本件外移；视图只留接线） */
const model = useGraphModel({ graph, nodes: graphNodes, edges: graphEdges, shownTypes, sigma })
const { timelineMinYear, timelineMaxYear, timelineFilteredCount, onTimelineFilter, onTimelineReset } = model

const allTypes = computed(() => {
  const used = new Set(entityStore.entities.map(e => e.type))
  return entitySchemaRegistry.getAll().filter(s => used.has(s.typeKey))
})

const toolbarTypes = computed(() =>
  allTypes.value.map(t => {
    const info = getNodeTypeInfo(t.typeKey)
    return {
      type: t.typeKey,
      label: t.label,
      icon: t.icon || '◻',
      shape: info.shape,
      coolColor: info.coolColor,
      warmColor: info.warmColor,
      color: getColor(t.typeKey, 'cool'),
    }
  })
)

const selectedNode = computed<GraphNode | null>(() => {
  const id = interaction.selectedNodeId.value
  return id ? (getNode(id) ?? null) : null
})

/** 选中/路径视觉复位（含粒子清理——资源归视图侧） */
function resetVisuals(): void {
  pathParticles.clearPath()
  model.syncGraphColors()
}

/** tooltip 定位（走查反馈修）：视图宿主 `.view-container` 带 `contain: layout`——它是
 *  `position: fixed` 后代的包含块，按视口换算会双重计入容器偏移；故 tooltip 用
 *  `absolute` 挂 `.graph-view`，坐标直接用 sigma 的容器相对值（勿改回 fixed）。 */
function moveTooltipTo(x: number, y: number): void {
  const el = containerRef.value
  const pos = tooltipPosition(x, y, el?.clientWidth ?? window.innerWidth, el?.clientHeight ?? window.innerHeight)
  tooltip.value.x = pos.x
  tooltip.value.y = pos.y
}

/** 底色双档（批 D）：sigma 标签色不吃 CSS——从画布现算 `--g-label`/`--g-edge-label` 再下发。
 *  触发点：渲染器创建后、底色档切换后、应用主题翻转（data-theme）后（见观察器）。 */
function applySigmaPalette(): void {
  const s = sigma.value
  const el = containerRef.value
  if (!s || !el) return
  const cs = getComputedStyle(el)
  const label = cs.getPropertyValue('--g-label').trim()
  const edgeLabel = cs.getPropertyValue('--g-edge-label').trim()
  if (label) s.setSetting('labelColor', { color: label })
  if (edgeLabel) s.setSetting('edgeLabelColor', { color: edgeLabel })
}

/** 退出聚焦/选中（批 B）：芯片按钮 / Esc / 点空白三通道共用 */
function exitFocus(): void {
  focus.value = null
  interaction.clearHighlight()
  resetVisuals()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (focus.value || interaction.selectedNodeId.value) exitFocus()
}

/** 搜索高亮（批 B）：输入即高亮命中（淡化其余）；清空/零命中恢复全图 */
function onSearch(q: string): void {
  searchQuery.value = q
  const ids = matchNodeIds(graphNodes.value, q)
  searchCount.value = ids.length
  focus.value = null
  interaction.clearHighlight()
  resetVisuals()
  if (ids.length === 0) return
  interaction.highlightNodes(new Set(ids))
  interaction.applyHighlightToGraph(graph)
}

/** 回车：相机飞至首个命中（批 B） */
function onSearchEnter(): void {
  const first = matchNodeIds(graphNodes.value, searchQuery.value)[0]
  const s = sigma.value
  if (!first || !s || !graph.hasNode(first)) return
  s.getCamera().animate(
    { x: graph.getNodeAttribute(first, 'x'), y: graph.getNodeAttribute(first, 'y'), ratio: 0.6 },
    { duration: 400, easing: 'cubicInOut' },
  )
}

function initGraph(): void {
  model.buildGraphology()
  layout.applyLayout(graph, layoutName.value, undefined, sigma.value)
  createRenderer()
  applySigmaPalette()
  bindEvents()
  if (sigma.value) pathParticles.init(sigma.value, graph)
  nextTick(() => layout.fitToGraph(sigma.value))
}

function bindEvents(): void {
  const s = sigma.value
  if (!s) return

  s.on('clickNode', ({ node }) => {
    interaction.selectNode(node, graph)
    interaction.applyHighlightToGraph(graph)
  })

  s.on('clickStage', () => {
    exitFocus()
  })

  s.on('enterNode', ({ node, event }) => {
    const meta = getNode(node)
    const name = meta?.name ?? String(graph.getNodeAttribute(node, 'label'))
    tooltip.value = {
      show: true,
      x: 0,
      y: 0,
      text: `${name} · ${meta?.label || '实体'} · ${meta?.degree ?? 0} 关系`,
    }
    moveTooltipTo(event.x, event.y)
    interaction.hoverNode(node, graph)
  })

  s.on('leaveNode', () => {
    tooltip.value.show = false
    interaction.hoverNode(null, graph)
  })

  // 边悬浮（批 B）：显示「A —关系→ B」
  s.on('enterEdge', ({ edge, event }) => {
    const rel = String(graph.getEdgeAttribute(edge, 'relLabel') || '关联')
    const src = String(graph.getNodeAttribute(graph.source(edge), 'label'))
    const tgt = String(graph.getNodeAttribute(graph.target(edge), 'label'))
    tooltip.value = { show: true, x: 0, y: 0, text: `${src} —${rel}→ ${tgt}` }
    moveTooltipTo(event.x, event.y)
  })

  s.on('leaveEdge', () => {
    tooltip.value.show = false
  })

  // 悬浮跟随（批 B）：tooltip 显示期间随鼠标移动
  s.getMouseCaptor().on('mousemovebody', (coords) => {
    if (!tooltip.value.show) return
    moveTooltipTo(coords.x, coords.y)
  })

  // 双击聚焦（批 B）：淡化非邻居（复用选中高亮）+ 芯片出口；不再硬隐藏
  s.on('doubleClickNode', ({ node }) => {
    const neighbors = algorithms.getNeighbors(graph, node, 1)
    interaction.selectNode(node, graph)
    interaction.applyHighlightToGraph(graph)
    focus.value = { name: String(graph.getNodeAttribute(node, 'label')), count: neighbors.length }
  })

  // 节点拖拽（批 B）：松手保留，「切换布局」可复位
  nodeDrag.attach(s, graph)

  // 相机缩放：百分比显示 + 标签阈值两档（批 A：远看只大节点、放大后全标）
  const camera = s.getCamera()
  let lastLabelThreshold = -1
  camera.on('updated', () => {
    zoomPct.value = Math.round((1 / camera.ratio) * 100)
    const threshold = labelThresholdFor(camera.ratio)
    if (threshold !== lastLabelThreshold) {
      lastLabelThreshold = threshold
      s.setSetting('labelRenderedSizeThreshold', threshold)
    }
  })
}

function toggleType(type: string): void {
  if (shownTypes.value.has(type)) shownTypes.value.delete(type)
  else shownTypes.value.add(type)
  model.applyTypeFilter()
}

function switchLayout(newLayout: string): void {
  layoutName.value = newLayout as LayoutType
  layout.applyLayout(graph, layoutName.value, undefined, sigma.value)
  sigma.value?.refresh()
  nextTick(() => layout.fitToGraph(sigma.value))
}

async function toggleClustering(): Promise<void> {
  clustering.toggleClustering()
  if (clustering.clusteringEnabled.value) {
    await clustering.detectCommunities(graph)
  } else {
    clustering.clusters.value = []
  }
}

function focusCluster(cluster: ClusterInfo): void {
  const clusterNodeIds = new Set(cluster.nodeIds)
  graph.forEachNode((n) => {
    graph.setNodeAttribute(n, 'hidden', !clusterNodeIds.has(n))
  })
  graph.forEachEdge((e) => {
    const src = graph.source(e)
    const tgt = graph.target(e)
    graph.setEdgeAttribute(e, 'hidden', !clusterNodeIds.has(src) || !clusterNodeIds.has(tgt))
  })
  nextTick(() => layout.fitToGraph(sigma.value))
}

async function onPathSearch(fromId: string, toId: string): Promise<void> {
  pathNotFound.value = false
  if (!graph.hasNode(fromId) || !graph.hasNode(toId)) {
    pathNotFound.value = true
    return
  }
  const path = await interaction.findPath(graph, fromId, toId)
  if (path.length === 0) {
    pathNotFound.value = true
  } else {
    pathNotFound.value = false
    interaction.applyHighlightToGraph(graph)
    const pathEdgeIds: string[] = []
    for (let i = 0; i < path.length - 1; i++) {
      const edges = graph.edge(path[i], path[i + 1])
      if (edges) {
        const edgeId = typeof edges === 'string' ? edges : edges[0]
        if (edgeId) pathEdgeIds.push(edgeId)
      }
    }
    pathParticles.setPath(pathEdgeIds)
  }
}

function zoomIn(): void {
  const s = sigma.value
  if (!s) return
  const camera = s.getCamera()
  camera.animatedZoom({ duration: 200 })
}

function zoomOut(): void {
  const s = sigma.value
  if (!s) return
  const camera = s.getCamera()
  camera.animatedUnzoom({ duration: 200 })
}

function fitView(): void {
  layout.fitToGraph(sigma.value)
}

function goTo(node: GraphNode): void {
  window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { entityType: node.type, entityId: node.id } }))
}

/** 应用主题观察器（批 D）：data-theme 翻转时重取 sigma 标签色（生命周期见 onMounted/onBeforeUnmount） */
let themeObserver: MutationObserver | null = null

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  // 应用主题翻转（data-theme/class）→ sigma 标签色重取（CSS 令牌自动、sigma 不自动；批 D）
  themeObserver = new MutationObserver(() => applySigmaPalette())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
  try {
    await entityStore.loadAll()
    await relationStore.loadAll()
    for (const t of allTypes.value) shownTypes.value.add(t.typeKey)
    await nextTick()
    initGraph()
  } catch (err) {
    console.warn('[GlobalGraph]', err)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  themeObserver?.disconnect()
  themeObserver = null
  pathParticles.destroy()
  destroyRenderer()
  layout.dispose()
})

/** 底色档切换（批 D）：等 class 落到 DOM 后再重取令牌色下发 sigma */
watch(graphThemeMode, () => {
  void nextTick(() => applySigmaPalette())
})

watch([graphNodes, graphEdges], () => {
  if (!sigma.value) return
  model.incrementalUpdate()
}, { deep: true })

</script>

<style scoped>
.graph-view {
  display: flex; flex-direction: column; height: 100%; position: relative;
  /* 底色双档（批 D）：默认深色星图；.graph-view--theme 覆盖为应用主题令牌 */
  --g-canvas: #0a0e14;
  --g-panel-bg: rgba(10, 14, 20, 0.92);
  --g-panel-border: rgba(255, 255, 255, 0.1);
  --g-text: #ccc;
  --g-text-strong: #e0e0e0;
  --g-text-dim: #888;
  --g-hover: rgba(255, 255, 255, 0.08);
  --g-label: #e0e0e0;
  --g-edge-label: #c9d4e0;
  background: var(--g-canvas);
}
.graph-view--theme {
  --g-canvas: var(--color-bg-surface, #ffffff);
  --g-panel-bg: color-mix(in srgb, var(--color-bg-elevated, #ffffff) 94%, transparent);
  --g-panel-border: var(--color-border, #e5e7eb);
  --g-text: var(--color-text-secondary, #666);
  --g-text-strong: var(--color-text-primary, #333);
  --g-text-dim: var(--color-text-tertiary, #999);
  --g-hover: var(--color-bg-hover, rgba(0, 0, 0, 0.06));
  --g-label: var(--color-text-primary, #333);
  --g-edge-label: var(--color-text-secondary, #666);
}
.g-canvas { flex: 1; background: var(--g-canvas); }
.g-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1;
}
.g-wasm-notice {
  position: absolute;
  top: 44px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 80%;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--info) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--info) 30%, transparent);
  border-radius: var(--radius-md);
  color: var(--info);
  font-size: var(--font-size-xs);
  line-height: 1.5;
  z-index: 5;
}
.g-wasm-notice__icon { flex-shrink: 0; }
.g-wasm-notice__text { flex: 1; }
.g-wasm-notice__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background var(--transition-fast);
}
.g-wasm-notice__close:hover { background: var(--g-hover, rgba(255, 255, 255, 0.1)); }
.g-focus-chip {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--g-panel-bg, rgba(10, 14, 20, 0.92));
  border: 1px solid var(--g-panel-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-mid);
  color: var(--g-text, #ccc);
  font-size: var(--font-size-xs);
  z-index: 6;
  backdrop-filter: blur(8px);
}
.g-focus-chip__text { white-space: nowrap; }
.g-focus-chip__exit {
  border: 1px solid var(--g-panel-border, rgba(255, 255, 255, 0.2));
  background: transparent;
  color: var(--g-text-strong, #e0e0e0);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  transition: background 0.15s;
}
.g-focus-chip__exit:hover { background: var(--g-hover, rgba(255, 255, 255, 0.1)); }
/* 走查反馈修：宿主 .view-container 带 contain:layout（fixed 的包含块是它而非视口）——
   tooltip 必须 absolute 挂 .graph-view，坐标即 sigma 容器相对值；勿改回 fixed */
.g-tooltip { position: absolute; pointer-events: none; z-index: var(--z-dropdown); background: var(--g-panel-bg, rgba(10,14,20,0.92)); border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1)); border-radius: var(--radius-sm); padding: 6px 10px; font-size: var(--font-size-sm); color: var(--g-text, #ccc); max-width: 240px; backdrop-filter: blur(4px); }
</style>
