import type { LibraryDescriptor, CapabilityDeclaration } from '@worldsea/agent-runtime/toolbus/capability-types'
import type { IToolContext } from '@worldsea/agent-runtime/toolbus/types'
import type { ToolParameter } from '@worldsea/agent-runtime/bridge-types'
import {
  algoList,
  algoRun,
  algoSpatialInsert,
  algoSpatialQuery,
  algoSpatialClear,
  algoSegmentIntersect,
  algoFindIntersections,
  algoPointInPolygon,
  algoPolygonMetrics,
  algoConvexHull,
  algoCollisionCheck,
  algoPolygonBoolean,
  algoPolygonOffset,
  algoShortestPath,
  algoKShortestPaths,
  algoTopologicalSort,
  algoGraphAnalysis,
  algoForceLayout,
  algoPageRank,
  algoCommunityDetection,
  algoTerrainNoise,
  algoTerrainHeightmap,
  algoTerrainContour,
  algoHydraulicErosion,
  algoViewshed,
  algoCrdtLww,
  algoCrdtOrset,
  algoCrdtRga,
  algoCrdtVectorClock,
  algoConstraintSolve,
  algoDxfParse,
  algoDxfGenerate,
  algoDxfExtractConstraints,
  algoChaikinSmooth,
  algoFindSharedEdges,
  algoFindLinePolygonIntersections,
  algoPolygonSplit,
  algoPolygonAugment,
} from '@worldsea/agent-runtime/tools/algo-tools'

const WASM_AVAILABILITY: { platforms: ('web' | 'tauri')[]; chain: ('internal')[]; requiresWasm: boolean } = {
  platforms: ['web', 'tauri'],
  chain: ['internal'],
  requiresWasm: true,
}

function delegate(tool: { execute: (args: Record<string, unknown>, ctx: IToolContext) => Promise<string> }) {
  return async (args: Record<string, unknown>, ctx: IToolContext) => tool.execute(args, ctx)
}

const algoListCap: CapabilityDeclaration = {
  id: 'algo.list',
  name: '列出可用算法',
  description: '列出所有可用的算法名称、参数格式和返回格式。使用场景：在使用 algo.run 之前查看可用算法和参数要求。',
  category: 'query',
  parameters: {},
  availability: { ...WASM_AVAILABILITY },
  execute: delegate(algoList),
}

const algoRunCap: CapabilityDeclaration = {
  id: 'algo.run',
  name: '执行算法',
  description: '执行 Rust 核心库中的算法。先用 algo.list 查看可用算法列表和参数格式。参数以 JSON 传递，返回 JSON 结果。',
  category: 'transform',
  parameters: {
    algorithm: { type: 'string', description: '算法名称，如 "dijkstra_path"、"convex_hull"、"terrain_noise"', required: true } satisfies ToolParameter,
    paramsJson: { type: 'string', description: '算法参数 JSON，格式因算法而异', required: true } satisfies ToolParameter,
  },
  availability: { ...WASM_AVAILABILITY },
  execute: delegate(algoRun),
}

