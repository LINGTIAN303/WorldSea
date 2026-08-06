import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'

/** 算法工具集：Tauri 调用 Rust 算法引擎（空间/几何/图/CRDT/地形等），详细见 docs/details/注释/packages/agent-runtime/tools-algo-tools.md */

async function invokeTauri(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}

export const algoSpatialInsert: ToolDefinition = {
  name: 'algo_spatial_insert',
  description: '将图元（矩形或点）插入空间索引（R-Tree）。用于在画布上注册墙体、家具、节点等图元的位置，以便后续快速空间查询。type="rect" 时 items 中每项需含 min/max 坐标数组；type="point" 时每项需含 coord 坐标数组。每项均可携带 category 字段用于分类过滤。',
  parameters: {
    items: {
      type: 'array',
      description: '图元数组。矩形图元格式: { id, min: [x,y], max: [x,y], category }；点图元格式: { id, coord: [x,y], category }',
      required: true,
    },
    type: {
      type: 'string',
      description: '图元类型: "rect"（矩形）或 "point"（点）',
      required: true,
      enum: ['rect', 'point'],
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_spatial_insert', {
        items: args.items,
        type: String(args.type),
      })
      return JSON.stringify({ ok: true, result, message: `已插入 ${(args.items as unknown[]).length} 个${args.type === 'rect' ? '矩形' : '点'}图元` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '空间图元插入失败' })
    }
  },
}

export const algoSpatialQuery: ToolDefinition = {
  name: 'algo_spatial_query',
  description: '查询空间索引。支持五种查询类型：range（范围查询，需 min/max）、atPoint（精确点查询，需 point）、nearest（最近邻查询，需 point）、kNearest（K 最近邻查询，需 point 和 k）、byCategory（按分类查询，需 category）。用于查找画布上与某区域或位置相关的图元。',
  parameters: {
    queryType: {
      type: 'string',
      description: '查询类型: "range"（范围查询）、"atPoint"（精确点查询）、"nearest"（最近邻）、"kNearest"（K 最近邻）、"byCategory"（按分类查询）',
      required: true,
      enum: ['range', 'atPoint', 'nearest', 'kNearest', 'byCategory'],
    },
    min: {
      type: 'array',
      description: '范围查询的最小坐标 [x,y]，仅 queryType="range" 时需要',
      required: false,
    },
    max: {
      type: 'array',
      description: '范围查询的最大坐标 [x,y]，仅 queryType="range" 时需要',
      required: false,
    },
    point: {
      type: 'array',
      description: '查询点坐标 [x,y]，用于 atPoint/nearest/kNearest 查询',
      required: false,
    },
    k: {
      type: 'number',
      description: 'K 最近邻的 K 值，仅 queryType="kNearest" 时需要',
      required: false,
    },
    category: {
      type: 'string',
      description: '分类名称，仅 queryType="byCategory" 时需要',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const payload: Record<string, unknown> = { queryType: String(args.queryType) }
      if (args.min !== undefined) payload.min = args.min
      if (args.max !== undefined) payload.max = args.max
      if (args.point !== undefined) payload.point = args.point
      if (args.k !== undefined) payload.k = Number(args.k)
      if (args.category !== undefined) payload.category = String(args.category)
      const result = await invokeTauri('cmd_algo_spatial_query', payload)
      return JSON.stringify({ ok: true, result, message: `空间查询完成 (${args.queryType})` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '空间查询失败' })
    }
  },
}

export const algoSpatialClear: ToolDefinition = {
  name: 'algo_spatial_clear',
  description: '清空空间索引。移除所有已插入的图元，释放索引资源。在重新构建场景或切换项目时使用。',
  parameters: {},
  execute: async () => {
    try {
      await invokeTauri('cmd_algo_spatial_clear')
      return JSON.stringify({ ok: true, message: '空间索引已清空' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '清空空间索引失败' })
    }
  },
}

export const algoSegmentIntersect: ToolDefinition = {
  name: 'algo_segment_intersect',
  description: '检测两条线段是否相交。输入两条线段的起止点，返回是否相交及交点坐标。用于判断墙体是否交叉、路径是否重叠等几何判断场景。',
  parameters: {
    seg1: {
      type: 'object',
      description: '第一条线段，格式: { start: {x, y}, end: {x, y} }',
      required: true,
    },
    seg2: {
      type: 'object',
      description: '第二条线段，格式: { start: {x, y}, end: {x, y} }',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_segment_intersect', {
        seg1: args.seg1,
        seg2: args.seg2,
      })
      return JSON.stringify({ ok: true, result, message: '线段相交检测完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '线段相交检测失败' })
    }
  },
}

export const algoFindIntersections: ToolDefinition = {
  name: 'algo_find_intersections',
  description: '批量检测线段集合中所有交点。使用扫描线算法高效计算，返回所有相交线段对及交点坐标。用于检测墙体碰撞、管网交叉等批量几何冲突场景。',
  parameters: {
    segments: {
      type: 'array',
      description: '线段数组，每条线段格式: { start: {x, y}, end: {x, y} }',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_find_intersections', {
        segments: args.segments,
      })
      return JSON.stringify({ ok: true, result, message: `批量交点检测完成，共 ${(args.segments as unknown[]).length} 条线段` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '批量交点检测失败' })
    }
  },
}

