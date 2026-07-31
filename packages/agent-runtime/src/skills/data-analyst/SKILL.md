---
name: data-analyst
description: >
  项目数据深度分析。当用户需要实体统计、属性分布、关系密度、一致性审计或趋势分析时激活。
  覆盖：实体数量分布、属性完整度、关系网络密度、度数分布、聚类系数、一致性检查。
  生成可视化报告并保存到 notebook。
  关键词：统计、分析、分布、趋势、报告、数据、审计、密度、完整度、质量。
capabilities:
  internal:
    - entity.list
    - entity.get
    - content_search
    - relation.list
    - algo.graph.analyze
    - algo.pagerank
    - algo.community-detection
    - consistency_check
    - schema_validate
    - ui.create.surface
    - ui.update.components
    - ui.update.data
  plugin:
    notebook:
      - notebook(action='create_note')
      - notebook(action='update_note')
      - notebook(action='list_notes')
schema-context:
  entity-types: all
  field-policy: prefer-defined
---

# 数据分析技能

## 目标

对项目世界观数据进行全面统计分析、质量审计和可视化报告生成，帮助用户了解世界观的完整度、一致性和结构健康度。

## 触发条件

- 用户要求统计各类型实体的分布
- 用户要求分析关系网络的密度或聚类
- 用户要求生成世界观完整性审计报告
- 用户提到"统计""分析""分布""趋势""报告""数据""审计""密度""完整度""质量"等词

## 分析维度

### 1. 实体统计
- 各类型实体数量分布
- 属性填充率（必填字段/推荐字段的完整度）
- description 长度分布（过短/适中/过长）
- 命名一致性（风格统一度）

### 2. 关系密度
- 关系总数与类型分布
- 平均度数（每个实体的平均关系数）
- 孤立实体数量与占比
- 高度数实体（枢纽节点）列表
- 关系方向分布（单向 vs 双向比例）

### 3. 一致性审计
- `consistency_check` 自动检测结果
- `schema_validate` schema 合规性检查
- 跨实体类型的一致性（角色所属组织是否存在、道具存放地是否存在等）

### 4. 网络结构
- 网络密度（实际边数 / 最大可能边数）
- 社区数量与规模分布
- PageRank Top 10 核心实体
- 连通分量分析（是否存在断开的子图）

## 核心方法论

1. **数据驱动决策**：所有结论必须基于数据——不凭直觉说"角色太少"，而是量化显示"N个角色 / 总实体 M%"
2. **对比基线**：提供行业参考基线（如"通常角色占总实体 20-30%"），让用户有对标感
3. **可操作建议**：每个问题点都附带具体建议——不只是"关系密度低"，而是"建议为这 N 个孤立实体建立关系"
4. **分层呈现**：先给总览数字，再按需展开细节，避免信息过载

## 标准工作流程

### 场景一：全面数据审计

1. 使用 `entity_list` 获取所有实体，按类型统计数量
2. 使用 `relation_list` 获取所有关系，按类型统计分布
3. 计算核心指标：
   - 实体总数与类型分布
   - 关系总数与平均度数
   - 孤立实体列表
   - 属性完整度（逐类型检查必填字段）
4. 使用 `consistency_check` 运行一致性检测
5. 使用 `schema_validate` 验证 schema 合规性
6. 生成可视化报告

### 场景二：关系网络分析

1. 使用 `algo_run(action='pagerank')` 计算影响力排名
2. 使用 `algo_run(action='community_detection')` 检测社区结构
3. 使用 `algo_run(action='graph_analysis')` 获取网络全局指标
4. 分析结果：
   - 核心节点（Top 10 PageRank）
   - 社区数量与最大社区规模
   - 网络密度与连通分量
   - 桥接节点（连接不同社区的实体）

### 场景三：趋势与对比分析

1. 按创建时间分析实体增长趋势
2. 按关系类型分析关系增长趋势
3. 与同类型项目基线对比：
   - 角色占比（基线: 20-30%）
   - 平均度数（基线: 3-5）
   - 孤立率（基线: <10%）
   - 一致性通过率（基线: >90%）
4. 生成趋势报告

## 输出规范

### 可视化组件选择

| 数据类型 | 推荐组件 | 说明 |
|---------|---------|------|
| 实体类型分布 | `EditableTable` | 表格展示数量与占比 |
| 属性完整度 | `ChartView` | 柱状图/饼图展示填充率 |
| 网络指标 | `Comparison` | 多维度对比 |
| 趋势数据 | `ChartView` | 折线图展示增长趋势 |
| 核心节点 | `EditableTable` | 排名表格 |
| 审计报告 | `notebook(action='create_note')` | 保存到笔记本（noteType=research） |

### 质量指标定义

| 指标 | 计算方式 | 健康基线 |
|------|---------|---------|
| 实体完整度 | 必填字段已填充数 / 必填字段总数 | ≥ 80% |
| 关系覆盖率 | 有关系连接的实体数 / 总实体数 | ≥ 90% |
| 一致性得分 | 通过一致性检查的项数 / 检查总项数 | ≥ 90% |
| 网络密度 | 实际边数 / 最大可能边数 | 0.05-0.3 |
| 孤立率 | 孤立实体数 / 总实体数 | ≤ 10% |

## 质量审核清单

- [ ] 统计数据准确（与 entity_list 实际返回数量一致）
- [ ] 所有指标附带健康基线对比
- [ ] 问题点有具体可操作建议
- [ ] 审计报告已保存到 notebook
- [ ] 可视化组件选择与数据类型匹配
- [ ] 分析结论有数据支撑，无主观臆断

## Gotchas

- `entity_list` 返回所有类型实体，需要按 type 字段分组统计
- `consistency_check` 和 `schema_validate` 是两个不同维度的检查——前者检查跨实体一致性，后者检查单实体 schema 合规
- `algo_run(action='pagerank')` 在稀疏网络中结果可能不稳定——需结合度数分析
- `notebook(action='create_note')` 的 noteType 使用 "research" 标记分析报告
- 大数据量时（>100 实体），分批获取数据避免单次查询超时
- 对比基线是参考值而非硬标准——不同世界观类型（小说/游戏/TRPG）基线不同

## 输出格式

```
## 世界观数据分析报告

### 总览
| 指标 | 数值 | 状态 |
|------|------|------|
| 实体总数 | [N] | - |
| 关系总数 | [N] | - |
| 实体类型数 | [N] | - |
| 平均度数 | [N] | ✅/⚠️ |
| 孤立率 | [N%] | ✅/⚠️ |
| 一致性得分 | [N%] | ✅/⚠️ |

### 实体类型分布
[EditableTable 数据]

### 属性完整度
[ChartView 数据]

### 网络核心节点 (Top 10)
[EditableTable 数据]

### 问题与建议
| 问题 | 严重度 | 建议 |
|------|--------|------|
| [描述] | 高/中/低 | [具体建议] |
```

## 工具优先级

1. `entity_list` / `relation_list` → 数据采集（基础操作）
2. `consistency_check` / `schema_validate` → 质量审计
3. `algo_run(action='pagerank')` / `algo_run(action='community_detection')` / `algo_run(action='graph_analysis')` → 网络分析
4. `output_table` / `output_stat` → 数据输出
5. `notebook(action='create_note')` → 报告保存
