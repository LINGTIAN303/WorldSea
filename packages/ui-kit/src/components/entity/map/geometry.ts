/**
 * RegionMap 纯几何函数 + 上下文菜单位置工具
 *
 * 这里的函数都是无副作用的纯函数，依赖通过参数显式传入。
 */

import { crossProduct } from '@worldsea/canvas-engine/geometry'
import type { Point, RegionEntity, SharedEdge } from './types'

// 点在多边形内（射线法）
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    if ((yi > point.y) !== (yj > point.y) && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// 两线段是否相交（基于叉积）
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = crossProduct(p3, p4, p1)
  const d2 = crossProduct(p3, p4, p2)
  const d3 = crossProduct(p1, p2, p3)
  const d4 = crossProduct(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

// 折线是否与多边形任一边相交
export function lineIntersectsPolygonEdges(line: Point[], polygon: Point[]): boolean {
  for (let i = 0; i < line.length - 1; i++) {
    for (let j = 0; j < polygon.length; j++) {
      const a = polygon[j], b = polygon[(j + 1) % polygon.length]
      if (segmentsIntersect(line[i], line[i + 1], a, b)) return true
    }
  }
  return false
}

// 在两个区域之间查找共享边（不依赖鼠标坐标）
export function findSharedEdgeBetween(
  r1: RegionEntity,
  r2: RegionEntity,
  getTerritory: (r: RegionEntity) => Point[]
): { startIdx1: number; startIdx2: number } | null {
  const pts1 = getTerritory(r1)
  const pts2 = getTerritory(r2)
  const threshold = 8
  for (let i = 0; i < pts1.length; i++) {
    const a1 = pts1[i], b1 = pts1[(i + 1) % pts1.length]
    for (let j = 0; j < pts2.length; j++) {
      const a2 = pts2[j], b2 = pts2[(j + 1) % pts2.length]
      const d1 = Math.sqrt((a1.x - a2.x) ** 2 + (a1.y - a2.y) ** 2)
      const d2 = Math.sqrt((b1.x - b2.x) ** 2 + (b1.y - b2.y) ** 2)
      const d3 = Math.sqrt((a1.x - b2.x) ** 2 + (a1.y - b2.y) ** 2)
      const d4 = Math.sqrt((b1.x - a2.x) ** 2 + (b1.y - a2.y) ** 2)
      if ((d1 < threshold && d2 < threshold) || (d3 < threshold && d4 < threshold)) {
        return { startIdx1: i, startIdx2: j }
      }
    }
  }
  return null
}

// 通过屏幕坐标查找共享边（用于右键抹除菜单）
export function findSharedEdgeAtPoint(
  mx: number, my: number,
  panX: number, panY: number, scale: number,
  regions: RegionEntity[],
  getTerritory: (r: RegionEntity) => Point[]
): SharedEdge | null {
  const x = (mx - panX) / scale
  const y = (my - panY) / scale
  for (let ri = 0; ri < regions.length; ri++) {
    for (let rj = ri + 1; rj < regions.length; rj++) {
      const pts1 = getTerritory(regions[ri])
      const pts2 = getTerritory(regions[rj])
      for (let ei = 0; ei < pts1.length; ei++) {
        const a1 = pts1[ei], b1 = pts1[(ei + 1) % pts1.length]
        for (let ej = 0; ej < pts2.length; ej++) {
          const a2 = pts2[ej], b2 = pts2[(ej + 1) % pts2.length]
          const d1 = Math.sqrt((a1.x - a2.x) ** 2 + (a1.y - a2.y) ** 2)
          const d2 = Math.sqrt((b1.x - b2.x) ** 2 + (b1.y - b2.y) ** 2)
          const d3 = Math.sqrt((a1.x - b2.x) ** 2 + (a1.y - b2.y) ** 2)
          const d4 = Math.sqrt((b1.x - a2.x) ** 2 + (b1.y - a2.y) ** 2)
          const threshold = 8
          if ((d1 < threshold && d2 < threshold) || (d3 < threshold && d4 < threshold)) {
            const edgeLen = Math.sqrt((b1.x - a1.x) ** 2 + (b1.y - a1.y) ** 2)
            if (edgeLen < 1) continue
            const ex = b1.x - a1.x, ey = b1.y - a1.y
            const t = ((x - a1.x) * ex + (y - a1.y) * ey) / (edgeLen * edgeLen)
            if (t < -0.1 || t > 1.1) continue
            const px = a1.x + t * ex, py = a1.y + t * ey
            const dd = Math.sqrt((x - px) ** 2 + (y - py) ** 2)
            if (dd < 10) {
              return { region1: regions[ri], region2: regions[rj], startIdx1: ei, startIdx2: ej }
            }
          }
        }
      }
    }
  }
  return null
}

// 用新折线替换多边形的一条边
export function replaceEdgeWithLine(
  polygon: Point[],
  edgeIdx: number,
  newLine: Point[]
): Point[] {
  const result: Point[] = []
  for (let i = 0; i < polygon.length; i++) {
    if (i === edgeIdx) {
      result.push(polygon[i])
      for (const p of newLine) {
        result.push(p)
      }
    } else if (i !== (edgeIdx + 1) % polygon.length) {
      result.push(polygon[i])
    }
  }
  return result
}

// 圆角矩形路径
export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
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

/**
 * 计算上下文菜单 / 浮层的位置，自动避免溢出屏幕右下边缘
 * @param mx 鼠标 clientX
 * @param my 鼠标 clientY
 * @param w 浮层宽度
 * @param h 浮层高度
 */
export function ctxPos(mx: number, my: number, w = 160, h = 240): { left: string; top: string } {
  let left = mx
  let top = my
  if (left + w > window.innerWidth - 8) left = mx - w
  if (top + h > window.innerHeight - 8) top = my - h
  left = Math.max(8, left)
  top = Math.max(8, top)
  return { left: left + 'px', top: top + 'px' }
}
