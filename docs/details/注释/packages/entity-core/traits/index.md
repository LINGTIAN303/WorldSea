# traits/index.ts 详细注释

> 来源：`packages/entity-core/src/traits/index.ts`
> 说明：本文件为 traits/index 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-14 行）

````
/**
 * 原子 Trait 定义 v1.1
 *
 * 13 个原子 Trait，基于路线1（严格标准）提炼。
 * 所有 Trait 通过 defineTrait() 注册到 traitRegistry。
 *
 * 原则：
 * - 不可变、零参数
 * - 字段最小语义集
 * - Classifiable 等分类字段为 entity-specific
 * - Deteriorable 提供默认选项，实体可通过 fieldOverrides 覆盖
 * - Significant 降级为 entity-specific（语义泛化，无统一校验规则）
 * - Ageable 独立于 Physical（物理形态 vs 生命时间点）
 */
````
