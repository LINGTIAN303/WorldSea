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
import type { LangNode, LangEdge, LangRelation } from './useLangFamilyTreeData'

/** 从 CSS 变量读取主题色（canvas 背景由引擎按 --color-bg-base 主题化，文本/边框须同步主题，否则浅色下不可见） */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

const NODE_W = 160
const NODE_H = 64
const NODE_R = 8

const RELATED_STYLES: Record<LangRelation, { color: string; dashed: boolean; bidir: boolean }> = {
  '同源': { color: '#3fb950', dashed: true, bidir: true },
  '借词': { color: '#d29922', dashed: true, bidir: false },
  '混合': { color: '#d2a8ff', dashed: true, bidir: true },
  '变体': { color: '#79c0ff', dashed: false, bidir: false },
  '祖先语言': { color: '#8b949e', dashed: false, bidir: false },
}

interface LangTreeEdge extends TreeEdgeBase {
  edgeType: 'branch' | 'related'
  relation?: LangRelation
}

function drawLangNode(
  ctx: CanvasRenderingContext2D,
  node: LangNode,
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

  ctx.font = '16px sans-serif'
  ctx.fillStyle = text
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(node.icon, x + 8, y + NODE_H / 2 - 8)

  ctx.font = '13px sans-serif'
  ctx.fillStyle = text
  ctx.textAlign = 'left'
  const nameText = node.name.length > 10 ? node.name.slice(0, 10) + '…' : node.name
  ctx.fillText(nameText, x + 30, y + NODE_H / 2 - 10)

  ctx.font = '10px sans-serif'
  ctx.fillStyle = tertiary
  ctx.fillText(node.langType, x + 30, y + NODE_H / 2 + 4)

  if (node.languageFamily) {
    ctx.font = '9px sans-serif'
    ctx.fillStyle = hexToRgba(node.color, 0.7)
    ctx.fillText(node.languageFamily, x + 30, y + NODE_H / 2 + 16)
  }

  ctx.restore()
}

function drawLangEdge(
  ctx: CanvasRenderingContext2D,
  edge: LangTreeEdge,
  source: LangNode | undefined,
  target: LangNode | undefined,
): void {
  if (!source || !target) return

  ctx.save()

  if (edge.edgeType === 'branch') {
    ctx.strokeStyle = '#58a6ff'
    ctx.lineWidth = 1.5
    ctx.setLineDash([])
    drawArrow(ctx, source.x, source.y, target.x, target.y, NODE_W, NODE_H, '#58a6ff', false)
  } else {
    const rel = edge.relation || '同源'
    const style = RELATED_STYLES[rel] || RELATED_STYLES['同源']
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
    ctx.fillText(rel, midX, midY - 6)
  }

  ctx.restore()
}

export function useLangFamilyTreeCanvas(containerRef: Ref<HTMLElement | null>) {
  let _nodes: LangNode[] = []
  let _showClusters = true
  let _layoutMode: 'top-down' | 'radial' = 'top-down'

  const treeCanvas = useTreeCanvas<LangNode, LangTreeEdge>({
    containerRef,
    drawNode: drawLangNode,
    drawEdge: drawLangEdge,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    onBeforeDraw: (ctx) => {
      if (_showClusters && _layoutMode === 'top-down') {
        drawClusterOutlines(ctx, _nodes, 'languageFamily', NODE_W, NODE_H)
      }
    },
  })

  function setSelectedId(id: string | null): void {
    treeCanvas.selectedId.value = id
    treeCanvas.markDirty()
  }

  function setData(
    nodes: LangNode[],
    edges: LangEdge[],
    showRelated: boolean,
  ): void {
    _nodes = nodes
    const filteredEdges = showRelated
      ? edges
      : edges.filter(e => e.type === 'branch')
    const treeEdges: LangTreeEdge[] = filteredEdges.map(e => {
      const rel = e.relation || '同源'
      const style = e.type === 'related' ? (RELATED_STYLES[rel] || RELATED_STYLES['同源']) : null
      return {
        id: `${e.sourceId}-${e.targetId}-${e.type}`,
        sourceId: e.sourceId,
        targetId: e.targetId,
        edgeType: e.type,
        relation: e.type === 'related' ? rel : undefined,
        color: e.type === 'branch' ? '#58a6ff' : style?.color,
        dashed: e.type === 'branch' ? false : style?.dashed,
        bidir: e.type === 'branch' ? false : style?.bidir,
      }
    })
    treeCanvas.setData(nodes, treeEdges)
  }

  function setShowClusters(v: boolean): void {
    _showClusters = v
    treeCanvas.markDirty()
  }

  function setShowRelated(_v: boolean): void {
    // _showRelated 已移除（原为 dead write，从不读取）
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
    setShowRelated,
    setLayoutMode,
  }
}
