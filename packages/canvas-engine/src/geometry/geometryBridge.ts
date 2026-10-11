import {
  type Point2D,
  getBackend,
} from '../core/backendProvider'

let _backendAvailable: boolean | null = null
let _backendCheckTime = 0
const BACKEND_CACHE_TTL = 5000

async function isBackendAvailable(): Promise<boolean> {
  const now = Date.now()
  if (_backendAvailable !== null && (now - _backendCheckTime) < BACKEND_CACHE_TTL) {
    return _backendAvailable
  }
  try {
    const backend = getBackend()
    const bt = backend?.getBackendType?.()
    _backendAvailable = bt === 'tauri' || bt === 'wasm'
    _backendCheckTime = now
  } catch {
    _backendAvailable = false
    _backendCheckTime = now
  }
  return _backendAvailable
}

function crossProduct(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function localPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
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

function localSegmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
  const d1 = crossProduct(p3, p4, p1)
  const d2 = crossProduct(p3, p4, p2)
  const d3 = crossProduct(p1, p2, p3)
  const d4 = crossProduct(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

function localPerpendicularDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
}

function localSimplifyPoints(pts: Point2D[], tolerance = 2): Point2D[] {
  if (pts.length <= 2) return pts
  let maxDist = 0, maxIdx = 0
  const first = pts[0], last = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = localPerpendicularDist(pts[i], first, last)
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }
  if (maxDist > tolerance) {
    const left = localSimplifyPoints(pts.slice(0, maxIdx + 1), tolerance)
    const right = localSimplifyPoints(pts.slice(maxIdx), tolerance)
    return left.slice(0, -1).concat(right)
  }
  return [first, last]
}

function localComputeMergedPolygon(poly1: Point2D[], poly2: Point2D[]): Point2D[] {
  const allPts = [...poly1, ...poly2]
  if (allPts.length < 3) return poly1
  const sorted = [...allPts].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point2D[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point2D[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) upper.pop()
    upper.push(sorted[i])
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function localChaikinSmooth(pts: Point2D[], iterations = 2): Point2D[] {
  let result = pts
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point2D[] = []
    for (let i = 0; i < result.length - 1; i++) {
      const a = result[i], b = result[i + 1]
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    const last = result[result.length - 1], first = result[0]
    next.push({ x: last.x * 0.75 + first.x * 0.25, y: last.y * 0.75 + first.y * 0.25 })
    next.push({ x: last.x * 0.25 + first.x * 0.75, y: last.y * 0.25 + first.y * 0.75 })
    result = next
  }
  return result
}

function localLineSegmentIntersection(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): Point2D | null {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
  if (Math.abs(denom) < 1e-10) return null
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom
  const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / denom
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }
  }
  return null
}

function localFindLinePolygonIntersections(
  line: Point2D[],
  polygon: Point2D[],
): { point: Point2D; lineIdx: number; edgeIdx: number }[] {
  const result: { point: Point2D; lineIdx: number; edgeIdx: number }[] = []
  for (let i = 0; i < line.length - 1; i++) {
    for (let j = 0; j < polygon.length; j++) {
      const a = polygon[j], b = polygon[(j + 1) % polygon.length]
      const inter = localLineSegmentIntersection(line[i], line[i + 1], a, b)
      if (inter) result.push({ point: inter, lineIdx: i, edgeIdx: j })
    }
  }
  return result
}

function localSplitPolygonAtIntersections(
  polygon: Point2D[],
  intersections: { point: Point2D; lineIdx: number; edgeIdx: number }[],
  cuttingLine: Point2D[],
): Point2D[][] {
  if (intersections.length < 2) return [polygon]
  const int1 = intersections[0]
  const int2 = intersections[intersections.length - 1]
  const poly1: Point2D[] = [int1.point]
  const poly2: Point2D[] = [int2.point]
  let idx = (int1.edgeIdx + 1) % polygon.length
  while (idx !== (int2.edgeIdx + 1) % polygon.length) {
    poly1.push(polygon[idx])
    idx = (idx + 1) % polygon.length
  }
  poly1.push(int2.point)
  for (let i = int2.lineIdx; i >= int1.lineIdx; i--) {
    if (i < cuttingLine.length) poly1.push(cuttingLine[i])
  }
  idx = (int2.edgeIdx + 1) % polygon.length
  while (idx !== (int1.edgeIdx + 1) % polygon.length) {
    poly2.push(polygon[idx])
    idx = (idx + 1) % polygon.length
  }
  poly2.push(int1.point)
  for (let i = int1.lineIdx; i <= int2.lineIdx; i++) {
    if (i < cuttingLine.length) poly2.push(cuttingLine[i])
  }
  return [poly1, poly2].filter(p => p.length >= 3)
}

