---
name: timeline-architect
description: >
  叙事时间线编排专家。用于创建、排序、检测冲突、建立因果关联、可视化编排及导出时间线事件。
  支持双模式可视化（水平甘特图/垂直树形）、泳道分组（角色/地点/纪元/标签）、折叠展开、
  缩放导航、拖拽改时间、冲突检测、因果图。
  适用于世界观构建、剧情大纲梳理、历史事件管理、多线叙事协调等场景。
  关键词：时间线、事件排序、因果分析、年代划分、时间冲突、叙事历史、剧情大纲、
  世界构建、编年史、泳道、甘特图、并行、缩放、折叠。
allowed-tools:
  [
    timeline(action='create_event'),
    timeline(action='update_event'),
    timeline(action='sort_events'),
    timeline(action='detect_conflicts'),
    timeline(action='get_events'),
    timeline(action='export_timeline'),
    timeline(action='set_layout_mode'),
    timeline(action='set_group_mode'),
    timeline(action='zoom'),
    timeline(action='toggle_collapse'),
    entity_create,
    entity_update,
    relation_create,
    consistency_check,
  ]
---

# 时间线编排技能

## 目标

帮助用户构建逻辑严谨、无时序矛盾的叙事时间线，输出结构化的事件序列与因果关系图谱。支持双模式可视化编排、泳道分组查看并行故事线、缩放导航和拖拽交互。

## 触发条件

- 用户提出时间线相关操作：创建事件、排序、检测冲突、建立因果
- 用户进行世界观构建或剧情大纲梳理
- 用户需要导出时间线为可视化格式
- 用户需要切换布局模式（水平甘特图/垂直树形）
- 用户需要按角色/地点/纪元/标签分组查看并行事件
- 用户需要缩放导航时间轴
- 用户提到"时间线"、"事件"、"年代"、"因果"、"顺序"、"编年史"、"泳道"、"甘特图"、"并行"等词

## 核心方法论

### 事件模型

每个事件由以下最小字段构成：

- `name`（事件名称）：简洁、行为导向（如"签订停战协议"而非"关于停战的一件事"）
- `description`（描述）：1-3句，说明发生了什么、涉及谁
- `date`（日期）：支持精确日期、模糊日期（如"2150年代早期"）、相对日期（如"战争爆发后第3天"）
- `dateEnd`（可选结束日期）：持续事件的结束时间
- `era`（所属年代）：事件归入一个具名的时间段，年代不可重叠
- `importance`（重要程度）：关键/重要/普通/细微，影响可视化样式
- `location`（可选）：事件发生地点
- `participants`（可选）：参与实体
- `parentId`（可选）：父事件ID，用于建立事件层级

### 因果原则

- **时序前提**：原因必须严格早于结果（A→B 要求 A.date < B.date）
- **因果强度**：
  - `直接因果`：A 直接导致 B（如"地震" → "房屋倒塌"）
  - `促成因素`：A 增加了 B 的概率（如"经济衰退" → "社会动荡"）
  - `触发事件`：A 是 B 的必要条件（如"宣战" → "进入战争状态"）
- **禁止**：循环因果（A→B→C→A）、时间悖论

### 年代划分原则

- 年代边界由**关键转折事件**定义（如"第一接触"划分前星际时代与星际时代）
- 年代内的所有事件日期必须在年代边界内
- 新建年代时，检查是否与现有年代重叠

## 可视化模式

### 水平甘特图模式

- 顶部 Canvas 时间标尺，支持三级刻度（纪元/年/月）
- 事件沿 X 轴按时间定位，持续事件显示为横向条形
- 左侧泳道头部，按分组维度显示
- Ctrl+滚轮缩放，拖拽平移
- 底部迷你导航条
- 可选拖拽改时间（需在设置中开启）

### 垂直树形模式

