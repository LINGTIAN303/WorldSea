# useFileSystemProject.ts 详细注释

> 来源：`packages/entity-core/src/composables/useFileSystemProject.ts`
> 说明：本文件为 useFileSystemProject 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

````
/**
 * useFileSystemProject — 项目目录绑定与导出
 *
 * 改造后对接 FileStorageBackend 体系：
 * - "打开文件夹" → 绑定本地目录到当前项目（setStorageProjectDir + FsWatcher）
 * - "保存到文件夹" → 导出项目到指定目录（ProjectFS.exportProjectToDir）
 *
 * 不再使用浏览器 File System Access API（pack.json 格式），
 * 改为 Tauri 后端文件操作 + FileStorageBackend 目录结构。
 *
 * Phase 5a: 从根 src/composables/useFileSystemProject.ts 迁移到 entity-core/composables，
 * 内部依赖改为相对路径（../core、../stores）。
 */
````
