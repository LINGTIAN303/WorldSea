import type { Ref } from 'vue'
import {
  useTreeCanvas,
  roundRect,
  hexToRgba,
  drawArrow,
  drawClusterOutlines,
  type TreeEdgeBase,
  type NodeState,
} from '@worldsmith/canvas-engine/tree'
import type { SkillNode, SkillEdge } from './useSkillTreeData'

const NODE_W = 160
const NODE_H = 60
const NODE_R = 8

interface SkillTreeEdge extends TreeEdgeBase {
  edgeType: 'upgrades_to' | 'counters'
}

function drawSkillNode(
  ctx: CanvasRenderingContext2D,
  node: SkillNode,
  state: NodeState,
  _nodeWidth: number,
  _nodeHeight: number,
): void {
  const x = node.x - NODE_W / 2
  const y = node.y - NODE_H / 2

  ctx.save()

  if (state.isSelected) {
    ctx.shadowColor = '#58a6ff'
    ctx.shadowBlur = 12
  }

  ctx.beginPath()
  roundRect(ctx, x, y, NODE_W, NODE_H, NODE_R)
  ctx.fillStyle = hexToRgba(node.color, 0.2)
  ctx.fill()
  ctx.strokeStyle = state.isSelected ? '#58a6ff' : state.isHovered ? '#e6edf3' : hexToRgba(node.color, 0.5)
  ctx.lineWidth = state.isSelected ? 2 : 1
  ctx.stroke()

  ctx.shadowBlur = 0

  ctx.font = '16px sans-serif'
  ctx.fillStyle = '#e6edf3'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(node.icon, x + 8, y + NODE_H / 2 - 6)

  ctx.font = '13px sans-serif'
  ctx.fillStyle = '#e6edf3'
  ctx.textAlign = 'left'
  const nameText = node.name.length > 10 ? node.name.slice(0, 10) + '…' : node.name
  ctx.fillText(nameText, x + 30, y + NODE_H / 2 - 6)

  ctx.font = '10px sans-serif'
  ctx.fillStyle = '#8b949e'
  ctx.textAlign = 'left'
  ctx.fillText(node.level, x + 30, y + NODE_H / 2 + 12)

  ctx.restore()
}

function drawSkillEdge(
  ctx: CanvasRenderingContext2D,
  edge: SkillTreeEdge,
  source: SkillNode | undefined,
  target: SkillNode | undefined,
): void {
  if (!source || !target) return

  const isCounters = edge.edgeType === 'counters'
  const color = isCounters ? '#f85149' : '#8b949e'

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5

  if (isCounters) {
    ctx.setLineDash([6, 4])
  }

  drawArrow(ctx, source.x, source.y, target.x, target.y, NODE_W, NODE_H, color, isCounters)

  ctx.restore()
}

export function useSkillTreeCanvas(containerRef: Ref<HTMLElement | null>) {
  let _nodes: SkillNode[] = []
  let _showClusters = true
  let _layoutMode: 'bottom-up' | 'radial' = 'bottom-up'

  const treeCanvas = useTreeCanvas<SkillNode, SkillTreeEdge>({
    containerRef,
    drawNode: drawSkillNode,
    drawEdge: drawSkillEdge,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    onBeforeDraw: (ctx) => {
      if (_showClusters && _layoutMode === 'bottom-up') {
        drawClusterOutlines(ctx, _nodes, 'magicType', NODE_W, NODE_H)
      }
    },
  })

  function setSelectedId(id: string | null): void {
    treeCanvas.selectedId.value = id
    treeCanvas.markDirty()
  }

  function setData(nodes: SkillNode[], edges: SkillEdge[], showCounters: boolean): void {
    _nodes = nodes
    const filteredEdges = showCounters ? edges : edges.filter(e => e.type === 'upgrades_to')
    const treeEdges: SkillTreeEdge[] = filteredEdges.map(e => ({
      id: `${e.sourceId}-${e.targetId}-${e.type}`,
      sourceId: e.sourceId,
      targetId: e.targetId,
      edgeType: e.type,
      color: e.type === 'counters' ? '#f85149' : '#8b949e',
      dashed: e.type === 'counters',
      bidir: e.type === 'counters',
    }))
    treeCanvas.setData(nodes, treeEdges)
  }

  function setShowClusters(v: boolean): void {
    _showClusters = v
    treeCanvas.markDirty()
  }

  function setLayoutMode(mode: 'bottom-up' | 'radial'): void {
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