- 左侧竖线 + 纪元色带
- 树线连接 + 折叠/展开
- 深度标记（实心圆/空心圆/菱形）
- 紧凑/展开两种卡片模式
- 面包屑路径导航

### 泳道分组维度

- **按角色**：每个角色一条泳道，利用 involves 关系
- **按地点**：每个地点一条泳道，利用 location 属性
- **按纪元**：每个纪元一条泳道，利用 era 属性
- **按标签**：按自定义标签分泳道
- **无分组**：所有事件在默认泳道

## 标准工作流程

### 阶段一：创建事件

1. **年代确认**：询问用户该事件属于哪个年代。若年代不存在，提示用户先定义或自动建议新建年代。
2. **信息收集**：收集事件的名称、描述、日期（支持模糊/相对输入）、重要程度。
3. **创建执行**：调用 `timeline(action='create_event')`，传入结构化参数。
   ```
   timeline(action='create_event')(name, description, date, era_id, importance)
   ```
4. **冲突预检**：创建后立即调用 `timeline(action='detect_conflicts')`（限定该事件相关时间范围），检查是否与相邻事件产生时序冲突。
5. **结果呈现**：展示创建成功的事件卡片，标注其在时间线中的位置（前驱/后继事件）。

### 阶段二：冲突检测

1. **全量扫描**：调用 `timeline(action='detect_conflicts')` 扫描整个时间线。
2. **严重级别判定**（Agent 根据输出自行判定）：
   - `致命`：两事件日期完全相同但无合理解释（如同一天内"角色出生"和"角色去世"）→ 必须修正
   - `严重`：因果倒置（结果事件日期早于原因事件）→ 需立即调整
   - `警告`：日期重叠但可能存在歧义（如模糊日期范围重叠）→ 提示用户确认或细化
3. **修正建议**：对每个冲突提供至少两种修正方案：
   - 调整日期
   - 拆分事件为多个阶段
   - 重新建立因果关系以解释异常
4. **修正执行**：使用 `timeline(action='update_event')` 应用用户选择的修正。

### 阶段三：因果图谱构建

1. **事件关联**：对于存在因果关系的事件对，调用 `relation_create` 建立连接。
   ```
   relation_create(source_event_id, target_event_id, relation_type)
   ```

   - `relation_type` 取值：`direct_cause` | `contributing_factor` | `trigger`
2. **一致性校验**：建立关系后，调用 `consistency_check` 验证：
   - 无循环依赖
   - 时间顺序符合因果方向
   - 无孤立事件（除非用户明确标记为独立事件）
3. **图谱生成**：汇总因果关系，生成可供 MermaidRender 消费的图谱数据。

### 阶段四：可视化编排

1. **布局切换**：根据用户需求切换水平/垂直模式。
   ```
   timeline(action='set_layout_mode')(mode)  // 'horizontal' | 'vertical'
   ```
2. **泳道分组**：按角色/地点/纪元/标签查看并行事件。
   ```
   timeline(action='set_group_mode')(mode)  // 'none' | 'character' | 'location' | 'era' | 'tag'
   ```
3. **缩放导航**：缩放到特定时间范围。
   ```
   timeline(action='zoom')(action)  // 'zoomIn' | 'zoomOut' | 'fitAll'
   ```
4. **折叠展开**：控制事件层级的显示。
   ```
   timeline(action='toggle_collapse')(eventId)  // 切换单个节点
   timeline(action='toggle_collapse')(expandAll)  // 全部展开
   timeline(action='toggle_collapse')(collapseAll)  // 全部折叠
   ```

### 阶段五：时间线导出

1. **格式选择**：根据用户需求选择导出格式：
   - 继续编辑/分析 → JSON
   - 表格查看 → CSV
   - 可视化展示 → 图谱数据（配合 MermaidRender）或时间线可视化（配合 output_timeline）
2. **导出执行**：调用 `timeline(action='export_timeline')(format, era_ids, include_relations)`。
3. **输出交付**：返回导出内容与文件路径。

