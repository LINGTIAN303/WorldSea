# 设置面板统一约定（2026-09-06 类名/契约归一后）

> 适用：全局设置弹窗（`apps/tauri/src/ui/settings/SettingsDialog.vue`）的 12 个 Tab 面板。
> 本文是防回潮约定：新增/修改设置面板必须遵守。

## 三契约（面板标准接口）

| 契约 | 形态 | 说明 |
|---|---|---|
| goToCard | `defineExpose({ goToCard: (i) => deckRef.value?.goToCard(i) })` | 设置弹窗左列分节标题点击翻卡 |
| searchQuery | `props.searchQuery` + 卡片 `v-show="match('关键词…')"`（或 Agent 面板的按 idx 关键词表） | 设置搜索过滤；弹窗搜索/常规两处都要接 `:search-query` |
| dirty | `emit('dirty')`（watch 设置项变更） | 设置弹窗关闭时的视图刷新依赖；**即时操作型面板可豁免**（现例：存储，决策记录在其代码内） |

## 基座样式（勿复制）

`.set-card / .sc-head / .set-row / .set-toggle 系列 / .set-hint / .set-cats / .set-cat / .set-input / .set-btn` 的唯一定义在
`packages/ui-kit/src/components/settings/settings-panels.css`（SettingsDialog 独家 import）。
面板 scoped 内**禁止再复制**这些规则；特殊变体以面板内一行覆盖显式保留
（现例：SproutsPanel 的 `.sc-head` flex、StorageManagementTab 的 `.sc-head` flex——标题行右侧带操作按钮）。

⚠️ 已知陷阱：`--color-surface` 与 `--color-surface-elevated` 在 web-tokens-bridge 中同映射 `--bg-surface`，
不能当两种颜色做层级区分（分层用 `--bg-muted` / `--color-surface` / 框线）。

⚠️ **scoped 跨组件陷阱**（2026-09-10 修正认知）：子组件内使用基座类名**不会**命中父组件 scoped 规则
（scopeId 不同）。仅**子组件根元素**会带上父组件 scopeId。故面板内的输入框/按钮必须使用
`settings-panels.css` 的基座类（`.set-input` / `.set-btn` / `.set-row`），不能指望父级 scoped 提供样式——
`McpPanel` / `SkillsStorePanel` 此前误用 `settings-input` / `sub-panel-btn`（父级 scoped 定义，实际落空），
2026-09-10 已统一为 `.set-input` / `.set-btn`。

## 类名与位置

- 全部面板统一 `.set-card`（卡）/ `.sc-head`（节标题）体系；历史遗留的 `sm-*`（存储）、`agent-set-*`（Agent）、`.set-card-title` 已归一删除。
- **分类筛选栏**统一用 `.set-cats` + `.set-cat`（药丸式 tab）+ `.set-cat-count`（计数徽标）。
  2026-09-10 收敛：此前 `McpPanel` 的 `.ms-cat*` 与 Agent 面板 Skills 卡的同名 `.ms-cat*` 是两份私有拷贝，已删除。
- 面板实现位置：通用面板在 `packages/ui-kit/src/components/settings/panels/`，
  apps/tauri 侧 `ui/settings/panels/` 只放 re-export 薄壳（Phase 8d 惯例）；
  例外：存储（`ui/data/StorageManagementTab.vue`，依赖应用侧 composables）、
  Agent（`space/panels/SpaceAgentSettingsPanel.vue` 内嵌 `agent/AgentSettingsPanel.vue`，依赖应用侧 agent 体系）——
  这两个因依赖方向暂留应用侧，类名与契约已归一。
- **App 面板内的卡片组件**（非设置 Tab 面板，例如 Agent 类的 `McpPanel` / `SkillsStorePanel`）：
  位于 `apps/tauri/src/agent/panels/`，通过宿主 `AgentSettingsPanel.vue` 的 `.set-card` 卡承载，
  自身**不使用** `.sc-head`（标题由宿主提供），但内部控件须用基座类。

## Agent 类卡片清单（embedded 路径 `CardDeck :count`）

| idx | 标题 | 实现 |
|---|---|---|
| 0 | 模型 | `panels/model/ModelsSection.vue` |
| 1 | Skills | 内联（工具区块 + 技能清单）+ `SkillsStorePanel.vue` |
| 2 | MCP | `agent/panels/McpPanel.vue` |
| 3 | 规则 | `@/space/panels/RulesPanel.vue` |
| 4 | 安全 | 内联（安全级别 + 权限规则） |
| 5 | 内置工具 | `@worldsea/ui-kit/.../panels/BuiltinToolsPanel.vue`（2026-09-10 新增） |
| 6 | 插件 | `@worldsea/ui-kit/.../panels/AgentPluginsPanel.vue`（2026-09-10 新增；此处「插件」为 **Agent 插件**语义 = 能力打包分发层，非世界观「芽」） |

> 新增卡片时四处必须同步：`CardDeck :count`、卡片模板、`CARD_KEYWORDS`（按 idx 对齐）、
> `SettingsDialog.vue` 的 `CATEGORY_KEYWORDS.agent`。

## 弹窗机制（SettingsDialog 侧，勿重复实现）

- Tab 清单：`categories` 数组（12 项）；点击激活、再点收起。
- 搜索模式：`matchedCategories` 过滤 + 面板 `flat` 平铺渲染；关键词表在 `CATEGORY_KEYWORDS`（新增 Tab 要同步）。
- 左列分节导航：`HEADING_SELECTOR='.sc-head'` / `SECTION_SELECTOR='.set-card'`（归一后单一体系）；
  面板标题元素务必用 `.sc-head`，否则左列不出该节。