export const algoPointInPolygon: ToolDefinition = {
  name: 'algo_point_in_polygon',
  description: '判断点是否在多边形内部。使用射线法（Ray Casting）算法，支持凹多边形。用于判断角色是否在房间内、点击是否落在区域内等空间归属判断场景。',
  parameters: {
    point: {
      type: 'object',
      description: '待判断的点，格式: { x, y }',
      required: true,
    },
    vertices: {
      type: 'array',
      description: '多边形顶点数组，按顺序排列，每项格式: { x, y }',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_point_in_polygon', {
        point: args.point,
        vertices: args.vertices,
      })
      return JSON.stringify({ ok: true, result, message: '点在多边形内判断完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '点在多边形内判断失败' })
    }
  },
}

export const algoPolygonMetrics: ToolDefinition = {
  name: 'algo_polygon_metrics',
  description: '计算多边形的面积、质心和周长。支持凹多边形，使用 Shoelace 公式计算面积。用于房间面积统计、区域中心定位、边界长度计算等场景。',
  parameters: {
    vertices: {
      type: 'array',
      description: '多边形顶点数组，按顺序排列，每项格式: { x, y }',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_polygon_metrics', {
        vertices: args.vertices,
      })
      return JSON.stringify({ ok: true, result, message: '多边形度量计算完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '多边形度量计算失败' })
    }
  },
}

export const algoConvexHull: ToolDefinition = {
  name: 'algo_convex_hull',
  description: '计算点集的凸包。使用 Graham Scan 或 Andrew 单调链算法，返回按顺序排列的凸包顶点。用于确定点集的外围边界、碰撞检测包围盒优化、区域轮廓提取等场景。',
  parameters: {
    points: {
      type: 'array',
      description: '点集数组，每项格式: { x, y }',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_convex_hull', {
        points: args.points,
      })
      return JSON.stringify({ ok: true, result, message: `凸包计算完成，输入 ${(args.points as unknown[]).length} 个点` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '凸包计算失败' })
    }
  },
}

export const algoCollisionCheck: ToolDefinition = {
  name: 'algo_collision_check',
  description: 'AABB/OBB 碰撞检测。检测两个包围盒是否发生碰撞。type="aabb" 时输入轴对齐包围盒（含 min/max 坐标），type="obb" 时输入有向包围盒（含 center/axes/halfExtents）。用于物理碰撞预检、家具摆放冲突检测、角色移动阻挡判断等场景。',
  parameters: {
    a: {
      type: 'object',
      description: '第一个包围盒。AABB 格式: { min: {x,y}, max: {x,y} }；OBB 格式: { center: {x,y}, axes: [[ax,ay],[bx,by]], halfExtents: [hx,hy] }',
      required: true,
    },
    b: {
      type: 'object',
      description: '第二个包围盒，格式同 a',
      required: true,
    },
    type: {
      type: 'string',
      description: '包围盒类型: "aabb"（轴对齐）或 "obb"（有向）',
      required: true,
      enum: ['aabb', 'obb'],
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_collision_check', {
        a: args.a,
        b: args.b,
        type: String(args.type),
      })
      return JSON.stringify({ ok: true, result, message: `${String(args.type).toUpperCase()} 碰撞检测完成` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '碰撞检测失败' })
    }
  },
}

export const algoShortestPath: ToolDefinition = {
  name: 'algo_shortest_path',
  description: '在带权图中搜索最短路径。支持 Dijkstra（无启发，保证最短）和 A*（带启发函数，更快但需合理启发）算法。用于知识图谱关系链搜索、地形路径规划、任务依赖链分析等场景。graph 为邻接表格式，每条边需含 weight 字段。',
  parameters: {
    graph: {
      type: 'object',
      description: '图的邻接表，格式: { [nodeId]: [{ target: string, weight: number }] }',
      required: true,
    },
    source: {
      type: 'string',
      description: '起点节点 ID',
      required: true,
    },
    target: {
      type: 'string',
      description: '终点节点 ID',
      required: true,
    },
    algorithm: {
      type: 'string',
      description: '算法选择: "dijkstra"（无启发，保证最短）或 "astar"（带启发，更快）',
      required: true,
      enum: ['dijkstra', 'astar'],
    },
    heuristic: {
      type: 'object',
      description: 'A* 启发函数映射，格式: { [nodeId]: estimatedCostToTarget }。仅 algorithm="astar" 时使用',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const payload: Record<string, unknown> = {
        graph: args.graph,
        source: String(args.source),
        target: String(args.target),
        algorithm: String(args.algorithm),
      }
      if (args.heuristic !== undefined) payload.heuristic = args.heuristic
      const result = await invokeTauri('cmd_algo_shortest_path', payload)
      return JSON.stringify({ ok: true, result, message: `最短路径搜索完成 (${args.algorithm})` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '最短路径搜索失败' })
    }
  },
}

export const algoKShortestPaths: ToolDefinition = {
  name: 'algo_k_shortest_paths',
  description: '在带权图中搜索 K 条最短路径（Yen 算法）。返回按路径长度排序的前 K 条不重复路径及其总权重。用于提供备选路线、多方案路径规划、冗余链路分析等场景。',
  parameters: {
    graph: {
      type: 'object',
      description: '图的邻接表，格式: { [nodeId]: [{ target: string, weight: number }] }',
      required: true,
    },
    source: {
      type: 'string',
      description: '起点节点 ID',
      required: true,
    },
    target: {
      type: 'string',
      description: '终点节点 ID',
      required: true,
    },
    k: {
      type: 'number',
      description: '需要返回的路径数量',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_k_shortest_paths', {
        graph: args.graph,
        source: String(args.source),
        target: String(args.target),
        k: Number(args.k),
      })
      return JSON.stringify({ ok: true, result, message: `K 最短路径搜索完成 (k=${args.k})` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: 'K 最短路径搜索失败' })
    }
  },
}