function localBuildAugmentedPolygon(
  polygon: Point2D[],
  addingLine: Point2D[],
  intersections: { point: Point2D; lineIdx: number; edgeIdx: number }[],
): Point2D[] {
  if (intersections.length < 2) return []
  const int1 = intersections[0]
  const int2 = intersections[intersections.length - 1]
  const result: Point2D[] = [int1.point]
  for (let i = int1.lineIdx + 1; i <= int2.lineIdx; i++) {
    if (i < addingLine.length) result.push(addingLine[i])
  }
  result.push(int2.point)
  let idx = (int2.edgeIdx + 1) % polygon.length
  while (idx !== (int1.edgeIdx + 1) % polygon.length) {
    result.push(polygon[idx])
    idx = (idx + 1) % polygon.length
  }
  return result.length >= 3 ? result : []
}

function localMergePolygons(poly1: Point2D[], poly2: Point2D[]): Point2D[] {
  let minDist = Infinity
  let bestI = 0, bestJ = 0
  for (let i = 0; i < poly1.length; i++) {
    const mid1x = (poly1[i].x + poly1[(i + 1) % poly1.length].x) / 2
    const mid1y = (poly1[i].y + poly1[(i + 1) % poly1.length].y) / 2
    for (let j = 0; j < poly2.length; j++) {
      const mid2x = (poly2[j].x + poly2[(j + 1) % poly2.length].x) / 2
      const mid2y = (poly2[j].y + poly2[(j + 1) % poly2.length].y) / 2
      const d = (mid1x - mid2x) ** 2 + (mid1y - mid2y) ** 2
      if (d < minDist) { minDist = d; bestI = i; bestJ = j }
    }
  }
  const result: Point2D[] = []
  let idx = (bestI + 1) % poly1.length
  while (true) {
    result.push(poly1[idx])
    if (idx === bestI) break
    idx = (idx + 1) % poly1.length
  }
  idx = (bestJ + 1) % poly2.length
  while (true) {
    result.push(poly2[idx])
    if (idx === bestJ) break
    idx = (idx + 1) % poly2.length
  }
  return result
}

export async function bridgePointInPolygon(point: Point2D, polygon: Point2D[]): Promise<boolean> {
  if (await isBackendAvailable()) {
    try {
      const backend = getBackend()
      if (backend?.algoPointInPolygon) return await backend.algoPointInPolygon(point, polygon)
    } catch { /* fallback */ }
  }
  return localPointInPolygon(point, polygon)
}

export async function bridgeSegmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): Promise<boolean> {
  if (await isBackendAvailable()) {
    try {
      const backend = getBackend()
      if (backend?.algoSegmentIntersect) return await backend.algoSegmentIntersect({ start: p1, end: p2 }, { start: p3, end: p4 })
    } catch { /* fallback */ }
  }
  return localSegmentsIntersect(p1, p2, p3, p4)
}

export async function bridgeSimplifyPoints(pts: Point2D[], tolerance = 2): Promise<Point2D[]> {
  if (await isBackendAvailable()) {
    try {
      const backend = getBackend()
      if (backend?.algoPolygonSimplify) {
        const result = await backend.algoPolygonSimplify({ exterior: pts, interiors: [] }, tolerance)
        return result.exterior
      }
    } catch { /* fallback */ }
  }
  return localSimplifyPoints(pts, tolerance)
}

export async function bridgeComputeMergedPolygon(poly1: Point2D[], poly2: Point2D[]): Promise<Point2D[]> {
  if (await isBackendAvailable()) {
    try {
      const backend = getBackend()
      if (backend?.algoConvexHull) {
        const result = await backend.algoConvexHull([...poly1, ...poly2])
        if (result.length >= 3) return result
      }
    } catch { /* fallback */ }
  }
  return localComputeMergedPolygon(poly1, poly2)
}

