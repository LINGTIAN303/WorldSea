# formula.ts 详细注释

> 来源：`packages/entity-core/src/core/formula.ts`
> 说明：本文件为 formula 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-15 行）

````
/**
 * core/formula.ts — 轻量公式引擎
 *
 * 支持：
 *   - 四则运算: + - * / %
 *   - 比较: == != < > <= >=
 *   - 逻辑: && || !
 *   - 字段引用: {field_name} 或直接用字母标识符
 *   - 聚合: SUM(field), COUNT(field), AVG(field), MIN(field), MAX(field)
 *   - 括号分组
 *
 * 纯函数，无 eval，沙箱安全。
 *
 * Phase 3：从 src/modules/runtime/formula.ts 下沉到 entity-core
 */
````
