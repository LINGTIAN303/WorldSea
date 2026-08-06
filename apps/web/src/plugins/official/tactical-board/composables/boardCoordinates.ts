// 坐标计算与命中测试：由 boardDraw.ts 拆出（2026-08-06），详见 docs/details/注释/README.md
export interface BoardCamera {
  x: number
  y: number
  k: number
}

// ── Seeded random for consistent patterns ──
export function seededRandom(seed: number): number {
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

export const COORD_MARGIN = 24

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
