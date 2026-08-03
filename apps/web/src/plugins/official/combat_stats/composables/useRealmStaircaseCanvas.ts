import type { Ref } from 'vue'
import {
  useTreeCanvas,
  roundRect,
  hexToRgba,
  type TreeEdgeBase,
  type NodeState,
} from '@worldsmith/canvas-engine/tree'
import type { RealmStep } from './useRealmStaircaseData'
import { getRadarValues, RADAR_DIMS } from './useRealmStaircaseData'

const STEP_W = 200
const STEP_H = 48
const STEP_GAP = 8
const STEP_OFFSET = 30

interface StairNode {
  id: string
  name: string
  x: number
  y: number
  color: string
  icon: string
  system: string
  tier: number
  realm: string
  culture: string
  promotion: string
  bottleneck: string
  power: string
  stepWidth: number
}

function toStairNodes(steps: RealmStep[]): StairNode[] {
  return steps.map((step, i) => {
    const isTop = i === steps.length - 1
    const sw = STEP_W + (isTop ? STEP_OFFSET : 0)
    return {
      id: step.id,
      name: step.name,
      color: step.color,
      icon: step.icon,
      system: step.system,
      tier: step.tier,
      realm: step.realm,
      culture: step.culture,
      promotion: step.promotion,
      bottleneck: step.bottleneck,
      power: step.power,
      stepWidth: sw,
      x: i * STEP_OFFSET + sw / 2,
      y: i * (STEP_H + STEP_GAP) + STEP_H / 2,
    }
  })
}

function drawStairNode(
  ctx: CanvasRenderingContext2D,
  node: StairNode,
  state: NodeState,
  _nodeWidth: number,
  _nodeHeight: number,
): void {
  const x = node.x - node.stepWidth / 2
  const y = node.y - STEP_H / 2

  ctx.save()

  if (state.isSelected) {
    ctx.shadowColor = node.color
    ctx.shadowBlur = 12
  }

  ctx.beginPath()
  roundRect(ctx, x, y, node.stepWidth, STEP_H, 6)
  ctx.fillStyle = state.isSelected
    ? hexToRgba(node.color, 0.25)
    : state.isHovered
      ? hexToRgba(node.color, 0.15)
      : hexToRgba(node.color, 0.08)
  ctx.fill()
  ctx.strokeStyle = state.isSelected ? node.color : state.isHovered ? '#e6edf3' : hexToRgba(node.color, 0.3)
  ctx.lineWidth = state.isSelected ? 2 : 1
  ctx.stroke()

  ctx.shadowBlur = 0

  ctx.font = '16px sans-serif'
  ctx.fillStyle = '#e6edf3'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(node.icon, x + 10, y + STEP_H / 2)

  ctx.font = '13px sans-serif'
  ctx.fillStyle = '#e6edf3'
  const nameText = node.name.length > 8 ? node.name.slice(0, 8) + '…' : node.name
  ctx.fillText(nameText, x + 32, y + STEP_H / 2 - 7)

  ctx.font = '10px sans-serif'
  ctx.fillStyle = '#8b949e'
  const realmText = node.realm || node.system
  ctx.fillText(realmText, x + 32, y + STEP_H / 2 + 9)

  if (node.tier > 0) {
    ctx.font = '9px sans-serif'
    ctx.fillStyle = hexToRgba(node.color, 0.7)
    ctx.textAlign = 'right'
    ctx.fillText(`T${node.tier}`, x + node.stepWidth - 10, y + STEP_H / 2)
  }

  ctx.restore()
}

