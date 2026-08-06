# useLongTaskRust.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/agent/composables/useLongTaskRust.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 6-44 行）

# useLongTaskRust — 长任务管理器（Rust 后端版）

阶段 2.2（Loop Engineering 批次5/6）新增。对应 TS 版 `useLongTask.ts`，
但底层持久化从 IndexedDB 改为 Rust SQLite（通过 Tauri 命令）。

## 职责

  1. 状态机：running → completed/failed/cancelled
  2. 心跳：定时更新 `lastHeartbeatAt`，检测失联（软提醒，不强制终止）
  3. checkpoint：事件驱动快照 AgentLoop 内部 messages，支持断点恢复
  4. 协作式取消：设 `cancelFlag`，ReAct 循环在下一轮检查时优雅停止

## 与 TS 版 `useLongTask` 的差异

- **持久化后端**：IndexedDB → Tauri 命令（`cmd_long_task_*`）→ SQLite
- **时间戳类型**：`number` (ms) → `string` (RFC3339)，对应 Rust `DateTime<Utc>`
  - 注：为兼容 `useLongTaskProgress.ts` 期望的 `number` 类型，本文件对外仍暴露 `number`，
    内部与 Rust 交互时通过 `dateToRfc3339` / `rfc3339ToMs` 转换
- **心跳定时器**：保留 `setInterval`（前端 timer，与 Rust 端 tokio::interval 分离）
- **取消标志**：保留模块级 `Map<taskId, boolean>`（内存即可，无需持久化）

## Tauri 命令映射

| TS 函数             | Rust 命令                          |
|---------------------|------------------------------------|
| `saveTask`          | `cmd_long_task_save`               |
| `loadTask`          | `cmd_long_task_load`               |
| `listRunningTasks`  | `cmd_long_task_list_running`       |
| `listAllTasks`      | `cmd_long_task_list_all`           |
| `updateHeartbeat`   | `cmd_long_task_update_heartbeat`   |
| `updateStatus`      | `cmd_long_task_update_status`      |
| `deleteTask`        | `cmd_long_task_delete`             |

## 设计原则（沿用 workflow 引擎模式）

  - 协作式取消 > 强制取消（Temporal/Airflow 经典模式）
  - 心跳判活（`DispatchHandle.last_heartbeat_at_ms` 模式）
  - checkpoint 持久化（`SqliteStore` 模式，此处用 SQLite via Tauri）
  - 无硬超时（符合"无强制中断"需求）

P1 范围：仅主 Agent 接入（单活跃任务）；P4 子 Agent 接入时扩展为多任务 Map。

## 注释块 2（原文件第 68-77 行）

Rust `agent_runtime::long_task::LongTaskRecord` 的前端镜像

Rust 端 `#[serde(rename_all = "camelCase")]` + `#[serde(rename = "type")]` for task_type，
序列化结果字段名与 TS `LongTaskRecord` 一致，但时间戳类型不同：
- Rust: `DateTime<Utc>` 序列化为 RFC3339 字符串
- TS 期望: `number`（ms）

因此定义 `RustLongTaskRecord` 作为 invoke 接收类型，再用转换函数变为 `LongTaskRecord`。
