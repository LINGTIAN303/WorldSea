import type { Ref } from 'vue'
import {
  useTreeCanvas,
  roundRect,
  hexToRgba,
  type TreeEdgeBase,
  type NodeState,
} from '@worldsea/canvas-engine/tree'
import type { BuildingNode, ConnectionEdge } from './useBuildingSectionData'
import { parseFloors } from './useBuildingSectionData'

/** 从 CSS 变量读取主题色（canvas 背景由引擎按 --color-bg-base 主题化，文本/边框须同步主题，否则浅色下不可见） */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

const MINI_W = 100
const MINI_H = 80
const FLOOR_H = 36
const EXPANDED_W = 280
const NODE_R = 6

const ROUTE_COLORS: Record<string, string> = {
  '门': '#3fb950', '走廊': '#58a6ff', '地道': '#8b949e',
  '桥': '#d29922', '传送门': '#d2a8ff', '密道': '#f0883e',
}

interface BuildingTreeEdge extends TreeEdgeBase {
  routeType: string
}

function getShape(buildingType: string): 'tower' | 'dungeon' | 'normal' {
  if (/塔楼|堡垒/.test(buildingType)) return 'tower'
  if (/地牢|监狱/.test(buildingType)) return 'dungeon'
  return 'normal'
}

function drawTowerOutline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const taper = w * 0.15
  ctx.moveTo(x + taper, y + h)
  ctx.lineTo(x, y + h * 0.3)
  ctx.lineTo(x + w * 0.3, y)
  ctx.lineTo(x + w * 0.7, y)
  ctx.lineTo(x + w, y + h * 0.3)
  ctx.lineTo(x + w - taper, y + h)
  ctx.closePath()
}

function drawDungeonOutline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const underground = h * 0.4
  ctx.moveTo(x + 4, y)
  ctx.lineTo(x + w - 4, y)
  ctx.lineTo(x + w, y + h - underground)
  ctx.lineTo(x + w + 10, y + h)
  ctx.lineTo(x - 10, y + h)
  ctx.lineTo(x, y + h - underground)
  ctx.closePath()
}

function drawBuildingNode(
  ctx: CanvasRenderingContext2D,
  node: BuildingNode,
  state: NodeState,
  _nodeWidth: number,
  _nodeHeight: number,
): void {
  if (state.isSelected) {
    drawExpandedBuilding(ctx, node, state.isHovered)
  } else {
    drawMiniBuilding(ctx, node, state.isSelected, state.isHovered)
  }
}

function drawMiniBuilding(
  ctx: CanvasRenderingContext2D,
  node: BuildingNode,
  isSelected: boolean,
  isHovered: boolean,
): void {
  const x = node.x - MINI_W / 2
  const y = node.y - MINI_H / 2

  ctx.save()
  const text = cssVar('--color-text-primary', '#e6edf3')

  if (isSelected) {
    ctx.shadowColor = node.color
    ctx.shadowBlur = 10
  }

  const shape = getShape(node.buildingType)
  ctx.beginPath()
  if (shape === 'tower') {
    drawTowerOutline(ctx, x, y, MINI_W, MINI_H)
  } else if (shape === 'dungeon') {
    drawDungeonOutline(ctx, x, y, MINI_W, MINI_H)
  } else {
    roundRect(ctx, x, y, MINI_W, MINI_H, NODE_R)
  }
  ctx.fillStyle = hexToRgba(node.color, isSelected ? 0.2 : isHovered ? 0.12 : 0.06)
  ctx.fill()
  ctx.strokeStyle = isSelected ? node.color : isHovered ? text : hexToRgba(node.color, 0.4)
  ctx.lineWidth = isSelected ? 2 : 1
  ctx.stroke()

  ctx.shadowBlur = 0

  ctx.font = '18px sans-serif'
  ctx.fillStyle = text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(node.icon, node.x, node.y - 10)

  ctx.font = '10px sans-serif'
  ctx.fillStyle = text
  const nameText = node.name.length > 6 ? node.name.slice(0, 6) + '…' : node.name
  ctx.fillText(nameText, node.x, node.y + 8)

  ctx.font = '8px sans-serif'
  ctx.fillStyle = hexToRgba(node.color, 0.7)
  ctx.fillText(`${node.floors}层`, node.x, node.y + 22)

  ctx.restore()
}

