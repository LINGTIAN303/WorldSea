<template>
  <div class="graph-view">
    <GraphToolbar
      :layout="layoutName"
      :layout-options="layoutOptions"
      :entity-types="toolbarTypes"
      :enabled-types="shownTypes"
      :zoom-pct="zoomPct"
      :clustering-on="clustering.clusteringEnabled.value"
      @update:layout="switchLayout"
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
      <WsEmpty preset="no-data" title="图谱为空" description="创建实体后会自动显示在这里" />
    </div>

    <PathSearchPanel
      :visible="showPathSearch"
      :nodes="graphNodes"
      :path-length="interaction.pathResult.value.length"
      :not-found="pathNotFound"
      @close="showPathSearch = false; interaction.clearHighlight(); syncGraphColors()"
      @search="onPathSearch"
    />

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
      @close="interaction.clearHighlight(); syncGraphColors()"
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
import { useEntityStore, useRelationStore, entitySchemaRegistry, getNodeTypeInfo } from '@worldsea/entity-core'
import { useGraphData, type GraphNode, useTypeMapping, useGraphFilter, useGraphAlgorithms } from '@worldsea/ui-kit'
import { useSigmaRenderer } from './composables/useSigmaRenderer'
import { useGraphLayout, type LayoutType } from './composables/useGraphLayout'
import { useGraphClustering } from './composables/useGraphClustering'
import { useGraphInteraction } from './composables/useGraphInteraction'
import { usePathParticles } from './composables/usePathParticles'
import { parseDate } from '../timeline/composables/useDateParser'
import GraphToolbar from './components/GraphToolbar.vue'
import GraphLegend from './components/GraphLegend.vue'
import PathSearchPanel from './components/PathSearchPanel.vue'
import NodeDetailPanel from './components/NodeDetailPanel.vue'
import ClusterPanel from './components/ClusterPanel.vue'
import TimelineSlider from './components/TimelineSlider.vue'
import type { ClusterInfo } from './composables/useGraphClustering'
import { useAgentPluginBridge } from '@/composables/useAgentPluginBridge'

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { nodes: graphNodes, edges: graphEdges, getNode } = useGraphData()
const { getColor } = useTypeMapping()
void useGraphFilter(() => graphNodes.value, () => graphEdges.value)

const containerRef = ref<HTMLElement | null>(null)
const graph = new Graph({ multi: false })
const { sigma, createRenderer, destroyRenderer } = useSigmaRenderer(containerRef, () => graph)
const layout = useGraphLayout()
const clustering = useGraphClustering()
const interaction = useGraphInteraction()
const algorithms = useGraphAlgorithms()
const pathParticles = usePathParticles()

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
const timelineMinYear = ref(0)
const timelineMaxYear = ref(2100)
const timelineFilteredCount = ref(0)
const timelineActiveRange = ref<{ start: number; end: number } | null>(null)
const tooltip = ref({ show: false, x: 0, y: 0, text: '' })

function extractAbsYear(properties: Record<string, unknown>): number | null {
  const dateText = (properties.date as string) || (properties.startDate as string) || ''
  if (!dateText) return null
  const parsed = parseDate(dateText)
  if (!parsed) return null
  return parsed.era * 10000 + parsed.year
}

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

function buildGraphology(): void {
  graph.clear()
  let minAbs = Infinity
  let maxAbs = -Infinity
  let hasDatedNodes = false

  for (const n of graphNodes.value) {
    const size = Math.min(16, Math.max(4, 4 + n.degree * 0.8))
    const color = getColor(n.type, 'cool')
    const hidden = !shownTypes.value.has(n.type)
    const entity = entityStore.entityMap.get(n.id)
    const absYear = entity ? extractAbsYear(entity.properties) : null
    if (absYear !== null) {
      minAbs = Math.min(minAbs, absYear)
      maxAbs = Math.max(maxAbs, absYear)
      hasDatedNodes = true
    }
    graph.addNode(n.id, {
      x: Math.random() * 100,
      y: Math.random() * 100,
      label: n.name,
      size,
      color,
      originalColor: color,
      originalSize: size,
      entityType: n.type,
      hidden,
      absYear: absYear ?? undefined,
    })
  }
  for (const e of graphEdges.value) {
    if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
      try {
        const srcHidden = graph.getNodeAttribute(e.source, 'hidden')
        const tgtHidden = graph.getNodeAttribute(e.target, 'hidden')
        graph.addEdge(e.source, e.target, {
          id: e.id,
          color: 'rgba(255,255,255,0.12)',
          size: 1,
          relType: e.relType,
          hidden: srcHidden || tgtHidden,
        })
      } catch {
      }
    }
  }

  if (hasDatedNodes) {
    timelineMinYear.value = minAbs
    timelineMaxYear.value = maxAbs
  } else {
    timelineMinYear.value = 0
    timelineMaxYear.value = 2100
  }
  timelineFilteredCount.value = 0
  timelineActiveRange.value = null
}

