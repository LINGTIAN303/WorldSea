# types/trait.ts 详细注释

> 来源：`packages/entity-core/src/types/trait.ts`
> 说明：本文件为 types/trait 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

````
/**
 * Trait 类型系统 v1.0
 *
 * 原子 Trait 是字段的最小语义集，不可变、零参数。
 * 预置组合（Preset）是语法糖，不进入数据模型。
 *
 * 设计决策：
 * - Trait 只声明字段和语义标签，不注册关系
 * - Classifiable 等分类字段为 entity-specific，非 Trait
 * - Temporal 拆为 Datable，其余 entity-specific
 * - Conditioned 拆为 Rateable + Deteriorable
 * - Deteriorable 提供默认选项，实体可通过 fieldOverrides 覆盖
 */
````
