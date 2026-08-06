# useAgentEvents.ts 详细注释

> 来源：`packages/shared-composables/src/agent/useAgentEvents.ts`
> 说明：本文件为 useAgentEvents 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-15 行）

````
/**
 * # useAgentEvents — Agent 事件处理（端无关）
 *
 * ## 职责
 * - 处理 Agent 事件流（agent_start / message_update / tool_execution_* 等）
 * - 维护 toolCalls 列表（含进度）、isProcessing、currentThinking 状态
 * - 将 image_generate / video_generate 进度同步到 useGenerationProgress
 * - 将 plan_create / plan_update 结果同步到 usePlanStore
 *
 * ## 端无关说明
 * 仅依赖 Vue + 共享 composables（usePlanStore / useGenerationProgress）+ perf-kit。
 * 事件源由各端 Agent Backend 推送，本 composable 不关心事件来源。
 *
 * 端分离批次3：从 src/agent/composables/useAgentEvents.ts 迁移至 shared-composables。
 */
````
