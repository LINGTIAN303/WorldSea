/**
 * G6 画布容器（2026-10-26 重构 · B1）。
 *
 * 只负责 G6 实例生命周期、数据灌入、事件转发与命令式操作；业务状态（选中/聚焦/筛选）
 * 全部留在视图壳。G6 数据必须是普通对象——`setData` 入口统一做结构化克隆。
 */
<template>
  <div ref="containerRef" class="g6-canvas" @contextmenu.prevent></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import {
  CanvasEvent,
  ComboEvent,
  Graph,
  GraphEvent,
  NodeEvent,
} from '@antv/g6'
import type {
  ComboData,
  EdgeData,
  GraphData,
  IElementEvent,
  IPointerEvent,
  NodeData,
} from '@antv/g6'
import { graphTheme } from '../graphTheme'

export interface HoverPayload {
  kind: 'node' | 'combo'
  id: string
  x: number
  y: number
}

export interface HullSpec {
  key: string
  members: string[]
  fill: string
  stroke: string
  label: string
}

const props = defineProps<{
  themeMode: 'dark' | 'theme'
}>()

const emit = defineEmits<{
  nodeClick: [id: string]
  nodeDblClick: [id: string]
  comboClick: [id: string]
  backgroundClick: []
  hover: [payload: HoverPayload | null]
  zoomChange: [percent: number]
  rendered: [first: boolean]
  renderError: [message: string]
}>()

const containerRef = ref<HTMLElement | null>(null)
const graphRef = shallowRef<Graph | null>(null)
let lastData: GraphData | null = null

function plainData(data: GraphData): GraphData {
  return JSON.parse(JSON.stringify(data)) as GraphData
}

function createGraph(data: GraphData): Graph {
  const theme = graphTheme(props.themeMode)
  return new Graph({
    container: containerRef.value!,
    autoResize: true,
    autoFit: 'view',
    animation: false,
    theme: props.themeMode === 'theme' ? 'light' : 'dark',
    data,
    padding: 48,
    zoomRange: [0.02, 4],
    node: {
      state: {
        selected: {
          halo: true,
          haloStroke: theme.accent,
          haloLineWidth: 9,
          haloOpacity: 0.28,
          stroke: theme.accent,
          lineWidth: 2,
        },
        active: {
          halo: true,
          haloStroke: theme.accent,
          haloLineWidth: 7,
          haloOpacity: 0.16,
          stroke: theme.accent,
          lineWidth: 1.6,
        },
        highlight: {
          halo: true,
          haloStroke: theme.accent,
          haloLineWidth: 8,
          haloOpacity: 0.24,
          stroke: theme.accent,
          lineWidth: 2.4,
        },
        inactive: { opacity: 0.16 },
      },
    },
    edge: {
      state: {
        active: {
          lineWidth: 2.2,
          opacity: 1,
          label: true,
          stroke: (datum: EdgeData) => (datum.data?.hlStroke as string) || theme.accent,
        },
        highlight: {
          lineWidth: 2.6,
          opacity: 1,
          label: true,
          stroke: (datum: EdgeData) => (datum.data?.hlStroke as string) || theme.accent,
        },
        inactive: { opacity: 0.06 },
      },
    },
    combo: {
      state: {
        active: { lineWidth: 2, stroke: theme.accent },
        inactive: { opacity: 0.28 },
      },
    },
    behaviors: [
      'zoom-canvas',
      'drag-canvas',
      'drag-element',
      {
        type: 'auto-adapt-label',
        padding: 6,
        throttle: 180,
        sortNode: (a: NodeData, b: NodeData) => {
          const delta = Number(b.data?.degree ?? 0) - Number(a.data?.degree ?? 0)
          return delta === 0 ? 0 : delta > 0 ? 1 : -1
        },
      },
      {
        type: 'collapse-expand',
        animation: true,
        enable: (event: IPointerEvent) => event.targetType === 'combo',
      },
      {
        // 平移/缩放时保留节点与 Combo 主图形，隐藏边与标签；停手 160ms 后恢复。
        type: 'optimize-viewport-transform',
        debounce: 160,
        shapes: (type: string, shape: { className?: string }) =>
          (type === 'node' || type === 'combo') && shape.className === 'key',
      },
      {
        // 只固定核心与 Combo 标签，避免 800+ 孤立节点参与逐帧字号补偿。
        type: 'fix-element-size',
        enable: true,
        nodeFilter: (datum: NodeData) => datum.data?.groupId === 'core',
        node: [{ shape: 'label' }],
        combo: [{ shape: 'label' }],
      },
    ],
    plugins: [
      {
        key: 'grid',
        type: 'grid-line',
        size: 30,
        stroke: theme.gridStroke,
        border: false,
        follow: true,
      },
      {
        key: 'minimap',
        type: 'minimap',
        size: [190, 128],
        position: 'right-bottom',
        padding: 12,
        shape: 'key',
        // 小地图只画 Combo 轮廓：800+ 孤立节点不参与缩略图重绘。
        filter: (_id: string, type: string) => type === 'combo',
        delay: 240,
        containerStyle: {
          borderRadius: '10px',
          overflow: 'hidden',
          border: `1px solid ${theme.panelBorder}`,
          background: theme.panelBg,
        },
        maskStyle: {
          background: theme.minimapMask,
          border: `1px solid ${theme.accent}`,
        },
      },
    ],
  })
}