function syncGraphColors(): void {
  pathParticles.clearPath()
  graph.forEachNode((node) => {
    graph.setNodeAttribute(node, 'color', graph.getNodeAttribute(node, 'originalColor') || '#4fc3f7')
    graph.setNodeAttribute(node, 'size', graph.getNodeAttribute(node, 'originalSize') || 6)
    graph.setNodeAttribute(node, 'highlighted', false)
  })
  graph.forEachEdge((edge) => {
    graph.setEdgeAttribute(edge, 'hidden', false)
  })
}

function applyTypeFilter(): void {
  graph.forEachNode((node) => {
    const type = graph.getNodeAttribute(node, 'entityType') as string
    const typeHidden = !shownTypes.value.has(type)
    const absYear = graph.getNodeAttribute(node, 'absYear') as number | undefined
    let timelineHidden = false
    if (timelineActiveRange.value && absYear !== undefined) {
      timelineHidden = absYear < timelineActiveRange.value.start || absYear > timelineActiveRange.value.end
    }
    graph.setNodeAttribute(node, 'hidden', typeHidden || timelineHidden)
  })
  graph.forEachEdge((edge) => {
    const src = graph.source(edge)
    const tgt = graph.target(edge)
    const srcHidden = graph.getNodeAttribute(src, 'hidden')
    const tgtHidden = graph.getNodeAttribute(tgt, 'hidden')
    graph.setEdgeAttribute(edge, 'hidden', srcHidden || tgtHidden)
  })
  sigma.value?.refresh()
}

function onTimelineFilter(start: number, end: number): void {
  timelineActiveRange.value = { start, end }
  let count = 0
  graph.forEachNode((node) => {
    const type = graph.getNodeAttribute(node, 'entityType') as string
    const typeHidden = !shownTypes.value.has(type)
    const absYear = graph.getNodeAttribute(node, 'absYear') as number | undefined
    let timelineHidden = false
    if (absYear !== undefined) {
      timelineHidden = absYear < start || absYear > end
      if (!timelineHidden && !typeHidden) count++
    }
    graph.setNodeAttribute(node, 'hidden', typeHidden || timelineHidden)
  })
  graph.forEachEdge((edge) => {
    const src = graph.source(edge)
    const tgt = graph.target(edge)
    graph.setEdgeAttribute(edge, 'hidden', graph.getNodeAttribute(src, 'hidden') || graph.getNodeAttribute(tgt, 'hidden'))
  })
  timelineFilteredCount.value = count
  sigma.value?.refresh()
}

function onTimelineReset(): void {
  timelineActiveRange.value = null
  timelineFilteredCount.value = 0
  applyTypeFilter()
}

function initGraph(): void {
  buildGraphology()
  layout.applyLayout(graph, layoutName.value, undefined, sigma.value)
  createRenderer()
  bindEvents()
  if (sigma.value) pathParticles.init(sigma.value, graph)
  nextTick(() => layout.fitToGraph(sigma.value, 10))
}

function bindEvents(): void {
  const s = sigma.value
  if (!s) return

  s.on('clickNode', ({ node }) => {
    interaction.selectNode(node, graph)
    interaction.applyHighlightToGraph(graph)
  })

  s.on('clickStage', () => {
    interaction.clearHighlight()
    syncGraphColors()
  })

  s.on('enterNode', ({ node }) => {
    const attrs = graph.getNodeAttributes(node)
    tooltip.value = {
      show: true,
      x: 0,
      y: 0,
      text: `${attrs.label} (${graph.getNodeAttribute(node, 'entityType')})`,
    }
    interaction.hoverNode(node, graph)
  })

  s.on('leaveNode', () => {
    tooltip.value.show = false
    interaction.hoverNode(null, graph)
  })

  s.on('doubleClickNode', ({ node }) => {
    const neighbors = algorithms.getNeighbors(graph, node, 1)
    const subNodeIds = new Set([node, ...neighbors])
    graph.forEachNode((n) => {
      graph.setNodeAttribute(n, 'hidden', !subNodeIds.has(n))
    })
    graph.forEachEdge((e) => {
      const src = graph.source(e)
      const tgt = graph.target(e)
      graph.setEdgeAttribute(e, 'hidden', !subNodeIds.has(src) || !subNodeIds.has(tgt))
    })
    nextTick(() => layout.fitToGraph(sigma.value, 10))
  })

  const camera = s.getCamera()
  camera.on('updated', () => {
    zoomPct.value = Math.round((1 / camera.ratio) * 100)
  })
}

