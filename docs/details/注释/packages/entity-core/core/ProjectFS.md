# ProjectFS.ts 详细注释

> 来源：`packages/entity-core/src/core/ProjectFS.ts`
> 说明：本文件为 ProjectFS 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-27 行）

> **2026-09-25 注**：目录树中的 `modules/`（自定义模块定义）条目已删——「自定义模块」随本批整体剪除（见 [剪自定义模块批计划](../../../../../plans/已完成/2026-09-25-剪自定义模块批计划.md)），导出不再输出该目录。

````
/**
 * ProjectFS — 项目文件系统导出/导入
 *
 * Phase 1: 将 IndexedDB 中的项目数据导出为本地文件夹结构，
 * 以及从文件夹结构导入恢复到 IndexedDB。
 *
 * 目录结构规范：
 * ```
 * MyProject/                     # 项目根目录
 * ├── project.json               # 项目元数据
 * ├── entities/                  # 实体数据，按类型分目录
 * │   ├── character/
 * │   │   ├── hero-001.json      # 单个实体一个文件
 * │   │   └── villain-002.json
 * │   └── region/
 * │       └── kingdom-001.json
 * ├── relations/
 * │   └── _index.json            # 所有关系集中存储
 * ├── settings/
 * │   └── plugins.json           # 插件开关（当前仅此一项，视图排序/配置未落盘）
 * └── .worldsea/               # 内部元数据
 *     └── cache.json             # 版本/校验信息
 * ```
 */
````
