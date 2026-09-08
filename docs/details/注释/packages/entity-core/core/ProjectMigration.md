# ProjectMigration.ts 详细注释

> 来源：`packages/entity-core/src/core/ProjectMigration.ts`
> 说明：本文件为 ProjectMigration 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-12 行）

````
/**
 * ProjectMigration — 一次性数据迁移
 *
 * 将旧的全局数据库 WorldSea / worldsea-agent 中的数据
 * 迁移到项目级数据库 WorldSea-Project-${projectId} / worldsea-agent-${projectId} 中。
 *
 * 迁移策略：
 * - 增量拷贝（不删除旧数据），安全回退
 * - 大数据量分批处理（每批 500 条），避免阻塞主线程
 * - 迁移失败不阻塞应用启动，降级为空项目
 * - 仅在首次运行时执行（通过 WorldSea-Meta.appState.projectMigrationDone 标记）
 */
````
