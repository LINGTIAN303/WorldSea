// 高亮 / 网格 / 坐标标注 / awareness 绘制：由 boardDraw.ts 拆出（2026-08-06），详见 docs/details/注释/README.md
import type { BoardRenderData } from './boardDraw'
import { HIGHLIGHT_BORDERS, HIGHLIGHT_COLORS, INFLUENCE_BORDERS, INFLUENCE_COLORS } from './boardColors'
import { COORD_MARGIN, cellCenter, hexCellCenter } from './boardCoordinates'
import { drawHexPath, drawTerrainHex, drawTerrainSquare } from './boardTerrain'

export interface HighlightCell {
  x: number
  y: number
  type: 'move' | 'attack' | 'skill'
}

export interface AwarenessCell {
  x: number
  y: number
  controlling_team: string | null
  threat_level: number
  is_supply_line: boolean
  is_isolated: boolean
}

// ── Grid rendering ──
export function drawSquareGrid(
  ctx: CanvasRenderingContext2D,
  data: BoardRenderData,
  cellSize: number,
): void {
  for (let r = 0; r < data.height; r++) {
    for (let c = 0; c < data.width; c++) {
      const t = data.terrain[r]?.[c] || 'plain'
      drawTerrainSquare(ctx, c, r, t, cellSize)
    }
  }

  // Grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.20)'
  ctx.lineWidth = 0.5
  for (let r = 0; r <= data.height; r++) {
    ctx.beginPath()
    ctx.moveTo(0, r * cellSize)
    ctx.lineTo(data.width * cellSize, r * cellSize)
    ctx.stroke()
  }
  for (let c = 0; c <= data.width; c++) {
    ctx.beginPath()
    ctx.moveTo(c * cellSize, 0)
    ctx.lineTo(c * cellSize, data.height * cellSize)
    ctx.stroke()
  }

  // Subtle inner shadow on each cell
  if (cellSize > 30) {
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'
    ctx.lineWidth = 1
    for (let r = 0; r <= data.height; r++) {
      ctx.beginPath()
      ctx.moveTo(0, r * cellSize + 1)
      ctx.lineTo(data.width * cellSize, r * cellSize + 1)
      ctx.stroke()
    }
  }
}

export function drawHexGrid(
  ctx: CanvasRenderingContext2D,
  data: BoardRenderData,
  hexSize: number,
): void {
  for (let r = 0; r < data.height; r++) {
    for (let c = 0; c < data.width; c++) {
      const t = data.terrain[r]?.[c] || 'plain'
      drawTerrainHex(ctx, c, r, t, hexSize)
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.20)'
  ctx.lineWidth = 0.8
  for (let r = 0; r < data.height; r++) {
    for (let c = 0; c < data.width; c++) {
      const [cx, cy] = hexCellCenter(c, r, hexSize)
      drawHexPath(ctx, cx, cy, hexSize)
      ctx.stroke()
    }
  }
}

// ── Highlights ──
export function drawHighlights(
  ctx: CanvasRenderingContext2D,
  data: BoardRenderData,
  cellSize: number,
): void {
  const byCell = new Map<string, HighlightCell['type']>()
  for (const h of data.highlights) {
    const key = `${h.x},${h.y}`
    if (!byCell.has(key)) byCell.set(key, h.type)
  }

  for (const [key, hType] of byCell) {
    const [cx, cy] = key.split(',').map(Number)
    const [px, py] = cellCenter(cx, cy, data.gridType, cellSize)

    if (data.gridType === 'hex') {
      drawHexPath(ctx, px, py, cellSize * 0.95)
    } else {
      const x = cx * cellSize + 1
      const y = cy * cellSize + 1
      ctx.beginPath()
      ctx.rect(x, y, cellSize - 2, cellSize - 2)
    }
    ctx.fillStyle = HIGHLIGHT_COLORS[hType]
    ctx.fill()
    ctx.strokeStyle = HIGHLIGHT_BORDERS[hType]
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
}

// ── Selection & Hover ──
export function drawSelection(
  ctx: CanvasRenderingContext2D,
  cell: { x: number; y: number },
  gridType: 'square' | 'hex',
  cellSize: number,
): void {
  const [px, py] = cellCenter(cell.x, cell.y, gridType, cellSize)

  // Outer glow
  ctx.save()
  ctx.shadowColor = 'rgba(74, 158, 255, 0.6)'
  ctx.shadowBlur = 8

  if (gridType === 'hex') {
    drawHexPath(ctx, px, py, cellSize * 0.97)
  } else {
    const x = cell.x * cellSize + 1.5
    const y = cell.y * cellSize + 1.5
    ctx.beginPath()
    ctx.rect(x, y, cellSize - 3, cellSize - 3)
  }
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.restore()

  // Inner accent
  if (gridType === 'hex') {
    drawHexPath(ctx, px, py, cellSize * 0.90)
  } else {
    const x = cell.x * cellSize + 3
    const y = cell.y * cellSize + 3
    ctx.beginPath()
    ctx.rect(x, y, cellSize - 6, cellSize - 6)
  }
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.85)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Corner accents for square
  if (gridType === 'square' && cellSize > 30) {
    const x = cell.x * cellSize
    const y = cell.y * cellSize
    const cs = cellSize
    const len = cs * 0.15
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.9)'
    ctx.lineWidth = 2.5
    // Top-left
    ctx.beginPath(); ctx.moveTo(x + 2, y + len + 2); ctx.lineTo(x + 2, y + 2); ctx.lineTo(x + len + 2, y + 2); ctx.stroke()
    // Top-right
    ctx.beginPath(); ctx.moveTo(x + cs - len - 2, y + 2); ctx.lineTo(x + cs - 2, y + 2); ctx.lineTo(x + cs - 2, y + len + 2); ctx.stroke()
    // Bottom-left
    ctx.beginPath(); ctx.moveTo(x + 2, y + cs - len - 2); ctx.lineTo(x + 2, y + cs - 2); ctx.lineTo(x + len + 2, y + cs - 2); ctx.stroke()
    // Bottom-right
    ctx.beginPath(); ctx.moveTo(x + cs - len - 2, y + cs - 2); ctx.lineTo(x + cs - 2, y + cs - 2); ctx.lineTo(x + cs - 2, y + cs - len - 2); ctx.stroke()
  }
}

