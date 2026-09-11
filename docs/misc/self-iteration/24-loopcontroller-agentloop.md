## 迭代主题 24：LoopController 接入 AgentLoop（内建自动控制闭环）

> 迭代 23 的代价是"`LoopController` 尚未接入 `AgentLoop`，`LoopEngRetrying` / `RetryExhausted` / `Recovered` 三类事件不会由 AgentLoop 自动 emit"。本轮把 `LoopController` 聚合进 `AgentLoop` 内层 ReAct 循环，让速率限制、重试、软超时、看门狗在内层自动驱动，补齐事件自动 emit 与"限流停止"闭环。命令层 `LoopControlRegistry` 的手动控制与之并存互补。

### 决策点 73：`AgentLoop` 持有 `Arc<LoopController>`，配置经 `AgentLoopConfig.loop_control` 注入
**选择**：`AgentLoop` 新增 `loop_controller: Arc<LoopController>` 字段，`new()` 默认用 `LoopControlConfig::default()`（宽松配置）初始化；`with_loop_control(Option<LoopControlConfig>)` builder 可覆盖（`None` = 禁用内建自动控制）。`AgentLoopConfig` 新增 `loop_control: Option<LoopControlConfig>` 字段，默认 `Some(LoopControlConfig::default())`。
**理由**：`AgentLoop` 是内层 ReAct 循环的宿主，`LoopController` 聚合 RateLimiter / RetryPolicy / SoftTimeout / Watchdog，放在这里才能在内层每轮驱动。`with_config(AgentLoopConfig)` 与 `with_loop_control(LoopControlConfig)` 双入口：前者批量替换配置，后者单独开关控制器，二者解耦；`with_loop_control` 内部同步覆写 `config.loop_control` 保证状态一致。

### 决策点 74：事件 emit 分工——AgentLoop 内联 emit 重试/限流，命令层负责手动 check
**选择**：
- `AgentLoop` 内联 emit：`call_llm_with_retry` / `execute_tool_with_retry` 重试时 emit `LoopEngRetrying`，耗尽时 emit `LoopEngRetryExhausted`；`check_all()` 发现 `rate_limit_exceeded` 时 emit `LoopEngRateLimitExceeded` 并返回 `AgentError::RateLimitExceeded` 停止循环。
- `check_all()` 的 soft_timeout / watchdog 非空结果 → `emit_loop_control_warnings` 广播 `LoopEngSoftTimeoutWarning` / `LoopEngWatchdogIdle` 等提醒（不强制停止）。
- 命令层 `LoopControlRegistry::check_and_emit` 保留：供外部按需手动触发检查（如前端定时轮询），与 AgentLoop 内联驱动并存，互不冲突。
**理由**：重试事件只在 LLM/工具调用路径发生，天然归 AgentLoop 内联；速率限制是循环级判定，也应 AgentLoop 每轮检查。命令层 check 是"外部按需"语义，两者职责不同。

### 决策点 75：默认启用宽松自动控制，避免破坏既有工作流
**选择**：`AgentLoopConfig::default()` 的 `loop_control` 为 `Some(LoopControlConfig::default())`（100 turns / 200 tool calls / 6h duration 宽松上限），实际项目任务远低于此，正常运行不受影响；仅当任务异常膨胀（无限循环 / 工具风暴 / 长时间空转）时才介入。需要完全禁用自动控制的可显式传 `None`。
**理由**：默认开 = 自动获得防护网；宽松上限 = 不误伤正常长任务。与迭代 23 命令层"默认创建宽松配置"的既有约定一致。

### 决策点 76：`AgentError` 新增 `RateLimitExceeded` 变体作为循环终态
**选择**：`AgentError::RateLimitExceeded(String)`（携带超限类型与进度的人类可读信息），在 `check_all()` 命中 rate_limit_exceeded 时返回，循环返回 `Err` 终止。
**理由**：速率限制超限是"该任务已被判定失控"的终态，不同于可重试的瞬时错误——用专门变体让调用方/前端可区分，测试也只需 `matches!(result, Err(AgentError::RateLimitExceeded(_)))` 即可断言。

### 代价（迭代主题 24）
- 内建 LoopController 与命令层 `LoopControlRegistry` 可能各自持有一份 `LoopController` 实例（AgentLoop 内建一份 + 命令层按 task_id 一份）。二者为"内层自动 vs 外层手动"双轨，状态不共享——需要统一进度展示时以命令层为准，内建主要提供自动停止与事件提醒兜底。
- `Recovered` 事件（软超时/看门狗恢复后回发）本轮未接入内建 emit（`check_all` 恢复路径暂无该事件），保留命令层实现覆盖。

## 影响范围（迭代主题 24）
- `crates/agent-runtime/src/agent.rs`：`AgentLoop` 增 `loop_controller` 字段 + `with_loop_control`/`loop_controller`/`loop_control_enabled` 方法；`AgentLoopConfig` 增 `loop_control` 字段；`AgentError` 增 `RateLimitExceeded` 变体；ReAct 循环内联 `check_all` + 事件广播；串/并行工具计数 `inc_tool_calls`；重试路径 emit `LoopEngRetrying`/`LoopEngRetryExhausted`。
- `crates/agent-runtime/src/loop_control.rs`：`SoftTimeout` 增 `config()` 访问器（供 emit 软超时事件读取阈值）。
- 新增单测：`run_stops_on_rate_limit_exceeded`（限流停止 + `LoopEngRateLimitExceeded` 事件）、`llm_failure_emits_retry_events`（`LoopEngRetrying` 先于 `LoopEngRetryExhausted`）。
- 前端零改动（`useLoopControlRust` 对缺失事件"无则忽略"）。

## 验证方式（迭代主题 24）
- `cargo check`（crates/agent-runtime）：通过。
- `cargo test`（crates/agent-runtime）：166 通过（含新 2 个：限流停止 + 重试事件闭环）。
- 全仓 `cargo check`：通过（crates/agent-commands、apps/tauri/src-tauri 均编译通过，跨 crate 调用方签名未变，无回归）。
- 桌面端实测（待做）：开启宽松配置跑长任务，验证默认不误停止；配置 `max_turns=2` 验证前端收到 `loop_eng_rate_limit_exceeded` 且任务终止。