function drawExpandedBuilding(
  ctx: CanvasRenderingContext2D,
  node: BuildingNode,
  _isHovered: boolean,
): void {
  const floors = parseFloors(node.interior, node.floors)
  const totalH = Math.max(floors.length * FLOOR_H + 40, 120)
  const x = node.x - EXPANDED_W / 2
  const y = node.y - totalH / 2

  ctx.save()
  const muted = cssVar('--color-text-secondary', '#c9d1d9')
  const tertiary = cssVar('--color-text-tertiary', '#8b949e')

  ctx.shadowColor = node.color
  ctx.shadowBlur = 16

  const shape = getShape(node.buildingType)
  ctx.beginPath()
  if (shape === 'tower') {
    drawTowerOutline(ctx, x, y, EXPANDED_W, totalH)
  } else if (shape === 'dungeon') {
    drawDungeonOutline(ctx, x, y, EXPANDED_W, totalH)
  } else {
    roundRect(ctx, x, y, EXPANDED_W, totalH, 8)
  }
  ctx.fillStyle = hexToRgba(node.color, 0.08)
  ctx.fill()
  ctx.strokeStyle = node.color
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.shadowBlur = 0

  ctx.font = 'bold 12px sans-serif'
  ctx.fillStyle = node.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(`${node.icon} ${node.name}`, node.x, y + 6)

  const roofH = 28
  for (let i = 0; i < floors.length; i++) {
    const fy = y + roofH + i * FLOOR_H
    const floor = floors[i]

    if (i > 0) {
      ctx.beginPath()
      ctx.moveTo(x + 8, fy)
      ctx.lineTo(x + EXPANDED_W - 8, fy)
      ctx.strokeStyle = hexToRgba(node.color, 0.2)
      ctx.lineWidth = 0.5
      ctx.stroke()
    }

    ctx.font = '9px sans-serif'
    ctx.fillStyle = hexToRgba(node.color, 0.8)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(floor.label, x + 10, fy + FLOOR_H / 2)

    if (floor.content) {
      ctx.font = '10px sans-serif'
      ctx.fillStyle = muted
      const contentText = floor.content.length > 20 ? floor.content.slice(0, 20) + '…' : floor.content
      ctx.fillText(contentText, x + 40, fy + FLOOR_H / 2)
    }
  }

  ctx.font = '9px sans-serif'
  ctx.fillStyle = tertiary
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  const infoParts = [node.style, node.material, node.status].filter(Boolean)
  if (infoParts.length > 0) {
    ctx.fillText(infoParts.join(' · '), x + EXPANDED_W - 8, y + totalH - 4)
  }

  ctx.restore()
}

function drawBuildingEdge(
  ctx: CanvasRenderingContext2D,
  edge: BuildingTreeEdge,
  source: BuildingNode | undefined,
  target: BuildingNode | undefined,
): void {
  if (!source || !target) return

  const color = ROUTE_COLORS[edge.routeType] || '#8b949e'

  ctx.save()
  ctx.beginPath()
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = color
  ctx.lineWidth = 1

  ctx.moveTo(source.x, source.y)
  ctx.lineTo(target.x, target.y)
  ctx.stroke()

  const midX = (source.x + target.x) / 2
  const midY = (source.y + target.y) / 2
  ctx.font = '9px sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(edge.routeType, midX, midY - 4)

  ctx.restore()
}

export function useBuildingSectionCanvas(containerRef: Ref<HTMLElement | null>) {
  const _hitCtx = { selectedId: null as string | null }

  const treeCanvas = useTreeCanvas<BuildingNode, BuildingTreeEdge>({
    containerRef,
    drawNode: drawBuildingNode,
    drawEdge: drawBuildingEdge,
    hitTest: (worldX, worldY, nodes) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]
        let hw: number, hh: number
        if (n.id === _hitCtx.selectedId) {
          const floors = parseFloors(n.interior, n.floors)
          hh = Math.max(floors.length * FLOOR_H + 40, 120) / 2
          hw = EXPANDED_W / 2
        } else {
          hw = MINI_W / 2
          hh = MINI_H / 2
        }
        if (worldX >= n.x - hw && worldX <= n.x + hw && worldY >= n.y - hh && worldY <= n.y + hh) {
          return n
        }
      }
      return null
    },
    nodeWidth: MINI_W,
    nodeHeight: MINI_H,
  })

  function setSelectedId(id: string | null): void {
    _hitCtx.selectedId = id
    treeCanvas.selectedId.value = id
    treeCanvas.markDirty()
  }

  function setData(nodes: BuildingNode[], connections: ConnectionEdge[]): void {
    const edges: BuildingTreeEdge[] = connections.map(c => ({
      id: `${c.sourceId}-${c.targetId}`,
      sourceId: c.sourceId,
      targetId: c.targetId,
      routeType: c.routeType,
      dashed: true,
      label: c.routeType,
    }))
    treeCanvas.setData(nodes, edges)
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
  }
}
