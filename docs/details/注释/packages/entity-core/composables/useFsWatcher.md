# useFsWatcher.ts 详细注释

> 来源：`packages/entity-core/src/composables/useFsWatcher.ts`
> 说明：本文件为 useFsWatcher 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-14 行）

````
/**
 * useFsWatcher — 文件系统变更监听
 *
 * 当项目有关联目录时，启动 Tauri 后端文件监听，
 * 接收 `fs:change` 事件并同步到前端 Store。
 *
 * 模块级单例 + 引用计数：所有组件共享同一个监听实例。
 * 多次 startWatching 同一目录仅增加引用计数；
 * stopWatching 仅在引用计数归零时才真正停止后端监听。
 * 目录变更时自动重启后端监听。
 *
 * Phase 5a: 从根 src/composables/useFsWatcher.ts 迁移到 entity-core/composables，
 * 内部依赖改为相对路径（../core、../stores）。
 */
````
