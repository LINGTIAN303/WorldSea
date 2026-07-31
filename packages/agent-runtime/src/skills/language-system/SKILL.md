---
name: language-system
description: >
  语言与文字系统设计。当用户需要创建虚构语言、构建语系分支、设计音系语法词汇时激活。
  支持语言类型：自然语言/人造语言/古代语言/暗语密语/手语/心灵感应/其他。
  文字类型：表音/表意/音节/象形/符文/无文字/混合。
  可关联使用者种族、通行区域、语系分支。对应 languages 插件。
  关键词：语言、文字、语系、音系、语法、词汇、象形文字、符文、方言。
capabilities:
  internal:
    - entity.list
    - entity.get
    - entity.create
    - entity.update
    - relation.create
    - relation.list
    - content_search
    - algo.graph.analyze
    - ui.output.entity-card
  plugin:
    languages:
      - language_list
      - language_create
      - language_update
      - language_get_family_tree
schema-context:
  entity-types:
    - language
  field-policy: prefer-defined
---

# 语言体系设计技能

## 目标

为世界观构建可信、自洽的虚构语言体系，涵盖音系、语法、词汇、文字系统，并构建语系分支关系，使每种语言都有历史脉络和使用群体。

## 触发条件

- 用户要求设计一种新语言或文字系统
- 用户要求构建语系分支树
- 用户要求为种族/地域创建独特语言
- 用户提到"语言""文字""语系""音系""语法""词汇""符文""方言"等词

## 实体模型

**language** 核心属性：

| 属性 | 说明 | 必填 |
|------|------|------|
| name | 语言名称 | ✅ |
| langType | 语言类型（自然语言/人造语言/古代语言/暗语密语/手语/心灵感应/其他） | ✅ |
| scriptType | 文字类型（表音/表意/音节/象形/符文/无文字/混合） | 推荐 |
| languageFamily | 所属语系 | 推荐 |
| scope | 使用范围（全球/区域/种族内部/秘密团体） | 推荐 |
| maturity | 成熟度（完整体系/部分记录/已消亡/仅口语） | 推荐 |
| phonology | 音系（音位清单、音节结构、声调系统） | 推荐 |
| grammar | 语法（语序、形态类型、核心语法特征） | 推荐 |
| vocabulary | 词汇（核心词汇示例） | 推荐 |
| sampleText | 文字示例 | 可选 |

## 关联关系

| 关系类型 | 目标类型 | 说明 |
|---------|---------|------|
| `spoken_by` | species/character | 使用者 |
| `spoken_in` | region | 通行区域 |
| `language_branch` | language | 语系分支（从子语言指向父语言） |
| `related_language` | language | 关联语言（同源/借词/混合/变体/祖先语言） |

## 核心方法论

1. **音系内部一致**：音位系统必须自洽——不出现不可能的音位组合，音节结构有规律可循
2. **语法与类型匹配**：语法特征应与语言类型和文化背景匹配（如精灵语倾向复杂形态，商人语倾向简化语法）
3. **语系有历史**：语系关系应有历史逻辑支撑——同源语言有共同祖先，借词反映文化接触
4. **词汇反映文化**：核心词汇应体现使用者的生活环境（沙漠民族有多个"沙"的词，海洋民族有多个"浪"的词）

## 标准工作流程

### 场景一：设计新语言

1. 使用 `language_list` 查看已有语言，确认语系归属
2. 确定语言类型、使用范围和成熟度
3. 使用 `language_create` 创建基本条目
4. 设计音系 → 填写 phonology（音位清单 + 音节结构 + 声调规则）
5. 设计语法 → 填写 grammar（基本语序 + 形态类型 + 核心语法标记）
6. 构建词汇 → 填写 vocabulary（至少 10 个核心词 + 文化特色词）
7. 文字示例 → 填写 sampleText（一段短文本展示文字风格）
8. 使用 `language_update` 写入完整属性

### 场景二：构建语系分支

1. 使用 `language_get_family_tree` 查看现有语系结构
2. 确定分支关系（祖语言 → 子语言 → 方言）
3. 使用 `relation_create` 建立 `language_branch` 关系
4. 标注分支原因（地理隔离/政治分裂/文化融合）
5. 使用 `algo_run(action='graph_analysis')` 分析语系网络结构

### 场景三：语言接触与演变推演

1. 分析地理相邻语言之间的接触可能
2. 推演借词方向（强势语言 → 弱势语言 的技术/文化词汇）
3. 推演混合语言的形成条件
4. 使用 `related_language` 关系记录接触结果

## 质量审核清单

- [ ] 音系内部一致（无不可能音位组合）
- [ ] 语法特征与语言类型匹配
- [ ] vocabulary 至少包含 10 个核心词
- [ ] 语系关系有历史逻辑支撑
- [ ] 每种语言至少关联一个使用者（spoken_by）或通行区域（spoken_in）
- [ ] 语言名称风格与世界观一致
- [ ] maturity 字段反映语言的实际状态

## Gotchas

- `language_create` 优先于 `entity_create(type=language)`——前者自动填充 languages 插件专用字段
- `language_get_family_tree` 返回的是以目标语言为根的子树，不包含平行语系
- `language_branch` 关系方向：从子语言指向父语言（子 is_a branch of 父）
- 音系设计避免直接照搬现实语言——保留特征但做变形
- `related_language` 用于非层级关系（借词/混合/变体），不要与 `language_branch` 混淆

## 输出格式

```
## 语言档案：[语言名]

### 基本信息
| 属性 | 值 |
|------|-----|
| 类型 | [langType] |
| 文字 | [scriptType] |
| 语系 | [languageFamily] |
| 范围 | [scope] |
| 成熟度 | [maturity] |

### 音系
[phonology 描述]

### 语法特征
[grammar 描述]

### 核心词汇
| 词义 | 词汇 | 注音 |
|------|------|------|
| [义] | [词] | [音] |

### 文字示例
[sampleText]

### 语系关系
[语系分支描述]
```

## 工具优先级

1. `language_list` / `language_get_family_tree` → 查询（优先使用插件工具）
2. `language_create` / `language_update` → 创建/更新
3. `relation_create` → 建立语系/使用关系
4. `algo_run(action='graph_analysis')` → 语系网络分析
5. `content_search` → 搜索关联设定
