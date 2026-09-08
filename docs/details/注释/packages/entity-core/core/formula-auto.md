# formula-auto.ts 详细注释

> 来源：`packages/entity-core/src/core/formula-auto.ts`
> 说明：本文件为 formula-auto 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-12 行）

````
/**
 * core/formula-auto.ts — Formula 自动重算
 *
 * 监听 field:change 事件，找出所有依赖该字段的 formula 字段并自动重算。
 * 在 registry initialize() 中注册。
 *
 * Phase 3：从 src/modules/runtime/formula-auto.ts 下沉到 entity-core
 * 导入路径调整：
 *   - ./events → ./events（包内相对）
 *   - ./formula → ./formula（包内相对）
 *   - @worldsea/entity-core → ../stores + ./EntitySchema（包内相对）
 */
````
