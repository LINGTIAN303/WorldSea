---
name: relation-explorer
description: >
  跨实体关系深度探索与构建。当用户需要查询关系、分析路径、探索网络结构或批量建立关系时激活。
  支持 20+ 种关系类型，覆盖角色、组织、物品、建筑、文化、概念、冲突、语言等实体间关系。
  集成图谱可视化（graph 插件）、路径分析（PageRank/最短路径/社区检测）等高级能力。
  关键词：关系、关联、连接、关系网、关系链、双向链接、关系类型、图谱、网络。
capabilities:
  internal:
    - entity.list
    - entity.get
    - relation.list
    - relation.create
    - relation.delete
    - algo.shortest-path
    - algo.k-shortest-paths
    - algo.graph.analyze
    - algo.pagerank
    - algo.community-detection
    - algo.force-layout
    - ui.show.relation
    - ui.create.surface
    - ui.update.components
  plugin:
    graph:
      - graph(action='get_nodes')
      - graph(action='get_edges')
      - graph(action='find_path')
      - graph(action='cluster_analysis')
      - graph(action='highlight_nodes')
schema-context:
  entity-types: all
  field-policy: prefer-defined
---

# 关系探索技能

## 目标

提供跨实体类型的关系深度探索能力——从单条关系的创建查询，到多跳路径分析、社区检测、影响力排名和图谱可视化，是世界观关系网络的基础设施技能。

## 触发条件

- 用户要求查找两个实体之间的关系路径
- 用户要求分析关系网络结构（社区/中心节点/桥接节点）
- 用户要求批量建立关系或清理关系
- 用户提到"关系""关联""连接""关系网""关系链""关系类型""图谱""网络"等词

## 关系类型速查表

### 角色关系（7种）
`knows`（认识）/ `ally_of`（盟友）/ `rival_of`（敌对）/ `spouse_of`（配偶）/ `sibling_of`（兄弟姐妹）/ `parent_of`（父母）/ `mentor_of`（师徒）

### 组织归属（3种）
`belongs_to`（属于）/ `resides_in`（居住）/ `member_of`（成员）

### 物品关系（4种）
`owns`（拥有）/ `possessed_by`（被持有）/ `kept_at`（存放于）/ `used_in`（使用于）

### 建筑空间（4种）
`located_in`（位于）/ `connected_to`（通道连接）/ `contains`（包含）/ `resident`（常驻者）

### 文化关系（3种）
`practiced_in`（流行地区）/ `practiced_by`（所属种族）/ `promoted_by`（官方推行）

### 概念关系（4种）
`references`（引用）/ `contradicts`（矛盾）/ `broader_than`（上位概念）/ `inspired_by`（灵感来源）

### 冲突关系（3种）
`participant_force`（参战势力）/ `participant_commander`（指挥官）/ `battlefield`（战场）

### 语言关系（3种）
`spoken_by`（使用者）/ `spoken_in`（通行区域）/ `language_branch`（语系分支）

## 核心方法论

1. **关系即叙事**：每条关系都暗含一段故事——"为什么他们认识？""如何获得这件物品？""这个概念从何而来？"
2. **多跳发现**：通过路径分析发现隐含关系——A 的师父是 B，B 的敌人是 C → A 与 C 有潜在冲突
3. **网络思维**：孤立实体无价值；核心实体（高度数节点）是世界观的骨架
4. **方向敏感**：单向关系有严格方向（parent_of/mentor_of/belongs_to），双向关系无方向（knows/ally_of/rival_of）

## 标准工作流程

### 场景一：关系查询与路径分析

1. 使用 `relation_list` 获取目标实体的全部关系
2. 使用 `graph(action='get_edges')` 从图谱获取边数据
3. 使用 `algo_run(action='shortest_path')` 查找两个实体之间的最短路径
4. 使用 `algo_run(action='k_shortest_paths')` 获取多条路径（发现替代关系链）
5. 使用 `graph(action='find_path')` 在交互式图谱中高亮路径

### 场景二：网络分析与社区检测

1. 使用 `algo_run(action='pagerank')` 计算所有实体的影响力排名
2. 使用 `algo_run(action='community_detection')` 发现实体聚类（自然分组）
3. 使用 `graph(action='cluster_analysis')` 深入分析特定社区的内部结构
4. 识别三类关键节点：
   - **核心节点**：PageRank 最高 → 世界观中心
   - **桥接节点**：连接不同社区 → 跨领域关键角色
   - **孤立节点**：无关系连接 → 需要补充关联

### 场景三：批量关系构建

1. 使用 `entity_list` 获取目标实体群
2. 分析实体间的合理关系类型
3. 使用 `relation_create` 批量建立关系（每次不超过 10 条，等待确认）
4. 使用 `relation_list` 验证创建结果
5. 使用 `graph(action='highlight_nodes')` 在图谱中高亮新建关系

## 质量审核清单

- [ ] 单向关系方向正确
- [ ] 关系类型与实体类型匹配（不会把 `mentor_of` 用在非角色实体上）
- [ ] 无重复关系（同类型同方向的重复边）
- [ ] 批量创建后验证关系数量一致
- [ ] 路径分析结果有实际叙事意义
- [ ] 孤立实体已被识别并建议关联

## Gotchas

- `relation_list` 返回所有类型的关系，需要按 relationType 过滤以减少噪音
- `algo_run(action='shortest_path')` 返回最短的一条路径，使用 `algo_run(action='k_shortest_paths')` 获取更多路径选项
- `graph(action='get_nodes')` / `graph(action='get_edges')` 操作的是前端图谱视图，需要先确保图谱已加载
- `graph(action='highlight_nodes')` 需要先传入节点 ID 列表，不支持按条件过滤
- `algo_run(action='community_detection')` 在稀疏网络中可能产生大量单节点社区——需结合 `algo_run(action='pagerank')` 筛选重要节点
- 批量创建关系时，先创建所有源/目标实体，再建立关系——避免引用不存在的 ID

## 输出格式

```
## 关系分析报告

### 实体关系概览
| 实体 | 关系数 | 类型分布 |
|------|--------|---------|
| [实体名] | [N] | [类型统计] |

### 路径分析：[实体A] → [实体B]
| 路径 | 长度 | 关系链 |
|------|------|--------|
| 路径1 | [N] | A →[关系]→ X →[关系]→ B |

### 网络分析
- **核心节点** (Top 5): [列表]
- **社区结构**: [N] 个社区
- **孤立实体**: [列表]
- **网络密度**: [数值]
```

## 工具优先级

1. `relation_list` → 关系查询（基础操作）
2. `graph(action='get_nodes')` / `graph(action='get_edges')` → 图谱数据获取
3. `algo_run(action='shortest_path')` / `algo_run(action='k_shortest_paths')` → 路径分析
4. `algo_run(action='pagerank')` / `algo_run(action='community_detection')` → 网络分析
5. `relation_create` / `relation_delete` → 关系管理
6. `graph(action='highlight_nodes')` / `graph(action='cluster_analysis')` → 图谱可视化
