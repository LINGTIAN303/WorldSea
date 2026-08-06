# useEntityMiniPanel.ts 详细注释

> 来源：`packages/shared-composables/src/entity/useEntityMiniPanel.ts`
> 说明：本文件为 useEntityMiniPanel 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-15 行）

````
/**
 * useEntityMiniPanel — 实体卡片小窗状态管理（模块级单例）
 *
 * 职责：
 * - 封装 FloatingPanel 的 visible/triggerRect 状态
 * - 维护当前打开的 entityId
 * - 提供 open(entityId, triggerRect) / close() API
 *
 * 设计说明：
 * - 模块级单例：与 useAgent 一致，全局共享同一份浮窗状态
 * - 单实例：同时只打开一个实体小窗（useFloatingPanel 是单例式 composable）
 * - triggerRect 来自触发元素（BlockEntityCard 按钮 / 消息内 mention），用于浮窗定位
 *
 * 端分离 Phase 3：迁移至 @worldsmith/shared-composables，三端共用。
 */
````