export const algoTopologicalSort: ToolDefinition = {
  name: 'algo_topological_sort',
  description: '对有向图进行拓扑排序。返回节点的线性排列，使得每条边的起点在终点之前。若图中存在环则返回错误信息。用于任务调度排序、依赖解析、构建顺序确定等场景。',
  parameters: {
    graph: {
      type: 'object',
      description: '有向图邻接表，格式: { [nodeId]: [dependentNodeId, ...] }，表示 nodeId 指向的后续节点列表',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_topological_sort', {
        graph: args.graph,
      })
      return JSON.stringify({ ok: true, result, message: '拓扑排序完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '拓扑排序失败（图中可能存在环）' })
    }
  },
}

export const algoGraphAnalysis: ToolDefinition = {
  name: 'algo_graph_analysis',
  description: '图结构分析。支持三种分析类型：components（连通分量，找出图中所有独立连通子图）、scc（强连通分量，找出所有强连通子图，用于循环依赖检测）、dangling（悬空引用，找出入度为零但出度非零或反之的异常节点）。用于知识图谱完整性检查、依赖关系健康度分析等场景。',
  parameters: {
    graph: {
      type: 'object',
      description: '图的邻接表，格式: { [nodeId]: [{ target: string, weight?: number }] }',
      required: true,
    },
    analysisType: {
      type: 'string',
      description: '分析类型: "components"（连通分量）、"scc"（强连通分量）、"dangling"（悬空引用检测）',
      required: true,
      enum: ['components', 'scc', 'dangling'],
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_graph_analysis', {
        graph: args.graph,
        analysisType: String(args.analysisType),
      })
      return JSON.stringify({ ok: true, result, message: `图分析完成 (${args.analysisType})` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '图分析失败' })
    }
  },
}

export const algoForceLayout: ToolDefinition = {
  name: 'algo_force_layout',
  description: '力导向图布局算法。通过模拟斥力（节点间）和引力（边连接的节点间）迭代计算节点位置，使图结构可视化时布局美观。config 可选参数包括: repulsion（斥力系数，默认 1000）、attraction（引力系数，默认 0.01）、idealLength（理想边长，默认 100）、maxIterations（最大迭代次数，默认 300）、damping（阻尼系数，默认 0.9）。用于知识图谱可视化、关系网络布局、流程图自动排列等场景。',
  parameters: {
    graph: {
      type: 'object',
      description: '图的邻接表，格式: { [nodeId]: [{ target: string, weight?: number }] }',
      required: true,
    },
    config: {
      type: 'object',
      description: '布局配置（可选）。支持字段: repulsion, attraction, idealLength, maxIterations, damping',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const payload: Record<string, unknown> = { graph: args.graph }
      if (args.config !== undefined) payload.config = args.config
      const result = await invokeTauri('cmd_algo_force_layout', payload)
      return JSON.stringify({ ok: true, result, message: '力导向布局计算完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '力导向布局计算失败' })
    }
  },
}

export const algoCrdtLww: ToolDefinition = {
  name: 'algo_crdt_lww',
  description: 'CRDT 最后写入胜出寄存器（LWW-Register）。支持三种操作：new（创建新寄存器，需 value 和 nodeId）、set（设置新值，需 registerJson/value/timestamp）、merge（合并两个寄存器，需 registerJson 和 otherJson）。用于多节点实时协作场景中的值同步，保证最终一致性。时间戳相同时按 nodeId 字典序仲裁。',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "new"（创建）、"set"（设置值）、"merge"（合并）',
      required: true,
      enum: ['new', 'set', 'merge'],
    },
    registerJson: {
      type: 'string',
      description: '当前寄存器 JSON（set/merge 操作时需要）',
      required: false,
    },
    value: {
      type: 'string',
      description: '要设置的值（new/set 操作时需要）',
      required: false,
    },
    nodeId: {
      type: 'string',
      description: '节点 ID（new 操作时需要）',
      required: false,
    },
    timestamp: {
      type: 'number',
      description: '时间戳（set 操作时需要）',
      required: false,
    },
    otherJson: {
      type: 'string',
      description: '要合并的另一个寄存器 JSON（merge 操作时需要）',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const op = String(args.operation)
      let result: unknown
      if (op === 'new') {
        result = await invokeTauri('cmd_algo_crdt_lww_new', { value: String(args.value), nodeId: String(args.nodeId) })
      } else if (op === 'set') {
        result = await invokeTauri('cmd_algo_crdt_lww_set', { registerJson: String(args.registerJson), value: String(args.value), timestamp: Number(args.timestamp) })
      } else if (op === 'merge') {
        result = await invokeTauri('cmd_algo_crdt_lww_merge', { registerJson: String(args.registerJson), otherJson: String(args.otherJson) })
      } else {
        return JSON.stringify({ ok: false, error: `unknown operation: ${op}`, message: 'LWW 寄存器操作失败' })
      }
      return JSON.stringify({ ok: true, result, message: `LWW 寄存器操作完成 (${op})` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: 'LWW 寄存器操作失败' })
    }
  },
}

