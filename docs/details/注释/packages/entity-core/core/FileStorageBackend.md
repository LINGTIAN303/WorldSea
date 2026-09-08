# FileStorageBackend.ts 详细注释

> 来源：`packages/entity-core/src/core/FileStorageBackend.ts`
> 说明：本文件为 FileStorageBackend 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-20 行）

````
/**
 * FileStorageBackend — 基于本地文件系统的存储后端
 *
 * Phase 2 核心组件：将实体、关系等数据以 JSON 文件形式存储在项目目录中。
 * 当项目有关联目录时使用此后端，否则降级到 WebStorageBackend/TauriStorageBackend。
 *
 * 目录结构：
 * ```
 * ProjectDir/
 * ├── entities/{type}/{name_id}.json   # 每个实体一个文件
 * ├── relations/_index.json            # 所有关系集中存储
 * ├── .worldsea/
 * │   ├── kv_store.json                # 键值对存储
 * │   ├── files_meta.json              # 文件元数据
 * │   └── files_content/               # 文件内容
 * │       └── {id}.json
 * ```
 *
 * 内存索引：启动时扫描 entities/ 目录构建索引，避免每次查文件系统。
 */
````
