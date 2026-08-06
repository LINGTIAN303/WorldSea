# events.ts 详细注释

> 来源：`packages/entity-core/src/core/events.ts`
> 说明：本文件为 events 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-8 行）

````
/**
 * events — 事件总线 + 生命周期事件
 *
 * 跨模块通信基础设施。实体 CRUD 时发射事件，其他模块（或 formula）
 * 通过 on() 订阅并响应。
 *
 * Phase 8a：从根 src/modules/runtime/events.ts 下沉到 entity-core/core/
 */
````