const algoSpatialQueryCap: CapabilityDeclaration = {
  id: 'algo.spatial.query',
  name: '空间索引操作',
  description: '空间索引操作（插入/查询/清空）。将图元插入 R-Tree 空间索引，支持范围查询、精确点查询、最近邻、K 最近邻、按分类查询，以及清空索引。',
  category: 'query',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "insert"（插入图元）、"query"（查询空间索引）、"clear"（清空索引）',
      required: true,
      enum: ['insert', 'query', 'clear'],
    } satisfies ToolParameter,
    items: { type: 'array', description: '图元数组（insert 操作时需要）', required: false } satisfies ToolParameter,
    type: { type: 'string', description: '图元类型: "rect" 或 "point"（insert 操作时需要）', required: false, enum: ['rect', 'point'] } satisfies ToolParameter,
    queryType: { type: 'string', description: '查询类型: "range"/"atPoint"/"nearest"/"kNearest"/"byCategory"（query 操作时需要）', required: false, enum: ['range', 'atPoint', 'nearest', 'kNearest', 'byCategory'] } satisfies ToolParameter,
    min: { type: 'array', description: '范围查询最小坐标 [x,y]', required: false } satisfies ToolParameter,
    max: { type: 'array', description: '范围查询最大坐标 [x,y]', required: false } satisfies ToolParameter,
    point: { type: 'array', description: '查询点坐标 [x,y]', required: false } satisfies ToolParameter,
    k: { type: 'number', description: 'K 最近邻的 K 值', required: false } satisfies ToolParameter,
    category: { type: 'string', description: '分类名称（byCategory 查询时需要）', required: false } satisfies ToolParameter,
  },
  availability: { ...WASM_AVAILABILITY },
  execute: async (args, ctx) => {
    const op = String(args.operation)
    if (op === 'insert') return algoSpatialInsert.execute(args, ctx)
    if (op === 'query') return algoSpatialQuery.execute(args, ctx)
    if (op === 'clear') return algoSpatialClear.execute(args, ctx)
    return JSON.stringify({ ok: false, error: `unknown operation: ${op}` })
  },
}

const algoGeometryComputeCap: CapabilityDeclaration = {
  id: 'algo.geometry.compute',
  name: '几何计算',
  description: '几何计算：线段相交检测、批量交点、点在多边形内判断、凸包、碰撞检测(AABB/OBB)、多边形度量(面积/质心/周长)、布尔运算、偏移。',
  category: 'transform',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "segmentIntersect"/"findIntersections"/"pointInPolygon"/"polygonMetrics"/"convexHull"/"collisionCheck"/"polygonBoolean"/"polygonOffset"',
      required: true,
      enum: ['segmentIntersect', 'findIntersections', 'pointInPolygon', 'polygonMetrics', 'convexHull', 'collisionCheck', 'polygonBoolean', 'polygonOffset'],
    } satisfies ToolParameter,
    seg1: { type: 'object', description: '第一条线段 { start: {x,y}, end: {x,y} }（segmentIntersect）', required: false } satisfies ToolParameter,
    seg2: { type: 'object', description: '第二条线段 { start: {x,y}, end: {x,y} }（segmentIntersect）', required: false } satisfies ToolParameter,
    segments: { type: 'array', description: '线段数组（findIntersections）', required: false } satisfies ToolParameter,
    point: { type: 'object', description: '待判断的点 { x, y }（pointInPolygon）', required: false } satisfies ToolParameter,
    vertices: { type: 'array', description: '多边形顶点数组 [{x,y}]（pointInPolygon/polygonMetrics）', required: false } satisfies ToolParameter,
    points: { type: 'array', description: '点集数组 [{x,y}]（convexHull）', required: false } satisfies ToolParameter,
    a: { type: 'object', description: '第一个包围盒（collisionCheck）', required: false } satisfies ToolParameter,
    b: { type: 'object', description: '第二个包围盒（collisionCheck）', required: false } satisfies ToolParameter,
    collisionType: { type: 'string', description: '包围盒类型: "aabb" 或 "obb"（collisionCheck）', required: false, enum: ['aabb', 'obb'] } satisfies ToolParameter,
    op: { type: 'string', description: '布尔运算类型: "union"/"intersection"/"difference"/"xor"（polygonBoolean）', required: false, enum: ['union', 'intersection', 'difference', 'xor'] } satisfies ToolParameter,
    aJson: { type: 'string', description: '多边形 A JSON（polygonBoolean）', required: false } satisfies ToolParameter,
    bJson: { type: 'string', description: '多边形 B JSON（polygonBoolean）', required: false } satisfies ToolParameter,
    polygonJson: { type: 'string', description: '多边形 JSON（polygonOffset）', required: false } satisfies ToolParameter,
    delta: { type: 'number', description: '偏移距离（polygonOffset）', required: false } satisfies ToolParameter,
  },
  availability: { ...WASM_AVAILABILITY },
  execute: async (args, ctx) => {
    const op = String(args.operation)
    switch (op) {
      case 'segmentIntersect': return algoSegmentIntersect.execute(args, ctx)
      case 'findIntersections': return algoFindIntersections.execute(args, ctx)
      case 'pointInPolygon': return algoPointInPolygon.execute(args, ctx)
      case 'polygonMetrics': return algoPolygonMetrics.execute(args, ctx)
      case 'convexHull': return algoConvexHull.execute(args, ctx)
      case 'collisionCheck': return algoCollisionCheck.execute({ ...args, type: args.collisionType }, ctx)
      case 'polygonBoolean': return algoPolygonBoolean.execute(args, ctx)
      case 'polygonOffset': return algoPolygonOffset.execute(args, ctx)
      default: return JSON.stringify({ ok: false, error: `unknown operation: ${op}` })
    }
  },
}

