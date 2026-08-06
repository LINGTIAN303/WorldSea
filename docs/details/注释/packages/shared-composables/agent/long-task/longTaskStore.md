# longTaskStore.ts 详细注释

> 来源：`packages/shared-composables/src/agent/long-task/longTaskStore.ts`
> 说明：本文件为 longTaskStore 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-16 行）

````
/**
 * LongTaskStore — 长任务持久化层
 *
 * 任务 4（Agent 长任务能力）P1 核心：
 *   将长任务记录（含 checkpoint 快照）持久化到 IndexedDB（Dexie），
 *   支持页面刷新/崩溃后从断点恢复。
 *
 * 设计参考：
 *   - GroupSessionManager.ts 的 Dexie 单例模式
 *   - src-tauri workflow 引擎的 SqliteStore 持久化模式（状态机 + 进度 + checkpoint）
 *
 * 复用 workflow 引擎的"设计模式"而非存储后端：
 *   前端 Agent 在 Web/Tauri 模式下均无 SqliteStore，故用 IndexedDB。
 *
 * 端分离 Phase 3：迁移至 @worldsmith/shared-composables，三端共用。
 */
````
