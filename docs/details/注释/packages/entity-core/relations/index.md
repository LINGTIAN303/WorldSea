# relations/index.ts 详细注释

> 来源：`packages/entity-core/src/relations/index.ts`
> 说明：本文件为 relations/index 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-12 行）

````
/**
 * 全局关系定义 v1.0
 *
 * 从20个插件中提取、去重、合并的所有关系。
 * 按领域分组，使用 defineRelation 注册到 relationshipRegistry。
 *
 * 原则：
 * - 所有关系强制有向 + 强制 inverseType
 * - 对称关系 inverseType 指向自身
 * - 消除命名混乱（located_at 收敛为「物品→地点」的 ownership 域语义；located_in 为「地区→地区」的地理域语义，二者并存、不重复）
 * - 消除重复声明（member_of, owned_by 等只声明一次）
 */
````
