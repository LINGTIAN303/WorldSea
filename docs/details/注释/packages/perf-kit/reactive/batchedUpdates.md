# batchedUpdates.ts 详细注释

> 来源：`packages/perf-kit/src/reactive/batchedUpdates.ts`
> 说明：本文件为 batchedUpdates 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 3-17 行）

````
/**
 * 批量更新合并器（batchedUpdates）。在同一个微任务/RAF/宏任务周期内
 * 收集对同一 id 的多次 update，合并为一次回调执行，避免逐条触发响应式更新。
 *
 * 解决 PERF-03：高频增删改导致响应式更新风暴。
 *
 * 用法：
 *   const batcher = createUpdateBatcher((batch) => {
 *     for (const { id, changes } of batch) store.updateById(id, changes)
 *   })
 *
 *   batcher.queue('a', { name: 'x' })
 *   batcher.queue('a', { tags: ['t'] })   // 同一周期内合并为 { name, tags }
 *   batcher.queue('b', { name: 'y' })
 */
````
