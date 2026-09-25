// 地形装饰绘制：由 boardDraw.ts 拆出（2026-08-06），详见 docs/details/注释/README.md
import { TERRAIN_COLORS } from './boardColors'
import { hexCellCenter, seededRandom } from './boardCoordinates'

// ── Hex path helper ──
export function drawHexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    const px = cx + size * Math.cos(angle)
    const py = cy + size * Math.sin(angle)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

// ── Terrain pattern renderers (square) ──
function drawTerrainDecorations(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  terrainType: string,
  x: number,
  y: number,
  cs: number,
): void {
  if (cs < 24) return
  const seed = col * 1000 + row
  const cx = x + cs / 2
  const cy = y + cs / 2

  if (terrainType === 'plain' && cs > 30) {
    // Subtle grass blades
    ctx.strokeStyle = 'rgba(90,140,70,0.25)'
    ctx.lineWidth = 1
    for (let i = 0; i < 3; i++) {
      const bx = x + cs * (0.2 + seededRandom(seed + i * 3) * 0.6)
      const by = y + cs * (0.5 + seededRandom(seed + i * 3 + 1) * 0.35)
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(bx + (seededRandom(seed + i * 7) - 0.5) * 4, by - cs * 0.12)
      ctx.stroke()
    }
  }

  if (terrainType === 'forest') {
    // Tree triangles
    const treeCount = cs > 40 ? 3 : 2
    for (let i = 0; i < treeCount; i++) {
      const tx = x + cs * (0.2 + seededRandom(seed + i * 5) * 0.6)
      const ty = y + cs * (0.35 + seededRandom(seed + i * 5 + 1) * 0.4)
      const ts = cs * (0.08 + seededRandom(seed + i * 5 + 2) * 0.06)
      ctx.fillStyle = `rgba(20,80,15,${0.3 + seededRandom(seed + i) * 0.2})`
      ctx.beginPath()
      ctx.moveTo(tx, ty - ts * 1.5)
      ctx.lineTo(tx - ts, ty + ts * 0.5)
      ctx.lineTo(tx + ts, ty + ts * 0.5)
      ctx.closePath()
      ctx.fill()
    }
  }

  if (terrainType === 'mountain') {
    // Rock shapes
    ctx.fillStyle = 'rgba(100,85,70,0.35)'
    const rc = cs > 40 ? 2 : 1
    for (let i = 0; i < rc; i++) {
      const rx = x + cs * (0.25 + seededRandom(seed + i * 4) * 0.5)
      const ry = y + cs * (0.3 + seededRandom(seed + i * 4 + 1) * 0.4)
      const rs = cs * (0.1 + seededRandom(seed + i * 4 + 2) * 0.08)
      ctx.beginPath()
      ctx.moveTo(rx, ry - rs)
      ctx.lineTo(rx + rs * 1.2, ry + rs * 0.3)
      ctx.lineTo(rx - rs * 0.8, ry + rs * 0.5)
      ctx.closePath()
      ctx.fill()
    }
    // Snow cap
    if (cs > 35) {
      ctx.fillStyle = 'rgba(220,230,240,0.2)'
      ctx.beginPath()
      ctx.moveTo(cx, cy - cs * 0.15)
      ctx.lineTo(cx + cs * 0.06, cy - cs * 0.08)
      ctx.lineTo(cx - cs * 0.06, cy - cs * 0.08)
      ctx.closePath()
      ctx.fill()
    }
  }

  if (terrainType === 'water') {
    // Wave lines
    ctx.strokeStyle = 'rgba(100,180,255,0.25)'
    ctx.lineWidth = 1.2
    for (let i = 0; i < 2; i++) {
      const wy = y + cs * (0.35 + i * 0.25)
      ctx.beginPath()
      ctx.moveTo(x + cs * 0.15, wy)
      ctx.quadraticCurveTo(x + cs * 0.35, wy - cs * 0.06, x + cs * 0.5, wy)
      ctx.quadraticCurveTo(x + cs * 0.65, wy + cs * 0.06, x + cs * 0.85, wy)
      ctx.stroke()
    }
  }

  if (terrainType === 'desert' && cs > 30) {
    // Sand dots
    ctx.fillStyle = 'rgba(200,180,100,0.2)'
    for (let i = 0; i < 5; i++) {
      const dx = x + cs * (0.15 + seededRandom(seed + i * 2) * 0.7)
      const dy = y + cs * (0.15 + seededRandom(seed + i * 2 + 1) * 0.7)
      ctx.beginPath()
      ctx.arc(dx, dy, cs * 0.02, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  if (terrainType === 'wall') {
    // Brick pattern
    ctx.strokeStyle = 'rgba(30,30,30,0.3)'
    ctx.lineWidth = 1
    const brickH = cs * 0.2
    for (let r = 0; r < 3; r++) {
      const by = y + cs * 0.2 + r * brickH
      ctx.beginPath()
      ctx.moveTo(x + cs * 0.1, by)
      ctx.lineTo(x + cs * 0.9, by)
      ctx.stroke()
      const offset = r % 2 === 0 ? 0 : cs * 0.25
      ctx.beginPath()
      ctx.moveTo(x + cs * 0.1 + offset + cs * 0.25, by)
      ctx.lineTo(x + cs * 0.1 + offset + cs * 0.25, by + brickH)
      ctx.stroke()
    }
  }
}

export function drawTerrainSquare(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  terrainType: string,
  cellSize: number,
): void {
  const tc = TERRAIN_COLORS[terrainType] || TERRAIN_COLORS.plain
  const x = col * cellSize
  const y = row * cellSize

  // Base fill
  ctx.fillStyle = tc.fill
  ctx.fillRect(x, y, cellSize, cellSize)

  // Gradient overlay for depth
  if (cellSize > 14) {
    const grad = ctx.createLinearGradient(x, y, x, y + cellSize)
    grad.addColorStop(0, 'rgba(255,255,255,0.05)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.01)')
    grad.addColorStop(1, 'rgba(0,0,0,0.12)')
    ctx.fillStyle = grad
    ctx.fillRect(x, y, cellSize, cellSize)
  }

  // Inner edge highlight (top-left light, bottom-right dark)
  if (cellSize > 20) {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y + cellSize)
    ctx.lineTo(x, y)
    ctx.lineTo(x + cellSize, y)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.beginPath()
    ctx.moveTo(x + cellSize, y)
    ctx.lineTo(x + cellSize, y + cellSize)
    ctx.lineTo(x, y + cellSize)
    ctx.stroke()
  }

  // Terrain-specific decorations
  drawTerrainDecorations(ctx, col, row, terrainType, x, y, cellSize)
}

export function drawTerrainHex(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  terrainType: string,
  hexSize: number,
): void {
  const tc = TERRAIN_COLORS[terrainType] || TERRAIN_COLORS.plain
  const [cx, cy] = hexCellCenter(col, row, hexSize)

  drawHexPath(ctx, cx, cy, hexSize)
  ctx.fillStyle = tc.fill
  ctx.fill()

  if (hexSize > 10) {
    drawHexPath(ctx, cx, cy, hexSize)
    const grad = ctx.createLinearGradient(cx, cy - hexSize, cx, cy + hexSize)
    grad.addColorStop(0, 'rgba(255,255,255,0.05)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.01)')
    grad.addColorStop(1, 'rgba(0,0,0,0.12)')
    ctx.fillStyle = grad
    ctx.fill()
  }

  // Hex terrain symbols
  if (hexSize > 22 && terrainType !== 'plain') {
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.font = `${Math.max(9, hexSize * 0.3)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const symbols: Record<string, string> = {
      forest: '\u{1F332}', mountain: '\u25B3', water: '\u2248',
      desert: '\u2022', wall: '\u2588',
    }
    ctx.fillText(symbols[terrainType] || '', cx, cy)
  }
}
