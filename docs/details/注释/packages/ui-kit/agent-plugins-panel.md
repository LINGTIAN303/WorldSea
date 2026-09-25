# Agent 插件面板（AgentPluginsPanel）详细注释

> 对应实现：`packages/ui-kit/src/components/settings/panels/AgentPluginsPanel.vue`
> 挂载位置：`apps/tauri/src/agent/AgentSettingsPanel.vue` embedded 路径 idx 6

## 一、术语界定（重要）

WorldSea 项目中「插件」一词**多义并存**，本面板只承载其中一义。未加界定会造成严重混淆：

| 含义 | 载体 | 数量 | 归口 |
|---|---|---|---|
| **A. 世界观插件** | `entity-core` 的 `PluginAPI` / `DEFAULT_PLUGINS` | 26 个（原 27，`official.module-builder` 已于 2026-09-25 随「自定义模块」整体剪除） | 内置工具系统中「数据域/视图扩展」的一环 |
| **B. 插件工具集** | `plugin-tools.ts`(5) + `plugin-backend-tools.ts`(10) | 15 个工具 | 内置工具系统中「跨插件统一操作接口」 |
| **C. Agent 插件系统** | 无代码 | 0 | **本面板** —— 能力打包/分发/安装层 |

本面板对应 **C**。A 与 B 已归入「内置工具」范畴（见审查报告 §概念修正）；C 是**尚未开始**的能力面。

## 二、为什么先建空状态占位

审查报告（`docs/plans/2026-09-10-Agent能力面整顿审查.md` §D）已定论：Agent 插件系统零代码。此面板先行占位的目的：

1. **信息位预留**：能力面四模块（Skills / MCP / 内置工具 / 插件）在设置 UI 上对齐，用户可感知完整坐标系
2. **界定语义**：在 UI 层面明确「插件 ≠ 世界观插件」，为后续立项减少沟通成本
3. **给出就绪度**：四类可打包组件（依 Agent Plugins 1.0.0）标注本项目对应能力的就绪状态

## 三、四类可打包组件（依 Agent Plugins 1.0.0）

外部标准（agent-plugins.org，AWS/Cursor/Microsoft/OpenAI/Vercel 技术指导委员会，2026-08 发布）中，
v1 **标准化两类组件**，hooks 与自定义 agents 在路线图：

| 组件 | 本项目就绪 | 依据 |
|---|---|---|
| Agent Skills | ✅ `ready: true` | `worldsea-skills-store` + SkillsStorePanel 已具备 |
| MCP 服务器 | ✅ `ready: true` | 全局单份 `mcp.json` + McpPanel 已具备 |
| Hooks | ❌ `ready: false` | kernel 已有 `tool_hook.rs` 位点，但未插件化 |
| Agents | ❌ `ready: false` | 无自定义子 Agent 定义/分发设施 |

## 四、约束与踩坑

- **卡片标题在父组件**（`.sc-head` = 插件），本组件只渲染内容
- **首行界定语必须保留**：这是与全局设置「插件」分类（世界观插件开关）的区分锚点
- **不要在此面板复用 `SproutsPanel`**：那是世界观「芽」的实现，两者数据源与语义均不同
- 空状态用 `WsEmpty`（`preset="custom"` + 自定义 icon/title/description），不要手写空状态 DOM
- 搜索关键词表在父组件 `CARD_KEYWORDS[6]`

## 五、后续立项时的对接点

- 插件 manifest 扫描目录约定：沿用 Agent Plugins 1.0.0 的「目录 + JSON manifest + 固定组件位置」
- 分发链可复用 `worldsea-skills-store`（Skills 已是插件组件之一）
- 能力聚合抽象（capability provider）为前置条件：审查报告 §E1 已列为待裁决项
