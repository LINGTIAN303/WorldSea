# useLongTask.ts 详细注释

> 来源：`packages/shared-composables/src/agent/long-task/useLongTask.ts`
> 说明：本文件为 useLongTask 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-21 行）

````
/**
 * # useLongTask — 长任务管理器（端无关）
 *
 * ## 职责
 *   1. 状态机：running → completed/failed/cancelled
 *   2. 心跳：定时更新 lastHeartbeatAt，检测失联（软提醒，不强制终止）
 *   3. checkpoint：事件驱动快照 pi-ai agent 内部 messages，支持断点恢复
 *   4. 协作式取消：设 cancelFlag，beforeToolCall hook 检查，等当前 tool call 完成再停
 *
 * ## 设计原则（复用 workflow 引擎模式）
 *   - 协作式取消 > 强制取消（Temporal/Airflow 经典模式）
 *   - 心跳判活（DispatchHandle.last_heartbeat_at_ms 模式）
 *   - checkpoint 持久化（SqliteStore 模式，此处用 IndexedDB）
 *   - 无硬超时（符合"无强制中断"需求）
 *
 * P1 范围：仅主 Agent 接入（单活跃任务）；P4 子 Agent 接入时扩展为多任务 Map。
 *
 * ## 端分离批次4
 * 从 src/agent/composables/useLongTask.ts 迁移至 shared-composables。
 * 端无关（仅依赖 vue + longTaskStore），无需依赖注入。
 */
````
