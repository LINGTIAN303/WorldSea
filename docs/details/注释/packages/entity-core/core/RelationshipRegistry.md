# RelationshipRegistry.ts 详细注释

> 来源：`packages/entity-core/src/core/RelationshipRegistry.ts`
> 说明：本文件为 RelationshipRegistry 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-10 行）

````
/**
 * 全局关系注册中心（Relationship Registry）
 *
 * 设计决策：
 * - 所有关系集中声明，消除插件间的重复定义
 * - 基于 RelationTypeSchemaV2：强制有向 + 强制 inverseType
 * - 对称关系 inverseType 指向自身
 * - 按 sourceType/targetType 索引，支持高效查询
 * - 插件激活/停用只影响数据可见性，不影响关系定义
 */
````
