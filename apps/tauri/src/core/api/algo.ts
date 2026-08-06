// coreBackend 算法领域：空间索引 + 几何/图/CRDT/地形算法（原 coreBackend.ts 拆分），详细见 docs/details/注释/tauri/coreBackend.md
import type {
  SpatialItem,
  PointItem,
  Segment2D,
  Point2D,
  WeightedGraph,
  PathResult,
  TopologicalSortResult,
  ConnectedComponentsResult,
  StronglyConnectedResult,
  ForceLayoutConfig,
  ForceLayoutResult,
  LWWRegister,
  ORSet,
  RGA,
  RGAInsertResult,
  VectorClockCompareResult,
  NoiseConfig,
  HeightMap,
  SlopeResult,
  ContourLine,
  ConstraintSolveOutput,
  DxfImportResult,
  DxfEntity,
  Constraint,
  Polygon2DResult,
  PageRankResult,
  CommunityDetectionResult,
  BetweennessResult,
  ErosionConfig,
  ViewshedResult,
  SharedEdge,
  LinePolygonIntersection,
} from '@worldsmith/core-api-types'
import { tauriCall, algoCall, getTauriInvoke } from './runtime'

// ── 空间索引 API ──

export async function spatialInsertRect(item: SpatialItem): Promise<void> {
  return tauriCall('cmd_spatial_insert_rect', { itemJson: JSON.stringify(item) })
}

export async function spatialInsertPoint(item: PointItem): Promise<void> {
  return tauriCall('cmd_spatial_insert_point', { itemJson: JSON.stringify(item) })
}

export async function spatialQueryRange(min: [number, number], max: [number, number]): Promise<SpatialItem[]> {
  return tauriCall('cmd_spatial_query_range', { minJson: JSON.stringify(min), maxJson: JSON.stringify(max) }, [] as SpatialItem[])
}

export async function spatialQueryAtPoint(point: [number, number]): Promise<SpatialItem[]> {
  return tauriCall('cmd_spatial_query_at_point', { pointJson: JSON.stringify(point) }, [] as SpatialItem[])
}

export async function spatialNearestPoint(query: [number, number]): Promise<PointItem | null> {
  return tauriCall('cmd_spatial_nearest_point', { queryJson: JSON.stringify(query) }, null)
}

export async function spatialKNearest(query: [number, number], k: number): Promise<PointItem[]> {
  return tauriCall('cmd_spatial_k_nearest', { queryJson: JSON.stringify(query), k }, [] as PointItem[])
}

export async function spatialQueryByCategory(category: string): Promise<SpatialItem[]> {
  return tauriCall('cmd_spatial_query_by_category', { category }, [] as SpatialItem[])
}

export async function spatialRemoveRect(item: SpatialItem): Promise<boolean> {
  return tauriCall('cmd_spatial_remove_rect', { itemJson: JSON.stringify(item) }, false)
}

export async function spatialClear(): Promise<void> {
  return tauriCall('cmd_spatial_clear')
}

export async function spatialCounts(): Promise<{ rectCount: number; pointCount: number }> {
  return tauriCall('cmd_spatial_counts', {}, { rectCount: 0, pointCount: 0 })
}

// ── 几何算法 API ──

export async function algoSegmentIntersect(seg1: Segment2D, seg2: Segment2D): Promise<boolean> {
  const invoke = await getTauriInvoke()
  return invoke('cmd_algo_segment_intersect', { seg1Json: JSON.stringify(seg1), seg2Json: JSON.stringify(seg2) }) as Promise<boolean>
}

export async function algoFindAllIntersections(segments: Segment2D[]): Promise<string> {
  const invoke = await getTauriInvoke()
  return invoke('cmd_algo_find_all_intersections', { segmentsJson: JSON.stringify(segments) }) as Promise<string>
}

export async function algoPointInPolygon(point: Point2D, vertices: Point2D[]): Promise<boolean> {
  const invoke = await getTauriInvoke()
  return invoke('cmd_algo_point_in_polygon', { pointJson: JSON.stringify(point), verticesJson: JSON.stringify(vertices) }) as Promise<boolean>
}

export async function algoPolygonArea(vertices: Point2D[]): Promise<number> {
  const invoke = await getTauriInvoke()
  return invoke('cmd_algo_polygon_area', { verticesJson: JSON.stringify(vertices) }) as Promise<number>
}

