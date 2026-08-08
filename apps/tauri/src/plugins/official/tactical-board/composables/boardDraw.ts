// 战术板 canvas 绘图模块入口：主接口 + 分层绘制入口（静态层/动态层/全量）
// 由 boardDraw.ts 按主题拆分（2026-08-06）：
//   boardCoordinates（坐标/命中测试）· boardColors（颜色表）· boardTerrain（地形）· boardUnits（单位）· boardOverlay（高亮/网格/坐标/awareness）
// 公共导出签名不变，外部 import './boardDraw' 的导出均可继续解析，详见 docs/details/注释/README.md
import { cellCenter, getBoardPixelSize, type BoardCamera } from './boardCoordinates'
import {
  drawAwareness,
  drawBoardFrame,
  drawCoordinateLabels,
  drawHexGrid,
  drawHighlights,
  drawHover,
  drawSelection,
  drawSquareGrid,
  type AwarenessCell,
  type HighlightCell,
} from './boardOverlay'
import { drawUnits, type AnimOverride, type FloatingNumber, type UnitRenderData } from './boardUnits'

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

// ── Static layer (background / frame / grid / coords) ──
// 静态层仅依赖：canvas 尺寸、gridType/terrain/width/height、camera、cellSize。
// 这些在动画期间不变化，可缓存到离屏 canvas，避免每帧重复绘制最昂贵的网格+地形。
export function drawStaticLayer(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  data: BoardRenderData,
  camera: BoardCamera,
  cellSize: number,
): void {
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

  ctx.restore()
}

// ── Dynamic layer (highlights / awareness / units / floats / selection / hover) ──
// 动态层每帧重绘，绘制在静态层之上。
export function drawDynamicLayer(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  data: BoardRenderData,
  camera: BoardCamera,
  cellSize: number,
  getAnim?: (unitId: string) => AnimOverride | undefined,
  floats?: FloatingNumber[],
): void {
  ctx.save()
  const cx = canvasW / 2
  const cy = canvasH / 2
  ctx.translate(cx, cy)
  ctx.scale(camera.k, camera.k)
  ctx.translate(-camera.x, -camera.y)

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

// ── Main draw entry (no caching; used by callers that don't need the static cache) ──
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
  drawStaticLayer(ctx, canvasW, canvasH, data, camera, cellSize)
  drawDynamicLayer(ctx, canvasW, canvasH, data, camera, cellSize, getAnim, floats)
}

export * from './boardColors'
export * from './boardCoordinates'
export * from './boardOverlay'
export * from './boardTerrain'
export * from './boardUnits'
