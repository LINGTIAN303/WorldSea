// 单位绘制：由 boardDraw.ts 拆出（2026-08-06），详见 docs/details/注释/README.md
import type { BoardRenderData } from './boardDraw'
import { TEAM_COLORS } from './boardColors'
import { cellCenter } from './boardCoordinates'
import { roundRect } from './boardOverlay'

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

export function drawUnits(
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

function adjustBrightness(hex: string, delta: number): string {
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + delta))
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + delta))
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + delta))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
