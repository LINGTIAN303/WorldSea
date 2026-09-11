## 迭代主题 23：Loop Control 与 Long Task 命令层恢复（端分离迁移链路断裂）

> 与迭代 16-22 的"有 API 无入口"不同，本次是**命令层整体丢失**。端分离迁移（commit 980385c）把旧的 `src-tauri/src/commands/loop_control.rs` + `long_task.rs` + `agent_bridge/loop_control_registry.rs` + `long_task_persistence.rs` 拆掉后，前端 `useLoopControlRust.ts`（11 命令）与 `useLongTaskRust.ts`（7 命令）指向的 Tauri 命令**从未在新结构重建**。git 历史（commit 5fd166e）保留原实现，本次按当前架构约定恢复。

### 重大发现：路线图声称"已完成"的 Loop Engineering 命令层实际不存在
**背景**：`agent-orchestration-roadmap.md` 声称阶段 2.6 Loop Engineering 已完成，且 `commands/loop_control.rs` + `commands/long_task.rs`（共 16 命令，加上 create/check 拆分实为 18 个）"已注册到 lib.rs"。但实际 `apps/tauri/src-tauri/src/lib.rs` 的 invoke_handler 只注册了 agent/terminal/subagent 命令。这是端分离迁移导致的**链路断裂**：Rust 核心组件（`agent-runtime::loop_control` / `long_task`）完好，前端 composable 完好，中间命令层被迁移时丢弃。

### 决策点 70：命令层放 agent-commands（纯逻辑层）而非恢复旧 tauri 目录
**选择**：不按历史实现放回 `src-tauri/src/agent_bridge/`，而是按当前架构约定拆两层：
1. `crates/agent-commands/src/loop_control.rs`：`LoopControlRegistry`（注册表 + `check_and_emit` 一站式检查 + 事件广播），`LoopControlEntry` / `LoopControlCheckResult` / `LoopControlStatus` / `LoopControlRegistryError`。
2. `crates/agent-commands/src/long_task_store.rs`：`LongTaskRepository`（SQLite 持久化，sqlx，与 subagent_store 同套基建）。
3. `apps/tauri/src-tauri/src/commands.rs`：18 个薄包装 `#[tauri::command]` + `LoopControlTauriEventListener`（LoopEng* 事件 → `loop_control:event:{task_id}`）。

**理由**：agent-commands 定位是"纯逻辑命令层，不依赖 tauri，可独立 cargo test"；注册表与检查逻辑不涉及 tauri API（事件广播用 `agent_runtime::event::EventBroadcaster`，纯逻辑），放服务层可被单测覆盖。tauri 层只做参数绑定与事件转发，与现有 agent/terminal/subagent 命令形态一致。

### 决策点 71：`check` 命令在服务层做「检查 + 广播」，Tauri 端只订阅转发
**选择**：`LoopControlRegistry::check_and_emit(task_id)` 内执行 `controller.check_all()`，非空结果构造 `OrchestratorEvent::LoopEng*` 广播到条目自己的 `broadcaster`（`Arc<RwLock<EventBroadcaster>>`）。`cmd_loop_control_create` 时 Tauri 端 `entry.subscribe(LoopControlTauriEventListener)`，监听器把事件转成前端 `RustLoopControlEventPayload`（snake_case 字段）emit 到 `loop_control:event:{task_id}`。
**理由**：与历史实现一致（历史也是命令层显式 emit，LoopController 本身不触发事件）；前端 `useLoopControlRust` 监听的就是 `loop_control:event:{task_id}` 通道，8 类事件 tag（`loop_eng_rate_limit_exceeded` / `retrying` / `retry_exhausted` / `soft_timeout_warning` / `soft_timeout_critical` / `watchdog_idle` / `watchdog_dead` / `recovered`）已全部在监听器覆盖。

### 决策点 72：长任务持久化独立 DB 文件，`update_status`/`update_heartbeat` 轻量写
**选择**：`LongTaskRepository` 用独立 `long_tasks.db`（与 `subagent_specs.db` 并列），单表 `long_tasks`（task_id 主键 + 标量列 + checkpoint/meta JSON 列）。枚举（task_type/status）用 serde 字符串值（`main-agent` / `running` 等）存储，便于 `WHERE status = ?` 过滤。`load` 不存在时返回 `CommandError::NotFound`（新增变体，`type: "not_found"`），与前端 `loadTask` catch 返回 null 对齐。
**理由**：标量列 + JSON 复合字段是历史实现同款设计（避免整条 record 全 JSON 导致无法按 status 过滤）；轻量 `update_heartbeat`/`update_status` 只写单列，避免心跳节流时全量 JSON 序列化开销（前端心跳 5s 一次）。

### 代价（迭代主题 23）
- `LoopController` 尚未接入 `AgentLoop`（`agent.rs` 只集成了 `LongTaskManager`，未持有 `LoopController`），因此 `LoopEngRetrying` / `RetryExhausted` / `Recovered` 三类事件当前不会由 AgentLoop 自动 emit；命令层的 `check_and_emit` 只覆盖 rate_limit / soft_timeout / watchdog 五类。重试/恢复事件需后续把 `LoopController` 接入 AgentLoop 循环（记录待办，不阻塞命令层交付——前端 composable 对缺失事件是"无则忽略"设计）。
- `LoopControlRegistry` 是全局单例（`app.manage(LoopControlRegistry::new())`），按 task_id 隔离，不绑定 session——与前端 `lcTasks` Map 语义一致；任务生命周期（create/destroy）由调用方管理。
- 长任务 DB 与子 Agent 规格 DB 分开文件，两处 `setup` 初始化独立进行，任一失败只影响对应命令组。

## 影响范围（迭代主题 23）
- `crates/agent-commands/src/loop_control.rs`（新增）：`LoopControlRegistry` + Entry + CheckResult/Status/RegistryError + 单测。
- `crates/agent-commands/src/long_task_store.rs`（新增）：`LongTaskRepository`（save/load/list_running/list_all/update_heartbeat/update_status/delete）+ 单测。
- `crates/agent-commands/src/lib.rs`：注册两模块 + 导出类型。
- `crates/agent-commands/src/error.rs`：新增 `NotFound` 变体（`not_found` 标签）。
- `apps/tauri/src-tauri/src/commands.rs`：`LoopControlTauriEventListener` + 18 命令。
- `apps/tauri/src-tauri/src/lib.rs`：注册 18 命令 + `manage(LoopControlRegistry::new())` + setup 初始化 `LongTaskRepository`。
- `apps/tauri/src-tauri/Cargo.toml`：新增 `chrono` 依赖（长任务命令 RFC3339 时间戳参数）。
- 前端零改动（`useLoopControlRust.ts` / `useLongTaskRust.ts` 命令签名已按历史实现对齐）。

## 验证方式（迭代主题 23）
- `cargo test`（crates/agent-commands）：56 通过（含 loop_control 6 个 + long_task_store 8 个新单测）。
- `cargo check`（apps/tauri/src-tauri）：通过（18 命令注册 + chrono 依赖）。
- `npx vue-tsc --noEmit`（apps/tauri，cwd=apps/tauri）：通过。
- 桌面端实测（待做）：前端调用 `useLoopControlRust.create → check → getStatus → destroy` 全链路 + `useLongTaskRust.saveTask → listAllTasks → updateStatus → loadTask` 全链路。
