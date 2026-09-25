import type { Ref } from 'vue'
import {
  useTreeCanvas,
  roundRect,
  hexToRgba,
  type TreeEdgeBase,
  type NodeState,
} from '@worldsea/canvas-engine/tree'
import type { RecipeNode, RecipeEdge, RecipeNodeType } from './useRecipeTreeData'

/** 从 CSS 变量读取主题色（canvas 背景由引擎按 --color-bg-base 主题化，文本/边框须同步主题，否则浅色下不可见） */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

const NODE_W = 160
const NODE_H = 56
const NODE_R = 8

const TYPE_BORDER: Record<RecipeNodeType, string> = {
  'plant': '#3fb950',
  'item': '#58a6ff',
  'magic': '#d2a8ff',
}

const EDGE_COLORS: Record<string, string> = {
  'materials_from': '#58a6ff',
  'magic_material': '#d2a8ff',
}

interface RecipeTreeEdge extends TreeEdgeBase {
  edgeType: 'materials_from' | 'magic_material'
}

function drawRecipeNode(
  ctx: CanvasRenderingContext2D,
  node: RecipeNode,
  state: NodeState,
  _nodeWidth: number,
  _nodeHeight: number,
): void {
  const x = node.x - NODE_W / 2
  const y = node.y - NODE_H / 2
  const borderColor = TYPE_BORDER[node.nodeType]

  ctx.save()
  const text = cssVar('--color-text-primary', '#e6edf3')
  const tertiary = cssVar('--color-text-tertiary', '#8b949e')

  if (state.isSelected) {
    ctx.shadowColor = borderColor
    ctx.shadowBlur = 12
  }

  ctx.beginPath()
  roundRect(ctx, x, y, NODE_W, NODE_H, NODE_R)
  ctx.fillStyle = hexToRgba(borderColor, 0.12)
  ctx.fill()
  ctx.strokeStyle = state.isSelected ? borderColor : state.isHovered ? text : hexToRgba(borderColor, 0.4)
  ctx.lineWidth = state.isSelected ? 2 : 1
  ctx.stroke()

  ctx.shadowBlur = 0

  ctx.font = '16px sans-serif'
  ctx.fillStyle = text
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(node.icon, x + 8, y + NODE_H / 2 - 6)

  ctx.font = '12px sans-serif'
  ctx.fillStyle = text
  const nameText = node.name.length > 8 ? node.name.slice(0, 8) + '…' : node.name
  ctx.fillText(nameText, x + 30, y + NODE_H / 2 - 8)

  ctx.font = '9px sans-serif'
  ctx.fillStyle = hexToRgba(borderColor, 0.8)
  ctx.fillText(node.subType, x + 30, y + NODE_H / 2 + 6)

  if (node.rarity && node.rarity !== '常见') {
    ctx.font = '9px sans-serif'
    ctx.fillStyle = node.color
    ctx.textAlign = 'right'
    ctx.fillText(node.rarity, x + NODE_W - 8, y + NODE_H / 2 + 6)
  }

  const typeTag = node.nodeType === 'plant' ? '🌿' : node.nodeType === 'item' ? '📦' : '🔮'
  ctx.font = '8px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillStyle = tertiary
  ctx.fillText(typeTag, x + NODE_W - 8, y + 12)

  ctx.restore()
}

function drawRecipeEdge(
  ctx: CanvasRenderingContext2D,
  edge: RecipeTreeEdge,
  source: RecipeNode | undefined,
  target: RecipeNode | undefined,
): void {
  if (!source || !target) return

  const color = EDGE_COLORS[edge.edgeType] || '#8b949e'

  ctx.save()

  const dx = target.x - source.x
  const dy = target.y - source.y
  const angle = Math.atan2(dy, dx)

  const startX = source.x + Math.cos(angle) * (NODE_W / 2 + 4)
  const startY = source.y + Math.sin(angle) * (NODE_H / 2 + 4)
  const endX = target.x - Math.cos(angle) * (NODE_W / 2 + 4)
  const endY = target.y - Math.sin(angle) * (NODE_H / 2 + 4)

  ctx.beginPath()
  ctx.setLineDash(edge.edgeType === 'magic_material' ? [6, 4] : [])
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.moveTo(startX, startY)
  ctx.lineTo(endX, endY)
  ctx.stroke()

  const arrowLen = 8
  ctx.beginPath()
  ctx.moveTo(endX, endY)
  ctx.lineTo(endX - arrowLen * Math.cos(angle - 0.3), endY - arrowLen * Math.sin(angle - 0.3))
  ctx.lineTo(endX - arrowLen * Math.cos(angle + 0.3), endY - arrowLen * Math.sin(angle + 0.3))
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()

  const midX = (startX + endX) / 2
  const midY = (startY + endY) / 2
  ctx.font = '9px sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const label = edge.edgeType === 'magic_material' ? '施法材料' : '制成'
  ctx.fillText(label, midX, midY - 4)

  ctx.restore()
}

export function useRecipeTreeCanvas(containerRef: Ref<HTMLElement | null>) {

  const treeCanvas = useTreeCanvas<RecipeNode, RecipeTreeEdge>({
    containerRef,
    drawNode: drawRecipeNode,
    drawEdge: drawRecipeEdge,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
  })

  function setShowMagic(_v: boolean): void {
    treeCanvas.markDirty()
  }

  function setData(
    nodes: RecipeNode[],
    edges: RecipeEdge[],
    showMagic: boolean,
  ): void {
    const treeEdges: RecipeTreeEdge[] = edges
      .filter(e => showMagic || e.edgeType !== 'magic_material')
      .map(e => ({
        id: `${e.sourceId}-${e.targetId}`,
        sourceId: e.sourceId,
        targetId: e.targetId,
        edgeType: e.edgeType,
        dashed: e.edgeType === 'magic_material',
        label: e.edgeType === 'magic_material' ? '施法材料' : '制成',
        arrow: true,
      }))

    treeCanvas.setData(nodes, treeEdges)
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
    setSelectedId: (id: string | null) => {
      treeCanvas.selectedId.value = id
      treeCanvas.markDirty()
    },
    setShowMagic,
    setData,
  }
}
