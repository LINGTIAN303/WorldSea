---
name: worldbuilding
description: >
  世界观构建与一致性验证。当用户需要完善、扩展、检查世界设定的完整性时激活。
  覆盖实体类型：region（区域）、organization（组织）、culture（文化）、
  species（物种）、language（语言）、conflict（冲突）、event（事件）。
  关键词：世界观、设定、完善、补充、推演、一致性、缺失、地理、势力、历史。
capabilities:
  internal:
    - entity.list
    - entity.get
    - entity.create
    - entity.update
    - entity.delete
    - relation.create
    - relation.delete
    - content_search
    - entity.schema.validate
    - consistency_check
    - algo.graph.analyze
    - ui.output.table
    - ui.output.choice
    - ui.output.entity-card
  cli: []
  mcp: []
schema-context:
  entity-types:
    - region
    - organization
    - culture
    - species
    - language
    - conflict
    - event
  field-policy: prefer-defined
---

## 目标

将零散的世界设定碎片推演为自洽、完整、有层次的世界观体系，确保因果链闭合、势力格局合理、文化特征与地理历史匹配。

## 触发条件

- 用户要求"完善/补充/推演"世界设定
- 用户要求"检查一致性"
- 用户描述了世界观中的空白或矛盾
- 用户要求生成区域、势力、文化、物种等设定

## 核心方法论

1. **因果链优先**：每个推演必须追溯到已有设定的因果逻辑，禁止凭空出现
2. **生态位思维**：每个实体占据独特的"生态位"——区域有地理独特性，势力有利益独特性，文化有价值独特性
3. **张力网络**：实体间的关系必须包含张力（利益冲突/资源竞争/价值观对立），而非全部和谐
4. **冰山原则**：推演 30% 显性设定 + 70% 隐性背景，给用户留创作空间

## 必备思考

- 推理工作量：尽最大努力，不允许任何捷径。
- 你必须在思考时做到极其周全，全面分解问题以找到根本原因，并针对所有潜在路径、极端情况和对抗性场景，对你的逻辑进行严格的压力测试。
- 明确写出你的完整思考过程，记录每一个中间步骤、考虑过的替代方案以及被否决的假设，以确保没有任何假设被遗漏核查。

## 标准工作流程

### 阶段一：现状诊断

1. 使用 `entity_list` 获取所有实体，按类型统计分布
2. 使用 `content_search` 搜索关键设定词，检查覆盖度
3. 识别三类缺口：
   - **类型缺口**：某实体类型数量为 0 或极少（如无 species、无 language）
   - **关系缺口**：孤立实体（无任何关系连接）
   - **描述缺口**：description 为空或过短（<20字）的实体

### 阶段二：推演补全

根据缺口类型，按以下优先级推演：

1. **区域→势力→文化**：先补地理，再由地理决定势力分布，再由势力衍生文化
2. **物种→语言**：先补物种生态，再为重要物种推演语言体系
3. **冲突→事件**：在势力间识别利益冲突点，推演历史事件

推演时使用 `entity_create` 创建实体，`relation_create` 建立关系。每次最多创建 5 个实体，等待用户确认后继续。

### 阶段三：一致性验证

1. 使用 `consistency_check` 运行自动验证
2. 人工审查以下维度：
   - 地理邻接关系是否合理（相邻区域是否有 relation 连接）
   - 势力关系是否自洽（敌对关系是否有历史依据）
   - 时间线是否连贯（事件先后顺序是否矛盾）
   - 文化特征是否与地理/历史匹配

3. 发现矛盾时，提出修正方案而非直接修改

## 质量审核清单

- [ ] 每个推演实体都有至少 1 条关系连接
- [ ] 新推演不与已有设定矛盾
- [ ] 区域描述包含地理特征 + 气候 + 资源
- [ ] 势力描述包含目标 + 结构 + 控制区域
- [ ] 文化描述包含价值观 + 习俗 + 与其他文化的关系
- [ ] 物种描述包含生态位 + 与其他物种的互动
- [ ] 无同质化实体（两个区域/势力特征雷同）

## Gotchas

- `consistency_check` 返回的警告必须逐一处理，不可跳过
- 创建关系时 `source → target` 方向性：`region` contains `organization`，`organization` controls `region`
- `entity_create` 的 `properties` 必须匹配 schema 定义，先 `schema_validate` 再创建
- 推演前先读 `references/worldbuilding-checklist.md` 获取完整检查项
- 推演时不要一次创建超过 5 个实体，避免 token 超限和用户信息过载

## 输出格式

```
## 世界观诊断

### 类型分布
| 类型 | 数量 | 状态 |
|------|------|------|
| region | N | ✅/⚠️ |

### 缺口识别
- [类型缺口]: [描述]
- [关系缺口]: [描述]
- [描述缺口]: [描述]

## 推演建议

### 优先级 1（因果链基础）
1. **[实体名]** ([类型]): [简述]
   - 与 [已有实体] 的关系: [关系类型]

### 一致性验证
- ✅ [已验证项]
- ⚠️ [需注意项]
```

## 参考资源

- `references/worldbuilding-checklist.md`：完整的世界观检查清单，推演前必读