function drawRadarChart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  node: StairNode,
): void {
  const values = getRadarValues({
    id: node.id, name: node.name, system: node.system, tier: node.tier,
    realm: node.realm, culture: node.culture, promotion: node.promotion,
    bottleneck: node.bottleneck, power: node.power, color: node.color, icon: node.icon,
  })
  const n = RADAR_DIMS.length
  const angleStep = (Math.PI * 2) / n

  ctx.save()

  ctx.beginPath()
  ctx.arc(cx, cy, r + 30, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(22,27,34,0.9)'
  ctx.fill()
  ctx.strokeStyle = '#21262d'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.font = 'bold 12px sans-serif'
  ctx.fillStyle = node.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(node.name, cx, cy - r - 14)

  for (let ring = 1; ring <= 5; ring++) {
    const ringR = (r * ring) / 5
    ctx.beginPath()
    for (let i = 0; i <= n; i++) {
      const angle = i * angleStep - Math.PI / 2
      const px = cx + Math.cos(angle) * ringR
      const py = cy + Math.sin(angle) * ringR
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.strokeStyle = hexToRgba('#30363d', 0.5)
    ctx.lineWidth = 0.5
    ctx.stroke()
  }

  for (let i = 0; i < n; i++) {
    const angle = i * angleStep - Math.PI / 2
    const px = cx + Math.cos(angle) * r
    const py = cy + Math.sin(angle) * r
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(px, py)
    ctx.strokeStyle = '#21262d'
    ctx.lineWidth = 0.5
    ctx.stroke()

    const labelR = r + 16
    const lx = cx + Math.cos(angle) * labelR
    const ly = cy + Math.sin(angle) * labelR
    ctx.font = '10px sans-serif'
    ctx.fillStyle = '#8b949e'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(RADAR_DIMS[i].label, lx, ly)
  }

  ctx.beginPath()
  for (let i = 0; i <= n; i++) {
    const idx = i % n
    const angle = idx * angleStep - Math.PI / 2
    const val = values[idx] / 10
    const px = cx + Math.cos(angle) * r * val
    const py = cy + Math.sin(angle) * r * val
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = hexToRgba(node.color, 0.2)
  ctx.fill()
  ctx.strokeStyle = node.color
  ctx.lineWidth = 2
  ctx.stroke()

  for (let i = 0; i < n; i++) {
    const angle = i * angleStep - Math.PI / 2
    const val = values[i] / 10
    const px = cx + Math.cos(angle) * r * val
    const py = cy + Math.sin(angle) * r * val
    ctx.beginPath()
    ctx.arc(px, py, 3, 0, Math.PI * 2)
    ctx.fillStyle = node.color
    ctx.fill()
  }

  ctx.restore()
}

export function useRealmStaircaseCanvas(containerRef: Ref<HTMLElement | null>) {
  let _nodes: StairNode[] = []

  const treeCanvas = useTreeCanvas<StairNode, TreeEdgeBase>({
    containerRef,
    drawNode: drawStairNode,
    hitTest: (worldX, worldY, nodes) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]
        const x = n.x - n.stepWidth / 2
        const y = n.y - STEP_H / 2
        if (worldX >= x && worldX <= x + n.stepWidth && worldY >= y && worldY <= y + STEP_H) {
          return n
        }
      }
      return null
    },
    nodeWidth: STEP_W + STEP_OFFSET,
    nodeHeight: STEP_H,
    onBeforeDraw: (ctx, w, h) => {
      if (_nodes.length === 0) {
        ctx.save()
        const dpr = window.devicePixelRatio || 1
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.font = '14px sans-serif'
        ctx.fillStyle = '#8b949e'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('暂无战力数据', w / 2, h / 2)
        ctx.restore()
      }
    },
    onAfterDraw: (ctx, w, h) => {
      const selId = treeCanvas.selectedId.value
      if (!selId) return
      const selNode = _nodes.find(n => n.id === selId)
      if (!selNode) return
      ctx.save()
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawRadarChart(ctx, w - 240, h / 2, 100, selNode)
      ctx.restore()
    },
  })

  function setSelectedId(id: string | null): void {
    treeCanvas.selectedId.value = id
    treeCanvas.markDirty()
  }

  function setData(steps: RealmStep[], filterSystem: string): void {
    const filtered = filterSystem
      ? steps.filter(s => s.system === filterSystem)
      : steps
    _nodes = toStairNodes(filtered)
    treeCanvas.setData(_nodes, [])
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