export const algoCrdtOrset: ToolDefinition = {
  name: 'algo_crdt_orset',
  description: 'CRDT 观察删除集合（OR-Set）。支持四种操作：new（创建，需 nodeId）、add（添加元素，需 setJson/element）、remove（删除元素，需 setJson/element）、merge（合并，需 setJson/otherJson）、elements（获取当前元素列表，需 setJson）。用于多节点集合协作，添加优先语义保证最终一致性。',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "new"（创建）、"add"（添加）、"remove"（删除）、"merge"（合并）、"elements"（获取元素列表）',
      required: true,
      enum: ['new', 'add', 'remove', 'merge', 'elements'],
    },
    setJson: {
      type: 'string',
      description: '当前集合 JSON（add/remove/merge/elements 操作时需要）',
      required: false,
    },
    element: {
      type: 'string',
      description: '要添加或删除的元素（add/remove 操作时需要）',
      required: false,
    },
    nodeId: {
      type: 'string',
      description: '节点 ID（new 操作时需要）',
      required: false,
    },
    otherJson: {
      type: 'string',
      description: '要合并的另一个集合 JSON（merge 操作时需要）',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const op = String(args.operation)
      let result: unknown
      if (op === 'new') {
        result = await invokeTauri('cmd_algo_crdt_orset_new', { nodeId: String(args.nodeId) })
      } else if (op === 'add') {
        result = await invokeTauri('cmd_algo_crdt_orset_add', { setJson: String(args.setJson), element: String(args.element) })
      } else if (op === 'remove') {
        result = await invokeTauri('cmd_algo_crdt_orset_remove', { setJson: String(args.setJson), element: String(args.element) })
      } else if (op === 'merge') {
        result = await invokeTauri('cmd_algo_crdt_orset_merge', { setJson: String(args.setJson), otherJson: String(args.otherJson) })
      } else if (op === 'elements') {
        result = await invokeTauri('cmd_algo_crdt_orset_elements', { setJson: String(args.setJson) })
      } else {
        return JSON.stringify({ ok: false, error: `unknown operation: ${op}`, message: 'OR-Set 操作失败' })
      }
      return JSON.stringify({ ok: true, result, message: `OR-Set 操作完成 (${op})` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: 'OR-Set 操作失败' })
    }
  },
}

export const algoCrdtRga: ToolDefinition = {
  name: 'algo_crdt_rga',
  description: 'CRDT 复制增长数组（RGA）。支持五种操作：new（创建，需 nodeId）、insert（插入字符，需 rgaJson/index/content）、delete（删除字符，需 rgaJson/id）、merge（合并，需 rgaJson/otherJson）、text（获取文本，需 rgaJson）。用于多节点文本实时协作编辑，保证最终一致性。',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "new"（创建）、"insert"（插入）、"delete"（删除）、"merge"（合并）、"text"（获取文本）',
      required: true,
      enum: ['new', 'insert', 'delete', 'merge', 'text'],
    },
    rgaJson: {
      type: 'string',
      description: '当前 RGA JSON（insert/delete/merge/text 操作时需要）',
      required: false,
    },
    index: {
      type: 'number',
      description: '插入位置索引（insert 操作时需要）',
      required: false,
    },
    content: {
      type: 'string',
      description: '要插入的字符内容（insert 操作时需要）',
      required: false,
    },
    id: {
      type: 'string',
      description: '要删除的节点 ID（delete 操作时需要）',
      required: false,
    },
    nodeId: {
      type: 'string',
      description: '节点 ID（new 操作时需要）',
      required: false,
    },
    otherJson: {
      type: 'string',
      description: '要合并的另一个 RGA JSON（merge 操作时需要）',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const op = String(args.operation)
      let result: unknown
      if (op === 'new') {
        result = await invokeTauri('cmd_algo_crdt_rga_new', { nodeId: String(args.nodeId) })
      } else if (op === 'insert') {
        result = await invokeTauri('cmd_algo_crdt_rga_insert', { rgaJson: String(args.rgaJson), index: Number(args.index), content: String(args.content) })
      } else if (op === 'delete') {
        result = await invokeTauri('cmd_algo_crdt_rga_delete', { rgaJson: String(args.rgaJson), id: String(args.id) })
      } else if (op === 'merge') {
        result = await invokeTauri('cmd_algo_crdt_rga_merge', { rgaJson: String(args.rgaJson), otherJson: String(args.otherJson) })
      } else if (op === 'text') {
        result = await invokeTauri('cmd_algo_crdt_rga_text', { rgaJson: String(args.rgaJson) })
      } else {
        return JSON.stringify({ ok: false, error: `unknown operation: ${op}`, message: 'RGA 操作失败' })
      }
      return JSON.stringify({ ok: true, result, message: `RGA 操作完成 (${op})` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: 'RGA 操作失败' })
    }
  },
}

export const algoCrdtVectorClock: ToolDefinition = {
  name: 'algo_crdt_vector_clock',
  description: 'CRDT 向量时钟比较。比较两个向量时钟的因果关系，返回 happensBefore（A 是否在 B 之前发生）和 isConcurrent（A 和 B 是否并发）。用于判断分布式事件之间的因果顺序，辅助协作冲突检测。',
  parameters: {
    clockAJson: {
      type: 'string',
      description: '第一个向量时钟 JSON，格式: { counter, nodeId }',
      required: true,
    },
    clockBJson: {
      type: 'string',
      description: '第二个向量时钟 JSON，格式: { counter, nodeId }',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_crdt_vc_compare', {
        clockAJson: String(args.clockAJson),
        clockBJson: String(args.clockBJson),
      })
      return JSON.stringify({ ok: true, result, message: '向量时钟比较完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '向量时钟比较失败' })
    }
  },
}

export const algoTerrainNoise: ToolDefinition = {
  name: 'algo_terrain_noise',
  description: '值噪声生成器。使用分形叠加（Fractal Brownian Motion）生成 2D 噪声值。config 可选参数: seed（种子，默认 42）、scale（缩放，默认 0.01）、octaves（叠加层数，默认 6）、persistence（持续度，默认 0.5）、lacunarity（间隙度，默认 2.0）。用于程序化地形高度图生成、纹理生成等场景。',
  parameters: {
    x: {
      type: 'number',
      description: 'X 坐标',
      required: true,
    },
    y: {
      type: 'number',
      description: 'Y 坐标',
      required: true,
    },
    config: {
      type: 'object',
      description: '噪声配置（可选）。支持字段: seed, scale, octaves, persistence, lacunarity',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const payload: Record<string, unknown> = { x: Number(args.x), y: Number(args.y) }
      if (args.config !== undefined) payload.configJson = JSON.stringify(args.config)
      const result = await invokeTauri('cmd_algo_terrain_noise', payload)
      return JSON.stringify({ ok: true, result, message: `噪声值: ${result}` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '噪声生成失败' })
    }
  },
}

