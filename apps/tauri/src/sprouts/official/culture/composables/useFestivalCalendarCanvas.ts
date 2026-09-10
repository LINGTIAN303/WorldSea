import type { Ref } from 'vue'
import {
  useTreeCanvas,
  hexToRgba,
  type TreeEdgeBase,
  type NodeState,
} from '@worldsea/canvas-engine/tree'
import type { FestivalNode } from './useFestivalCalendarData'
import { monthToAngle } from './useFestivalCalendarData'

/** 从 CSS 变量读取主题色（canvas 背景由引擎按 --color-bg-base 主题化，文本/边框须同步主题，否则浅色下不可见） */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

const BASE_R = 200
const MARKER_R = 6

const MONTH_NAMES = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月',
]

const SEASON_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  '春': { fill: 'rgba(63,185,80,0.08)', stroke: 'rgba(63,185,80,0.3)', label: '春' },
  '夏': { fill: 'rgba(240,136,62,0.08)', stroke: 'rgba(240,136,62,0.3)', label: '夏' },
  '秋': { fill: 'rgba(210,153,34,0.08)', stroke: 'rgba(210,153,34,0.3)', label: '秋' },
  '冬': { fill: 'rgba(88,166,255,0.08)', stroke: 'rgba(88,166,255,0.3)', label: '冬' },
}

interface CalNode {
  id: string
  name: string
  x: number
  y: number
  color: string
  icon: string
  cultureType: string
  cycle: string
  season: string
  significance: string
  practices: string
  participants: string
  origin: string
}

function toCalNode(n: FestivalNode, x: number, y: number): CalNode {
  return {
    id: n.id, name: n.name, x, y,
    color: n.color, icon: n.icon,
    cultureType: n.cultureType, cycle: n.cycle, season: n.season,
    significance: n.significance, practices: n.practices,
    participants: n.participants, origin: n.origin,
  }
}

function computeTimedNodes(nodes: FestivalNode[], filterType: string): CalNode[] {
  const filtered = filterType
    ? nodes.filter(n => n.cultureType === filterType)
    : nodes

  const monthBuckets = new Map<number, FestivalNode[]>()
  for (let i = 0; i < 12; i++) monthBuckets.set(i, [])
  for (const n of filtered) {
    const m = Math.round(((n.angle + Math.PI / 2) / (Math.PI * 2)) * 12) % 12
    monthBuckets.get(m)?.push(n)
  }

  const result: CalNode[] = []
  for (let m = 0; m < 12; m++) {
    const bucket = monthBuckets.get(m) || []
    const angle = monthToAngle(m)
    for (let i = 0; i < bucket.length; i++) {
      const offset = (i - (bucket.length - 1) / 2) * 22
      const markerR = BASE_R - 50 - offset
      result.push(toCalNode(bucket[i], Math.cos(angle) * markerR, Math.sin(angle) * markerR))
    }
  }
  return result
}

function computeUntimedNodes(nodes: FestivalNode[], filterType: string): CalNode[] {
  const filtered = filterType
    ? nodes.filter(n => n.cultureType === filterType)
    : nodes
  const startY = -filtered.length * 12
  return filtered.map((n, i) =>
    toCalNode(n, (i % 2 === 0 ? -1 : 1) * 40, startY + i * 22)
  )
}

function drawSeasonArcs(ctx: CanvasRenderingContext2D): void {
  const seasonRanges: [string, number, number][] = [
    ['春', 2, 5], ['夏', 5, 8], ['秋', 8, 11], ['冬', 11, 14],
  ]

  for (const [season, startM, endM] of seasonRanges) {
    const sc = SEASON_COLORS[season]
    const startAngle = monthToAngle(startM)
    const endAngle = monthToAngle(endM)

    ctx.beginPath()
    ctx.arc(0, 0, BASE_R + 8, startAngle, endAngle)
    ctx.arc(0, 0, BASE_R - 36, endAngle, startAngle, true)
    ctx.closePath()
    ctx.fillStyle = sc.fill
    ctx.fill()
    ctx.strokeStyle = sc.stroke
    ctx.lineWidth = 1
    ctx.stroke()

    const midAngle = (startAngle + endAngle) / 2
    const labelR = BASE_R - 14
    ctx.font = 'bold 14px sans-serif'
    ctx.fillStyle = sc.stroke
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(sc.label, Math.cos(midAngle) * labelR, Math.sin(midAngle) * labelR)
  }
}