export async function algoConvexHull(points: Point2D[]): Promise<Point2D[]> {
  const invoke = await getTauriInvoke()
  return invoke('cmd_algo_convex_hull', { pointsJson: JSON.stringify(points) }) as Promise<Point2D[]>
}

export async function algoAabbIntersects(a: { min: Point2D; max: Point2D }, b: { min: Point2D; max: Point2D }): Promise<boolean> {
  const invoke = await getTauriInvoke()
  return invoke('cmd_algo_aabb_intersects', { aJson: JSON.stringify(a), bJson: JSON.stringify(b) }) as Promise<boolean>
}

export async function algoObbIntersects(a: { center: Point2D; halfExtents: [number, number]; rotation: number }, b: { center: Point2D; halfExtents: [number, number]; rotation: number }): Promise<boolean> {
  const invoke = await getTauriInvoke()
  return invoke('cmd_algo_obb_intersects', { aJson: JSON.stringify(a), bJson: JSON.stringify(b) }) as Promise<boolean>
}

// ── 图算法 API ──

export async function algoDijkstraPath(graph: WeightedGraph, source: string, target: string): Promise<PathResult> {
  return algoCall(
    'cmd_algo_dijkstra_path',
    { graphJson: JSON.stringify(graph), source, target },
    c => c.algoDijkstraPath(graph, source, target),
    { path: [], totalCost: 0, found: false },
    true,
    'algoDijkstraPath', [graph, source, target],
  )
}

export async function algoAstar(graph: WeightedGraph, source: string, target: string, heuristic: Record<string, number>): Promise<PathResult> {
  return algoCall(
    'cmd_algo_astar',
    { graphJson: JSON.stringify(graph), source, target, heuristicJson: JSON.stringify(heuristic) },
    c => c.algoAstar(graph, source, target, heuristic),
    { path: [], totalCost: 0, found: false },
    true,
    'algoAstar', [graph, source, target, heuristic],
  )
}

export async function algoTopologicalSort(graph: WeightedGraph): Promise<TopologicalSortResult> {
  return algoCall(
    'cmd_algo_topological_sort',
    { graphJson: JSON.stringify(graph) },
    c => c.algoTopologicalSort(graph),
    { order: [], hasCycle: false, cycleNodes: [] },
    true,
    'algoTopologicalSort', [graph],
  )
}

export async function algoConnectedComponents(graph: WeightedGraph): Promise<ConnectedComponentsResult> {
  return algoCall(
    'cmd_algo_connected_components',
    { graphJson: JSON.stringify(graph) },
    c => c.algoConnectedComponents(graph),
    { components: [], count: 0, largestSize: 0 },
    true,
    'algoConnectedComponents', [graph],
  )
}

export async function algoTarjanScc(graph: WeightedGraph): Promise<StronglyConnectedResult> {
  return algoCall(
    'cmd_algo_tarjan_scc',
    { graphJson: JSON.stringify(graph) },
    c => c.algoTarjanScc(graph),
    { components: [], count: 0, hasCycles: false },
    true,
    'algoTarjanScc', [graph],
  )
}

export async function algoForceLayout(graph: WeightedGraph, config?: ForceLayoutConfig): Promise<ForceLayoutResult> {
  return algoCall(
    'cmd_algo_force_layout',
    { graphJson: JSON.stringify(graph), configJson: config ? JSON.stringify(config) : null },
    c => c.algoForceLayout(graph, config),
    { nodes: [], iterations: 0, converged: false, totalEnergy: 0 },
    true,
    'algoForceLayout', [graph, config],
  )
}

export async function algoCrdtLwwNew(value: string, nodeId: string): Promise<LWWRegister> {
  return algoCall('cmd_algo_crdt_lww_new', { value, nodeId }, c => c.algoCrdtLwwNew(value, nodeId), { value: '', timestamp: 0, nodeId: '' } as LWWRegister, true)
}

export async function algoCrdtLwwSet(registerJson: string, value: string, timestamp: number): Promise<LWWRegister> {
  return algoCall('cmd_algo_crdt_lww_set', { registerJson, value, timestamp }, c => c.algoCrdtLwwSet(registerJson, value, timestamp), { value: '', timestamp: 0, nodeId: '' } as LWWRegister, true)
}

