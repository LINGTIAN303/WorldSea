# long_task_store.rs 详细注释文档（agent-commands）

> 来源：`crates/agent-commands/src/long_task_store.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-19 行）

# 长任务持久化（SQLite）

端分离迁移前位于 `src-tauri/src/agent_bridge/long_task_persistence.rs`，
迁移后按架构约定落到本 crate。对应 TS 版 `longTaskStore.ts` 的 IndexedDB
持久化，改为 SQLite（sqlx，与 [`crate::subagent_store`] 同一套持久化基建）。

## 表结构
- 标量字段（task_id / task_type / status / 时间戳 / turn_count 等）独立列，
  便于 SQL 过滤（`list_running` 按 status 过滤）
- 复合字段（checkpoint / meta）存 JSON TEXT

## API
- [`LongTaskRepository::save`]：upsert 完整 record（心跳定时器 CheckpointFlush 时调用）
- [`LongTaskRepository::load`]：加载完整 record（断点恢复用）
- [`LongTaskRepository::list_running`]：列出所有 Running 任务（应用启动恢复用）
- [`LongTaskRepository::list_all`]：列出所有长任务（按 started_at DESC）
- [`LongTaskRepository::update_heartbeat`]：轻量心跳更新（HeartbeatOnly tick 调用）
- [`LongTaskRepository::update_status`]：轻量状态更新（complete/fail/cancel 时调用）
- [`LongTaskRepository::delete`]：删除任务记录