function drawMonthTicks(ctx: CanvasRenderingContext2D): void {
  for (let i = 0; i < 12; i++) {
    const angle = monthToAngle(i)
    const x1 = Math.cos(angle) * (BASE_R + 8)
    const y1 = Math.sin(angle) * (BASE_R + 8)
    const x2 = Math.cos(angle) * (BASE_R + 16)
    const y2 = Math.sin(angle) * (BASE_R + 16)

    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = cssVar('--color-border-strong', '#30363d')
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

function drawMonthLabels(ctx: CanvasRenderingContext2D): void {
  ctx.font = '11px sans-serif'
  ctx.fillStyle = cssVar('--color-text-tertiary', '#8b949e')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let i = 0; i < 12; i++) {
    const angle = monthToAngle(i)
    const x = Math.cos(angle) * (BASE_R + 28)
    const y = Math.sin(angle) * (BASE_R + 28)
    ctx.fillText(MONTH_NAMES[i], x, y)
  }
}

function drawCalMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  node: CalNode,
  state: NodeState,
): void {
  const r = state.isSelected ? MARKER_R + 2 : state.isHovered ? MARKER_R + 1 : MARKER_R

  ctx.save()
  const text = cssVar('--color-text-primary', '#e6edf3')

  if (state.isSelected) {
    ctx.shadowColor = node.color
    ctx.shadowBlur = 12
  }

  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = hexToRgba(node.color, state.isSelected ? 0.9 : state.isHovered ? 0.7 : 0.5)
  ctx.fill()
  ctx.strokeStyle = state.isSelected ? text : node.color
  ctx.lineWidth = state.isSelected ? 2 : 1
  ctx.stroke()

  ctx.shadowBlur = 0

  ctx.font = '12px sans-serif'
  ctx.fillStyle = text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(node.icon, x, y - MARKER_R - 2)

  if (state.isSelected || state.isHovered) {
    ctx.font = '10px sans-serif'
    ctx.fillStyle = text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const nameText = node.name.length > 6 ? node.name.slice(0, 6) + '…' : node.name
    ctx.fillText(nameText, x, y + MARKER_R + 3)
  }

  ctx.restore()
}

function drawCalNode(
  ctx: CanvasRenderingContext2D,
  node: CalNode,
  state: NodeState,
  _nodeWidth: number,
  _nodeHeight: number,
): void {
  drawCalMarker(ctx, node.x, node.y, node, state)
}

export function useFestivalCalendarCanvas(containerRef: Ref<HTMLElement | null>) {
  let _untimedNodes: CalNode[] = []
  let _showUntimed = true

  const treeCanvas = useTreeCanvas<CalNode, TreeEdgeBase>({
    containerRef,
    drawNode: drawCalNode,
    hitTest: (worldX, worldY, nodes) => {
      const hitR = MARKER_R + 4
      const hitR2 = hitR * hitR
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]
        const dx = worldX - n.x
        const dy = worldY - n.y
        if (dx * dx + dy * dy <= hitR2) return n
      }
      if (_showUntimed) {
        for (let i = _untimedNodes.length - 1; i >= 0; i--) {
          const n = _untimedNodes[i]
          const dx = worldX - n.x
          const dy = worldY - n.y
          if (dx * dx + dy * dy <= hitR2) return n
        }
      }
      return null
    },
    nodeWidth: MARKER_R * 2 + 8,
    nodeHeight: MARKER_R * 2 + 8,
    onBeforeDraw: (ctx) => {
      drawSeasonArcs(ctx)
      drawMonthTicks(ctx)
      drawMonthLabels(ctx)
    },
    onAfterDraw: (ctx) => {
      if (!_showUntimed || _untimedNodes.length === 0) return

      const startY = -_untimedNodes.length * 12
      ctx.font = '9px sans-serif'
      ctx.fillStyle = cssVar('--color-text-tertiary', '#8b949e')
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('— 无固定时间 —', 0, startY - 14)

      const selId = treeCanvas.selectedId.value
      const hovId = treeCanvas.hoveredId.value
      for (const n of _untimedNodes) {
        drawCalMarker(ctx, n.x, n.y, n, {
          isSelected: n.id === selId,
          isHovered: n.id === hovId,
        })
      }
    },
  })

  function setSelectedId(id: string | null): void {
    treeCanvas.selectedId.value = id
    treeCanvas.markDirty()
  }

  function setShowUntimed(v: boolean): void {
    _showUntimed = v
    treeCanvas.markDirty()
  }

  function setData(
    timedNodes: FestivalNode[],
    untimedNodes: FestivalNode[],
    filterType: string,
    showUntimed: boolean,
  ): void {
    _showUntimed = showUntimed
    _untimedNodes = computeUntimedNodes(untimedNodes, filterType)
    const timedCalNodes = computeTimedNodes(timedNodes, filterType)
    treeCanvas.setData(timedCalNodes, [])
  }

  function fitCalendarView(): void {
    if (!containerRef.value) return
    const rect = containerRef.value.getBoundingClientRect()
    const contentR = BASE_R + 50
    const k = Math.min(rect.width, rect.height) / (contentR * 2 + 40)
    treeCanvas.setCamera({ x: 0, y: 0, k: Math.max(0.2, Math.min(2, k)) })
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
    fitCalendarView,
    setCallbacks: treeCanvas.setCallbacks,
    setSelectedId,
    setShowUntimed,
    setData,
  }
}
