# useEntityMentionIndex.ts 详细注释

> 来源：`packages/shared-composables/src/agent/useEntityMentionIndex.ts`
> 说明：本文件为 useEntityMentionIndex 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-19 行）

````
/**
 * # useEntityMentionIndex — 实体名反向索引（端无关）
 *
 * ## 职责
 * - 从 entityStore 构建实体名 → entityId[] 的反向索引
 * - entityStore 变更时自动更新（computed 驱动）
 * - 提供 matchInText(text) 方法，返回文本中所有实体名匹配位置
 *
 * ## 设计说明
 * - name 长度 ≥ 2 才入索引（避免单字歧义）
 * - 同名实体可能多个，匹配时返回全部 entityId
 * - 索引按 name 长度降序排列，优先匹配长名（避免"剑圣"被"剑"截断）
 * - 模块级单例：全局共享同一份索引
 *
 * ## 端无关说明
 * 仅依赖 Vue + entity-core（entityStore）。entityStore 由各端注入 Pinia 实例。
 *
 * 端分离批次3：从 src/agent/composables/useEntityMentionIndex.ts 迁移至 shared-composables。
 */
````
