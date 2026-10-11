import type { Ref } from 'vue'
import {
  useTreeCanvas,
  roundRect,
  hexToRgba,
  drawArrow,
  drawClusterOutlines,
  type TreeEdgeBase,
  type NodeState,
} from '@worldsea/canvas-engine/tree'
import type { EvoNode, EvoEdge, RelationKind } from './useEvolutionTreeData'

/** 从 CSS 变量读取主题色（canvas 背景由引擎按 --color-bg-base 主题化，文本/边框须同步主题，否则浅色下不可见） */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

const NODE_W = 160
const NODE_H = 64
const NODE_R = 8

const EDGE_STYLES: Record<RelationKind, { color: string; dashed: boolean; bidir: boolean }> = {
  '祖先': { color: '#8b949e', dashed: false, bidir: false },
  '进化': { color: '#58a6ff', dashed: false, bidir: false },
  '杂交': { color: '#d2a8ff', dashed: true, bidir: true },
  '共生': { color: '#3fb950', dashed: true, bidir: false },
  '天敌': { color: '#f85149', dashed: true, bidir: false },
}

interface EvoTreeEdge extends TreeEdgeBase {
  relation: RelationKind
}

function drawEvoNode(
  ctx: CanvasRenderingContext2D,
  node: EvoNode,
  state: NodeState,
  _nodeWidth: number,
  _nodeHeight: number,
): void {
  const x = node.x - NODE_W / 2
  const y = node.y - NODE_H / 2

  ctx.save()
  const text = cssVar('--color-text-primary', '#e6edf3')
  const tertiary = cssVar('--color-text-tertiary', '#8b949e')
  const accent = cssVar('--color-primary', '#58a6ff')

  if (state.isSelected) {
    ctx.shadowColor = accent
    ctx.shadowBlur = 12
  }

  ctx.beginPath()
  roundRect(ctx, x, y, NODE_W, NODE_H, NODE_R)
  ctx.fillStyle = hexToRgba(node.color, 0.15)
  ctx.fill()
  ctx.strokeStyle = state.isSelected ? accent : state.isHovered ? text : hexToRgba(node.color, 0.5)
  ctx.lineWidth = state.isSelected ? 2 : 1
  ctx.stroke()

  ctx.shadowBlur = 0

  ctx.font = '18px sans-serif'
  ctx.fillStyle = text
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(node.icon, x + 8, y + NODE_H / 2 - 6)

  ctx.font = '13px sans-serif'
  ctx.fillStyle = text
  ctx.textAlign = 'left'
  const nameText = node.name.length > 10 ? node.name.slice(0, 10) + '…' : node.name
  ctx.fillText(nameText, x + 34, y + NODE_H / 2 - 8)

  ctx.font = '10px sans-serif'
  ctx.fillStyle = tertiary
  ctx.fillText(node.speciesType, x + 34, y + NODE_H / 2 + 8)

  if (node.population) {
    ctx.font = '9px sans-serif'
    ctx.fillStyle = hexToRgba(node.color, 0.7)
    ctx.fillText(String(node.population), x + 34, y + NODE_H / 2 + 20)
  }

  ctx.restore()
}

function drawEvoEdge(
  ctx: CanvasRenderingContext2D,
  edge: EvoTreeEdge,
  source: EvoNode | undefined,
  target: EvoNode | undefined,
): void {
  if (!source || !target) return

  const style = EDGE_STYLES[edge.relation] || EDGE_STYLES['进化']

  ctx.save()
  ctx.strokeStyle = style.color
  ctx.lineWidth = 1.5

  if (style.dashed) {
    ctx.setLineDash([6, 4])
  }

  drawArrow(ctx, source.x, source.y, target.x, target.y, NODE_W, NODE_H, style.color, style.bidir)

  const midX = (source.x + target.x) / 2
  const midY = (source.y + target.y) / 2
  ctx.font = '9px sans-serif'
  ctx.fillStyle = style.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(edge.relation, midX, midY - 6)

  ctx.restore()
}

export function useEvolutionTreeCanvas(containerRef: Ref<HTMLElement | null>) {
  let _nodes: EvoNode[] = []
  let _showClusters = true
  let _layoutMode: 'top-down' | 'radial' = 'top-down'

  const treeCanvas = useTreeCanvas<EvoNode, EvoTreeEdge>({
    containerRef,
    drawNode: drawEvoNode,
    drawEdge: drawEvoEdge,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    onBeforeDraw: (ctx) => {
      if (_showClusters && _layoutMode === 'top-down') {
        drawClusterOutlines(ctx, _nodes, 'speciesType', NODE_W, NODE_H)
      }
    },
  })

  function setSelectedId(id: string | null): void {
    treeCanvas.selectedId.value = id
    treeCanvas.markDirty()
  }

  function setData(
    nodes: EvoNode[],
    edges: EvoEdge[],
    showSymbiosis: boolean,
    showRivals: boolean,
  ): void {
    _nodes = nodes
    const filteredEdges = edges.filter(e => {
      if (!showSymbiosis && e.relation === '共生') return false
      if (!showRivals && e.relation === '天敌') return false
      return true
    })
    const treeEdges: EvoTreeEdge[] = filteredEdges.map(e => ({
      id: `${e.sourceId}-${e.targetId}-${e.relation}`,
      sourceId: e.sourceId,
      targetId: e.targetId,
      relation: e.relation,
      color: EDGE_STYLES[e.relation]?.color,
      dashed: EDGE_STYLES[e.relation]?.dashed,
      bidir: EDGE_STYLES[e.relation]?.bidir,
    }))
    treeCanvas.setData(nodes, treeEdges)
  }

  function setShowClusters(v: boolean): void {
    _showClusters = v
    treeCanvas.markDirty()
  }

  function setLayoutMode(mode: 'top-down' | 'radial'): void {
    _layoutMode = mode
    treeCanvas.markDirty()
  }

  return {
    canvas: treeCanvas.canvas,
    camera: treeCanvas.camera,
    selectedId: treeCanvas.selectedId,
    hoveredId: treeCanvas.hoveredId,
    markDirty: treeCanvas.markDirty,
    getCamera: treeCanvas.getCamera,
    setCamera: treeCanvas.setCamera,
    screenToWorld: treeCanvas.screenToWorld,
    hitTest: treeCanvas.hitTest,
    fitView: treeCanvas.fitView,
    setCallbacks: treeCanvas.setCallbacks,
    setSelectedId,
    setData,
    setShowClusters,
    setLayoutMode,
  }
}
