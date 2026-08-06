# useManuscriptAnimation.ts 详细注释

> 来源：`packages/shared-composables/src/agent/useManuscriptAnimation.ts`
> 说明：本文件为 useManuscriptAnimation 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

````
/**
 * # useManuscriptAnimation — 手稿块打字机动画（端无关）
 *
 * ## 职责
 * - 根据 ManuscriptBlock 内容驱动逐字显示动画
 * - 自适应延迟：内容越长，单字延迟越短（避免长文动画过长）
 * - 支持 prefersReducedMotion：无动画直接显示全部
 *
 * ## 端无关说明
 * 仅依赖 Vue + motion-kit（useReducedMotion）+ Agent 类型。
 *
 * 端分离批次3：从 src/agent/composables/useManuscriptAnimation.ts 迁移至 shared-composables。
 */
````
