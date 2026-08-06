# long_task.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/long_task.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 long_task_tests.rs

## 注释块 1（原文件第 1-21 行）

# 长任务管理 — Loop Engineering 核心组件

对应 TS 版 `longTaskStore.ts` + `useLongTask.ts`，迁移到 Rust 原生实现。

## 职责

1. **状态机**：running → completed/failed/cancelled
2. **心跳**：定时更新 `last_heartbeat_at`，检测失联（软提醒，不强制终止）
3. **checkpoint**：事件驱动快照 AgentLoop 内部 messages，支持断点恢复
4. **协作式取消**：设 `cancel_flag`，ReAct 循环在下一轮检查时优雅停止

## 设计原则（复用 workflow 引擎模式）

- 协作式取消 > 强制取消（Temporal/Airflow 经典模式）
- 心跳判活（`DispatchHandle.last_heartbeat_at_ms` 模式）
- checkpoint 持久化（`SqliteStore` 模式）
- 无硬超时（符合"无强制中断"需求）

## 与 TS 版的差异

- 持久化层从 IndexedDB 改为 SQLite（与 SessionRepository 同库）
- 心跳定时器从 `setInterval` 改为 `tokio::time::interval`
- 取消标志从模块级 `Map` 改为 `Arc<AtomicBool>`（每任务独立）
- checkpoint 数据提供者从回调改为 `Arc<dyn CheckpointProvider>` trait

---

## 注释块 2（原文件第 190-201 行）

checkpoint 数据提供者 trait

对应 TS 版 `() => LongTaskCheckpoint` 回调，Rust 改为 trait 注入：
- `AgentLoop` 实现此 trait，提供 `get_checkpoint()` 返回当前 messages 快照
- `LongTaskManager` 通过 `Arc<dyn CheckpointProvider>` 调用，解耦具体实现

# 设计动机

Rust 没有 TS 的闭包捕获灵活性，用 trait + Arc 既能持有状态又线程安全。

# 异步设计

AgentLoop 的 `state` 用 `tokio::sync::Mutex`（AsyncMutex）保护，
取 messages 必须 `.await`，因此 trait 方法为 `async`。

---

## 注释块 3（原文件第 212-225 行）

长任务管理器

对应 TS 版 `useLongTask` composable，Rust 版改为可注入的 Manager。
单例：每个 AgentLoop 持有一个 Manager（P1 范围仅主 Agent 接入）。

# 职责

1. 持有当前活跃任务（`active_task`）
2. 启动/停止心跳定时器
3. 提供 checkpoint 更新接口（脏标记节流）
4. 协作式取消标志管理

# 不负责

- 持久化：由 `LongTaskRepository`（Tauri 端）负责，Manager 仅持有内存状态
- 事件广播：由 `AgentLoop` 通过 `OrchestratorEvent` 转发

---

## 注释块 4（原文件第 251-266 行）

启动长任务

# 参数

- `task_id`：调用方生成的任务 ID（格式建议：`longtask-{type}-{ts}-{rand}`）
- `task_type`：任务类型
- `initial_checkpoint`：初始 checkpoint（由 `CheckpointProvider` 获取）
- `meta`：任务元数据（含 `prompt` 字段，作为任务描述）

# 行为

1. 若已有活跃任务，警告并保留（不抢占，调用方应先 `complete_task` 或 `fail_task`）
2. 创建 `LongTaskRecord`，status=Running，started_at=now
3. 清除 cancel_flag，重置 heartbeat_status=Alive
4. 启动心跳定时器

# 返回

创建的 `LongTaskRecord`（调用方负责持久化）

---

## 注释块 5（原文件第 321-333 行）

更新 checkpoint（事件驱动，由 `turn_end` / `tool_execution_end` 触发）

# 参数

- `progress_turn_count`：可选的轮次更新
- `progress_current_tool`：可选的当前工具名更新
- `progress_current_phase`：可选的当前阶段标签更新
- `new_checkpoint`：新的 checkpoint 快照（由 `CheckpointProvider` 获取）

# 行为