const algoGraphAnalyzeCap: CapabilityDeclaration = {
  id: 'algo.graph.analyze',
  name: '图分析',
  description: '图分析：最短路径(Dijkstra/A*)、K 最短路径(Yen)、拓扑排序、图结构分析(连通分量/强连通分量/悬空引用)、力导向布局、PageRank、社群发现(Louvain)。',
  category: 'transform',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "shortestPath"/"kShortestPaths"/"topologicalSort"/"graphAnalysis"/"forceLayout"/"pagerank"/"communityDetection"',
      required: true,
      enum: ['shortestPath', 'kShortestPaths', 'topologicalSort', 'graphAnalysis', 'forceLayout', 'pagerank', 'communityDetection'],
    } satisfies ToolParameter,
    graph: { type: 'object', description: '图的邻接表（shortestPath/kShortestPaths/topologicalSort/graphAnalysis/forceLayout）', required: false } satisfies ToolParameter,
    source: { type: 'string', description: '起点节点 ID（shortestPath/kShortestPaths）', required: false } satisfies ToolParameter,
    target: { type: 'string', description: '终点节点 ID（shortestPath/kShortestPaths）', required: false } satisfies ToolParameter,
    algorithm: { type: 'string', description: '算法选择: "dijkstra" 或 "astar"（shortestPath）', required: false, enum: ['dijkstra', 'astar'] } satisfies ToolParameter,
    heuristic: { type: 'object', description: 'A* 启发函数映射（shortestPath, astar）', required: false } satisfies ToolParameter,
    k: { type: 'number', description: 'K 值（kShortestPaths）', required: false } satisfies ToolParameter,
    analysisType: { type: 'string', description: '分析类型: "components"/"scc"/"dangling"（graphAnalysis）', required: false, enum: ['components', 'scc', 'dangling'] } satisfies ToolParameter,
    config: { type: 'object', description: '布局配置（forceLayout）', required: false } satisfies ToolParameter,
    graphJson: { type: 'string', description: '加权图 JSON（pagerank/communityDetection）', required: false } satisfies ToolParameter,
    damping: { type: 'number', description: '阻尼因子（pagerank，默认 0.85）', required: false } satisfies ToolParameter,
    maxIterations: { type: 'number', description: '最大迭代次数（pagerank）', required: false } satisfies ToolParameter,
    tolerance: { type: 'number', description: '收敛容差（pagerank）', required: false } satisfies ToolParameter,
  },
  availability: { ...WASM_AVAILABILITY },
  execute: async (args, ctx) => {
    const op = String(args.operation)
    switch (op) {
      case 'shortestPath': return algoShortestPath.execute(args, ctx)
      case 'kShortestPaths': return algoKShortestPaths.execute(args, ctx)
      case 'topologicalSort': return algoTopologicalSort.execute(args, ctx)
      case 'graphAnalysis': return algoGraphAnalysis.execute(args, ctx)
      case 'forceLayout': return algoForceLayout.execute(args, ctx)
      case 'pagerank': return algoPageRank.execute(args, ctx)
      case 'communityDetection': return algoCommunityDetection.execute(args, ctx)
      default: return JSON.stringify({ ok: false, error: `unknown operation: ${op}` })
    }
  },
}

