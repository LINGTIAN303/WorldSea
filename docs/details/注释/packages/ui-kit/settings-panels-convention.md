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

`.set-card / .sc-head / .set-row / .set-toggle 系列 / .set-hint` 的唯一定义在
`packages/ui-kit/src/components/settings/settings-panels.css`（SettingsDialog 独家 import）。
面板 scoped 内**禁止再复制**这些规则；特殊变体以面板内一行覆盖显式保留
（现例：PluginsPanel 的 `.sc-head` flex、StorageManagementTab 的 `.sc-head` flex——标题行右侧带操作按钮）。

⚠️ 已知陷阱：`--color-surface` 与 `--color-surface-elevated` 在 web-tokens-bridge 中同映射 `--bg-surface`，
不能当两种颜色做层级区分（分层用 `--bg-muted` / `--color-surface` / 框线）。

## 类名与位置

- 全部面板统一 `.set-card`（卡）/ `.sc-head`（节标题）体系；历史遗留的 `sm-*`（存储）、`agent-set-*`（Agent）、`.set-card-title` 已归一删除。
- 面板实现位置：通用面板在 `packages/ui-kit/src/components/settings/panels/`，
  apps/tauri 侧 `ui/settings/panels/` 只放 re-export 薄壳（Phase 8d 惯例）；
  例外：存储（`ui/data/StorageManagementTab.vue`，依赖应用侧 composables）、
  Agent（`space/panels/SpaceAgentSettingsPanel.vue` 内嵌 `agent/AgentSettingsPanel.vue`，依赖应用侧 agent 体系）——
  这两个因依赖方向暂留应用侧，类名与契约已归一。

## 弹窗机制（SettingsDialog 侧，勿重复实现）

- Tab 清单：`categories` 数组（12 项）；点击激活、再点收起。
- 搜索模式：`matchedCategories` 过滤 + 面板 `flat` 平铺渲染；关键词表在 `CATEGORY_KEYWORDS`（新增 Tab 要同步）。
- 左列分节导航：`HEADING_SELECTOR='.sc-head'` / `SECTION_SELECTOR='.set-card'`（归一后单一体系）；
  面板标题元素务必用 `.sc-head`，否则左列不出该节。
