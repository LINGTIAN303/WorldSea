<!-- memory-center-agents begin -->
# 内置工具面板（BuiltinToolsPanel）详细注释

> 对应实现：`packages/ui-kit/src/components/settings/panels/BuiltinToolsPanel.vue`
> 挂载位置：`apps/tauri/src/agent/AgentSettingsPanel.vue` embedded 路径 idx 5

## 一、设计决策（why）

### 为什么是「只读目录」而不是「启停开关」

Agent 的「工具」这一概念在两个层面被使用，容易混淆：

| 层面 | 语义 | 现入口 |
|---|---|---|
| 工具目录 | Agent **能**调用哪些工具（全景、元数据） | 本面板 |
| 工具开关 | 用户**允许**用哪些工具（策略） | Skills 卡「工具」区块（4 项能力：搜索/视觉/图像/视频） |

本面板只做前者，理由有三：

1. **避免双开关冲突**：Skills 卡现有 4 项能力开关走 `localStorage` 的 `worldsea_capability_tools` 键，与 `TOOL_CATEGORIES` 的 20 分类体系不连通。若本面板再做一套勾选，会出现两个开关控制同一事实源的问题。
2. **20 分类 × 39 工具模块的规模不适合做勾选 UI**：可读性优先。
3. **职责单一**：本面板回答「有什么」，Skills 卡回答「开不开」。

面板底部因此显式给出引导语：「启停请前往 Skills 卡片的『工具』区块」。

### 为什么权限徽标用三色而非文字

`PermissionLevel` 只有三档（`safe` / `moderate` / `dangerous`），语义稳定。使用颜色 + 短文字（安全/需确认/危险）双重编码，兼顾快速扫读与色觉障碍用户。

## 二、数据源（what）

- `TOOL_CATEGORIES`（`@worldsea/agent-runtime`，定义在 `packages/agent-runtime/src/agent.ts:253`）
  - 20 个分类，每类含 `{ id, label, tools }`
  - 注意：**分类间存在重叠**——同一工具可能出现在多个分类（如 `webSearchTools` 同时属于 `search` 与 `coding-agent`）。因此总数统计必须按工具名去重。
- `getToolMeta(name)`（`@worldsea/agent-runtime`，定义在 `tools/tool-meta-registry.ts:70`）
  - 三级查找：全局 ToolRegistry → `ALIAS_MAP`/`LEGACY_*` → 兜底 `{ permission: 'moderate', category: 'coding' }`
  - 本面板用到的字段：`permission` / `alwaysAvailable`
  - **注意遍历工具名时不能用 `getToolMeta` 反查分类**（兜底值会污染统计）

## 三、整体思路（how）

1. 顶部概览行展示：工具总数（去重？否——按分类内条目累加，与左列各分类计数口径一致）、分类数、三档权限计数（此处**去重**，故各档之和 ≤ 总数）
2. 分类折叠列表：默认全部折叠（避免首屏过长），点击标题展开
3. 展开后逐行展示工具：`名称 | 描述 | 权限徽标`，`alwaysAvailable` 工具追加「常驻」标记

## 四、约束与踩坑

- **必须使用 `.sc-head` 作为卡片标题**（在父组件 `AgentSettingsPanel.vue` 内），否则设置弹窗左列 rail 不出该节
- 搜索过滤通过 `matchKeywords(props.searchQuery, keywords)`，关键词表在父组件 `CARD_KEYWORDS[5]`
- 权限计数与总数口径不一致是**有意为之**（见上），若改为一致需同步修改概览文案
<!-- memory-center-agents end -->