export async function algoCrdtLwwMerge(registerJson: string, otherJson: string): Promise<LWWRegister> {
  return algoCall('cmd_algo_crdt_lww_merge', { registerJson, otherJson }, c => c.algoCrdtLwwMerge(registerJson, otherJson), { value: '', timestamp: 0, nodeId: '' } as LWWRegister, true)
}

export async function algoCrdtOrsetNew(nodeId: string): Promise<ORSet> {
  return algoCall('cmd_algo_crdt_orset_new', { nodeId }, c => c.algoCrdtOrsetNew(nodeId), { added: {}, removed: [], nodeId: '', counter: 0 } as ORSet, true)
}

export async function algoCrdtOrsetAdd(setJson: string, element: string): Promise<ORSet> {
  return algoCall('cmd_algo_crdt_orset_add', { setJson, element }, c => c.algoCrdtOrsetAdd(setJson, element), { added: {}, removed: [], nodeId: '', counter: 0 } as ORSet, true)
}

export async function algoCrdtOrsetRemove(setJson: string, element: string): Promise<ORSet> {
  return algoCall('cmd_algo_crdt_orset_remove', { setJson, element }, c => c.algoCrdtOrsetRemove(setJson, element), { added: {}, removed: [], nodeId: '', counter: 0 } as ORSet, true)
}

export async function algoCrdtOrsetMerge(setJson: string, otherJson: string): Promise<ORSet> {
  return algoCall('cmd_algo_crdt_orset_merge', { setJson, otherJson }, c => c.algoCrdtOrsetMerge(setJson, otherJson), { added: {}, removed: [], nodeId: '', counter: 0 } as ORSet, true)
}

export async function algoCrdtOrsetElements(setJson: string): Promise<string[]> {
  return algoCall('cmd_algo_crdt_orset_elements', { setJson }, c => c.algoCrdtOrsetElements(setJson), [] as string[], false)
}

export async function algoCrdtRgaNew(nodeId: string): Promise<RGA> {
  return algoCall('cmd_algo_crdt_rga_new', { nodeId }, c => c.algoCrdtRgaNew(nodeId), { nodes: {}, nodeId: '', counter: 0 } as RGA, true)
}

export async function algoCrdtRgaInsert(rgaJson: string, index: number, content: string): Promise<RGAInsertResult> {
  return algoCall('cmd_algo_crdt_rga_insert', { rgaJson, index, content }, c => c.algoCrdtRgaInsert(rgaJson, index, content), { rga: { nodes: {}, nodeId: '', counter: 0 }, insertedId: '' } as RGAInsertResult, false)
}

export async function algoCrdtRgaDelete(rgaJson: string, id: string): Promise<RGA> {
  return algoCall('cmd_algo_crdt_rga_delete', { rgaJson, id }, c => c.algoCrdtRgaDelete(rgaJson, id), { nodes: {}, nodeId: '', counter: 0 } as RGA, true)
}

export async function algoCrdtRgaMerge(rgaJson: string, otherJson: string): Promise<RGA> {
  return algoCall('cmd_algo_crdt_rga_merge', { rgaJson, otherJson }, c => c.algoCrdtRgaMerge(rgaJson, otherJson), { nodes: {}, nodeId: '', counter: 0 } as RGA, true)
}

export async function algoCrdtRgaText(rgaJson: string): Promise<string> {
  return algoCall('cmd_algo_crdt_rga_text', { rgaJson }, c => c.algoCrdtRgaText(rgaJson), '', false)
}

export async function algoCrdtVcCompare(clockAJson: string, clockBJson: string): Promise<VectorClockCompareResult> {
  return algoCall('cmd_algo_crdt_vc_compare', { clockAJson, clockBJson }, c => c.algoCrdtVcCompare(clockAJson, clockBJson), { happensBefore: false, isConcurrent: false }, false)
}

export async function algoTerrainNoise(x: number, y: number, config?: NoiseConfig): Promise<number> {
  return algoCall('cmd_algo_terrain_noise', { x, y, configJson: config ? JSON.stringify(config) : null }, c => c.algoTerrainNoise(x, y, config ? JSON.stringify(config) : undefined), 0, false)
}

