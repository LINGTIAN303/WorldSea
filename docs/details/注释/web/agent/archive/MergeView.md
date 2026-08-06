# MergeView.vue 详细注释

> 来源：`apps/web/src/agent/archive/MergeView.vue`
> 说明：本文件为 MergeView 组件内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 64-73 行）

```
/**
 * MergeView - 待合并钩子管理视图
 *
 * 从 ArchivePanel.vue 拆分。自包含合并状态和逻辑：
 * - 加载待合并组
 * - 确认单组合并
 * - 确认全部合并
 *
 * 通过 emit 'merged' 通知父组件刷新主钩子列表。
 */
```
