# ArchivePanel.vue 详细注释

> 来源：`apps/web/src/agent/ArchivePanel.vue`
> 说明：本文件为 ArchivePanel 组件内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 178-192 行）

```
/**
 * ArchivePanel - 记忆库管理面板
 *
 * P3-3-3 新增：记忆库管理 UI，提供钩子列表/详情/搜索/统计/回收站/合并/配置 7 个子视图。
 *
 * 子视图已拆分为独立组件（src/agent/archive/）：
 * - HookListView：列表 + 详情视图
 * - SearchView：搜索视图（自包含搜索逻辑）
 * - StatsView：统计视图（纯 UI，接收 stats/metaInfo props）
 * - TrashView：回收站视图（自包含回收站逻辑）
 * - MergeView：待合并视图（自包含合并逻辑）
 *
 * 父组件保留：subPanel 切换、hooks 共享状态、stats computed、
 * 手动归档、周期任务调度、配置面板、面板拖拽。
 */
```
