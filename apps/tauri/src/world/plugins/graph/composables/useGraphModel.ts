/**
 * 图谱数据模型装配（2026-10-09 图谱改进批 A：自 `GlobalGraph.vue` 外移的减压件）。
 *
 * 职责：graphology 组装 / 增量更新 / 类型与时间双过滤 / 选中视觉复位。
 * 边视觉走 `graphStyle` 纯函数（类型色·方向程序·线宽·关系标签两级），视图只留接线；
 * 「关系标签只在选中/路径时显名」由 `useGraphInteraction` 按 `relLabel` 属性写上 `label`。
 */
import { ref, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import Graph from 'graphology'
import type { Sigma } from 'sigma'
import { useEntityStore } from '@worldsea/entity-core'
import { useTypeMapping, type GraphNode, type GraphEdge } from '@worldsea/ui-kit'
import { parseDate } from '@/world/plugins/timeline/composables/useDateParser'
import { edgeBaseVisual, edgeHighlightVisual, type EdgeVisualMeta } from '../graphStyle'

export interface GraphModelOptions {
  graph: Graph
  nodes: ComputedRef<GraphNode[]>
  edges: ComputedRef<GraphEdge[]>
  shownTypes: Ref<Set<string>>
  sigma: ShallowRef<Sigma | null>
}

function metaOf(e: GraphEdge): EdgeVisualMeta {
  return { color: e.coolColor, noArrow: e.noArrow, bidirectional: e.bidirectional, symmetric: e.symmetric }
}

export function useGraphModel(opts: GraphModelOptions) {
  const graph = opts.graph
  const entityStore = useEntityStore()
  const { getColor } = useTypeMapping()

  const timelineMinYear = ref(0)
  const timelineMaxYear = ref(2100)
  const timelineFilteredCount = ref(0)
  const timelineActiveRange = ref<{ start: number; end: number } | null>(null)

  function extractAbsYear(properties: Record<string, unknown>): number | null {
    const dateText = (properties.date as string) || (properties.startDate as string) || ''
    if (!dateText) return null
    const parsed = parseDate(dateText)
    if (!parsed) return null
    return parsed.era * 10000 + parsed.year
  }

  /** 边的基础视觉属性组（组装与增量更新共用；base* 供复位、hl* 供高亮） */
  function baseAttrs(e: GraphEdge) {
    const base = edgeBaseVisual(metaOf(e))
    const hl = edgeHighlightVisual(metaOf(e))
    return {
      relType: e.relType,
      relLabel: e.relLabel,
      baseColor: base.color,
      baseSize: base.size,
      baseType: base.type,
      hlColor: hl.color,
      hlSize: hl.size,
    }
  }

  function addEdgeWithVisual(e: GraphEdge): void {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) return
    const a = baseAttrs(e)
    try {
      graph.addEdge(e.source, e.target, {
        ...a,
        color: a.baseColor,
        size: a.baseSize,
        type: a.baseType,
        hidden: graph.getNodeAttribute(e.source, 'hidden') || graph.getNodeAttribute(e.target, 'hidden'),
      })
    } catch { /* 同向重边（multi=false） */ }
  }

  function buildGraphology(): void {
    graph.clear()
    let minAbs = Infinity
    let maxAbs = -Infinity
    let hasDatedNodes = false

    for (const n of opts.nodes.value) {
      const size = Math.min(16, Math.max(4, 4 + n.degree * 0.8))
      const color = getColor(n.type, 'cool')
      const hidden = !opts.shownTypes.value.has(n.type)
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
    for (const e of opts.edges.value) {
      addEdgeWithVisual(e)
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

  /** 选中/路径视觉复位：节点回原色原尺寸；边回基础档 + 撤关系标签；边隐藏态随两端节点重算
   *  （不再无差别全显——类型过滤/聚焦隐藏的边不该被点空白「救回来」） */
  function syncGraphColors(): void {
    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, 'color', graph.getNodeAttribute(node, 'originalColor') || '#4fc3f7')
      graph.setNodeAttribute(node, 'size', graph.getNodeAttribute(node, 'originalSize') || 6)
      graph.setNodeAttribute(node, 'highlighted', false)
    })
    graph.forEachEdge((edge) => {
      graph.setEdgeAttribute(edge, 'color', graph.getEdgeAttribute(edge, 'baseColor'))
      graph.setEdgeAttribute(edge, 'size', graph.getEdgeAttribute(edge, 'baseSize'))
      graph.setEdgeAttribute(edge, 'label', undefined)
      const srcHidden = graph.getNodeAttribute(graph.source(edge), 'hidden')
      const tgtHidden = graph.getNodeAttribute(graph.target(edge), 'hidden')
      graph.setEdgeAttribute(edge, 'hidden', srcHidden || tgtHidden)
    })
  }

  function applyTypeFilter(): void {
    graph.forEachNode((node) => {
      const type = graph.getNodeAttribute(node, 'entityType') as string
      const typeHidden = !opts.shownTypes.value.has(type)
      const absYear = graph.getNodeAttribute(node, 'absYear') as number | undefined
      let timelineHidden = false
      if (timelineActiveRange.value && absYear !== undefined) {
        timelineHidden = absYear < timelineActiveRange.value.start || absYear > timelineActiveRange.value.end
      }
      graph.setNodeAttribute(node, 'hidden', typeHidden || timelineHidden)
    })
    graph.forEachEdge((edge) => {
      const srcHidden = graph.getNodeAttribute(graph.source(edge), 'hidden')
      const tgtHidden = graph.getNodeAttribute(graph.target(edge), 'hidden')
      graph.setEdgeAttribute(edge, 'hidden', srcHidden || tgtHidden)
    })
    opts.sigma.value?.refresh()
  }

  function onTimelineFilter(start: number, end: number): void {
    timelineActiveRange.value = { start, end }
    let count = 0
    graph.forEachNode((node) => {
      const type = graph.getNodeAttribute(node, 'entityType') as string
      const typeHidden = !opts.shownTypes.value.has(type)
      const absYear = graph.getNodeAttribute(node, 'absYear') as number | undefined
      let timelineHidden = false
      if (absYear !== undefined) {
        timelineHidden = absYear < start || absYear > end
        if (!timelineHidden && !typeHidden) count++
      }
      graph.setNodeAttribute(node, 'hidden', typeHidden || timelineHidden)
    })
    graph.forEachEdge((edge) => {
      const srcHidden = graph.getNodeAttribute(graph.source(edge), 'hidden')
      const tgtHidden = graph.getNodeAttribute(graph.target(edge), 'hidden')
      graph.setEdgeAttribute(edge, 'hidden', srcHidden || tgtHidden)
    })
    timelineFilteredCount.value = count
    opts.sigma.value?.refresh()
  }

  function onTimelineReset(): void {
    timelineActiveRange.value = null
    timelineFilteredCount.value = 0
    applyTypeFilter()
  }

  function incrementalUpdate(): void {
    const currentIds = new Set<string>()
    graph.forEachNode((n) => currentIds.add(n))
    const targetIds = new Set(opts.nodes.value.map(n => n.id))

    for (const id of currentIds) {
      if (!targetIds.has(id)) {
        graph.dropNode(id)
      }
    }

    for (const n of opts.nodes.value) {
      const size = Math.min(16, Math.max(4, 4 + n.degree * 0.8))
      const color = getColor(n.type, 'cool')
      const typeHidden = !opts.shownTypes.value.has(n.type)
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
    const targetEdgeIds = new Set(opts.edges.value.map(e => e.id))

    for (const eid of currentEdges) {
      if (!targetEdgeIds.has(eid)) {
        try { graph.dropEdge(eid) } catch { /* skip */ }
      }
    }

    for (const e of opts.edges.value) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue
      const srcHidden = graph.getNodeAttribute(e.source, 'hidden')
      const tgtHidden = graph.getNodeAttribute(e.target, 'hidden')
      const a = baseAttrs(e)
      if (currentEdges.has(e.id)) {
        graph.mergeEdgeAttributes(e.id, { ...a, hidden: srcHidden || tgtHidden })
      } else {
        try {
          graph.addEdge(e.source, e.target, {
            ...a,
            color: a.baseColor,
            size: a.baseSize,
            type: a.baseType,
            hidden: srcHidden || tgtHidden,
          })
        } catch { /* 同向重边（multi=false） */ }
      }
    }

    opts.sigma.value?.refresh()
  }

  return {
    timelineMinYear,
    timelineMaxYear,
    timelineFilteredCount,
    buildGraphology,
    syncGraphColors,
    applyTypeFilter,
    onTimelineFilter,
    onTimelineReset,
    incrementalUpdate,
  }
}
