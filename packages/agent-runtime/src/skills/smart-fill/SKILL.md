# 智能填充技能 (Smart Fill)

> 为 WorldSmith 实体表单提供 AI 辅助输入，减少重复性手动填写，提升世界观构建效率。

## 核心能力

### Layer A — 字段级建议

- `entity_suggest_field`：为单个字段生成建议值
  - `mode=continue`：接续预览，基于用户已输入内容生成续写文本
  - `mode=suggest`：独立建议，基于上下文生成完整建议值
- ✨ 图标仅在 hover 时显示（不再所有字段同时展示）
- 用户开始输入时，✨ 图标隐藏，自动触发 ghost text 接续预览
- 新建实体：使用 `entity_get_context(scope='same_type_entities')` 获取同类型参考
- 编辑实体：使用 `entity_get_context(scope='relations_only')` 获取关联实体上下文

### Layer B — 实体级一键填充

- `entity_smart_fill`：批量生成建议值
  - `includeExisting=false`（默认）：仅为空字段生成建议，已填字段不覆盖
  - `includeExisting=true`：为所有字段生成建议，包括对已有内容的优化/改写
- 预览面板提供模式切换开关，用户可选择仅空字段或全字段模式

### Layer C — 上下文感知

- `entity_get_context`：聚合获取实体上下文
  - `scope=full`：全量上下文（实体+关联+同类型+Schema+语义）
  - `scope=relations_only`：仅关联实体
  - `scope=same_type_entities`：仅同类型实体
  - `scope=schema_detail`：仅 Schema 字段定义
  - `scope=semantic_related`：仅语义相关实体
  - `scope=field_context`：字段级上下文，需提供 `fieldKey` 参数，返回同类型实体的该字段值 + 关联实体摘要 + 字段 Schema 定义，显著降低 token 消耗
  - `scope=cross_type_relations`：跨类型关联查询，需提供 `targetType` + `entityId` 参数，返回指定目标类型的关联关系及实体

### Layer D — 对话式协同创作

- 通过 A2UI 协议在小窗中引导用户构建实体
- 使用 TextField、ChoiceGroup、Stepper 等组件进行交互式引导
- 拥有独立的 Agent 后端（不与 Layer A/B 共享），确保对话上下文隔离
- 支持 A2UI 交互组件：TextField、ChoiceGroup、Stepper 等
- 回写机制：用户在对话中的选择可同步回写至表单字段
- 多种触发入口：文本划选、字段聚焦、右键上下文菜单、空字段提示
- 打开时自动通过 `entity_get_context` 注入完整上下文

## 工作流程

### 字段级建议流程

1. 用户在字段输入内容 → 前端触发 `entity_suggest_field(mode=continue)`
2. Agent 调用 `entity_get_context` 获取上下文（新建用 `scope=same_type_entities`，编辑用 `scope=relations_only`）
3. 结合上下文生成接续文本 → 返回给前端显示为 ghost text
4. 用户按 Tab/Enter 采纳，Esc 取消

### 一键填充流程

1. 用户点击"AI 智能填充"按钮 → 前端触发 `entity_smart_fill`
2. Agent 调用 `entity_get_context(scope=full)` 获取完整上下文
3. 根据 Schema 字段定义 + 同类型实体 + 关联实体 → 为所有空字段生成建议
4. 返回建议值 → 前端弹出预览面板（左右对比）
5. 用户逐字段接受/拒绝或一键操作

### 对话式创作流程

1. 用户划选文本 → 弹出"与 AI 聊聊？"按钮
2. 小窗自动获取上下文 → Agent 以对话方式引导
3. Agent 通过 A2UI 推送交互组件（选择、输入等）
4. 用户操作结果同步回写表单

## 生成原则

1. **一致性优先**：生成内容必须与同一世界观的已有实体保持一致
2. **尊重上下文**：编辑实体时，建议值应考虑已关联实体的设定
3. **风格适配**：参考同类型已有实体的描述风格和详细程度
4. **不过度设计**：空字段生成简洁的初始建议，用户可在此基础上细化
5. **Schema 驱动**：根据字段定义（类型、描述、约束）决定建议值的格式和内容

## 常见实体类型字段指南

### character（角色）
- personality: 性格特征，2-4 个关键词 + 1-2 句展开描述
- background: 背景故事，1-3 段叙事，与已关联的区域/组织保持一致
- appearance: 外貌描写，从整体到细节，可参考种族特征
- occupation: 职业，与所属组织的设定相匹配

### region（区域）
- climate: 气候特征，参考地理位置推断
- population: 人口数量级，与区域类型匹配
- government: 政体形式，与区域规模和文化背景匹配
- significance: 区域意义，与已关联的事件/组织呼应

### building（建筑）
- style: 建筑风格，参考所在区域的文化设定
- era: 建造时代，与区域历史一致
- materials: 建筑材料，考虑技术水平和文化背景
- significance: 建筑意义，与已关联的角色/组织/事件呼应

### species（物种）
- avgLifespan: 平均寿命，与物种类型匹配
- abilities: 特殊能力，考虑与魔法体系的关联
- weakness: 弱点，与能力形成平衡
- society: 社会结构，参考文化关联

## 注意事项

- 语义搜索（scope=semantic_related）需要 Embedding API 配置，未配置时降级为关键词上下文
- Schema 获取需要 Tauri 环境，Web 模式下 schema_detail 可能不可用
- 建议 text/textarea/richtext 类型字段，select/number/boolean/date/tags/color/image/entityRef 类型不适用
- ghost text 接续预览仅适用于 text/textarea，richtext 仅支持 ✨ 按钮模式
