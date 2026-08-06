# useDrawing.ts 详细注释

> 来源：`packages/ui-kit/src/components/entity/map/useDrawing.ts`
> 说明：本文件为 useDrawing 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-10 行）

````
/**
 * 绘制模式 composable
 *
 * 负责：
 * - 普通绘制模式（手绘疆域边界 → 创建新区域）
 * - 边境线模式（按 Alt 触发，分割/增补现有区域）
 *
 * 鼠标坐标相关的命中检测由主文件调用 handleDrawMouseDown/Move/Up 完成。
 * 本 composable 内部管理 drawingPath 与 isDrawing 状态。
 */
````
