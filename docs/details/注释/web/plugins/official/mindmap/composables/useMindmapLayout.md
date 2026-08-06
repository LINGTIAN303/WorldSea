# useMindmapLayout.ts 详细注释

> 来源：`apps/web/src/plugins/official/mindmap/composables/useMindmapLayout.ts`
> 说明：本文件为思维导图布局 composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-12 行）

```
/**
 * 思维导图布局相关逻辑
 *
 * 从 MindmapView.vue 拆出，封装：
 * - buildCanvasData: 构建 canvasNodes/canvasEdges
 * - mapToGraphData: 转换为 Rust 布局输入
 * - applyLayout: 调用 rustLayout 并触发动画
 * - rebuildGraph: 重建 + 布局 + fitView
 * - savePositions: 持久化节点位置
 * - onLayoutChange: 切换布局算法
 * - toggleType: 切换类型过滤
 */
```
