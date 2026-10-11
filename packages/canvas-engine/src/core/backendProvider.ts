export interface Point2D {
  x: number
  y: number
}

export interface Segment2D {
  start: Point2D
  end: Point2D
}

export interface GraphEdge {
  target: string
  weight: number
  label?: string
}

export interface WeightedGraph {
  adjacency: Record<string, GraphEdge[]>
}

export interface PathResult {
  path: string[]
  totalCost: number
  found: boolean
}

export interface Community {
  id: number
  members: string[]
}

export interface CommunityDetectionResult {
  communities: Community[]
  modularity: number
}

export interface Polygon2DResult {
  exterior: Point2D[]
  interiors: Point2D[][]
}

export interface SharedEdge {
  edgeIdxA: number
  edgeIdxB: number
  distance: number
}

export interface LinePolygonIntersection {
  point: Point2D
  lineIdx: number
  edgeIdx: number
}

export interface BackendAlgoApi {
  getBackendType?: () => 'tauri' | 'wasm' | 'none'
  algoPointInPolygon?: (point: Point2D, vertices: Point2D[]) => Promise<boolean>
  algoSegmentIntersect?: (seg1: Segment2D, seg2: Segment2D) => Promise<boolean>
  algoConvexHull?: (points: Point2D[]) => Promise<Point2D[]>
  algoPolygonSimplify?: (polygon: Polygon2DResult, epsilon: number) => Promise<Polygon2DResult>
  algoPolygonBoolean?: (op: 'union' | 'intersection' | 'difference' | 'xor', a: Polygon2DResult, b: Polygon2DResult) => Promise<Polygon2DResult[]>
  algoChaikinSmooth?: (vertices: Point2D[], iterations: number) => Promise<Point2D[]>
  algoFindSharedEdges?: (verticesA: Point2D[], verticesB: Point2D[], threshold: number) => Promise<SharedEdge[]>
  algoFindLinePolygonIntersections?: (line: Point2D[], polygon: Point2D[]) => Promise<LinePolygonIntersection[]>
  algoPolygonSplit?: (polygon: Point2D[], cuttingLine: Point2D[]) => Promise<Point2D[][]>
  algoPolygonAugment?: (polygon: Point2D[], addingLine: Point2D[]) => Promise<Point2D[]>
  algoDijkstraPath?: (graph: WeightedGraph, source: string, target: string) => Promise<PathResult>
  algoCommunityDetection?: (graphJson: string) => Promise<CommunityDetectionResult>
}

let _backend: BackendAlgoApi | null = null

export function registerBackend(api: BackendAlgoApi): void {
  _backend = api
}

export function getBackend(): BackendAlgoApi | null {
  return _backend
}