function toggleType(type: string): void {
  if (shownTypes.value.has(type)) shownTypes.value.delete(type)
  else shownTypes.value.add(type)
  applyTypeFilter()
}

function switchLayout(newLayout: string): void {
  layoutName.value = newLayout as LayoutType
  layout.applyLayout(graph, layoutName.value, undefined, sigma.value)
  sigma.value?.refresh()
  nextTick(() => layout.fitToGraph(sigma.value, 10))
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
  nextTick(() => layout.fitToGraph(sigma.value, 10))
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

function incrementalUpdate(): void {
  const currentIds = new Set<string>()
  graph.forEachNode((n) => currentIds.add(n))

  const targetIds = new Set(graphNodes.value.map(n => n.id))

  for (const id of currentIds) {
    if (!targetIds.has(id)) {
      graph.dropNode(id)
    }
  }

  for (const n of graphNodes.value) {
    const size = Math.min(16, Math.max(4, 4 + n.degree * 0.8))
    const color = getColor(n.type, 'cool')
    const typeHidden = !shownTypes.value.has(n.type)
    const entity = entityStore.entityMap.get(n.id)
    const absYear = entity ? extractAbsYear(entity.properties) : null
    let timelineHidden = false
    if (timelineActiveRange.value && absYear !== null) {
      timelineHidden = absYear < timelineActiveRange.value.start || absYear > timelineActiveRange.value.end
    }
    const hidden = typeHidden || timelineHidden

    if (graph.hasNode(n.id)) {
      graph.mergeNodeAttributes(n.id, {
        label: n.name,
        size,
        color,
        originalColor: color,
        originalSize: size,
        entityType: n.type,
        hidden,
        absYear: absYear ?? undefined,
      })
    } else {
      graph.addNode(n.id, {
        x: Math.random() * 100,
        y: Math.random() * 100,
        label: n.name,
        size,
        color,
        originalColor: color,
        originalSize: size,
        entityType: n.type,
        hidden,
        absYear: absYear ?? undefined,
      })
    }
  }

  const currentEdges = new Set<string>()
  graph.forEachEdge((e) => currentEdges.add(e))
  const targetEdgeIds = new Set(graphEdges.value.map(e => e.id))

  for (const eid of currentEdges) {
    if (!targetEdgeIds.has(eid)) {
      try { graph.dropEdge(eid) } catch { /* skip */ }
    }
  }

  for (const e of graphEdges.value) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue
    const srcHidden = graph.getNodeAttribute(e.source, 'hidden')
    const tgtHidden = graph.getNodeAttribute(e.target, 'hidden')
    if (currentEdges.has(e.id)) {
      graph.mergeEdgeAttributes(e.id, {
        relType: e.relType,
        hidden: srcHidden || tgtHidden,
      })
    } else {
      try {
        graph.addEdge(e.source, e.target, {
          id: e.id,
          color: 'rgba(255,255,255,0.12)',
          size: 1,
          relType: e.relType,
          hidden: srcHidden || tgtHidden,
        })
      } catch {
      }
    }
  }

  sigma.value?.refresh()
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
  layout.fitToGraph(sigma.value, 10)
}

function goTo(node: GraphNode): void {
  const viewMap: Record<string, string> = {
    character: 'characters', region: 'regions', event: 'timeline',
    organization: 'organizations', concept: 'concepts', item: 'items',
  }
  const vid = viewMap[node.type]
  if (vid) window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { view: vid, entityId: node.id } }))
}

onMounted(async () => {
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
  pathParticles.destroy()
  destroyRenderer()
  layout.dispose()
})

watch([graphNodes, graphEdges], () => {
  if (!sigma.value) return
  incrementalUpdate()
}, { deep: true })

useAgentPluginBridge('graph', (event) => {
  console.log(`[Agent→${event.pluginId}] ${event.action}`, event.payload)
})
</script>

<style scoped>
.graph-view { display: flex; flex-direction: column; height: 100%; position: relative; background: #0a0e14; }
.g-canvas { flex: 1; background: #0a0e14; }
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
.g-wasm-notice__close:hover { background: rgba(255, 255, 255, 0.1); }
.g-tooltip { position: fixed; pointer-events: none; z-index: var(--z-dropdown); background: rgba(10,14,20,0.92); border: 1px solid rgba(255,255,255,0.1); border-radius: var(--radius-sm); padding: 6px 10px; font-size: var(--font-size-sm); color: #ccc; max-width: 240px; backdrop-filter: blur(4px); }
</style>
