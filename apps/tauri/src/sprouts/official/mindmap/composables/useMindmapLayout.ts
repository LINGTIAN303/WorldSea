/** 思维导图布局逻辑（buildCanvasData/Rust 布局/持久化等，从 MindmapView 拆出），详细见 docs/details/注释/web/plugins/official/mindmap/composables/useMindmapLayout.md */
import { nextTick, type Ref, type ComputedRef } from 'vue'
import { deduplicateEdges } from '@worldsea/ui-kit'
import { getEdgeColor, useEntityStore, useRelationStore } from '@worldsea/entity-core'
import type { GraphNode, GraphEdge } from '@worldsea/canvas-engine'
import type { CanvasNode, CanvasEdge } from './canvasTypes'
import { useMindmapStore } from '../mindmapStore'
import type { LayoutAlgorithmType } from '../mindmapStore'
import { nodeSize, edgeLineStyle } from '../mindmapConfig'
import type { useRustLayout } from './useRustLayout'
import type { useLayoutAnimation } from './useLayoutAnimation'
import type { useCanvasRenderer } from './useCanvasRenderer'
import type { useTypeMapping } from '@worldsea/ui-kit'

/** useMindmapLayout 依赖的外部参数 */
export interface UseMindmapLayoutDeps {
  mindmapStore: ReturnType<typeof useMindmapStore>
  entityStore: ReturnType<typeof useEntityStore>
  relationStore: ReturnType<typeof useRelationStore>
  graphNodes: ComputedRef<GraphNode[]>
  graphEdges: ComputedRef<GraphEdge[]>
  canvasNodes: Ref<CanvasNode[]>
  canvasEdges: Ref<CanvasEdge[]>
  visibleTypes: Set<string>
  layoutName: { value: LayoutAlgorithmType }
  containerRef: Ref<HTMLDivElement | null>
  renderer: ReturnType<typeof useCanvasRenderer>
  rustLayout: ReturnType<typeof useRustLayout>
  layoutAnim: ReturnType<typeof useLayoutAnimation>
  typeMapping: ReturnType<typeof useTypeMapping>
}

export function useMindmapLayout(deps: UseMindmapLayoutDeps) {
  const {
    mindmapStore, entityStore, relationStore,
    graphNodes, graphEdges,
    canvasNodes, canvasEdges,
    visibleTypes, layoutName,
    containerRef, renderer,
    rustLayout, layoutAnim,
    typeMapping,
  } = deps
  const { getColor, getIcon, getLabel } = typeMapping

  /**
   * 构建画布数据：将 entity/relation 转换为 CanvasNode/CanvasEdge
   * 分两种模式：全局图（rootId=null）和嵌套子图（rootId 指定）
   */
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
      // ===== 全局图模式 =====
      const centerId = mindmapStore.centerNodeId
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
          curveStyle: (override ? override.lineStyle : defaultStyle) as CanvasEdge['curveStyle'],
          dashed: false, noArrow: me.symmetric,
          hidden: false, selected: false,
        })
      }
    } else {
      // ===== 嵌套子图模式 =====
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
          curveStyle: (override ? override.lineStyle : defaultStyle) as CanvasEdge['curveStyle'],
          dashed: false, noArrow: me.symmetric,
          hidden: false, selected: false,
        })
      }

      // 自定义节点（textbox/image/note/link）
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

  /** 将 canvasNodes/Edges 转换为 Rust 布局算法的输入格式 */
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

  /** 切换布局算法并重新应用 */
  function onLayoutChange(v: string): void {
    layoutName.value = v as LayoutAlgorithmType
    applyLayout()
  }

  /** 调用 rustLayout 并触发过渡动画 */
  async function applyLayout(): Promise<void> {
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

      // 构建动画目标（跳过被手动固定的节点和中心节点）
      const targets: Array<{
        node: CanvasNode
        fromX: number; fromY: number; toX: number; toY: number
      }> = []
      for (const pos of positions) {
        const node = canvasNodes.value.find(n => n.id === pos.id)
        if (node && !node.isRoot && node.fx === null && (Math.abs(node.x - pos.x) > 2 || Math.abs(node.y - pos.y) > 2)) {
          targets.push({ node, fromX: node.x, fromY: node.y, toX: pos.x, toY: pos.y })
        }
      }

      if (targets.length > 0) {
        layoutAnim.animateToTargets(targets, () => {
          renderer.markDirty()
        })
      } else {
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

  /** 重建图谱：构建数据 → 应用布局 → fitView */
  function rebuildGraph(): void {
    buildCanvasData()
    applyLayout()
    nextTick(() => renderer.fitView(canvasNodes.value))
  }

  /** 持久化节点位置到 store */
  function savePositions(): void {
    const positions: Record<string, { x: number; y: number }> = {}
    for (const n of canvasNodes.value) {
      positions[n.id] = { x: n.x, y: n.y }
    }
    mindmapStore.nodePositions = positions
  }

  /** 切换类型过滤并重建 */
  function toggleType(type: string): void {
    const v = visibleTypes
    if (!(v instanceof Set)) return
    if (v.has(type)) v.delete(type)
    else v.add(type)
    rebuildGraph()
  }

  return {
    buildCanvasData,
    mapToGraphData,
    onLayoutChange,
    applyLayout,
    rebuildGraph,
    savePositions,
    toggleType,
  }
}
