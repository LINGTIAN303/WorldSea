# TrashView.vue 详细注释

> 来源：`apps/web/src/agent/archive/TrashView.vue`
> 说明：本文件为 TrashView 组件内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 44-54 行）

```
/**
 * TrashView - 回收回站视图
 *
 * 从 ArchivePanel.vue 拆分。自包含回收站状态和逻辑：
 * - 加载回收站列表
 * - 恢复钩子
 * - 永久删除钩子
 * - 清空回收站
 *
 * 通过 emit 'restored' 通知父组件刷新主钩子列表。
 */
```