export const algoTerrainHeightmap: ToolDefinition = {
  name: 'algo_terrain_heightmap',
  description: '地形高度图生成与分析。支持三种操作：generate（生成高度图，需 width/height/offsetX/offsetY，可选 config）、slope（计算坡度，需 heightmapJson/x/y）、aspect（计算坡向，需 heightmapJson/x/y）。generate 返回 HeightMap JSON，slope 返回 { dx, dy, magnitude }，aspect 返回弧度值。用于地形分析、坡度计算、等高线生成前置步骤。',
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型: "generate"（生成高度图）、"slope"（计算坡度）、"aspect"（计算坡向）',
      required: true,
      enum: ['generate', 'slope', 'aspect'],
    },
    width: {
      type: 'number',
      description: '高度图宽度（generate 操作时需要）',
      required: false,
    },
    height: {
      type: 'number',
      description: '高度图高度（generate 操作时需要）',
      required: false,
    },
    offsetX: {
      type: 'number',
      description: 'X 偏移量（generate 操作时需要，默认 0）',
      required: false,
    },
    offsetY: {
      type: 'number',
      description: 'Y 偏移量（generate 操作时需要，默认 0）',
      required: false,
    },
    config: {
      type: 'object',
      description: '噪声配置（可选，generate 操作时使用）',
      required: false,
    },
    heightmapJson: {
      type: 'string',
      description: '高度图 JSON（slope/aspect 操作时需要）',
      required: false,
    },
    x: {
      type: 'number',
      description: '查询点 X 坐标（slope/aspect 操作时需要）',
      required: false,
    },
    y: {
      type: 'number',
      description: '查询点 Y 坐标（slope/aspect 操作时需要）',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const op = String(args.operation)
      let result: unknown
      if (op === 'generate') {
        result = await invokeTauri('cmd_algo_terrain_heightmap_generate', {
          configJson: args.config !== undefined ? JSON.stringify(args.config) : null,
          width: args.width !== undefined ? Number(args.width) : 64,
          height: args.height !== undefined ? Number(args.height) : 64,
          offsetX: args.offsetX !== undefined ? Number(args.offsetX) : 0,
          offsetY: args.offsetY !== undefined ? Number(args.offsetY) : 0,
        })
      } else if (op === 'slope') {
        result = await invokeTauri('cmd_algo_terrain_heightmap_slope', { heightmapJson: String(args.heightmapJson), x: Number(args.x), y: Number(args.y) })
      } else if (op === 'aspect') {
        result = await invokeTauri('cmd_algo_terrain_heightmap_aspect', { heightmapJson: String(args.heightmapJson), x: Number(args.x), y: Number(args.y) })
      } else {
        return JSON.stringify({ ok: false, error: `unknown operation: ${op}`, message: '高度图操作失败' })
      }
      return JSON.stringify({ ok: true, result, message: `高度图操作完成 (${op})` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '高度图操作失败' })
    }
  },
}

export const algoTerrainContour: ToolDefinition = {
  name: 'algo_terrain_contour',
  description: '等高线生成（Marching Squares 算法）。根据高度图和指定高度等级，生成等高线段列表。每条等高线包含 level（高度等级）和 points（两个端点坐标）。用于地形可视化、等高线地图绘制、区域划分等场景。',
  parameters: {
    heightmapJson: {
      type: 'string',
      description: '高度图 JSON',
      required: true,
    },
    levels: {
      type: 'array',
      description: '高度等级数组，如 [0.3, 0.5, 0.7]',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_terrain_marching_squares', {
        heightmapJson: String(args.heightmapJson),
        levelsJson: JSON.stringify(args.levels),
      })
      return JSON.stringify({ ok: true, result, message: `等高线生成完成，等级数: ${(args.levels as unknown[]).length}` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '等高线生成失败' })
    }
  },
}

