# useSidebarInteraction.ts 详细注释

> 来源：`apps/web/src/ui/layout/sidebar/useSidebarInteraction.ts`
> 说明：本文件为侧边栏交互处理 composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 34-54 行）

```
/**
 * 侧边栏交互处理 composable
 *
 * 核心修复(对比原 Sidebar.vue):
 *  1. 点击 vs 拖拽判定:用 totalDy(总位移)而非 dy(单帧增量)
 *     原代码 onPointerMove 无条件更新 pos,导致 < 25px 的微小移动污染 pos
 *  2. 阈值内不更新 pos:dragMoved=false 时 pos 保持 startPos
 *     原代码 pos = dragStartPos - dy * SENSITIVITY 用 dy 增量,导致每帧振荡
 *  3. 点击用 startPos 计算跳转目标:避免 pos 被污染
 *     原代码用 Math.round(pos),可能命中被污染的 pos
 *
 * 职责:
 *  - 监听 pointerdown/move/up
 *  - 判定点击 vs 拖拽(25px 阈值)
 *  - 拖拽时计算总位移并回调 onDragMove
 *  - 释放时根据 dragMoved 回调 onClick 或 onDragEnd
 *
 * 不含:
 *  - 物理动画(由 useSidebarPhysics 处理)
 *  - DOM 样式更新(由 SidebarV2 处理)
 */
```
