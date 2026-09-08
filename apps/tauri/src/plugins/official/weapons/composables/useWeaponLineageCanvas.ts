import type { Ref } from 'vue'
import {
  useTreeCanvas,
  roundRect,
  hexToRgba,
  type TreeEdgeBase,
  type NodeState,
} from '@worldsea/canvas-engine/tree'
import type { WeaponNode, WeaponEdge, HolderLink } from './useWeaponLineageData'

/** 从 CSS 变量读取主题色（canvas 背景由引擎按 --color-bg-base 主题化，文本/边框须同步主题，否则浅色下不可见） */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

const NODE_W = 160
const NODE_H = 56
const NODE_R = 8

const RELATION_COLORS: Record<string, string> = {
  '克制': '#f85149',
  '配套': '#3fb950',
  '同源': '#d2a8ff',
  '对立': '#f0883e',
}

interface WeaponTreeEdge extends TreeEdgeBase {
  relation: string
}

function drawWeaponNode(
  ctx: CanvasRenderingContext2D,
  node: WeaponNode,
  state: NodeState,
  _nodeWidth: number,
  _nodeHeight: number,
): void {
  const x = node.x - NODE_W / 2
  const y = node.y - NODE_H / 2

  ctx.save()
  const text = cssVar('--color-text-primary', '#e6edf3')
  const tertiary = cssVar('--color-text-tertiary', '#8b949e')

  if (state.isSelected) {
    ctx.shadowColor = node.color
    ctx.shadowBlur = 12
  }

  ctx.beginPath()
  roundRect(ctx, x, y, NODE_W, NODE_H, NODE_R)
  ctx.fillStyle = hexToRgba(node.color, 0.15)
  ctx.fill()
  ctx.strokeStyle = state.isSelected ? node.color : state.isHovered ? text : hexToRgba(node.color, 0.4)
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
  ctx.fillStyle = hexToRgba(node.color, 0.8)
  ctx.fillText(node.rank, x + 30, y + NODE_H / 2 + 6)

  if (node.status) {
    ctx.font = '9px sans-serif'
    ctx.fillStyle = tertiary
    ctx.textAlign = 'right'
    ctx.fillText(node.status, x + NODE_W - 8, y + NODE_H / 2 + 6)
  }

  ctx.restore()
}

function drawWeaponEdge(
  ctx: CanvasRenderingContext2D,
  edge: WeaponTreeEdge,
  source: WeaponNode | undefined,
  target: WeaponNode | undefined,
): void {
  if (!source || !target) return

  const color = RELATION_COLORS[edge.relation] || '#8b949e'

  ctx.save()

  const dx = target.x - source.x
  const dy = target.y - source.y
  const angle = Math.atan2(dy, dx)

  const startX = source.x + Math.cos(angle) * (NODE_W / 2 + 4)
  const startY = source.y + Math.sin(angle) * (NODE_H / 2 + 4)
  const endX = target.x - Math.cos(angle) * (NODE_W / 2 + 4)
  const endY = target.y - Math.sin(angle) * (NODE_H / 2 + 4)

  ctx.beginPath()
  ctx.setLineDash(edge.relation === '对立' ? [6, 4] : [])
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
  ctx.fillText(edge.relation, midX, midY - 4)

  ctx.restore()
}

function drawHolderChain(
  ctx: CanvasRenderingContext2D,
  weaponId: string,
  holderLinks: HolderLink[],
  nodes: WeaponNode[],
): void {
  const weaponNode = nodes.find(n => n.id === weaponId)
  if (!weaponNode) return

  const holders = holderLinks.filter(h => h.weaponId === weaponId)
  if (holders.length === 0) return

  const chainStartX = weaponNode.x + NODE_W / 2 + 20
  const chainStartY = weaponNode.y - (holders.length - 1) * 14

  ctx.save()
  const text = cssVar('--color-text-primary', '#e6edf3')
  const textTertiary = cssVar('--color-text-tertiary', '#8b949e')
  const accent = cssVar('--color-primary', '#58a6ff')
  const borderStrong = cssVar('--color-border-strong', '#30363d')
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  for (let i = 0; i < holders.length; i++) {
    const h = holders[i]
    const hy = chainStartY + i * 28

    ctx.beginPath()
    ctx.moveTo(weaponNode.x + NODE_W / 2, weaponNode.y)
    ctx.lineTo(chainStartX, hy)
    ctx.strokeStyle = h.isCurrent ? accent : borderStrong
    ctx.lineWidth = h.isCurrent ? 1.5 : 0.8
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(chainStartX + 4, hy, 4, 0, Math.PI * 2)
    ctx.fillStyle = h.isCurrent ? accent : textTertiary
    ctx.fill()

    ctx.fillStyle = h.isCurrent ? text : textTertiary
    const label = (h.isCurrent ? '● ' : '○ ') + h.characterName
    ctx.fillText(label, chainStartX + 14, hy)
  }

  ctx.restore()
}

export function useWeaponLineageCanvas(containerRef: Ref<HTMLElement | null>) {
  let _showHolders = true
  let _holderLinks: HolderLink[] = []
  let _nodes: WeaponNode[] = []

  const treeCanvas = useTreeCanvas<WeaponNode, WeaponTreeEdge>({
    containerRef,
    drawNode: drawWeaponNode,
    drawEdge: drawWeaponEdge,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    onAfterDraw: (ctx, _w, _h, _camera) => {
      if (_showHolders && treeCanvas.selectedId.value) {
        drawHolderChain(ctx, treeCanvas.selectedId.value, _holderLinks, _nodes)
      }
    },
  })

  function setShowHolders(v: boolean): void {
    _showHolders = v
    treeCanvas.markDirty()
  }

  function setShowRelations(_v: boolean): void {
    treeCanvas.markDirty()
  }

  function setData(
    nodes: WeaponNode[],
    edges: WeaponEdge[],
    holderLinks: HolderLink[],
    showHolders: boolean,
    showRelations: boolean,
  ): void {
    _nodes = nodes
    _holderLinks = holderLinks
    _showHolders = showHolders

    const treeEdges: WeaponTreeEdge[] = showRelations
      ? edges.map(e => ({
          id: `${e.sourceId}-${e.targetId}`,
          sourceId: e.sourceId,
          targetId: e.targetId,
          relation: e.relation,
          dashed: e.relation === '对立',
          label: e.relation,
          arrow: true,
        }))
      : []

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
    setShowHolders,
    setShowRelations,
    setData,
  }
}
