---
name: content-craft
description: >
  批量生成实体、扩写描述、补充属性、生成关系网络。当用户需要创建、扩展或丰富内容时激活。
  覆盖实体类型：character（角色）、region（区域）、item（物品）、weapon（武器）、
  apparel（服饰）、plant（植物）、building（建筑）、magic（魔法）、
  combat_stat（战斗属性）、concept（概念）。
  关键词：生成、批量、扩写、补充、创建、丰富、角色卡、物品卡。
capabilities:
  internal:
    - entity.list
    - entity.get
    - entity.create
    - entity.update
    - relation.create
    - content_search
    - ui.entity.show
    - ui.surface.create
    - ui.components.update
    - ui.data.update
    - file_write
    - memory_store
    - ui.output.table
    - ui.output.choice
    - ui.output.code
  cli: []
  mcp: []
schema-context:
  entity-types:
    - character
    - region
    - item
    - weapon
    - apparel
    - plant
    - building
    - magic
    - combat_stat
    - concept
  field-policy: prefer-defined
---

## 目标

高效批量生成高质量实体内容，确保风格一致、属性完整、与已有设定协调。

## 触发条件

- 用户要求批量生成实体（"生成10个角色"、"创建一组武器"）
- 用户要求扩写描述（"丰富这个区域的描述"）
- 用户要求补充缺失属性（"给所有角色补充性格字段"）

## 核心方法论

1. **上下文优先**：生成前必须获取已有实体的风格和设定，确保新内容融入而非突兀
2. **差异化生成**：同批实体的核心特征必须有显著差异，避免同质化
3. **属性完整性**：每个实体必须填充其类型的所有必填字段
4. **关系即内容**：生成实体后立即建立与已有实体的关系，孤立实体是无价值的

## 标准工作流程

### 场景一：批量生成实体

1. 使用 `entity_list` 获取同类型已有实体，分析命名风格和属性模式
2. 使用 `content_search` 搜索相关设定，确保新实体不矛盾
3. 设计差异化矩阵：为每个实体确定 1 个核心差异特征
4. 使用 `entity_create` 逐个创建，每批不超过 5 个
5. 使用 `relation_create` 为新实体建立与已有实体的关系
6. 使用 `a2ui_show_entity` 展示创建结果

### 场景二：扩写描述

1. 使用 `entity_get` 获取原文
2. 分析原文风格（正式/口语/文学/学术）
3. 从五个维度扩写：视觉、听觉、嗅觉、触觉、情感
4. 使用 `entity_update` 写入扩写内容，保留原文不删除

### 场景三：补充属性

1. 使用 `entity_list` 筛选目标类型
2. 逐个 `entity_get` 检查缺失字段
3. 根据实体类型和已有信息推断缺失值
4. 使用 `entity_update` 批量补充

## 各类型生成规范

| 类型 | 必填字段 | 差异化维度 | 参考模板 |
|------|----------|------------|----------|
| character | name, description, 性格, 背景, 目标 | 性格标签、说话方式、致命缺陷 | `references/content-templates.md` |
| region | name, description, 气候, 地形, 资源 | 地貌特征、文化氛围、危险等级 | 同上 |
| item | name, description, 类型, 稀有度, 效果 | 外观、来历、副作用 | 同上 |
| weapon | name, description, 伤害类型, 特殊效果 | 材质、锻造工艺、传说 | 同上 |
| magic | name, description, 消耗, 效果, 限制 | 施法方式、视觉表现、代价 | 同上 |

## 质量审核清单

- [ ] 同批实体核心特征无重复
- [ ] 每个实体 description 长度 50-200 字
- [ ] 每个实体至少有 1 条关系
- [ ] 新实体不与已有设定矛盾
- [ ] 命名风格与已有实体一致

## Gotchas

- 批量创建时先创建实体再创建关系，避免引用不存在的实体 ID
- `entity_create` 的 `properties` 字段必须匹配 schema，先用 `schema_validate` 验证
- 扩写前必须 `entity_get` 获取原文，不要凭记忆扩写
- 使用 `a2ui_show_entity` 展示时，entityId 必须是已创建的实体 ID
- 生成前读 `references/content-templates.md` 获取各类型模板

## 输出格式

```
## 批量生成结果

| # | 名称 | 类型 | 核心特征 |
|---|------|------|----------|
| 1 | [名] | [型] | [差异化特征] |

### 新建关系
- [实体A] →[关系类型]→ [实体B]

### 扩写内容
**[实体名]**:
- 原文: "[原文片段]"
- 扩写: "[扩写内容]"
- 扩写维度: [视觉/听觉/...]
```

## 参考资源

- `references/content-templates.md`：各实体类型的生成模板和字段规范
