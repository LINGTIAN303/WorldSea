export interface BoardCamera {
  x: number
  y: number
  k: number
}

export interface UnitRenderData {
  id: string
  name: string
  team: string
  hp: number
  max_hp: number
  acted: boolean
  x: number
  y: number
}

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

export interface BoardRenderData {
  gridType: 'square' | 'hex'
  width: number
  height: number
  terrain: string[][]
  units: UnitRenderData[]
  highlights: HighlightCell[]
  selectedCell: { x: number; y: number } | null
  hoveredCell: { x: number; y: number } | null
  awarenessCells: AwarenessCell[]
  awarenessMode: 'none' | 'influence' | 'threat' | 'supply'
}

// ── Color Palettes ──
const TERRAIN_COLORS: Record<string, { fill: string; dark: string; accent: string; stroke: string }> = {
  plain:    { fill: '#4a6741', dark: '#3a5731', accent: '#5a7751', stroke: '#3d5835' },
  forest:   { fill: '#2d5a27', dark: '#1d4a17', accent: '#3d6a37', stroke: '#1e4818' },
  mountain: { fill: '#7a6b5a', dark: '#5b4b3a', accent: '#8a7b6a', stroke: '#5a4a3a' },
  water:    { fill: '#2a6a9a', dark: '#1a4a7a', accent: '#3a7aaa', stroke: '#1a5080' },
  desert:   { fill: '#b8a060', dark: '#9a8040', accent: '#c8b070', stroke: '#8a7040' },
  wall:     { fill: '#5a5a5a', dark: '#3a3a3a', accent: '#6a6a6a', stroke: '#2a2a2a' },
}

const TEAM_COLORS: Record<string, { main: string; light: string; dark: string; ring: string; glow: string }> = {
  ally:    { main: '#4a9eff', light: '#7ab8ff', dark: '#2a6ecf', ring: '#4a9eff', glow: 'rgba(74,158,255,0.4)' },
  enemy:   { main: '#ff4a4a', light: '#ff7a7a', dark: '#cc2a2a', ring: '#ff4a4a', glow: 'rgba(255,74,74,0.4)' },
  neutral: { main: '#9a9a9a', light: '#bababa', dark: '#6a6a6a', ring: '#9a9a9a', glow: 'rgba(154,154,154,0.4)' },
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  move:   'rgba(74, 158, 255, 0.25)',
  attack: 'rgba(255, 74, 74, 0.25)',
  skill:  'rgba(255, 200, 50, 0.25)',
}

const HIGHLIGHT_BORDERS: Record<string, string> = {
  move:   'rgba(74, 158, 255, 0.70)',
  attack: 'rgba(255, 74, 74, 0.70)',
  skill:  'rgba(255, 200, 50, 0.70)',
}

// ── Seeded random for consistent patterns ──
function seededRandom(seed: number): number {
  let s = seed
  s = ((s >>> 16) ^ s) * 0x45d9f3b | 0
  s = ((s >>> 16) ^ s) * 0x45d9f3b | 0
  s = (s >>> 16) ^ s
  return (s & 0x7fffffff) / 0x7fffffff
}

// ── Board sizing ──
export function getBoardPixelSize(
  gridType: 'square' | 'hex',
  width: number,
  height: number,
  cellSize: number,
): { bw: number; bh: number } {
  if (gridType === 'hex') {
    const hexW = Math.sqrt(3) * cellSize
    const bw = width * hexW + hexW / 2
    const bh = (height - 1) * 1.5 * cellSize + 2 * cellSize
    return { bw, bh }
  }
  return { bw: width * cellSize, bh: height * cellSize }
}

const COORD_MARGIN = 24

export function computeCellSize(
  gridType: 'square' | 'hex',
  width: number,
  height: number,
  canvasW: number,
  canvasH: number,
): number {
  const pad = 0.82
  const margin = COORD_MARGIN
  if (gridType === 'hex') {
    const hexW = Math.sqrt(3)
    const sizeByW = ((canvasW - margin * 2) * pad) / (width * hexW + hexW / 2)
    const sizeByH = ((canvasH - margin * 2) * pad) / ((height - 1) * 1.5 + 2)
    return Math.min(sizeByW, sizeByH)
  }
  const sizeByW = ((canvasW - margin * 2) * pad) / width
  const sizeByH = ((canvasH - margin * 2) * pad) / height
  return Math.min(sizeByW, sizeByH)
}

export function squareCellCenter(col: number, row: number, cellSize: number): [number, number] {
  return [col * cellSize + cellSize / 2, row * cellSize + cellSize / 2]
}

export function hexCellCenter(col: number, row: number, hexSize: number): [number, number] {
  const w = Math.sqrt(3) * hexSize
  const x = col * w + (row % 2 === 1 ? w / 2 : 0) + w / 2
  const y = row * 1.5 * hexSize + hexSize
  return [x, y]
}

export function cellCenter(
  col: number,
  row: number,
  gridType: 'square' | 'hex',
  cellSize: number,
): [number, number] {
  if (gridType === 'hex') return hexCellCenter(col, row, cellSize)
  return squareCellCenter(col, row, cellSize)
}

