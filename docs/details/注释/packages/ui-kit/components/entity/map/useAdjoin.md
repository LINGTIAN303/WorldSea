# useAdjoin.ts 详细注释

> 来源：`packages/ui-kit/src/components/entity/map/useAdjoin.ts`
> 说明：本文件为 useAdjoin 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-11 行）

````
/**
 * 接壤模式 composable
 *
 * 负责：
 * - 接壤选择模式的状态（多选目标区域）
 * - 接壤关系建立（relation type='borders'）
 * - 接壤方式的合并逻辑（extend / be-extended）
 *
 * 注意：与主上下文菜单的关闭逻辑（closeCtx）存在协作，
 * 通过 onAdjoinDone 回调通知主文件清理菜单状态。
 */
````
