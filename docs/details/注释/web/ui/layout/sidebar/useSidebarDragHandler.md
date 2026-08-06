# useSidebarDragHandler.ts 详细注释

> 来源：`apps/web/src/ui/layout/sidebar/useSidebarDragHandler.ts`
> 说明：本文件为侧边栏 HTML5 拖拽处理 composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 3-16 行）

```
/**
 * 侧边栏 HTML5 拖拽处理 composable(自定义视图模式下拖拽视图到看板)
 *
 * 说明:
 *  - 原侧边栏拖拽实际用途:从 Sidebar 拖拽视图到 DashboardView 的看板面板(非侧边栏内部重排)
 *  - drop target 在 DashboardView.vue 的 onExternalDrop,本 composable 只负责 dragstart
 *  - 逻辑极简(5 行设置 dataTransfer),独立成 .vue 子组件会引入包装层破坏 v-for 结构
 *    故采用 composable 实现,同样实现"拖拽逻辑与主交互解耦"的目标
 *
 * 职责:
 *  - 在自定义视图模式下,为 .sidebar-btn 提供 draggable 属性和 dragstart 处理
 *  - dragstart 时设置 dataTransfer(view-id / view-label / view-icon)
 *  - DashboardView 的 onExternalDrop 读取这些数据,把视图添加到看板
 */
```