export async function algoTerrainHeightmapGenerate(config: NoiseConfig | undefined, width: number, height: number, offsetX: number, offsetY: number): Promise<HeightMap> {
  return algoCall('cmd_algo_terrain_heightmap_generate', { configJson: config ? JSON.stringify(config) : null, width, height, offsetX, offsetY }, c => c.algoTerrainHeightmapGenerate(config ? JSON.stringify(config) : undefined, width, height, offsetX, offsetY), { width: 0, height: 0, data: [] } as HeightMap, true, 'algoTerrainHeightmapGenerate', [config ? JSON.stringify(config) : undefined, width, height, offsetX, offsetY])
}

export async function algoTerrainHeightmapSlope(heightmapJson: string, x: number, y: number): Promise<SlopeResult> {
  return algoCall('cmd_algo_terrain_heightmap_slope', { heightmapJson, x, y }, c => c.algoTerrainHeightmapSlope(heightmapJson, x, y), { dx: 0, dy: 0, magnitude: 0 }, false)
}

export async function algoTerrainHeightmapAspect(heightmapJson: string, x: number, y: number): Promise<number> {
  return algoCall('cmd_algo_terrain_heightmap_aspect', { heightmapJson, x, y }, c => c.algoTerrainHeightmapAspect(heightmapJson, x, y), 0, false)
}

export async function algoTerrainMarchingSquares(heightmapJson: string, levels: number[]): Promise<ContourLine[]> {
  return algoCall('cmd_algo_terrain_marching_squares', { heightmapJson, levelsJson: JSON.stringify(levels) }, c => c.algoTerrainMarchingSquares(heightmapJson, levels), [] as ContourLine[], false)
}

export async function algoConstraintSolve(systemJson: string, maxIterations: number, tolerance: number): Promise<ConstraintSolveOutput> {
  return algoCall('cmd_algo_constraint_solve', { systemJson, maxIterations, tolerance }, c => c.algoConstraintSolve(systemJson, maxIterations, tolerance), { result: { solved: false, iterations: 0, residual: 0, violations: [] }, system: { points: [], lines: [], constraints: [] } } as ConstraintSolveOutput, false, 'algoConstraintSolve', [systemJson, maxIterations, tolerance])
}

export async function algoDxfParse(content: string): Promise<DxfImportResult> {
  return algoCall('cmd_algo_dxf_parse', { content }, c => c.algoDxfParse(content), { entities: [], constraintSystem: { points: [], lines: [], constraints: [] }, layerNames: [], warnings: [] } as DxfImportResult, false, 'algoDxfParse', [content])
}

export async function algoDxfGenerate(entities: DxfEntity[]): Promise<string> {
  return algoCall('cmd_algo_dxf_generate', { entitiesJson: JSON.stringify(entities) }, c => c.algoDxfGenerate(JSON.stringify(entities)), '', false)
}

export async function algoDxfExtractConstraints(systemJson: string): Promise<Constraint[]> {
  return algoCall('cmd_algo_dxf_extract_constraints', { systemJson }, c => c.algoDxfExtractConstraints(systemJson), [] as Constraint[], false)
}

export async function algoPolygonBoolean(op: 'union' | 'intersection' | 'difference' | 'xor', a: Polygon2DResult, b: Polygon2DResult): Promise<Polygon2DResult[]> {
  return algoCall('cmd_algo_polygon_boolean', { op, aJson: JSON.stringify(a), bJson: JSON.stringify(b) }, c => c.algoPolygonBoolean(op, JSON.stringify(a), JSON.stringify(b)), [] as Polygon2DResult[], false, 'algoPolygonBoolean', [op, JSON.stringify(a), JSON.stringify(b)])
}

export async function algoPolygonOffset(polygon: Polygon2DResult, delta: number): Promise<Polygon2DResult> {
  return algoCall('cmd_algo_polygon_offset', { polygonJson: JSON.stringify(polygon), delta }, c => c.algoPolygonOffset(JSON.stringify(polygon), delta), { exterior: [], interiors: [] } as Polygon2DResult, true)
}

export async function algoPolygonSimplify(polygon: Polygon2DResult, epsilon: number): Promise<Polygon2DResult> {
  return algoCall('cmd_algo_polygon_simplify', { polygonJson: JSON.stringify(polygon), epsilon }, c => c.algoPolygonSimplify(JSON.stringify(polygon), epsilon), { exterior: [], interiors: [] } as Polygon2DResult, true)
}

