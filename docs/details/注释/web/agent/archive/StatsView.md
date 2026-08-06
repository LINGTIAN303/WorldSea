# StatsView.vue 详细注释

> 来源：`apps/web/src/agent/archive/StatsView.vue`
> 说明：本文件为 StatsView 组件内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 64-73 行）

```
/**
 * StatsView - 记忆库统计视图
 *
 * 从 ArchivePanel.vue 拆分。纯 UI 组件：
 * - 展示钩子总数、Tokens、置顶/活跃/淘汰数、平均重要性/衰减等
 * - 展示总访问次数、主动检索次数、存储占用（H3.5 新增）
 * - 展示孤儿/回收站/待合并钩子数量警告
 *
 * stats 和 metaInfo 由父组件通过 props 传入。
 */
```
