---
name: inspiration-curator
description: >
  创作灵感与素材收集管理。当用户需要收集参考素材、整理灵感、生成概念图时激活。
  支持 9 种素材类型（图片/视频/文章/音乐/概念/角色/场景/对话/其他）。
  建立灵感与实体（角色/地域/事件/道具/概念/组织）的双向关联。对应 inspiration 插件。
  关键词：灵感、素材、参考、图片、收集、创意、moodboard、参考资料、概念图。
capabilities:
  internal:
    - entity.list
    - entity.get
    - entity.create
    - entity.update
    - relation.create
    - content_search
    - web_search
    - web_fetch
    - image_generate
    - ui.output.table
  plugin:
    inspiration:
      - inspiration_list
      - inspiration_create
      - inspiration_update
      - inspiration_search
schema-context:
  entity-types:
    - inspiration
  field-policy: prefer-defined
---

# 灵感素材管理技能

## 目标

系统化收集、分类和关联创作灵感素材，将碎片化的灵感转化为结构化的参考库，并建立素材与世界观实体之间的创作关联。

## 触发条件

- 用户要求收集、搜索、整理参考素材
- 用户要求创建灵感条目并关联到世界观实体
- 用户要求生成基于素材的概念图
- 用户提到"灵感""素材""参考""收集""创意""moodboard""参考资料"等词

## 实体模型

**inspiration** 核心属性：

| 属性 | 说明 | 必填 |
|------|------|------|
| name | 素材标题 | ✅ |
| materialType | 类型（图片/视频/文章/音乐/概念/角色/场景/对话/其他） | ✅ |
| source | 来源（出处/作者/平台） | 推荐 |
| url | 链接（在线素材的 URL） | 可选 |
| notes | 创作笔记（灵感方向、使用方法、情感基调） | 推荐 |
| colors | 主色调（图片素材的色板记录） | 图片素材推荐 |

## 关联关系

| 关系类型 | 目标类型 | 说明 |
|---------|---------|------|
| `inspires` | character/region/event/item/concept/organization | 灵感来源（从素材指向被启发的实体） |

## 核心方法论

1. **素材即种子**：每条素材都应孕育出至少一个创作产出——关联到具体实体说明灵感如何被使用
2. **笔记优先**：素材的价值不在于素材本身，而在于创作笔记（notes）——记录"我为什么保存它"和"我打算怎么用"
3. **色板意识**：图片素材的 colors 字段是视觉一致性的关键——同主题素材应有相近色调
4. **去重机制**：定期检索已有素材，避免重复收集，保持素材库的精炼度

## 标准工作流程

### 场景一：收集新素材

1. 使用 `web_search` 搜索相关参考资料
2. 使用 `web_fetch` 获取素材详情（如适用）
3. 使用 `inspiration_search` 检查是否已有类似素材
4. 使用 `inspiration_create` 创建素材条目，填写创作笔记和主色调
5. 使用 `relation_create` 建立 `inspires` 关系关联到目标实体

### 场景二：素材库整理

1. 使用 `inspiration_list` 按 materialType 分类查看
2. 审查每条素材：
   - notes 是否充分（是否有明确的灵感方向）
   - 是否关联了至少一个实体
   - 是否有重复素材需要合并
3. 使用 `inspiration_update` 补充缺失信息
4. 使用 `entity_delete` 清理低价值重复素材

### 场景三：概念图生成

1. 使用 `inspiration_list` 获取同主题素材集
2. 分析素材的视觉特征（colors、风格、情感基调）
3. 使用 `image_generate` 基于素材描述生成概念图
4. 将生成结果作为新素材保存

## 质量审核清单

- [ ] 每条素材有创作笔记（notes ≥ 20 字）
- [ ] 图片素材记录了主色调（colors）
- [ ] 每条素材至少关联一个实体（inspires）
- [ ] 素材库无重复条目
- [ ] source 字段记录了来源出处
- [ ] 素材按类型分类清晰
- [ ] 关联实体说明了灵感方向

## Gotchas

- `inspiration_create` 优先于 `entity_create(type=inspiration)`——前者自动填充 inspiration 插件专用字段
- `inspiration_search` 支持关键词模糊搜索，收集前先检索避免重复
- `inspires` 关系方向：从素材指向被启发的实体（灵感 → 作品）
- `web_search` / `web_fetch` 返回的内容需要提炼——不要把整篇文章塞进 notes
- `image_generate` 生成的图片应记录生成提示词，方便后续复用
- colors 字段使用标准色名（如"深红/藏蓝/象牙白"）而非色值，保持可读性

## 输出格式

```
## 素材档案：[标题]

### 基本信息
| 属性 | 值 |
|------|-----|
| 类型 | [materialType] |
| 来源 | [source] |
| 链接 | [url] |
| 主色调 | [colors] |

### 创作笔记
[notes 详细描述]

### 灵感关联
| 关联实体 | 类型 | 灵感方向 |
|---------|------|---------|
| [实体名] | [entity type] | [说明] |
```

## 工具优先级

1. `inspiration_list` / `inspiration_search` → 查询（优先使用插件工具）
2. `inspiration_create` / `inspiration_update` → 创建/更新
3. `web_search` / `web_fetch` → 搜索外部参考资料
4. `relation_create` → 建立灵感关联
5. `image_generate` → 生成概念图