export async function algoLineLength(points: Point2D[]): Promise<number> {
  return algoCall('cmd_algo_line_length', { pointsJson: JSON.stringify(points) }, c => c.algoLineLength(JSON.stringify(points)), 0, false)
}

export async function algoPageRank(graphJson: string, damping: number, maxIterations: number, tolerance: number): Promise<PageRankResult> {
  return algoCall('cmd_algo_pagerank', { graphJson, damping, maxIterations, tolerance }, c => c.algoPageRank(graphJson, damping, maxIterations, tolerance), { scores: {}, iterations: 0, converged: false }, false, 'algoPageRank', [graphJson, damping, maxIterations, tolerance])
}

export async function algoCommunityDetection(graphJson: string): Promise<CommunityDetectionResult> {
  return algoCall('cmd_algo_community_detection', { graphJson }, c => c.algoCommunityDetection(graphJson), { communities: [], modularity: 0 }, false, 'algoCommunityDetection', [graphJson])
}

export async function algoBetweennessCentrality(graphJson: string): Promise<BetweennessResult> {
  return algoCall('cmd_algo_betweenness_centrality', { graphJson }, c => c.algoBetweennessCentrality(graphJson), { betweenness: {} }, false, 'algoBetweennessCentrality', [graphJson])
}

export async function algoHydraulicErosion(heightmapJson: string, config?: ErosionConfig): Promise<HeightMap> {
  return algoCall('cmd_algo_hydraulic_erosion', { heightmapJson, configJson: config ? JSON.stringify(config) : null }, c => c.algoHydraulicErosion(heightmapJson, config ? JSON.stringify(config) : undefined), { width: 0, height: 0, data: [] } as HeightMap, true, 'algoHydraulicErosion', [heightmapJson, config ? JSON.stringify(config) : undefined])
}

export async function algoViewshed(heightmapJson: string, observerX: number, observerY: number, observerHeight: number, radius: number): Promise<ViewshedResult> {
  return algoCall('cmd_algo_viewshed', { heightmapJson, observerX, observerY, observerHeight, radius }, c => c.algoViewshed(heightmapJson, observerX, observerY, observerHeight, radius), { visible: [], width: 0, height: 0 }, false, 'algoViewshed', [heightmapJson, observerX, observerY, observerHeight, radius])
}

export async function algoChaikinSmooth(vertices: Point2D[], iterations: number): Promise<Point2D[]> {
  return algoCall('cmd_algo_chaikin_smooth', { verticesJson: JSON.stringify(vertices), iterations }, c => c.algoChaikinSmooth(JSON.stringify(vertices), iterations), [] as Point2D[], true)
}

export async function algoFindSharedEdges(verticesA: Point2D[], verticesB: Point2D[], threshold: number): Promise<SharedEdge[]> {
  return algoCall('cmd_algo_find_shared_edges', { verticesAJson: JSON.stringify(verticesA), verticesBJson: JSON.stringify(verticesB), threshold }, c => c.algoFindSharedEdges(JSON.stringify(verticesA), JSON.stringify(verticesB), threshold), [] as SharedEdge[], false)
}

export async function algoFindLinePolygonIntersections(line: Point2D[], polygon: Point2D[]): Promise<LinePolygonIntersection[]> {
  return algoCall('cmd_algo_find_line_polygon_intersections', { lineJson: JSON.stringify(line), polygonJson: JSON.stringify(polygon) }, c => c.algoFindLinePolygonIntersections(JSON.stringify(line), JSON.stringify(polygon)), [] as LinePolygonIntersection[], false)
}

export async function algoPolygonSplit(polygon: Point2D[], cuttingLine: Point2D[]): Promise<Point2D[][]> {
  return algoCall('cmd_algo_polygon_split', { polygonJson: JSON.stringify(polygon), cuttingLineJson: JSON.stringify(cuttingLine) }, c => c.algoPolygonSplit(JSON.stringify(polygon), JSON.stringify(cuttingLine)), [] as Point2D[][], false)
}

export async function algoPolygonAugment(polygon: Point2D[], addingLine: Point2D[]): Promise<Point2D[]> {
  return algoCall('cmd_algo_polygon_augment', { polygonJson: JSON.stringify(polygon), addingLineJson: JSON.stringify(addingLine) }, c => c.algoPolygonAugment(JSON.stringify(polygon), JSON.stringify(addingLine)), [] as Point2D[], true)
}
