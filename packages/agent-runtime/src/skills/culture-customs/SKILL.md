---
name: culture-customs
description: >
  文化习俗设计与推演。当用户需要设计节日、仪式、禁忌、婚丧、饮食、服饰等文化细节时激活。
  支持文化类型：节日/仪式/禁忌/婚俗/丧葬/饮食/服饰/艺术/建筑风格/其他。
  可关联地域、种族、组织和起源事件。对应 culture 插件。
  关键词：文化、习俗、节日、仪式、禁忌、婚俗、饮食、服饰、传统、民俗。
capabilities:
  internal:
    - entity.list
    - entity.get
    - entity.create
    - entity.update
    - relation.create
    - relation.list
    - content_search
    - consistency_check
    - ui.output.entity-card
    - ui.output.table
  plugin:
    culture:
      - culture_list
      - culture_create
      - culture_update
      - culture_get_detail
schema-context:
  entity-types:
    - culture
  field-policy: prefer-defined
---

# 文化习俗设计技能

## 目标

为世界观构建丰富、自洽、有深度的文化习俗体系，确保每条文化条目都有明确的起源、象征意义和社会功能，并与地域、种族、组织形成有机关联。

## 触发条件

- 用户要求设计节日、仪式、禁忌、婚俗、丧葬等文化内容
- 用户要求推演某种文化的历史演变
- 用户要求检查文化与世界观的一致性
- 用户提到"文化""习俗""节日""仪式""禁忌""婚俗""饮食""服饰""传统"等词

## 实体模型

**culture** 核心属性：

| 属性 | 说明 | 必填 |
|------|------|------|
| name | 文化条目名称 | ✅ |
| cultureType | 类型（节日/仪式/禁忌/婚俗/丧葬/饮食/服饰/艺术/建筑风格/其他） | ✅ |
| cycle | 周期（如年度/月度/一次性） | 节日类必填 |
| origin | 起源故事 | 推荐 |
| participants | 参与群体 | 推荐 |
| significance | 象征意义与社会功能 | 推荐 |
| practices | 具体做法与流程 | 推荐 |

## 关联关系

| 关系类型 | 目标类型 | 说明 |
|---------|---------|------|
| `practiced_in` | region | 流行地区 |
| `practiced_by` | species | 所属种族 |
| `promoted_by` | organization | 官方推行组织 |
| `origin_event` | event | 起源事件 |

## 核心方法论

1. **起源决定形态**：每种文化的形式必须追溯到具体的历史事件或社会需求——节日纪念什么？禁忌防范什么？
2. **功能主义**：文化习俗在社会中承担功能（凝聚/教化/疗愈/秩序），设计时明确其社会角色
3. **演化思维**：文化不是静态的——思考它如何随时代变迁而演变，与其他文化如何互动融合
4. **感官细节**：文化体验是多感官的——节日有食物气味、仪式有音乐节奏、服饰有触感质地

## 标准工作流程

### 场景一：设计新文化条目

1. 使用 `culture_list` 或 `entity_list` 查看已有文化条目，避免重复
2. 确定文化类型和核心设计理念（起源故事 + 社会功能）
3. 使用 `culture_create` 创建，填充所有推荐字段
4. 使用 `relation_create` 关联到地域（practiced_in）、种族（practiced_by）、组织（promoted_by）
5. 如有起源事件，建立 `origin_event` 关系
6. 使用 `consistency_check` 验证与世界观的一致性

### 场景二：文化推演与演化

1. 使用 `culture_get_detail` 获取已有文化的完整信息
2. 分析文化与地域、种族、历史的匹配度
3. 推演文化随时间的演变：
   - 外来文化冲击 → 融合/排斥/变异
   - 政治变革 → 禁止/改造/复兴
   - 技术进步 → 简化/数字化/消失
4. 使用 `entity_update` 记录演化结果

### 场景三：文化体系审查

1. 使用 `culture_list` 按类型逐一审查
2. 检查以下维度：
   - 每个种族/地域是否有独特的文化标识
   - 文化间是否存在交流融合的痕迹
   - 是否有"无根文化"（缺少起源故事）
3. 使用 `content_search` 搜索关联设定，确保一致

## 各类型设计规范

| 文化类型 | 关键字段 | 必须回答的问题 |
|---------|---------|--------------|
| 节日 | cycle, practices, significance | 纪念什么？如何庆祝？持续多久？ |
| 仪式 | practices, participants, significance | 何时举行？谁参与？象征什么？ |
| 禁忌 | significance, origin | 为什么禁止？违反后果是什么？ |
| 婚俗 | practices, participants | 求婚流程？婚礼仪式？离婚条件？ |
| 丧葬 | practices, significance | 如何处理遗体？悼念期多长？ |
| 饮食 | practices, cycle | 特色食物？用餐礼仪？禁忌食物？ |
| 服饰 | practices, significance | 日常/仪式服饰？阶级标识？ |

## 质量审核清单

- [ ] 每种文化有明确的起源故事和象征意义
- [ ] 节日文化包含周期和具体做法
- [ ] 禁忌文化解释了违反后果
- [ ] 每条文化至少关联一个地域或种族
- [ ] 文化条目间无设定矛盾
- [ ] practices 字段有具体可感知的细节（非泛泛描述）
- [ ] 命名风格与世界观文化氛围一致

## Gotchas

- `culture_create` 优先于 `entity_create(type=culture)`——前者自动填充 culture 插件专用字段
- `culture_list` 支持按 `cultureType` 过滤，审查特定类型时使用
- 建立关联关系时注意方向：`practiced_in` 从文化指向地域，`practiced_by` 从文化指向种族
- `consistency_check` 可能不会捕获文化层面的软矛盾（如"沙漠民族的航海节日"），需人工审查合理性
- 设计文化前先用 `content_search` 搜索相关设定，避免与已有世界观冲突

## 输出格式

```
## 文化档案：[名称]

### 基本信息
- **类型**: [cultureType]
- **周期**: [cycle]（如适用）
- **流行区域**: [关联地域]
- **所属种族**: [关联种族]

### 起源故事
[origin 描述]

### 具体做法
[practices 详细流程]

### 象征意义
[significance 社会功能与文化价值]

### 关联网络
| 关联 | 目标 | 类型 |
|------|------|------|
| [关系] | [实体名] | [类型] |
```

## 工具优先级

1. `culture_list` / `culture_get_detail` → 查询（优先使用插件工具）
2. `culture_create` / `culture_update` → 创建/更新
3. `relation_create` → 建立关联（practiced_in/practiced_by/promoted_by/origin_event）
4. `consistency_check` → 一致性验证
5. `content_search` → 搜索关联设定
