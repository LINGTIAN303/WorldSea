// 区域地图的命中测试与坐标换算：纯函数，不持有状态。
// 容差与判定顺序是交互手感的直接来源，改动前先确认真机表现。
import type { HitTestResult, Point, RegionEntity } from './types'

/** 顶点命中半径平方（8px）与边命中半径平方（6px） */
const VERTEX_HIT_R2 = 64
const EDGE_HIT_R2 = 36

/**
 * 命中测试：顶点 → 边 → 面（由细到粗）。
 * 顶点命中返回 vertexIdx >= 0；边命中返回 vertexIdx === -2 且带 edgeIdx；面命中返回 vertexIdx === -1。
 */
export function hitTest(
  mx: number,
  my: number,
  panX: number,
  panY: number,
  scale: number,
  regions: RegionEntity[],
  getTerritory: (r: RegionEntity) => Point[],
): HitTestResult | null {
  const x = (mx - panX) / scale
  const y = (my - panY) / scale
  for (const r of regions) {
    const pts = getTerritory(r)
    for (let vi = 0; vi < pts.length; vi++) {
      const dx = x - pts[vi].x, dy = y - pts[vi].y
      if (dx * dx + dy * dy < VERTEX_HIT_R2) { return { region: r, vertexIdx: vi } }
    }
    // 边命中检测
    for (let ei = 0; ei < pts.length; ei++) {
      const a = pts[ei], b = pts[(ei + 1) % pts.length]
      const ex = b.x - a.x, ey = b.y - a.y
      const len = Math.sqrt(ex * ex + ey * ey)
      if (len < 1) continue
      const t = ((x - a.x) * ex + (y - a.y) * ey) / (len * len)
      if (t < 0 || t > 1) continue
      const px = a.x + t * ex, py = a.y + t * ey
      const ddx = x - px, ddy = y - py
      if (ddx * ddx + ddy * ddy < EDGE_HIT_R2) { return { region: r, vertexIdx: -2, edgeIdx: ei } }
    }
  }
  // 面命中：射线法
  for (const r of regions) {
    const pts = getTerritory(r)
    if (pts.length < 3) continue
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y
      const xj = pts[j].x, yj = pts[j].y
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) { inside = !inside }
    }
    if (inside) return { region: r, vertexIdx: -1 }
  }
  return null
}

/** 屏幕坐标 → 世界坐标（去掉平移与缩放） */
export function toWorldCoords(mx: number, my: number, panX: number, panY: number, scale: number): Point {
  return { x: (mx - panX) / scale, y: (my - panY) / scale }
}