const algoTerrainGenerateCap: CapabilityDeclaration = {
  id: 'algo.terrain.generate',
  name: '地形生成',
  description: '地形生成与分析：值噪声(fBm)、高度图生成/坡度/坡向、等高线(Marching Squares)、水文侵蚀模拟、视域分析。',
  category: 'transform',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "noise"/"heightmap"/"contour"/"hydraulicErosion"/"viewshed"',
      required: true,
      enum: ['noise', 'heightmap', 'contour', 'hydraulicErosion', 'viewshed'],
    } satisfies ToolParameter,
    x: { type: 'number', description: 'X 坐标（noise）', required: false } satisfies ToolParameter,
    y: { type: 'number', description: 'Y 坐标（noise）', required: false } satisfies ToolParameter,
    config: { type: 'object', description: '噪声/侵蚀配置（noise/heightmap/hydraulicErosion）', required: false } satisfies ToolParameter,
    heightmapOperation: { type: 'string', description: '高度图操作: "generate"/"slope"/"aspect"（heightmap）', required: false, enum: ['generate', 'slope', 'aspect'] } satisfies ToolParameter,
    width: { type: 'number', description: '高度图宽度（heightmap generate）', required: false } satisfies ToolParameter,
    height: { type: 'number', description: '高度图高度（heightmap generate）', required: false } satisfies ToolParameter,
    offsetX: { type: 'number', description: 'X 偏移量（heightmap generate）', required: false } satisfies ToolParameter,
    offsetY: { type: 'number', description: 'Y 偏移量（heightmap generate）', required: false } satisfies ToolParameter,
    heightmapJson: { type: 'string', description: '高度图 JSON（contour/slope/aspect/erosion/viewshed）', required: false } satisfies ToolParameter,
    levels: { type: 'array', description: '高度等级数组（contour）', required: false } satisfies ToolParameter,
    observerX: { type: 'number', description: '观察者 X 坐标（viewshed）', required: false } satisfies ToolParameter,
    observerY: { type: 'number', description: '观察者 Y 坐标（viewshed）', required: false } satisfies ToolParameter,
    observerHeight: { type: 'number', description: '观察者离地高度（viewshed）', required: false } satisfies ToolParameter,
    radius: { type: 'number', description: '可视半径（viewshed）', required: false } satisfies ToolParameter,
  },
  availability: { ...WASM_AVAILABILITY },
  execute: async (args, ctx) => {
    const op = String(args.operation)
    switch (op) {
      case 'noise': return algoTerrainNoise.execute(args, ctx)
      case 'heightmap': return algoTerrainHeightmap.execute({ ...args, operation: args.heightmapOperation }, ctx)
      case 'contour': return algoTerrainContour.execute(args, ctx)
      case 'hydraulicErosion': return algoHydraulicErosion.execute(args, ctx)
      case 'viewshed': return algoViewshed.execute(args, ctx)
      default: return JSON.stringify({ ok: false, error: `unknown operation: ${op}` })
    }
  },
}