// ── Hex path helper ──
function drawHexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
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

function drawTerrainSquare(
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

function drawTerrainHex(
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

// ── Grid rendering ──
function drawSquareGrid(
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

function drawHexGrid(
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
function drawHighlights(
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

// ── Animation override ──
export interface AnimOverride {
  offsetX: number
  offsetY: number
  alpha: number
  scale: number
  flash: number
  shakeX: number
  shakeY: number
}

export interface FloatingNumber {
  x: number
  y: number
  text: string
  alpha: number
}

const NO_ANIM: AnimOverride = { offsetX: 0, offsetY: 0, alpha: 1, scale: 1, flash: 0, shakeX: 0, shakeY: 0 }

// ── Unit token rendering ──
function drawUnitToken(
  ctx: CanvasRenderingContext2D,
  unit: UnitRenderData,
  gridType: 'square' | 'hex',
  cellSize: number,
  anim?: AnimOverride,
): void {
  const a = anim || NO_ANIM
  const [basePx, basePy] = cellCenter(unit.x, unit.y, gridType, cellSize)
  const px = basePx + a.offsetX + a.shakeX
  const py = basePy + a.offsetY + a.shakeY
  const tc = TEAM_COLORS[unit.team] || TEAM_COLORS.neutral
  const radius = cellSize * 0.35 * a.scale
  const alpha = (unit.acted ? 0.5 : 1.0) * a.alpha

  ctx.save()
  ctx.globalAlpha = alpha

  // Drop shadow
  ctx.beginPath()
  ctx.arc(px + 2, py + 2, radius + 1, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fill()

  // Outer ring (team glow)
  ctx.beginPath()
  ctx.arc(px, py, radius + 3, 0, Math.PI * 2)
  ctx.fillStyle = tc.glow
  ctx.fill()

  // Main body - gradient fill
  ctx.beginPath()
  ctx.arc(px, py, radius, 0, Math.PI * 2)
  const bodyGrad = ctx.createRadialGradient(px - radius * 0.3, py - radius * 0.3, 0, px, py, radius)
  bodyGrad.addColorStop(0, tc.light)
  bodyGrad.addColorStop(0.7, tc.main)
  bodyGrad.addColorStop(1, tc.dark)
  ctx.fillStyle = bodyGrad
  ctx.fill()

  // Metallic rim
  ctx.strokeStyle = tc.ring
  ctx.lineWidth = 2
  ctx.stroke()

  // Inner shine highlight
  if (radius > 8) {
    ctx.beginPath()
    ctx.arc(px - radius * 0.2, py - radius * 0.25, radius * 0.45, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.fill()
  }

  // Unit name
  if (cellSize > 20) {
    ctx.fillStyle = '#fff'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 2
    ctx.font = `bold ${Math.max(8, cellSize * 0.18)}px 'Segoe UI', sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const maxChars = Math.max(1, Math.floor(radius * 1.6 / (cellSize * 0.14)))
    const name = unit.name.length > maxChars ? unit.name.slice(0, maxChars - 1) + '\u2026' : unit.name
    ctx.fillText(name, px, py - (cellSize > 35 ? radius * 0.2 : 0))
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }

  // HP bar
  if (cellSize > 28) {
    const barW = radius * 1.8
    const barH = Math.max(3, cellSize * 0.07)
    const barX = px - barW / 2
    const barY = py + radius * 0.55
    const hpRatio = Math.max(0, unit.hp / unit.max_hp)

    // Bar background with rounded corners
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    roundRect(ctx, barX - 1, barY - 1, barW + 2, barH + 2, 2)
    ctx.fill()

    // HP fill with gradient
    const hpColor = hpRatio > 0.6 ? '#4ade80' : hpRatio > 0.3 ? '#fbbf24' : '#ef4444'
    const hpGrad = ctx.createLinearGradient(barX, barY, barX, barY + barH)
    hpGrad.addColorStop(0, hpColor)
    hpGrad.addColorStop(1, adjustBrightness(hpColor, -30))
    ctx.fillStyle = hpGrad
    if (hpRatio > 0) {
      roundRect(ctx, barX, barY, barW * hpRatio, barH, 1.5)
      ctx.fill()
    }

    // HP text
    if (cellSize > 38) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = `${Math.max(7, cellSize * 0.13)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${unit.hp}/${unit.max_hp}`, px, barY + barH + cellSize * 0.06)
    }
  }

  // Flash overlay
  if (a.flash > 0) {
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 255, 255, ${a.flash})`
    ctx.fill()
  }

  ctx.restore()
}

function drawUnits(
  ctx: CanvasRenderingContext2D,
  data: BoardRenderData,
  cellSize: number,
  getAnim?: (unitId: string) => AnimOverride | undefined,
): void {
  for (const unit of data.units) {
    const anim = getAnim?.(unit.id)
    drawUnitToken(ctx, unit, data.gridType, cellSize, anim)
  }
}

// ── Selection & Hover ──
function drawSelection(
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

function drawHover(
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
const INFLUENCE_COLORS: Record<string, string> = {
  ally:    'rgba(74, 158, 255, 0.18)',
  enemy:   'rgba(255, 74, 74, 0.18)',
  neutral: 'rgba(154, 154, 154, 0.18)',
}

const INFLUENCE_BORDERS: Record<string, string> = {
  ally:    'rgba(74, 158, 255, 0.35)',
  enemy:   'rgba(255, 74, 74, 0.35)',
  neutral: 'rgba(154, 154, 154, 0.35)',
}

function drawAwareness(
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
function drawCoordinateLabels(
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
function drawBoardFrame(
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
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

function adjustBrightness(hex: string, delta: number): string {
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + delta))
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + delta))
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + delta))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// ── Main draw entry ──
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  data: BoardRenderData,
  camera: BoardCamera,
  cellSize: number,
  getAnim?: (unitId: string) => AnimOverride | undefined,
  floats?: FloatingNumber[],
): void {
  ctx.clearRect(0, 0, canvasW, canvasH)

  // Background gradient
  const bgGrad = ctx.createRadialGradient(canvasW / 2, canvasH / 2, 0, canvasW / 2, canvasH / 2, Math.max(canvasW, canvasH) * 0.7)
  bgGrad.addColorStop(0, '#141922')
  bgGrad.addColorStop(1, '#0a0e14')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, canvasW, canvasH)

  const { bw, bh } = getBoardPixelSize(data.gridType, data.width, data.height, cellSize)

  ctx.save()

  const cx = canvasW / 2
  const cy = canvasH / 2
  ctx.translate(cx, cy)
  ctx.scale(camera.k, camera.k)
  ctx.translate(-camera.x, -camera.y)

  // Board frame (behind the grid)
  drawBoardFrame(ctx, bw, bh, cellSize)

  // Grid
  if (data.gridType === 'hex') {
    drawHexGrid(ctx, data, cellSize)
  } else {
    drawSquareGrid(ctx, data, cellSize)
  }

  // Coordinate labels
  if (cellSize > 20) {
    drawCoordinateLabels(ctx, data, cellSize, bh)
  }

  drawHighlights(ctx, data, cellSize)

  if (data.awarenessMode !== 'none' && data.awarenessCells.length > 0) {
    drawAwareness(ctx, data, cellSize)
  }

  drawUnits(ctx, data, cellSize, getAnim)

  // Floating damage numbers
  if (floats && floats.length > 0) {
    for (const f of floats) {
      const [fpx, fpy] = cellCenter(Math.round(f.x), Math.round(f.y), data.gridType, cellSize)
      ctx.save()
      ctx.globalAlpha = f.alpha
      ctx.fillStyle = f.text.includes('!') ? '#ff4444' : '#ffffff'
      ctx.font = `bold ${Math.max(12, cellSize * 0.35)}px 'Segoe UI', sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 4
      ctx.fillText(f.text, fpx, fpy - cellSize * 0.5 * (1 - f.alpha) * 2)
      ctx.restore()
    }
  }

  if (data.selectedCell) {
    drawSelection(ctx, data.selectedCell, data.gridType, cellSize)
  }

  if (data.hoveredCell) {
    drawHover(ctx, data.hoveredCell, data.gridType, cellSize)
  }

  ctx.restore()
}

// ── Hit testing ──
export function hitTestCell(
  screenX: number,
  screenY: number,
  canvasW: number,
  canvasH: number,
  camera: BoardCamera,
  gridType: 'square' | 'hex',
  gridWidth: number,
  gridHeight: number,
  cellSize: number,
): { x: number; y: number } | null {
  const cx = canvasW / 2
  const cy = canvasH / 2
  const worldX = (screenX - cx) / camera.k + camera.x
  const worldY = (screenY - cy) / camera.k + camera.y

  if (gridType === 'hex') {
    return hitTestHex(worldX, worldY, gridWidth, gridHeight, cellSize)
  }
  return hitTestSquare(worldX, worldY, gridWidth, gridHeight, cellSize)
}

function hitTestSquare(
  wx: number,
  wy: number,
  gw: number,
  gh: number,
  cellSize: number,
): { x: number; y: number } | null {
  const col = Math.floor(wx / cellSize)
  const row = Math.floor(wy / cellSize)
  if (col < 0 || col >= gw || row < 0 || row >= gh) return null
  return { x: col, y: row }
}

function hitTestHex(
  wx: number,
  wy: number,
  gw: number,
  gh: number,
  hexSize: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number; dist: number } | null = null
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const [cx, cy] = hexCellCenter(c, r, hexSize)
      const dx = wx - cx
      const dy = wy - cy
      const dist = dx * dx + dy * dy
      if (dist < hexSize * hexSize) {
        if (!best || dist < best.dist) {
          best = { x: c, y: r, dist }
        }
      }
    }
  }
  return best ? { x: best.x, y: best.y } : null
}