1. 仅当活跃任务存在且 status=Running 时更新
2. 更新进度字段
3. 替换 checkpoint，标记 dirty=true
4. 持久化由心跳定时器节流（5s 一次），避免频繁写入

---

## 注释块 6（原文件第 365-374 行）

标记任务完成

# 行为

1. 设置 status=Completed, ended_at=now
2. 停止心跳定时器
3. 清空内存（record 已持久化由调用方负责）
4. 重置标志

# 返回

完成后的 `LongTaskRecord`（含 ended_at），供调用方持久化；若无可恢复任务返回 None

---

## 注释块 7（原文件第 464-483 行）

标记任务可重试失败（Loop Engineering 阶段 2.6 新增）

与 `fail_task` 的区别：
- `fail_task`：永久失败，设 `ended_at`，状态转 Failed
- `retry_task`：可重试失败，**不设 `ended_at`**，状态保持 Running，
  保留 checkpoint 供 AgentLoop 决定是否重试

# 行为

1. 仅当活跃任务存在且 status=Running 时更新
2. 将错误信息记录到 `current_phase`（前缀 "retry:"）
3. 标记 checkpoint dirty 以便持久化最新状态

# 返回

当前 `LongTaskRecord` 的克隆（含最新 checkpoint），供调用方决定是否重试。
若无可重试任务返回 None。

# 使用场景

AgentLoop 在 LLM/tool 调用失败时调用此方法，然后查询 `LoopController::retry_policy`
决定是否重试。若重试，调用 `clear_retry_marker` 清除标记后继续循环；
若不重试，调用 `fail_task` 转为永久失败。

---

## 注释块 8（原文件第 530-541 行）

记录速率限制状态（Loop Engineering 阶段 2.6 新增）

由 AgentLoop 在每轮检查 `LoopController::rate_limiter` 后调用，
将 rate_limit 状态记录到 `current_phase` 字段，便于持久化与 UI 展示。

# 参数

- `status`：rate_limit 状态描述（如 "turns: 50/100" / "tokens: 45000/100000"）

# 行为

1. 仅当活跃任务存在且 status=Running 时更新
2. 更新 `current_phase` 字段（前缀 "rate_limit:"）
3. 不标记 dirty（避免频繁持久化，由心跳定时器节流）

---

## 注释块 9（原文件第 677-699 行）

启动心跳定时器

# 参数

- `manager_arc`：`LongTaskManager` 的 Arc 句柄（让 spawn 闭包能持有 Manager 引用，
  从而在每次 tick 时读取内存状态决定 tick 类型）
- `on_tick`：心跳 tick 回调（用于持久化脏 checkpoint / 更新 SQLite 心跳时间）

# 行为

- 每 `HEARTBEAT_INTERVAL` 触发一次：
  1. 调用 `update_heartbeat()` 更新内存心跳时间
  2. 若 `is_checkpoint_dirty()`：构造 `CheckpointFlush` tick（含完整 record）调用 `on_tick`，
     然后清除 dirty 标记
  3. 否则：构造 `HeartbeatOnly` tick（仅 task_id + last_heartbeat_at）调用 `on_tick`
- 任务完成/失败/取消时通过 `stop_heartbeat_internal` 停止

# 设计说明

- **为何需要 `manager_arc` 参数**：spawn 出来的定时器 task 需要异步访问 Manager 的
  `is_checkpoint_dirty` / `get_active_task` / `clear_checkpoint_dirty` 等方法，
  这些方法都是 `&self`，需要持有 Arc 引用才能在 spawn 闭包中调用。
  调用方（通常是 `AgentLoop::start_long_task_heartbeat`）通过
  `Arc::clone(&manager)` 传入。
- **不直接持有 `Arc<dyn LongTaskRepository>`**：避免 agent-runtime crate 依赖
  rusqlite，保持 crate 解耦。持久化逻辑由 `on_tick` 回调注入。

---

## 模块职责一句话

长任务管理器：状态机（running/completed/failed/cancelled）、心跳监控、checkpoint 脏标记节流持久化、协作式取消标志，供 AgentLoop 与 Tauri 命令层集成。