const algoCrdtOperationCap: CapabilityDeclaration = {
  id: 'algo.crdt.operation',
  name: 'CRDT 操作',
  description: 'CRDT 操作：LWW 寄存器(创建/设置/合并)、OR-Set(创建/添加/删除/合并/获取元素)、RGA(创建/插入/删除/合并/获取文本)、向量时钟比较。',
  category: 'transform',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "lww"/"orset"/"rga"/"vectorClock"',
      required: true,
      enum: ['lww', 'orset', 'rga', 'vectorClock'],
    } satisfies ToolParameter,
    crdtOperation: { type: 'string', description: 'CRDT 子操作（lww: new/set/merge; orset: new/add/remove/merge/elements; rga: new/insert/delete/merge/text）', required: false } satisfies ToolParameter,
    registerJson: { type: 'string', description: '当前寄存器 JSON（lww set/merge）', required: false } satisfies ToolParameter,
    value: { type: 'string', description: '值（lww new/set; orset add/remove）', required: false } satisfies ToolParameter,
    nodeId: { type: 'string', description: '节点 ID（lww/orset/rga new）', required: false } satisfies ToolParameter,
    timestamp: { type: 'number', description: '时间戳（lww set）', required: false } satisfies ToolParameter,
    otherJson: { type: 'string', description: '合并目标 JSON（lww/orset/rga merge）', required: false } satisfies ToolParameter,
    setJson: { type: 'string', description: '当前集合 JSON（orset add/remove/merge/elements）', required: false } satisfies ToolParameter,
    element: { type: 'string', description: '元素（orset add/remove）', required: false } satisfies ToolParameter,
    rgaJson: { type: 'string', description: '当前 RGA JSON（rga insert/delete/merge/text）', required: false } satisfies ToolParameter,
    index: { type: 'number', description: '插入位置（rga insert）', required: false } satisfies ToolParameter,
    content: { type: 'string', description: '插入内容（rga insert）', required: false } satisfies ToolParameter,
    id: { type: 'string', description: '删除节点 ID（rga delete）', required: false } satisfies ToolParameter,
    clockAJson: { type: 'string', description: '向量时钟 A JSON（vectorClock）', required: false } satisfies ToolParameter,
    clockBJson: { type: 'string', description: '向量时钟 B JSON（vectorClock）', required: false } satisfies ToolParameter,
  },
  availability: { ...WASM_AVAILABILITY },
  execute: async (args, ctx) => {
    const op = String(args.operation)
    switch (op) {
      case 'lww': return algoCrdtLww.execute({ ...args, operation: args.crdtOperation }, ctx)
      case 'orset': return algoCrdtOrset.execute({ ...args, operation: args.crdtOperation }, ctx)
      case 'rga': return algoCrdtRga.execute({ ...args, operation: args.crdtOperation }, ctx)
      case 'vectorClock': return algoCrdtVectorClock.execute({ clockAJson: args.clockAJson, clockBJson: args.clockBJson }, ctx)
      default: return JSON.stringify({ ok: false, error: `unknown operation: ${op}` })
    }
  },
}

const algoCadOperationCap: CapabilityDeclaration = {
  id: 'algo.cad.operation',
  name: 'CAD 操作',
  description: 'CAD 操作：几何约束求解(迭代投影法)、DXF 解析/生成/约束提取。支持 FixedPoint/Horizontal/Vertical/Parallel/Perpendicular/EqualLength/Distance/Angle/Coincident 约束类型。',
  category: 'transform',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "constraintSolve"/"dxfParse"/"dxfGenerate"/"dxfExtractConstraints"',
      required: true,
      enum: ['constraintSolve', 'dxfParse', 'dxfGenerate', 'dxfExtractConstraints'],
    } satisfies ToolParameter,
    systemJson: { type: 'string', description: '约束系统 JSON（constraintSolve/dxfExtractConstraints）', required: true } satisfies ToolParameter,
    maxIterations: { type: 'number', description: '最大迭代次数（constraintSolve，默认 200）', required: false } satisfies ToolParameter,
    tolerance: { type: 'number', description: '收敛容差（constraintSolve，默认 0.001）', required: false } satisfies ToolParameter,
    content: { type: 'string', description: 'DXF 文件内容（dxfParse）', required: false } satisfies ToolParameter,
    entitiesJson: { type: 'string', description: '实体列表 JSON（dxfGenerate）', required: false } satisfies ToolParameter,
  },
  availability: { ...WASM_AVAILABILITY },
  execute: async (args, ctx) => {
    const op = String(args.operation)
    switch (op) {
      case 'constraintSolve': return algoConstraintSolve.execute(args, ctx)
      case 'dxfParse': return algoDxfParse.execute(args, ctx)
      case 'dxfGenerate': return algoDxfGenerate.execute(args, ctx)
      case 'dxfExtractConstraints': return algoDxfExtractConstraints.execute(args, ctx)
      default: return JSON.stringify({ ok: false, error: `unknown operation: ${op}` })
    }
  },
}