export const algoConstraintSolve: ToolDefinition = {
  name: 'algo_constraint_solve',
  description: '几何约束求解器。使用迭代投影法求解几何约束系统。支持约束类型: FixedPoint（固定点）、Horizontal（水平线）、Vertical（垂直线）、Parallel（平行）、Perpendicular（垂直）、EqualLength（等长）、Distance（距离）、Angle（角度）、Coincident（重合）。输入约束系统 JSON（含 points/lines/constraints），返回求解结果和更新后的系统状态。用于 CAD 草图约束、建筑布局约束等场景。',
  parameters: {
    systemJson: {
      type: 'string',
      description: '约束系统 JSON，格式: { points: [{ id, position: {x,y}, free }], lines: [{ id, startId, endId }], constraints: [{ id, constraintType: {...}, priority }] }',
      required: true,
    },
    maxIterations: {
      type: 'number',
      description: '最大迭代次数（默认 200）',
      required: false,
    },
    tolerance: {
      type: 'number',
      description: '收敛容差（默认 0.001）',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const payload: Record<string, unknown> = { systemJson: String(args.systemJson) }
      if (args.maxIterations !== undefined) payload.maxIterations = Number(args.maxIterations)
      if (args.tolerance !== undefined) payload.tolerance = Number(args.tolerance)
      const result = await invokeTauri('cmd_algo_constraint_solve', payload)
      return JSON.stringify({ ok: true, result, message: '约束求解完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '约束求解失败' })
    }
  },
}

export const algoDxfParse: ToolDefinition = {
  name: 'algo_dxf_parse',
  description: '解析 DXF CAD 文件内容，提取实体（Line/Circle/Arc/Polyline/Ellipse/Spline/Text）并自动构建约束系统。返回实体列表、约束系统、图层名和警告。解析后可调用 algo_constraint_solve 求解约束，或调用 algo_dxf_extract_constraints 自动提取水平/垂直约束。',
  parameters: {
    content: {
      type: 'string',
      description: 'DXF 文件内容（ASCII 格式）',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_dxf_parse', { content: String(args.content) })
      return JSON.stringify({ ok: true, result, message: 'DXF 解析完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: 'DXF 解析失败' })
    }
  },
}

export const algoDxfGenerate: ToolDefinition = {
  name: 'algo_dxf_generate',
  description: '根据实体列表生成 DXF CAD 文件内容。支持 Line/Circle/Arc/LwPolyline/Text 实体类型。返回 DXF ASCII 格式字符串，可直接保存为 .dxf 文件。',
  parameters: {
    entitiesJson: {
      type: 'string',
      description: '实体列表 JSON 数组，格式: [{ entityType, layer, data: { line: { start, end } } | { circle: { center, radius } } | ... }]',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_dxf_generate', { entitiesJson: String(args.entitiesJson) })
      return JSON.stringify({ ok: true, result, message: 'DXF 生成完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: 'DXF 生成失败' })
    }
  },
}

export const algoDxfExtractConstraints: ToolDefinition = {
  name: 'algo_dxf_extract_constraints',
  description: '从约束系统中自动提取水平/垂直约束。分析所有线段，当线段接近水平（dy < 1% 长度）时添加 Horizontal 约束，接近垂直（dx < 1% 长度）时添加 Vertical 约束。通常在 DXF 解析后调用，用于自动识别 CAD 草图中的隐含约束。',
  parameters: {
    systemJson: {
      type: 'string',
      description: '约束系统 JSON',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_dxf_extract_constraints', { systemJson: String(args.systemJson) })
      return JSON.stringify({ ok: true, result, message: '约束提取完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '约束提取失败' })
    }
  },
}

export const algoPolygonBoolean: ToolDefinition = {
  name: 'algo_polygon_boolean',
  description: '多边形布尔运算。支持四种操作：union（并集，合并两个多边形）、intersection（交集，取重叠区域）、difference（差集，A 减去 B）、xor（对称差集，取非重叠区域）。基于 Martinez-Rueda 算法，支持带孔洞的复杂多边形。用于墙体合并、区域计算、空间分析等场景。',
  parameters: {
    op: {
      type: 'string',
      description: '操作类型: "union"（并集）、"intersection"（交集）、"difference"（差集）、"xor"（对称差集）',
      required: true,
      enum: ['union', 'intersection', 'difference', 'xor'],
    },
    aJson: {
      type: 'string',
      description: '多边形 A JSON，格式: { exterior: [{x,y},...], interiors: [[{x,y},...],...] }',
      required: true,
    },
    bJson: {
      type: 'string',
      description: '多边形 B JSON，格式同 A',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_polygon_boolean', { op: String(args.op), aJson: String(args.aJson), bJson: String(args.bJson) })
      return JSON.stringify({ ok: true, result, message: `多边形${args.op === 'union' ? '并集' : args.op === 'intersection' ? '交集' : args.op === 'difference' ? '差集' : '对称差集'}运算完成` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '多边形布尔运算失败' })
    }
  },
}

export const algoPolygonOffset: ToolDefinition = {
  name: 'algo_polygon_offset',
  description: '多边形偏移（缓冲区）。将多边形向外（正 delta）或向内（负 delta）偏移指定距离。用于墙体厚度调整、安全距离计算、碰撞区域扩展等场景。',
  parameters: {
    polygonJson: {
      type: 'string',
      description: '多边形 JSON，格式: { exterior: [{x,y},...], interiors: [[{x,y},...],...] }',
      required: true,
    },
    delta: {
      type: 'number',
      description: '偏移距离（正数向外扩展，负数向内收缩）',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_polygon_offset', { polygonJson: String(args.polygonJson), delta: Number(args.delta) })
      return JSON.stringify({ ok: true, result, message: `多边形偏移完成 (delta=${args.delta})` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '多边形偏移失败' })
    }
  },
}

export const algoPageRank: ToolDefinition = {
  name: 'algo_pagerank',
  description: 'PageRank 算法。计算图中每个节点的 PageRank 分数，用于评估节点的重要性。damping 因子通常设为 0.85。返回每个节点的分数、迭代次数和是否收敛。用于知识图谱重要节点识别、影响力分析等场景。',
  parameters: {
    graphJson: {
      type: 'string',
      description: '加权图 JSON，格式: { adjacency: { "nodeA": [{ target: "nodeB", weight: 1.0 }], ... } }',
      required: true,
    },
    damping: {
      type: 'number',
      description: '阻尼因子（默认 0.85）',
      required: false,
    },
    maxIterations: {
      type: 'number',
      description: '最大迭代次数（默认 100）',
      required: false,
    },
    tolerance: {
      type: 'number',
      description: '收敛容差（默认 0.001）',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_pagerank', {
        graphJson: String(args.graphJson),
        damping: args.damping !== undefined ? Number(args.damping) : 0.85,
        maxIterations: args.maxIterations !== undefined ? Number(args.maxIterations) : 100,
        tolerance: args.tolerance !== undefined ? Number(args.tolerance) : 0.001,
      })
      return JSON.stringify({ ok: true, result, message: 'PageRank 计算完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: 'PageRank 计算失败' })
    }
  },
}

export const algoCommunityDetection: ToolDefinition = {
  name: 'algo_community_detection',
  description: '社群发现算法（Louvain 方法）。基于模块度优化的层次聚类，自动检测图中的社群结构。返回社群列表（每个社群包含成员节点）和模块度分数。用于知识图谱社群分析、社交网络发现、事件分组等场景。',
  parameters: {
    graphJson: {
      type: 'string',
      description: '加权图 JSON（建议使用无向边）',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_community_detection', { graphJson: String(args.graphJson) })
      return JSON.stringify({ ok: true, result, message: '社群发现完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '社群发现失败' })
    }
  },
}

export const algoHydraulicErosion: ToolDefinition = {
  name: 'algo_hydraulic_erosion',
  description: '水文侵蚀模拟。模拟水滴在地形上的侵蚀和沉积过程，使地形更自然真实。支持自定义侵蚀参数（迭代次数、惯性、侵蚀率、沉积率等）。返回侵蚀后的高度图。用于地形美化、自然景观生成等场景。',
  parameters: {
    heightmapJson: {
      type: 'string',
      description: '高度图 JSON',
      required: true,
    },
    config: {
      type: 'object',
      description: '侵蚀配置（可选）。支持字段: iterations, inertia, capacityFactor, minSlope, erosionRate, depositionRate, evaporationRate, gravity, startWater, startSpeed, maxDropletLifetime',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const payload: Record<string, unknown> = { heightmapJson: String(args.heightmapJson) }
      if (args.config !== undefined) payload.configJson = JSON.stringify(args.config)
      const result = await invokeTauri('cmd_algo_hydraulic_erosion', payload)
      return JSON.stringify({ ok: true, result, message: '水文侵蚀模拟完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '水文侵蚀模拟失败' })
    }
  },
}

export const algoViewshed: ToolDefinition = {
  name: 'algo_viewshed',
  description: '视域分析。计算从观察者位置能看到的地形区域。返回布尔数组标记每个网格点是否可见。用于建筑选址、瞭望塔规划、军事视野分析等场景。',
  parameters: {
    heightmapJson: {
      type: 'string',
      description: '高度图 JSON',
      required: true,
    },
    observerX: {
      type: 'number',
      description: '观察者 X 坐标（网格索引）',
      required: true,
    },
    observerY: {
      type: 'number',
      description: '观察者 Y 坐标（网格索引）',
      required: true,
    },
    observerHeight: {
      type: 'number',
      description: '观察者离地高度',
      required: true,
    },
    radius: {
      type: 'number',
      description: '可视半径（网格单位）',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_viewshed', {
        heightmapJson: String(args.heightmapJson),
        observerX: Number(args.observerX),
        observerY: Number(args.observerY),
        observerHeight: Number(args.observerHeight),
        radius: Number(args.radius),
      })
      return JSON.stringify({ ok: true, result, message: '视域分析完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '视域分析失败' })
    }
  },
}

export const algoChaikinSmooth: ToolDefinition = {
  name: 'algo_chaikin_smooth',
  description: 'Chaikin 曲线平滑算法。对多边形顶点进行角切割平滑，每轮迭代将每条边按 0.25/0.75 比例插入两个新点，使轮廓更圆滑。iterations 越大越平滑但顶点数指数增长。',
  parameters: {
    vertices: {
      type: 'array',
      description: '多边形顶点数组 [{x,y}]',
      required: true,
    },
    iterations: {
      type: 'number',
      description: '平滑迭代次数，默认 2',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_chaikin_smooth', {
        verticesJson: JSON.stringify(args.vertices),
        iterations: Number(args.iterations ?? 2),
      })
      return JSON.stringify({ ok: true, result: JSON.parse(result as string), message: 'Chaikin 平滑完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: 'Chaikin 平滑失败' })
    }
  },
}

export const algoFindSharedEdges: ToolDefinition = {
  name: 'algo_find_shared_edges',
  description: '检测两个多边形之间的共享边。逐边比较距离，当两条边的端点距离均小于阈值时判定为共享边。返回共享边的索引对和距离。',
  parameters: {
    verticesA: {
      type: 'array',
      description: '多边形 A 的顶点数组 [{x,y}]',
      required: true,
    },
    verticesB: {
      type: 'array',
      description: '多边形 B 的顶点数组 [{x,y}]',
      required: true,
    },
    threshold: {
      type: 'number',
      description: '共享边判定距离阈值，默认 8',
      required: false,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_find_shared_edges', {
        verticesAJson: JSON.stringify(args.verticesA),
        verticesBJson: JSON.stringify(args.verticesB),
        threshold: Number(args.threshold ?? 8),
      })
      return JSON.stringify({ ok: true, result, message: '共享边检测完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '共享边检测失败' })
    }
  },
}

export const algoFindLinePolygonIntersections: ToolDefinition = {
  name: 'algo_find_line_polygon_intersections',
  description: '计算一条折线与多边形的所有交点。返回每个交点的坐标、折线段索引和多边形边索引。是多边形切割和增补操作的前置步骤。',
  parameters: {
    line: {
      type: 'array',
      description: '折线顶点数组 [{x,y}]',
      required: true,
    },
    polygon: {
      type: 'array',
      description: '多边形顶点数组 [{x,y}]',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_find_line_polygon_intersections', {
        lineJson: JSON.stringify(args.line),
        polygonJson: JSON.stringify(args.polygon),
      })
      return JSON.stringify({ ok: true, result, message: '线-多边形交点计算完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '线-多边形交点计算失败' })
    }
  },
}

export const algoPolygonSplit: ToolDefinition = {
  name: 'algo_polygon_split',
  description: '沿切割线将多边形分割为两个或多个子多边形。自动计算切割线与多边形的交点，沿交点将多边形一分为二。若切割线与多边形无交点或仅一个交点，返回原多边形。',
  parameters: {
    polygon: {
      type: 'array',
      description: '多边形顶点数组 [{x,y}]',
      required: true,
    },
    cuttingLine: {
      type: 'array',
      description: '切割线顶点数组 [{x,y}]',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_polygon_split', {
        polygonJson: JSON.stringify(args.polygon),
        cuttingLineJson: JSON.stringify(args.cuttingLine),
      })
      return JSON.stringify({ ok: true, result, message: '多边形切割完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '多边形切割失败' })
    }
  },
}

export const algoPolygonAugment: ToolDefinition = {
  name: 'algo_polygon_augment',
  description: '沿添加线增补多边形。计算添加线与多边形的交点，将添加线部分融入多边形轮廓，扩展多边形面积。若添加线与多边形交点不足两个，返回空数组。',
  parameters: {
    polygon: {
      type: 'array',
      description: '多边形顶点数组 [{x,y}]',
      required: true,
    },
    addingLine: {
      type: 'array',
      description: '添加线顶点数组 [{x,y}]',
      required: true,
    },
  },
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_polygon_augment', {
        polygonJson: JSON.stringify(args.polygon),
        addingLineJson: JSON.stringify(args.addingLine),
      })
      return JSON.stringify({ ok: true, result: JSON.parse(result as string), message: '多边形增补完成' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '多边形增补失败' })
    }
  },
}

export const algoRun: ToolDefinition = {
  name: 'algo_run',
  description: '执行 Rust 核心库中的算法。先用 algo_list 查看可用算法列表和参数格式。可用算法类别：图算法(dijkstra_path, astar, topological_sort, connected_components, tarjan_scc, force_layout, pagerank, community_detection, betweenness_centrality)、几何算法(segment_intersect, point_in_polygon, convex_hull, polygon_boolean, polygon_offset, polygon_simplify, aabb_intersects, obb_intersects)、地形算法(terrain_noise, heightmap_generate, hydraulic_erosion, viewshed, marching_squares)、CRDT(crdt_lww, crdt_orset, crdt_rga, crdt_vc_compare)、约束求解(constraint_solve, dxf_parse, dxf_generate)。参数以 JSON 传递，返回 JSON 结果。',
  parameters: {
    algorithm: { type: 'string', description: '算法名称，如 "dijkstra_path"、"convex_hull"、"terrain_noise"', required: true },
    paramsJson: { type: 'string', description: '算法参数 JSON，格式因算法而异', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'algo',
    displayName: '执行算法',
  } satisfies ToolMeta,
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_algo_run', {
        algorithm: String(args.algorithm),
        paramsJson: String(args.paramsJson),
      })
      return JSON.stringify({ ok: true, result, message: `算法 ${args.algorithm} 执行完成` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: `算法 ${args.algorithm} 执行失败` })
    }
  },
}

export const algoList: ToolDefinition = {
  name: 'algo_list',
  description: '列出所有可用的算法名称、参数格式和返回格式。使用场景：在使用 algo_run 之前查看可用算法和参数要求。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'algo',
    displayName: '列出算法',
  } satisfies ToolMeta,
  execute: async () => {
    try {
      const result = await invokeTauri('cmd_algo_list')
      return JSON.stringify({ ok: true, result, message: '算法列表查询成功' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '算法列表查询失败' })
    }
  },
}

export const algoTools: ToolDefinition[] = [
  algoRun,
  algoList,
]

/** 30 个独立 algo 工具已合并到 algoRun，此映射供别名查找 */
export const LEGACY_ALGO_MAP: Record<string, string> = {
  algo_spatial_insert: 'algo_run',
  algo_spatial_query: 'algo_run',
  algo_spatial_clear: 'algo_run',
  algo_segment_intersect: 'algo_run',
  algo_find_intersections: 'algo_run',
  algo_point_in_polygon: 'algo_run',
  algo_polygon_metrics: 'algo_run',
  algo_convex_hull: 'algo_run',
  algo_collision_check: 'algo_run',
  algo_shortest_path: 'algo_run',
  algo_k_shortest_paths: 'algo_run',
  algo_topological_sort: 'algo_run',
  algo_graph_analysis: 'algo_run',
  algo_force_layout: 'algo_run',
  algo_crdt_lww: 'algo_run',
  algo_crdt_orset: 'algo_run',
  algo_crdt_rga: 'algo_run',
  algo_crdt_vector_clock: 'algo_run',
  algo_terrain_noise: 'algo_run',
  algo_terrain_heightmap: 'algo_run',
  algo_terrain_contour: 'algo_run',
  algo_constraint_solve: 'algo_run',
  algo_dxf_parse: 'algo_run',
  algo_dxf_generate: 'algo_run',
  algo_dxf_extract_constraints: 'algo_run',
  algo_polygon_boolean: 'algo_run',
  algo_polygon_offset: 'algo_run',
  algo_pagerank: 'algo_run',
  algo_community_detection: 'algo_run',
  algo_hydraulic_erosion: 'algo_run',
  algo_viewshed: 'algo_run',
  algo_chaikin_smooth: 'algo_run',
  algo_find_shared_edges: 'algo_run',
  algo_find_line_polygon_intersections: 'algo_run',
  algo_polygon_split: 'algo_run',
  algo_polygon_augment: 'algo_run',
}
