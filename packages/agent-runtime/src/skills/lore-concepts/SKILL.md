---
name: lore-concepts
description: >
  世界观概念与设定百科。当用户需要创建核心设定、构建概念体系、检查设定矛盾时激活。
  支持 11 种概念类型（概念/规则/魔法/科技/文化/历史/宗教/生物/语言/社会制度/其他）。
  构建概念引用、矛盾、上下位层级、灵感来源网络。对应 concepts 插件。
  关键词：概念、设定、百科、规则、魔法体系、科技体系、社会制度、世界观、宗教。
capabilities:
  internal:
    - entity.list
    - entity.get
    - entity.create
    - entity.update
    - entity.delete
    - relation.create
    - relation.list
    - content_search
    - algo.graph.analyze
    - consistency_check
    - ui.output.entity-card
  plugin:
    concepts:
      - concept_list
      - concept_create
      - concept_update
      - concept_get_network
schema-context:
  entity-types:
    - concept
  field-policy: prefer-defined
---

# 设定百科管理技能

## 目标

构建世界观的概念知识图谱——从单一概念定义到概念层级、引用网络、矛盾检测，确保世界观的每个设定都有清晰定义、关联脉络和一致性保障。

## 触发条件

- 用户要求创建世界观核心概念（魔法体系规则、社会制度、宗教信仰等）
- 用户要求构建概念之间的层级或引用关系
- 用户要求检测设定之间的矛盾
- 用户提到"概念""设定""百科""规则""魔法体系""世界观""社会制度""宗教"等词

## 实体模型

**concept** 核心属性：

| 属性 | 说明 | 必填 |
|------|------|------|
| name | 概念名称 | ✅ |
| conceptType | 类型（概念/规则/魔法/科技/文化/历史/宗教/生物/语言/社会制度/其他） | ✅ |
| definition | 定义（一句话精准描述） | ✅ |
| aliases | 别名/同义词 | 可选 |
| description | 详细描述（展开说明） | 推荐 |

## 关联关系

| 关系类型 | 目标类型 | 说明 | 典型场景 |
|---------|---------|------|----------|
| `references` | concept | 引用 | "火球术"引用"火元素" |
| `contradicts` | concept | 矛盾 | "无魔法世界"矛盾"火球术" |
| `broader_than` | concept | 上位概念 | "元素魔法"broader_than"火元素魔法" |
| `inspired_by` | concept/character | 灵感来源 | 角色启发了某个概念 |

## 核心方法论

1. **定义精准**：每个概念的 definition 必须一句话可解释清楚——如果需要一段话才能说清，说明需要拆分为子概念
2. **层级清晰**：使用 `broader_than` 建立上下位层级，确保概念体系有树状结构
3. **矛盾显式化**：发现矛盾不要隐藏——用 `contradicts` 显式标记并解释原因（可能是有意的设计张力）
4. **网络稠密**：核心设定概念应有密集的引用网络——孤立概念要么不重要，要么遗漏了关联

## 标准工作流程

### 场景一：创建新概念

1. 使用 `concept_list` 查看已有概念，检查是否有重叠或矛盾
2. 确定概念类型和精准定义
3. 使用 `concept_create` 创建，填充 definition 和 description
4. 使用 `relation_create` 建立层级关系（broader_than）和引用关系（references）
5. 使用 `concept_get_network` 确认新融入的关联网络

### 场景二：概念层级构建

1. 使用 `concept_list` 按 conceptType 筛选同类型概念
2. 识别上下位关系，使用 `broader_than` 建立层级
3. 使用 `algo_run(action='graph_analysis')` 分析概念网络结构：
   - 识别中心概念（被引用最多的概念 = 世界观核心设定）
   - 识别孤立概念（无引用的概念 → 需补充关联或删除）
   - 识别环状引用（A→B→C→A → 可能需要合并）

### 场景三：矛盾检测与解决

1. 使用 `consistency_check` 运行自动一致性检测
2. 对发现的矛盾逐一分类：
   - **硬矛盾**：两个设定逻辑上不可能共存 → 必须修正其一
   - **软矛盾**：表面冲突但可解释（如不同视角的叙述差异）→ 用 `contradicts` 标记并说明
   - **设计张力**：有意的矛盾，服务于叙事 → 用 `contradicts` 标记并标注"有意设计"
3. 提出修正方案供用户选择

## 质量审核清单

- [ ] 每个概念有清晰的 definition（一句话定义）
- [ ] 核心设定概念建立了 references 引用网络
- [ ] 存在冲突的设定用 contradicts 显式标记并解释
- [ ] 概念层级（broader_than）结构合理，无环状层级
- [ ] 无孤立的核心概念（被引用次数 > 0）
- [ ] aliases 字段记录了常用别名
- [ ] description 展开说明充分（50-300 字）

## Gotchas

- `concept_create` 优先于 `entity_create(type=concept)`——前者自动填充 concepts 插件专用字段
- `concept_get_network` 返回概念的引用/矛盾/层级/灵感来源四类关系，适合做全局分析
- `broader_than` 方向：从下位概念指向上位概念（"火球术" broader_than → "元素魔法"）
- `contradicts` 关系必须附带说明——没有解释的矛盾标记是无意义的
- `algo_run(action='graph_analysis')` 分析时关注入度最高的节点——它们是世界观的基石概念
- 批量创建概念时先创建上位概念，再创建下位概念，避免引用不存在

## 输出格式

```
## 概念档案：[名称]

### 基本信息
| 属性 | 值 |
|------|-----|
| 类型 | [conceptType] |
| 定义 | [definition] |
| 别名 | [aliases] |

### 详细描述
[description 展开说明]

### 概念关系
| 关系 | 目标 | 类型 | 说明 |
|------|------|------|------|
| [关系] | [概念名] | [references/broader_than/contradicts] | [描述] |

### 网络位置
- 入度（被引用数）: [N]
- 层级深度: [N]
- 相邻核心概念: [概念列表]
```

## 工具优先级

1. `concept_list` / `concept_get_network` → 查询（优先使用插件工具）
2. `concept_create` / `concept_update` → 创建/更新
3. `relation_create` → 建立引用/矛盾/层级关系
4. `consistency_check` → 一致性验证
5. `algo_run(action='graph_analysis')` → 概念网络结构分析
