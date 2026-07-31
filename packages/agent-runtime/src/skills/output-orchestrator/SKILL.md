---
name: output-orchestrator
description: >
  输出路由与编排。当 Agent 需要决定内容以何种形式输出时激活。
  提供输出通道决策树、组件选择指南、插件写入规范、多通道组合规则。
  关键词：输出、展示、渲染、写入、表格、图表、流程图、笔记。
capabilities:
  internal:
    - ui.surface.create
    - ui.components.update
    - ui.data.update
    - ui.surface.delete
    - plugin_write
    - file_write
  cli: []
  mcp: []
---

## 目标

帮助 Agent 智能选择输出通道和呈现组件，确保内容以最合适的形式展示给用户或写入目标位置。

## 触发条件

- 需要决定内容以何种形式输出时
- 用户要求特定展示形式（表格、图表、流程图等）
- 需要将内容写入插件（正文、笔记、大纲）时
- 不确定应该用 A2UI 还是聊天文本时

## 输出通道决策树

### 1. 判断内容类型

| 内容类型 | 首选通道 | 组件/目标 |
|---------|---------|----------|
| 结构化数据（对比/列表/属性） | a2ui | EditableTable |
| 数值数据（统计/排名/趋势） | a2ui | ChartView |
| 关系/流程/层次 | a2ui | MermaidRender |
| 空间/几何/地图 | a2ui | SvgCanvas |
| 选项/建议/方案 | a2ui | SuggestionPicker |
| 正文/剧情/对话 | chat 或 plugin | manuscript 插件 |
| 分析报告/诊断结果 | plugin | notebook 插件 |
| 资料收集/参考信息 | plugin | notebook 插件 |
| 简短确认/说明 | chat | Markdown 文本 |
| 导出文件 | file | file_write |

### 2. 多通道组合规则

- **展示 + 保存**：先 a2ui 展示，再 plugin 写入（如：表格展示 + 笔记本保存报告）
- **选项 + 执行**：先 SuggestionPicker 让用户选，再执行选定方案
- **图表 + 解读**：先 ChartView/MermaidRender，再 chat 文字解读

### 3. 插件写入规范

使用 `plugin_write` 工具写入插件实体：

- **manuscript**：写入正文内容，data 结构为 `{ content, volumeName?, status? }`
- **notebook**：写入笔记，data 结构为 `{ content, noteType, tags?, folderId?, codeLanguage? }`
- **outline**：写入大纲节点，data 结构为 `{ title, content?, parentId? }`

写入前必须通过 ConfirmBar 或 SuggestionPicker 获得用户确认。

## 组件选择指南

详见 [see reference: component-catalog]

## 输出模板

详见 [see reference: output-channel-guide]

## 质量标准

- 结构化数据必须使用表格/图表，禁止纯文本罗列
- 超过 3 个选项时必须使用 SuggestionPicker
- 写入插件前必须获得用户确认
- 图表必须有标题和图例
- 流程图方向统一（从上到下或从左到右）