export function drawHover(
  ctx: CanvasRenderingContext2D,
  cell: { x: number; y: number },
  gridType: 'square' | 'hex',
  cellSize: number,
): void {
  const [px, py] = cellCenter(cell.x, cell.y, gridType, cellSize)

  if (gridType === 'hex') {
    drawHexPath(ctx, px, py, cellSize * 0.97)
  } else {
    const x = cell.x * cellSize + 1
    const y = cell.y * cellSize + 1
    ctx.beginPath()
    ctx.rect(x, y, cellSize - 2, cellSize - 2)
  }

  // Subtle fill
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fill()

  // Glowing border
  ctx.save()
  ctx.shadowColor = 'rgba(255,255,255,0.15)'
  ctx.shadowBlur = 4
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

// ── Awareness overlays ──
export function drawAwareness(
  ctx: CanvasRenderingContext2D,
  data: BoardRenderData,
  cellSize: number,
): void {
  for (const cell of data.awarenessCells) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= data.width || cell.y >= data.height) continue

    const [px, py] = cellCenter(cell.x, cell.y, data.gridType, cellSize)

    if (data.awarenessMode === 'influence') {
      if (!cell.controlling_team) continue
      const color = INFLUENCE_COLORS[cell.controlling_team] || INFLUENCE_COLORS.neutral
      const border = INFLUENCE_BORDERS[cell.controlling_team] || INFLUENCE_BORDERS.neutral

      if (data.gridType === 'hex') {
        drawHexPath(ctx, px, py, cellSize * 0.95)
      } else {
        drawSquareCellPath(ctx, cell.x, cell.y, cellSize)
      }
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = border
      ctx.lineWidth = 1
      ctx.stroke()
    }

    if (data.awarenessMode === 'threat') {
      if (cell.threat_level <= 0) continue
      const alpha = Math.min(0.5, cell.threat_level)

      if (data.gridType === 'hex') {
        drawHexPath(ctx, px, py, cellSize * 0.95)
      } else {
        drawSquareCellPath(ctx, cell.x, cell.y, cellSize)
      }
      ctx.fillStyle = `rgba(255, 74, 74, ${alpha * 0.4})`
      ctx.fill()
      ctx.strokeStyle = `rgba(255, 74, 74, ${alpha * 0.7})`
      ctx.lineWidth = 1
      ctx.stroke()

      if (cellSize > 24) {
        ctx.fillStyle = `rgba(255, 200, 200, ${Math.min(0.8, alpha + 0.2)})`
        ctx.font = `bold ${Math.max(8, cellSize * 0.2)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(cell.threat_level.toFixed(1), px, py)
      }
    }

    if (data.awarenessMode === 'supply') {
      if (!cell.is_supply_line && !cell.is_isolated) continue

      if (data.gridType === 'hex') {
        drawHexPath(ctx, px, py, cellSize * 0.95)
      } else {
        drawSquareCellPath(ctx, cell.x, cell.y, cellSize)
      }

      if (cell.is_supply_line) {
        ctx.fillStyle = 'rgba(63, 185, 80, 0.15)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(63, 185, 80, 0.40)'
        ctx.lineWidth = 1.5
        ctx.stroke()

        if (cellSize > 22) {
          ctx.fillStyle = 'rgba(63, 185, 80, 0.6)'
          ctx.font = `${Math.max(8, cellSize * 0.22)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('\u2194', px, py)
        }
      }

      if (cell.is_isolated) {
        ctx.fillStyle = 'rgba(210, 153, 34, 0.15)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(210, 153, 34, 0.40)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([3, 3])
        ctx.stroke()
        ctx.setLineDash([])

        if (cellSize > 22) {
          ctx.fillStyle = 'rgba(210, 153, 34, 0.6)'
          ctx.font = `${Math.max(8, cellSize * 0.22)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('\u26a0', px, py)
        }
      }
    }
  }
}

function drawSquareCellPath(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  cellSize: number,
): void {
  const x = col * cellSize
  const y = row * cellSize
  ctx.beginPath()
  ctx.rect(x, y, cellSize, cellSize)
}

// ── Coordinate labels ──
export function drawCoordinateLabels(
  ctx: CanvasRenderingContext2D,
  data: BoardRenderData,
  cellSize: number,
  bh: number,
): void {
  const fontSize = Math.max(9, Math.min(12, cellSize * 0.22))
  ctx.font = `${fontSize}px 'Segoe UI', sans-serif`
  ctx.textBaseline = 'middle'

  // Column labels (A, B, C, ...)
  ctx.textAlign = 'center'
  for (let c = 0; c < data.width; c++) {
    const label = String.fromCharCode(65 + c)
    const [px] = cellCenter(c, 0, data.gridType, cellSize)

    // Top
    ctx.fillStyle = 'rgba(180,190,200,0.5)'
    ctx.fillText(label, px, -COORD_MARGIN / 2 + 2)
    // Bottom
    ctx.fillText(label, px, bh + COORD_MARGIN / 2)
  }

  // Row labels (1, 2, 3, ...)
  ctx.textAlign = 'right'
  for (let r = 0; r < data.height; r++) {
    const label = String(r + 1)
    const [, py] = cellCenter(0, r, data.gridType, cellSize)

    // Left
    ctx.fillStyle = 'rgba(180,190,200,0.5)'
    ctx.fillText(label, -6, py)
    // Right
    ctx.textAlign = 'left'
    const [rightX] = cellCenter(data.width - 1, r, data.gridType, cellSize)
    const cellHalf = data.gridType === 'hex' ? cellSize * Math.sqrt(3) / 2 : cellSize / 2
    ctx.fillText(label, rightX + cellHalf + 6, py)
    ctx.textAlign = 'right'
  }
}

// ── Board frame ──
export function drawBoardFrame(
  ctx: CanvasRenderingContext2D,
  bw: number,
  bh: number,
  cellSize: number,
): void {
  const pad = 4

  // Outer shadow
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 6
  ctx.fillStyle = '#151a24'
  roundRect(ctx, -pad, -pad, bw + pad * 2, bh + pad * 2, 4)
  ctx.fill()
  ctx.restore()

  // Inner border with gradient
  const borderGrad = ctx.createLinearGradient(0, 0, 0, bh)
  borderGrad.addColorStop(0, 'rgba(120,140,160,0.35)')
  borderGrad.addColorStop(0.5, 'rgba(80,100,120,0.25)')
  borderGrad.addColorStop(1, 'rgba(60,80,100,0.35)')
  ctx.strokeStyle = borderGrad
  ctx.lineWidth = 2
  roundRect(ctx, -pad, -pad, bw + pad * 2, bh + pad * 2, 4)
  ctx.stroke()

  // Inner glow line
  ctx.strokeStyle = 'rgba(100,130,160,0.12)'
  ctx.lineWidth = 1
  roundRect(ctx, -1, -1, bw + 2, bh + 2, 2)
  ctx.stroke()

  // Corner accents
  const cornerLen = Math.min(20, cellSize * 0.4)
  ctx.strokeStyle = 'rgba(140,170,200,0.3)'
  ctx.lineWidth = 2.5

  // Top-left
  ctx.beginPath(); ctx.moveTo(-pad, cornerLen - pad); ctx.lineTo(-pad, -pad); ctx.lineTo(cornerLen - pad, -pad); ctx.stroke()
  // Top-right
  ctx.beginPath(); ctx.moveTo(bw + pad - cornerLen, -pad); ctx.lineTo(bw + pad, -pad); ctx.lineTo(bw + pad, cornerLen - pad); ctx.stroke()
  // Bottom-left
  ctx.beginPath(); ctx.moveTo(-pad, bh + pad - cornerLen); ctx.lineTo(-pad, bh + pad); ctx.lineTo(cornerLen - pad, bh + pad); ctx.stroke()
  // Bottom-right
  ctx.beginPath(); ctx.moveTo(bw + pad - cornerLen, bh + pad); ctx.lineTo(bw + pad, bh + pad); ctx.lineTo(bw + pad, bh + pad - cornerLen); ctx.stroke()
}

// ── Utility helpers ──
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
