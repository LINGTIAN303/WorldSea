# ImportController.ts 详细注释

> 来源：`packages/entity-core/src/core/io/ImportController.ts`
> 说明：本文件为 ImportController 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 11-27 行）

````
/**
 * ImportController — 统一导入调度器
 *
 * 将 WorldSmithPack 按依赖顺序（拓扑排序）恢复到系统。
 * 支持 overwrite（全量覆盖）和 merge（按 id 去重合并）两种策略。
 *
 * 导入顺序 by design:
 *   1. custom-modules  → 先恢复模块定义
 *   2. entity-types    → 再恢复类型 Schema
 *   3. relation-types  → 关系类型 Schema
 *   4. views           → 视图注册
 *   5. entities        → 实体实例
 *   6. relations       → 关系实例
 *
 * Phase 8a 下沉改造：
 *   - validatePack 依赖剥离为 PackValidator 接口（通过 registerPackValidator 注入）
 */
````
