# TraitRuntime.ts 详细注释

> 来源：`packages/entity-core/src/core/TraitRuntime.ts`
> 说明：本文件为 TraitRuntime 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 155-164 行）

````
/**
 * 编译 EntitySchemaV2：将 traits 的字段 + ownFields 合并为 _compiledFields。
 * 处理 fieldOverrides 覆盖逻辑。
 *
 * 编译顺序：
 * 1. 按 traits 声明顺序，逐个展开 Trait 的字段
 * 2. 对每个 Trait 的字段，应用该 TraitRef 的 fieldOverrides
 * 3. 追加 ownFields
 * 4. 去重：如果 ownFields 的 key 与 Trait 字段冲突，ownFields 优先
 */
````