function hoverPayload(kind: 'node' | 'combo', event: { clientX?: number; clientY?: number; target: { id: string } }): HoverPayload | null {
  const container = containerRef.value
  if (!container) return null
  const rect = container.getBoundingClientRect()
  if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return null
  return {
    kind,
    id: String(event.target.id),
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
}

function bindEvents(graph: Graph): void {
  graph.on<IElementEvent>(NodeEvent.CLICK, event => emit('nodeClick', String(event.target.id)))
  graph.on<IElementEvent>(NodeEvent.DBLCLICK, event => emit('nodeDblClick', String(event.target.id)))
  graph.on<IElementEvent>(ComboEvent.CLICK, event => emit('comboClick', String(event.target.id)))
  graph.on(CanvasEvent.CLICK, () => emit('backgroundClick'))
  graph.on<IElementEvent>(NodeEvent.POINTER_OVER, event => emit('hover', hoverPayload('node', event)))
  graph.on<IElementEvent>(NodeEvent.POINTER_MOVE, event => emit('hover', hoverPayload('node', event)))
  graph.on(NodeEvent.POINTER_OUT, () => emit('hover', null))
  graph.on<IElementEvent>(ComboEvent.POINTER_OVER, event => emit('hover', hoverPayload('combo', event)))
  graph.on<IElementEvent>(ComboEvent.POINTER_MOVE, event => emit('hover', hoverPayload('combo', event)))
  graph.on(ComboEvent.POINTER_OUT, () => emit('hover', null))
  graph.on(GraphEvent.AFTER_TRANSFORM, () => {
    const graphInstance = graphRef.value
    if (graphInstance) emit('zoomChange', Math.round(graphInstance.getZoom() * 100))
  })
}

async function setData(data: GraphData): Promise<boolean> {
  lastData = plainData(data)
  if (!graphRef.value) {
    try {
      const graph = createGraph(lastData)
      graphRef.value = graph
      bindEvents(graph)
      await graph.render()
      // 初始折叠兜底：数据里的 collapsed=true 在部分 G6 版本只改样式不隐子节点，
      // 这里显式折叠一次（幂等；动画关闭，避免首屏抖动）。
      const collapsedIds = (lastData.combos ?? [])
        .filter(combo => Boolean((combo.style as Record<string, unknown> | undefined)?.collapsed))
        .map(combo => String(combo.id))
      for (const id of collapsedIds) {
        try { await graph.collapseElement(id, false) } catch { /* 已折叠 / 无子元素 */ }
      }
      // 折叠后组合尺寸变化，重新拟合一次，确保首屏居中（autoFit 只在 render 时执行）
      await graph.fitView({ when: 'always' }, { duration: 0 })
      emit('rendered', true)
      return true
    } catch (error) {
      emit('renderError', error instanceof Error ? error.message : String(error))
      return false
    }
  }
  try {
    graphRef.value.setData(lastData)
    await graphRef.value.draw()
    emit('rendered', false)
    return true
  } catch (error) {
    emit('renderError', error instanceof Error ? error.message : String(error))
    return false
  }
}

function fitView(): void {
  void graphRef.value?.fitView({ when: 'always' }, { duration: 400 })
}

async function focusElement(id: string, minZoom = 0): Promise<void> {
  const graph = graphRef.value
  if (!graph) return
  // 总览 autoFit 后 zoom 往往 < 0.5；只居中不放大，用户看不到节点细节。
  if (minZoom > 0 && graph.getZoom() < minZoom) {
    await graph.zoomTo(minZoom, { duration: 450 })
  }
  await graph.focusElement(id, { duration: 500, easing: 'ease-in-out' })
}

function zoomBy(ratio: number): void {
  void graphRef.value?.zoomBy(ratio, { duration: 200 })
}

async function expandElement(id: string): Promise<void> {
  await graphRef.value?.expandElement(id, true)
}

async function collapseElement(id: string): Promise<void> {
  await graphRef.value?.collapseElement(id, true)
}

function isCollapsed(id: string): boolean {
  const graph = graphRef.value
  if (!graph || !graph.hasCombo(id)) return false
  return Boolean((graph.getComboData(id).style as Record<string, unknown> | undefined)?.collapsed)
}

async function setStates(states: Record<string, string[]>): Promise<void> {
  await graphRef.value?.setElementState(states as never, true)
}

async function resetStates(): Promise<void> {
  const graph = graphRef.value
  if (!graph) return
  const ids: Record<string, string[]> = {}
  graph.getData().nodes?.forEach(node => { ids[String(node.id)] = [] })
  graph.getData().edges?.forEach(edge => { if (edge.id) ids[String(edge.id)] = [] })
  graph.getData().combos?.forEach(combo => { ids[String(combo.id)] = [] })
  await graph.setElementState(ids as never, false)
}

async function setVisibility(map: Record<string, 'visible' | 'hidden'>): Promise<void> {
  await graphRef.value?.setElementVisibility(map as never, false)
}

async function setHulls(specs: HullSpec[]): Promise<void> {
  const graph = graphRef.value
  if (!graph) return
  const isHullPlugin = (item: unknown): boolean =>
    typeof item === 'object' && item !== null
    && String((item as { key?: unknown }).key ?? '').startsWith('hull:')
  const next = specs
    .map(spec => ({ ...spec, members: spec.members.filter(id => graph.hasNode(id)) }))
    .filter(spec => spec.members.length >= 3)
    .map(spec => ({
      key: spec.key,
      type: 'hull' as const,
      members: spec.members,
      padding: 18,
      corner: 'rounded' as const,
      fill: spec.fill, stroke: spec.stroke, lineWidth: 1, lineDash: [6, 5], zIndex: -1,
      label: true, labelText: spec.label, labelFill: spec.stroke, labelFontSize: 11,
      labelPlacement: 'bottom' as const,
    }))
  graph.setPlugins(prev => [...prev.filter(item => !isHullPlugin(item)), ...next])
  // Hull 在 AFTER_RENDER 时重算轮廓；setPlugins 本身不触发渲染。
  await graph.draw()
}

function getNeighborIds(id: string): string[] {
  return graphRef.value?.getNeighborNodesData(id).map(node => String(node.id)) ?? []
}

function getRelatedEdgeIds(id: string): string[] {
  return graphRef.value?.getRelatedEdgesData(id).map(edge => String(edge.id)) ?? []
}

function getNode(id: string): NodeData | null {
  const graph = graphRef.value
  if (!graph || !graph.hasNode(id)) return null
  return graph.getNodeData(id)
}

function getCombo(id: string): ComboData | null {
  const graph = graphRef.value
  if (!graph || !graph.hasCombo(id)) return null
  return graph.getComboData(id)
}

function getZoom(): number {
  return graphRef.value?.getZoom() ?? 1
}

function destroy(): void {
  graphRef.value?.destroy()
  graphRef.value = null
}

defineExpose({
  setData,
  fitView,
  focusElement,
  zoomBy,
  expandElement,
  collapseElement,
  isCollapsed,
  setStates,
  resetStates,
  setVisibility,
  setHulls,
  getNeighborIds,
  getRelatedEdgeIds,
  getNode,
  getCombo,
  getZoom,
  destroy,
})

onBeforeUnmount(() => {
  destroy()
  lastData = null
})
</script>

<style scoped>
.g6-canvas { position: absolute; inset: 0; }
</style>
