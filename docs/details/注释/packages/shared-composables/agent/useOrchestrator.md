# useOrchestrator.ts 详细注释

> 来源：`packages/shared-composables/src/agent/useOrchestrator.ts`
> 说明：本文件为 useOrchestrator 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 53-62 行）

````
// ─────────────────────────────────────────────────────────────────────────────
// 任务 4 P4：子 Agent 长任务跟踪（checkpoint + 心跳，复用 longTaskStore 持久层）
//
// 设计：子 Agent 独立于 useLongTask（主 Agent），直接复用 longTaskStore 持久化。
// - trackSubAgentLongTask：saveTask 初始记录 + subBackend.subscribe 事件 checkpoint + 心跳
// - untrackSubAgentLongTask：终态 updateTask + 清理
// - 心跳：模块级统一定时器（5s），遍历活跃子 Agent 任务
// - 多任务：activeLongTasks Map 支持多子 Agent 并发
// 不做恢复（子 Agent 后台任务，刷新后重跑即可）。
// ─────────────────────────────────────────────────────────────────────────────
````
