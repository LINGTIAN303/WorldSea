---
name: analysis-engine
description: >
  算法分析引擎。当用户需要空间分析、路径规划、地形生成、关系网络分析、
  碰撞检测、约束求解等计算时激活。
  覆盖能力：图算法（最短路径/社区发现/PageRank）、几何算法（凸包/碰撞/多边形运算）、
  地形算法（噪声/高度图/侵蚀/视域）、CRDT（分布式同步）、CAD（DXF/约束求解）。
  关键词：算法、分析、路径、地形、图、几何、空间、布局、网络、碰撞、地形生成。
capabilities:
  internal:
    - entity.list
    - entity.get
    - algo.list
    - algo.run
    - algo.spatial.query
    - algo.geometry.compute
    - algo.graph.analyze
    - algo.crdt.operation
    - algo.terrain.generate
    - algo.cad.operation
    - algo.polygon.advanced
    - entity.schema.validate
    - consistency_check
    - ui.surface.create
    - ui.components.update
    - ui.data.update
    - ui.output.table
    - ui.output.code
  cli: []
  mcp: []
---

## 目标

将用户的世界观分析需求翻译为精确的算法调用，将数值结果解读为世界观含义。

## 触发条件

- 用户要求分析角色关系网络（"分析角色间的影响力"、"找出最紧密的小团体"）
- 用户要求地理/空间计算（"两个区域的最短路径"、"检测领土重叠"）
- 用户要求生成地形（"生成一片山脉的地形"、"模拟河流侵蚀"）
- 用户要求图论分析（"找出关键节点"、"拓扑排序事件"）

## 核心方法论

1. **需求→算法映射**：将模糊需求精确映射到具体算法，不猜测
2. **数据准备**：从实体属性中提取算法所需的输入格式
3. **结果解读**：将数值输出翻译为世界观含义，而非直接返回原始数据
4. **可视化优先**：能用 A2UI 展示的，不要只返回文字

## 标准工作流程

1. **理解需求**：确认分析目标和输入数据范围
2. **选择算法**：根据需求从下方算法目录选择
3. **准备数据**：从实体属性提取算法输入（坐标、图结构、参数）
4. **调用算法**：使用 `algo_run` 或具体算法工具
5. **解读结果**：将数值翻译为世界观含义
6. **可视化**：使用 `ui_create_surface` 展示结果

## 算法速查

### 关系网络分析
| 需求 | 算法 | 输入 | 输出 |
|------|------|------|------|
| 角色影响力排名 | `algo_run(action='pagerank')` | 关系图 | 节点重要性分数 |
| 发现势力阵营 | `algo_run(action='community_detection')` | 关系图 | 社区划分 |
| 两角色关系路径 | `algo_run(action='shortest_path')` | 图+起终点 | 路径序列 |
| 网络整体分析 | `algo_run(action='graph_analysis')` | 邻接表 | 连通性/中心性 |
| 关系图布局 | `algo_run(action='force_layout')` | 图结构 | 节点坐标 |

### 地理空间分析
| 需求 | 算法 | 输入 | 输出 |
|------|------|------|------|
| 领土重叠检测 | `algo_run(action='collision_check')` | 多边形列表 | 碰撞对 |
| 区域面积计算 | `algo_run(action='polygon_metrics')` | 多边形顶点 | 面积/周长 |
| 凸包计算 | `algo_run(action='convex_hull')` | 点集 | 凸包多边形 |
| 空间查询 | `algo_run(action='spatial_query')` | 点/范围 | 命中实体 |

### 地形生成
| 需求 | 算法 | 输入 | 输出 |
|------|------|------|------|
| 随机地形 | `algo_run(action='terrain_noise')` | scale/octaves/seed | 高度矩阵 |
| 精细地形 | `algo_run(action='terrain_heightmap')` | width/height/params | 高度图 |
| 等高线 | `algo_run(action='terrain_contour')` | 高度图 | 等高线数据 |
| 河流侵蚀 | `algo_run(action='hydraulic_erosion')` | 高度图/iterations | 侵蚀后地形 |
| 视域分析 | `algo_run(action='viewshed')` | 观测点/距离 | 可见区域 |

## 质量审核清单

- [ ] 选择了正确的算法（不是"差不多"的）
- [ ] 输入数据格式正确（坐标系统、图结构格式）
- [ ] 结果已翻译为世界观含义
- [ ] 可视化展示（非纯文字）
- [ ] 参数设置合理（非默认值盲目使用）

## Gotchas

- 几何算法坐标系统：X 向右增大，Y 向下增大
- 图算法需要先构建邻接表，实体间的关系不自动成为图边
- 地形算法输出是数值矩阵，需转换为等高线或热力图
- `algo_run` 是通用入口但参数校验弱，优先使用具体算法工具
- 详细参数说明见 `references/algo-catalog.md`

## 输出格式

```
## 算法分析结果

### 输入
- 算法: [名称]
- 参数: [关键参数]
- 数据来源: [实体名/属性]

### 数值结果
[原始输出摘要]

### 世界观解读
- [将数值翻译为世界观含义]

### 可视化
[A2UI 展示或文字描述]
```

## 参考资源

- `references/algo-catalog.md`：38+ 算法的完整参数说明和示例