export async function bridgeChaikinSmooth(pts: Point2D[], iterations = 2): Promise<Point2D[]> {
  if (await isBackendAvailable()) {
    try {
      const backend = getBackend()
      if (backend?.algoChaikinSmooth) return await backend.algoChaikinSmooth(pts, iterations)
    } catch { /* fallback */ }
  }
  return localChaikinSmooth(pts, iterations)
}

export async function bridgeFindLinePolygonIntersections(
  line: Point2D[],
  polygon: Point2D[],
): Promise<{ point: Point2D; lineIdx: number; edgeIdx: number }[]> {
  if (await isBackendAvailable()) {
    try {
      const backend = getBackend()
      if (backend?.algoFindLinePolygonIntersections) return await backend.algoFindLinePolygonIntersections(line, polygon)
    } catch { /* fallback */ }
  }
  return localFindLinePolygonIntersections(line, polygon)
}

export async function bridgePolygonSplit(
  polygon: Point2D[],
  cuttingLine: Point2D[],
): Promise<Point2D[][]> {
  if (await isBackendAvailable()) {
    try {
      const backend = getBackend()
      if (backend?.algoPolygonSplit) return await backend.algoPolygonSplit(polygon, cuttingLine)
    } catch { /* fallback */ }
  }
  return localSplitPolygonAtIntersections(
    polygon,
    localFindLinePolygonIntersections(cuttingLine, polygon),
    cuttingLine,
  )
}

export async function bridgePolygonAugment(
  polygon: Point2D[],
  addingLine: Point2D[],
): Promise<Point2D[]> {
  if (await isBackendAvailable()) {
    try {
      const backend = getBackend()
      if (backend?.algoPolygonAugment) return await backend.algoPolygonAugment(polygon, addingLine)
    } catch { /* fallback */ }
  }
  const intersections = localFindLinePolygonIntersections(addingLine, polygon)
  return localBuildAugmentedPolygon(polygon, addingLine, intersections)
}

export async function bridgeMergePolygons(poly1: Point2D[], poly2: Point2D[]): Promise<Point2D[]> {
  if (await isBackendAvailable()) {
    try {
      const backend = getBackend()
      if (backend?.algoPolygonBoolean) {
        const result = await backend.algoPolygonBoolean('union',
          { exterior: poly1, interiors: [] },
          { exterior: poly2, interiors: [] },
        )
        if (result.length > 0 && result[0].exterior.length >= 3) return result[0].exterior
      }
    } catch { /* fallback */ }
  }
  return localMergePolygons(poly1, poly2)
}

export async function bridgeFindSharedEdges(
  verticesA: Point2D[],
  verticesB: Point2D[],
  threshold = 8,
): Promise<{ edgeIdxA: number; edgeIdxB: number; distance: number }[]> {
  if (await isBackendAvailable()) {
    try {
      const backend = getBackend()
      if (backend?.algoFindSharedEdges) return await backend.algoFindSharedEdges(verticesA, verticesB, threshold)
    } catch { /* fallback */ }
  }
  const result: { edgeIdxA: number; edgeIdxB: number; distance: number }[] = []
  for (let i = 0; i < verticesA.length; i++) {
    const a1 = verticesA[i], a2 = verticesA[(i + 1) % verticesA.length]
    for (let j = 0; j < verticesB.length; j++) {
      const b1 = verticesB[j], b2 = verticesB[(j + 1) % verticesB.length]
      const d1 = Math.sqrt((a1.x - b1.x) ** 2 + (a1.y - b1.y) ** 2)
      const d2 = Math.sqrt((a2.x - b2.x) ** 2 + (a2.y - b2.y) ** 2)
      const d3 = Math.sqrt((a1.x - b2.x) ** 2 + (a1.y - b2.y) ** 2)
      const d4 = Math.sqrt((a2.x - b1.x) ** 2 + (a2.y - b1.y) ** 2)
      if ((d1 < threshold && d2 < threshold) || (d3 < threshold && d4 < threshold)) {
        result.push({ edgeIdxA: i, edgeIdxB: j, distance: Math.min(d1, d2, d3, d4) })
      }
    }
  }
  return result
}

export {
  localPointInPolygon,
  localSegmentsIntersect,
  localSimplifyPoints,
  localComputeMergedPolygon,
  localChaikinSmooth,
  localLineSegmentIntersection,
  localFindLinePolygonIntersections,
  localSplitPolygonAtIntersections,
  localBuildAugmentedPolygon,
  localMergePolygons,
  localPerpendicularDist,
  crossProduct,
}
