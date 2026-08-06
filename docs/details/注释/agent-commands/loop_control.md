# loop_control.rs 详细注释文档（agent-commands）

> 来源：`crates/agent-commands/src/loop_control.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 loop_control_tests.rs

## 注释块 1（原文件第 1-31 行）

# Loop Control 注册表 — Loop Engineering 实例管理（服务层）

端分离迁移前位于 `src-tauri/src/agent_bridge/loop_control_registry.rs`，
迁移后按"纯逻辑命令层放 agent-commands、Tauri 薄包装放 tauri app"的架构约定
落到本 crate。本模块**不依赖 tauri**，可独立 `cargo test`。

## 职责
在 Tauri 应用进程内按 `task_id` 管理多个 [`LoopController`] 实例，
与 AgentRegistry / SubAgentManager 等并行。Loop Engineering 是**横切关注点**：
- 其他 Registry 按 `session_id` 管理节点实例（一个会话一个节点）
- 本 Registry 按 `task_id` 管理 LoopController（一个会话可能有多个长任务，
  每个长任务对应独立的 LoopController，`task_id` 与 `LongTaskRecord.task_id` 对齐）

## 事件广播
每个条目持有独立的 [`EventBroadcaster`]。命令层 `check_and_emit` 在检查到
非空结果（rate_limit / soft_timeout / watchdog）时构造 `OrchestratorEvent::LoopEng*`
并广播；Tauri 端在 `cmd_loop_control_create` 时订阅一个监听器，把事件转发到
前端 `loop_control:event:{task_id}` 通道。

## 与 Tauri 命令的关系
```text
cmd_loop_control_create           -> registry.register(task_id, entry) + 订阅监听器
cmd_loop_control_check            -> registry.check_and_emit(task_id)
cmd_loop_control_record_turn      -> registry.get(task_id) → rate_limiter.inc_turns()
cmd_loop_control_update_activity  -> registry.get(task_id) → controller.update_activity()
cmd_loop_control_reset_counters   -> registry.get(task_id) → entry.reset_counters()
cmd_loop_control_get_config       -> registry.get(task_id) → 返回配置快照
cmd_loop_control_get_status       -> registry.get(task_id) → 返回计数器与状态
cmd_loop_control_destroy          -> registry.remove(task_id)
cmd_loop_control_list_tasks       -> registry.list()
```

## 注释块 2（原文件第 225-234 行）

一站式检查 + 事件广播（`cmd_loop_control_check` 调用）

1. 对指定任务执行 `controller.check_all()`
2. 若结果非空，构造对应的 `OrchestratorEvent::LoopEng*` 并广播到条目 broadcaster
   （Tauri 端订阅的监听器会转发到前端 `loop_control:event:{task_id}`）
3. 返回 [`LoopControlCheckResult`]（即使无事件也会返回，has_any=false）

注意：本方法只 emit rate_limit / soft_timeout / watchdog 五类事件；
`LoopEngRetrying` / `LoopEngRetryExhausted` / `LoopEngRecovered` 由
AgentLoop 在重试/恢复时直接 emit（命令层不介入）。
