## 迭代主题 26：内建与命令层 LoopController 共享单实例（消除双轨）

> 迭代 24 的代价（决策点 76 后）明确指出：`AgentLoop` 内建一份 `LoopController`（自动轨），命令层 `LoopControlRegistry` 又按 `task_id` 各持一份（手动轨），二者状态不共享——手动命令看到的速率/超时/看门狗状态与自动驱动是"两本账"。本轮把命令层注册表与内建控制器统一为**同一 Arc 实例**，手动命令与自动驱动操作同一份状态。

### 决策点 78：`LoopController` 暴露 `config()` 重建配置，`AgentLoop::loop_controller()` 返回 `&Arc<LoopController>`
**选择**：
- `RateLimiter::config() -> &RateLimitConfig`、`LoopController::config() -> LoopControlConfig`：从现有实例重建完整配置快照，供注册表条目创建时使用（`LoopControlEntry::new` 需要 `config`）。
- `AgentLoop::loop_controller() -> &Arc<LoopController>`：返回内建控制器的共享引用，调用方既可读取计数/状态、手动驱动（如 `record_turn`），也可 `clone()` 出 `Arc` 与外部共享同一实例。
**理由**：共享要求"注册表条目复用同一 Arc"，而条目构造需要配置快照——`config()` 让已有实例能重建配置，无需另存一份；`&Arc` 返回值让 `clone()` 零成本共享，是消除双轨的前提。

### 决策点 79：`AgentCommandService` 持 `Arc<LoopControlRegistry>`，提供 `register_session_loop_control` 绑定会话
**选择**：`AgentCommandService` 新增 `loop_control_registry: Arc<LoopControlRegistry>` 字段（默认自建独立实例，`with_loop_control_registry` 可注入共享实例并公开 `loop_control_registry()` 访问器）。新增 `register_session_loop_control(task_id, session_id)`：取该会话 `AgentLoop` 内建 `Arc<LoopController>`，重建配置后注册为 `task_id` 对应条目——手动命令与自动驱动操作同一份状态。
**理由**：服务层是会话与命令层的交汇点，把注册表放这里并新增"会话→内建控制器"绑定入口，Tauri 命令即可复用；会话不存在返回 `SessionNotFound`，重复 task_id 由注册表 `AlreadyExists` 生成并包装为 `Internal`。

### 决策点 80：`LoopControlRegistryError` 增 `Internal` 变体承接服务层错误
**选择**：`LoopControlRegistryError` 新增 `Internal { message: String }`，用于包装服务层错误（会话不存在 / 注册失败）在注册表命令间透明传递。
**理由**：注册表命令签名返回 `LoopControlRegistryError`，而绑定会话失败的是 `CommandError`——需要统一错误通道，`Internal` 作为兜底承载任意内部失败，避免泄漏具体实现。

### 决策点 81：Tauri 端 manage 共享注册表，`cmd_loop_control_create` 支持 `session_id` 绑定
**选择**：`apps/tauri/src-tauri/src/lib.rs` 用 `Arc<LoopControlRegistry>` 单独 `manage`，同时注入 `AgentCommandService`（`with_loop_control_registry`），使 `cmd_loop_control_*` 与"绑定会话的 loop_control"操作同一注册表。`cmd_loop_control_create` 新增 `session_id: Option<String>` 参数：提供且会话存在 → 复用内建控制器（`config` 被忽略，以内建配置为准）；缺省 → 保留原"独立创建控制器（手动轨）"路径。
**理由**：既有命令层注册表已单独 manage 供 `cmd_loop_control_*` 使用；注入同一实例到服务后，命令层与内建控制器的共享关系在 Tauri 装配层收敛，前端无需感知区别。

## 影响范围（迭代主题 26）
- `crates/agent-runtime/src/loop_control.rs`：`RateLimiter::config()`、`LoopController::config()` 新增。
- `crates/agent-runtime/src/agent.rs`：`AgentLoop::loop_controller()` 返回 `&Arc<LoopController>`（原 `&LoopController`）。
- `crates/agent-commands/src/loop_control.rs`：`LoopControlRegistryError` 增 `Internal` 变体。
- `crates/agent-commands/src/lib.rs`：`AgentCommandService` 增 `loop_control_registry` 字段 + `with_loop_control_registry`/`loop_control_registry()` + `register_session_loop_control`。
- `apps/tauri/src-tauri/src/lib.rs`：manage `Arc<LoopControlRegistry>` 并注入服务。
- `apps/tauri/src-tauri/src/commands.rs`：`cmd_loop_control_create` 增 `session_id` 参数 + 绑定分支。
- 新增单测（agent-commands）：`register_session_loop_control_shares_builtin_controller`（`Arc::ptr_eq` 断言共享 + 状态同步）、`register_session_loop_control_requires_existing_session`、`register_session_loop_control_rejects_duplicate_task`。

## 验证方式（迭代主题 26）
- `cargo test`（crates/agent-commands）：61 通过（含新 3 个共享控制器单测）。
- `cargo test`（crates/agent-runtime）：167 通过，无回归。
- `cargo check`（apps/tauri/src-tauri）：通过，跨 crate 调用方签名收敛。
- 待办（桌面端实测）：前端绑定会话创建 loop_control 后，手动命令与自动驱动读数一致；宽松配置默认不误停止。