const algoPolygonAdvancedCap: CapabilityDeclaration = {
  id: 'algo.polygon.advanced',
  name: '高级多边形操作',
  description: '高级多边形操作：Chaikin 曲线平滑、共享边检测、线-多边形交点计算、多边形切割、多边形增补。',
  category: 'transform',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "chaikinSmooth"/"findSharedEdges"/"findLinePolygonIntersections"/"polygonSplit"/"polygonAugment"',
      required: true,
      enum: ['chaikinSmooth', 'findSharedEdges', 'findLinePolygonIntersections', 'polygonSplit', 'polygonAugment'],
    } satisfies ToolParameter,
    vertices: { type: 'array', description: '多边形顶点数组 [{x,y}]（chaikinSmooth）', required: false } satisfies ToolParameter,
    iterations: { type: 'number', description: '平滑迭代次数（chaikinSmooth，默认 2）', required: false } satisfies ToolParameter,
    verticesA: { type: 'array', description: '多边形 A 顶点数组 [{x,y}]（findSharedEdges）', required: false } satisfies ToolParameter,
    verticesB: { type: 'array', description: '多边形 B 顶点数组 [{x,y}]（findSharedEdges）', required: false } satisfies ToolParameter,
    threshold: { type: 'number', description: '共享边判定距离阈值（findSharedEdges，默认 8）', required: false } satisfies ToolParameter,
    line: { type: 'array', description: '折线顶点数组 [{x,y}]（findLinePolygonIntersections/polygonSplit/polygonAugment 的切割线或添加线）', required: false } satisfies ToolParameter,
    polygon: { type: 'array', description: '多边形顶点数组 [{x,y}]（findLinePolygonIntersections/polygonSplit/polygonAugment）', required: false } satisfies ToolParameter,
    cuttingLine: { type: 'array', description: '切割线顶点数组 [{x,y}]（polygonSplit）', required: false } satisfies ToolParameter,
    addingLine: { type: 'array', description: '添加线顶点数组 [{x,y}]（polygonAugment）', required: false } satisfies ToolParameter,
  },
  availability: { ...WASM_AVAILABILITY },
  execute: async (args, ctx) => {
    const op = String(args.operation)
    switch (op) {
      case 'chaikinSmooth': return algoChaikinSmooth.execute(args, ctx)
      case 'findSharedEdges': return algoFindSharedEdges.execute(args, ctx)
      case 'findLinePolygonIntersections': return algoFindLinePolygonIntersections.execute(args, ctx)
      case 'polygonSplit': return algoPolygonSplit.execute(args, ctx)
      case 'polygonAugment': return algoPolygonAugment.execute(args, ctx)
      default: return JSON.stringify({ ok: false, error: `unknown operation: ${op}` })
    }
  },
}

export const canvasEngineDescriptor: LibraryDescriptor = {
  id: '@worldsea/canvas-engine',
  name: 'Canvas Engine',
  version: '0.1.0',
  capabilities: [
    algoListCap,
    algoRunCap,
    algoSpatialQueryCap,
    algoGeometryComputeCap,
    algoGraphAnalyzeCap,
    algoTerrainGenerateCap,
    algoCrdtOperationCap,
    algoCadOperationCap,
    algoPolygonAdvancedCap,
  ],
}