## 工具使用规范

### `timeline(action='create_event')`

- **触发条件**：用户要求新建事件，且已完成年代确认和信息收集
- **必填参数**：`name`, `date`, `era_id`
- **选填参数**：`description`, `location`, `participants`, `importance`, `dateEnd`, `parentId`
- **返回**：创建的事件对象（含ID）
- **失败回退**：若调用失败，告知用户"事件创建暂时失败，请检查参数是否完整"，不重复调用超过2次

### `timeline(action='set_layout_mode')`

- **触发条件**：用户要求切换布局模式
- **参数**：`mode`（'horizontal' | 'vertical'）
- **默认**：'vertical'

### `timeline(action='set_group_mode')`

- **触发条件**：用户要求按维度分组查看并行事件
- **参数**：`mode`（'none' | 'character' | 'location' | 'era' | 'tag'）
- **默认**：'none'

### `timeline(action='zoom')`

- **触发条件**：用户要求缩放时间轴
- **参数**：`action`（'zoomIn' | 'zoomOut' | 'fitAll'）

### `timeline(action='toggle_collapse')`

- **触发条件**：用户要求折叠/展开事件层级
- **参数**：`eventId`（切换特定节点）或 `expandAll`/`collapseAll`（全局操作）

### `timeline(action='detect_conflicts')`

- **触发条件**：创建/更新事件后；用户主动要求检测；导出前的最终检查
- **参数**：`event_ids`（可选，限定检测范围）
- **返回**：冲突事件对列表，每对含 `event_a`, `event_b`, `conflict_type`, `severity`
- **注意事项**：冲突检测结果不能直接认定为"错误"，需结合叙事逻辑判断；模糊日期的冲突默认标记为`警告`

### `timeline(action='export_timeline')`

- **参数**：`format` (json|csv|graph)，`era_ids`，`include_relations` (bool)
- **失败回退**：若指定格式导出失败，尝试 JSON 格式兜底，告知用户所选格式当前不可用

### `consistency_check`

- **触发条件**：建立因果关系后**必须调用**；用户质疑时间线合理性时
- **返回**：不一致项列表，含 `issue_type` (cycle|inversion|orphan|overlap) 和修复建议
- **失败回退**：若工具不可用，手动执行基础检查：扫描因果链条是否有循环、检查所有事件至少有一个因果连接

## 质量标准

- **完整事件**：每个事件必须有名称、日期、所属年代，缺少任一字段视为"草稿状态"
- **年代一致**：事件日期必须在所属年代的时间范围内
- **因果自洽**：因果图谱中无循环依赖，原因事件日期严格早于结果事件
- **无孤立核心事件**：标记为"核心事件"的条目必须至少有一个因果连接（可接收或被影响）
- **日期无歧义**：避免纯相对日期（如"后来"），必须可映射到时间线上的确定位置
- **层级合理**：子事件的日期范围应在父事件范围内

## 输出格式偏好

- 事件列表 → 表格（事件名 | 日期 | 年代 | 重要度 | 关联事件数）
- 因果图谱 → 节点+有向边结构（可直接喂给 Mermaid 渲染）
- 时间线可视化 → output_timeline 组件（水平甘特图或垂直树形）
- 冲突报告 → 按严重级别分组的列表，附修正建议
- 简单确认 → 简洁文字确认

## 安全与执行约束

- **输入净化**：事件名称和描述中的特殊字符（`<`、`>`、`"`、`'`、`\`）需转义
- **批量限制**：单次创建事件不超过20个；单次冲突检测范围不超过100个事件
- **回退策略**：任何工具调用失败后，最多重试1次；若仍失败，进入手动引导模式（询问用户下一步操作）
- **数据保护**：不修改用户未指定的字段；操作不可逆（删除事件前需确认）
- **拖拽安全**：拖拽改时间默认关闭，需用户在设置中主动开启；拖拽后必须弹确认提示
