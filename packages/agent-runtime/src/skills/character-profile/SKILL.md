---
name: character-profile
description: >
  角色档案管理与深度分析。当用户需要创建角色、编辑属性、构建关系网络、追踪人物弧光时激活。
  覆盖 12 种关系类型（认识/盟友/敌对/师徒/配偶/亲属/属于/居住/拥有/参与/关联/兄弟姐妹）。
  对应 characters 插件。
  关键词：角色、人物、关系、家族、师徒、盟友、敌对、性格、背景、人物弧光。
capabilities:
  internal:
    - entity.list
    - entity.get
    - entity.create
    - entity.update
    - entity.delete
    - relation.create
    - relation.list
    - relation.delete
    - content_search
    - algo.pagerank
    - algo.graph.analyze
    - ui.output.entity-card
  plugin:
    characters:
      - character_list
      - character_get_detail
      - character_create
      - character_update
      - character_get_relations
      - character_search
schema-context:
  entity-types:
    - character
  field-policy: prefer-defined
---

# 角色档案管理技能

## 目标

管理角色的完整生命周期——从创建、属性编辑、关系网络构建到人物弧光追踪与社交影响力分析，确保每个角色都有丰满的个性、合理的社会关系和可信的成长轨迹。

## 触发条件

- 用户要求创建、编辑、删除角色
- 用户要求建立或查询角色之间的关系
- 用户要求分析角色的社交网络或影响力
- 用户提到"角色""人物""关系""家族""师徒""性格""背景""人物弧光"等词

## 实体模型

**character** 核心属性：

| 属性 | 说明 | 必填 |
|------|------|------|
| name | 角色名 | ✅ |
| description | 简述（50-200字） | ✅ |
| age | 年龄 | 推荐 |
| gender | 性别 | 推荐 |
| race | 种族 | 推荐 |
| occupation | 职业 | 推荐 |
| affiliation | 所属势力/组织 | 推荐 |
| role | 角色定位（主角/反派/配角/导师/信使） | 推荐 |
| appearance | 外貌描述 | 可选 |
| personality | 性格特征 | 推荐 |
| background | 背景故事 | 推荐 |

## 关系类型（12种）

| 关系类型 | 标签 | 方向 | 说明 | 典型场景 |
|---------|------|------|------|----------|
| knows | 认识 | 双向 | 基本认知 | 初次相遇 |
| ally_of | 盟友 | 双向 | 同盟关系 | 共同目标 |
| rival_of | 敌对 | 双向 | 竞争/仇恨 | 利益冲突 |
| spouse_of | 配偶 | 双向 | 婚姻 | 联姻/爱情 |
| sibling_of | 兄弟姐妹 | 双向 | 血缘同辈 | 家族 |
| parent_of | 父母 | 单向 | 亲子 | 家族传承 |
| mentor_of | 师徒 | 单向 | 师徒传承 | 技艺传授 |
| belongs_to | 属于 | 单向 | 组织归属 | 加入势力 |
| resides_in | 居住 | 单向 | 居住地 | 定居/流亡 |
| owns | 拥有 | 单向 | 物品持有 | 获得宝物 |
| participated_in | 参与事件 | 单向 | 事件参与 | 历史事件 |
| associated_with | 关联概念 | 双向 | 概念关联 | 信仰/理念 |

## 核心方法论

1. **属性驱动设计**：角色的每个属性应服务于叙事——性格决定行为，背景决定动机，目标决定冲突
2. **关系即故事**：每条关系都暗含一段故事；建立关系时思考"他们之间发生了什么"
3. **网络思维**：孤立角色无价值，每个角色至少连接 2-3 个其他实体
4. **方向一致性**：单向关系（parent_of/mentor_of/belongs_to）方向不可反转

## 标准工作流程

### 场景一：创建角色

1. 使用 `character_list` 或 `entity_list` 查看已有角色，避免重名和设定冲突
2. 确定角色定位（role）和核心差异特征
3. 使用 `character_create` 创建，填充所有推荐字段
4. 使用 `relation_create` 建立至少 2 条与已有实体的关系
5. 使用 `a2ui_show_entity` 展示创建结果

### 场景二：关系网络查询与分析

1. 使用 `character_get_relations` 获取目标角色的全部关系
2. 使用 `character_search` 按名称/职业/势力搜索关联角色
3. 使用 `algo_run(action='pagerank')` 分析角色在社交网络中的影响力排名
4. 使用 `algo_run(action='graph_analysis')` 发现角色间的隐藏路径和社区结构
5. 使用 MermaidRender 组件可视化关系子图

### 场景三：人物弧光追踪

1. 使用 `entity_get` 获取角色当前状态
2. 使用 `relation_list` 获取角色的关系变化
3. 分析关键事件对角色性格、信念、关系的影响
4. 使用 `entity_update` 更新角色状态，标注变化原因

## 质量审核清单

- [ ] 每个角色至少有 2-3 条关系连接
- [ ] 主角角色有完整的性格、背景、动机、弱点描述
- [ ] description 长度 50-200 字，包含核心特征
- [ ] 关系网络无逻辑矛盾（A 是 B 的师父 → B 不能同时是 A 的师父）
- [ ] 同批创建的角色核心特征无重复
- [ ] 单向关系方向正确（parent_of 从父指向子）
- [ ] 命名风格与已有角色一致

## Gotchas

- `character_create` 优先于 `entity_create(type=character)`——前者自动填充 characters 插件的专用字段
- `character_get_relations` 支持按 `relationType` 过滤，查询特定类型关系时务必使用
- `relation_create` 中 source/target 方向：单向关系 source 为主动方（如 parent_of 中 source 是父母）
- 使用 `algo_run(action='pagerank')` 前确保关系网络已建立，空网络会返回无意义结果
- 批量创建时先创建所有角色，再建立关系，避免引用不存在的实体 ID

## 输出格式

```
## 角色档案：[角色名]

### 基本信息
| 属性 | 值 |
|------|-----|
| 定位 | [role] |
| 种族 | [race] |
| 职业 | [occupation] |
| 势力 | [affiliation] |

### 性格与背景
- **性格**: [personality]
- **背景**: [background 摘要]

### 关系网络
| 关系 | 对象 | 类型 | 故事 |
|------|------|------|------|
| [关系标签] | [角色名] | [type] | [简述] |

### 影响力分析
- PageRank 得分: [分数]
- 网络位置: [核心/桥接/边缘]
- 关键连接: [最重要的关系]
```

## 工具优先级

1. `character_list` / `character_get_detail` → 查询（优先使用插件工具）
2. `character_create` / `character_update` → 创建/更新
3. `character_get_relations` → 关系查询（支持类型过滤）
4. `character_search` → 模糊搜索
5. `relation_create` / `relation_delete` → 关系管理
6. `algo_run(action='pagerank')` / `algo_run(action='graph_analysis')` → 网络分析
