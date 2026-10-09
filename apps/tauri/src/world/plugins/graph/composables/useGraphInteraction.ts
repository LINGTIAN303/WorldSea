import { ref } from 'vue'
import Graph from 'graphology'
import { useGraphAlgorithms } from '@worldsea/ui-kit'

export function useGraphInteraction() {
  const selectedNodeId = ref<string | null>(null)
  const hoveredNodeId = ref<string | null>(null)
  const highlightedNodes = ref<Set<string>>(new Set())
  const highlightedEdges = ref<Set<string>>(new Set())
  const pathResult = ref<string[]>([])

  const algorithms = useGraphAlgorithms()

  function selectNode(nodeId: string | null, graph: Graph): void {
    selectedNodeId.value = nodeId
    if (nodeId && graph.hasNode(nodeId)) {
      const neighbors = new Set(graph.neighbors(nodeId))
      highlightedNodes.value = new Set([nodeId, ...neighbors])
      const edgeSet = new Set<string>()
      graph.forEachEdge(nodeId, (edge) => { edgeSet.add(edge) })
      highlightedEdges.value = edgeSet
    } else {
      highlightedNodes.value = new Set()
      highlightedEdges.value = new Set()
    }
  }

  function hoverNode(nodeId: string | null, _graph: Graph): void {
    hoveredNodeId.value = nodeId
  }

  async function findPath(graph: Graph, fromId: string, toId: string): Promise<string[]> {
    const path = await algorithms.shortestPath(graph, fromId, toId)
    pathResult.value = path
    if (path.length > 0) {
      highlightedNodes.value = new Set(path)
      const edgeSet = new Set<string>()
      for (let i = 0; i < path.length - 1; i++) {
        const edges = graph.edge(path[i], path[i + 1])
        if (edges) {
          if (Array.isArray(edges)) edges.forEach(e => edgeSet.add(e))
          else edgeSet.add(edges)
        }
      }
      highlightedEdges.value = edgeSet
    }
    return path
  }

  function clearHighlight(): void {
    selectedNodeId.value = null
    hoveredNodeId.value = null
    highlightedNodes.value = new Set()
    highlightedEdges.value = new Set()
    pathResult.value = []
  }

  /** 搜索高亮（批 B）：只设高亮节点集、不动选中；边集留空 = 不隐边（applyHighlight 既有语义） */
  function highlightNodes(ids: Set<string>): void {
    selectedNodeId.value = null
    highlightedNodes.value = ids
    highlightedEdges.value = new Set()
  }

  /** 悬停暂态高亮（批 E）：同上但保留选中态——簇项悬停离开后可据此恢复选中视觉 */
  function peekHighlight(ids: Set<string>): void {
    highlightedNodes.value = ids
    highlightedEdges.value = new Set()
  }

  function applyHighlightToGraph(graph: Graph): void {
    const highlighted = highlightedNodes.value
    const selected = selectedNodeId.value
    graph.forEachNode((node) => {
      const isHighlighted = highlighted.has(node)
      const isSelected = node === selected
      graph.setNodeAttribute(node, 'highlighted', isHighlighted)
      if (highlighted.size > 0 && !isHighlighted) {
        graph.setNodeAttribute(node, 'color', dimColor(graph.getNodeAttribute(node, 'originalColor') || '#4fc3f7'))
      } else {
        graph.setNodeAttribute(node, 'color', graph.getNodeAttribute(node, 'originalColor') || '#4fc3f7')
      }
      if (isSelected) {
        graph.setNodeAttribute(node, 'size', (graph.getNodeAttribute(node, 'originalSize') || 6) * 1.8)
      } else {
        graph.setNodeAttribute(node, 'size', graph.getNodeAttribute(node, 'originalSize') || 6)
      }
    })

    const hlEdges = highlightedEdges.value
    graph.forEachEdge((edge) => {
      const isHl = hlEdges.size > 0 && hlEdges.has(edge)
      // 有高亮边集时才接管显隐（搜索零命中/空集不得把类型过滤隐藏的边「救活」）
      if (hlEdges.size > 0) {
        graph.setEdgeAttribute(edge, 'hidden', !isHl)
      }
      // 高亮档：类型色满档 + 加粗 + 显关系标签（批 A「选中/聚焦时显关系标签」）
      graph.setEdgeAttribute(edge, 'color', isHl ? graph.getEdgeAttribute(edge, 'hlColor') : graph.getEdgeAttribute(edge, 'baseColor'))
      graph.setEdgeAttribute(edge, 'size', isHl ? graph.getEdgeAttribute(edge, 'hlSize') : graph.getEdgeAttribute(edge, 'baseSize'))
      graph.setEdgeAttribute(edge, 'label', isHl ? graph.getEdgeAttribute(edge, 'relLabel') : undefined)
    })
  }

  function dimColor(hex: string): string {
    if (!hex || hex.length < 7) return 'rgba(150,150,150,0.2)'
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},0.2)`
  }

  return {
    selectedNodeId,
    hoveredNodeId,
    highlightedNodes,
    highlightedEdges,
    pathResult,
    selectNode,
    hoverNode,
    findPath,
    clearHighlight,
    highlightNodes,
    peekHighlight,
    applyHighlightToGraph,
  }
}
