## 迭代主题 25：`Recovered` 事件接入内建 emit（告警恢复自动上报）

> 迭代 24 的代价提到"`Recovered` 事件未接入内建 emit（命令层覆盖）"。本轮把 `LoopEngRecovered` 接入 `AgentLoop` 内建路径：当内建 LoopController 的告警锁存态由"已触发"跳变为"已解除"时，自动广播 `LoopEngRecovered`，补齐"限流停止 / 重试 / 恢复"三类事件在内建驱动的最后一块。

### 决策点 77：恢复检测基于底层触发标志边沿（`is_alerted` true→false），而非 `check_all` 返回级别
**选择**：
- `SoftTimeout` / `Watchdog` 各新增 `is_alerted() -> bool`（读取 `*_triggered` 锁存标志）；`LoopController` 新增聚合 `is_alerted()`（软超时或看门狗任一锁存）。
- `AgentLoop` 新增 `loop_control_warned: Arc<AtomicBool>` 记录上一轮告警锁存态；每轮循环在 `emit_loop_control_warnings` 前调用 `emit_loop_recovered_if_needed()`：`swap(is_alerted())` 做边沿检测，`true → false` 时 emit `LoopEngRecovered { task_id, turn_count, recovery_method: "auto" }`。
**理由**：不能直接用 `check_all` 返回的 `soft_timeout_level` / `watchdog_alert` 判恢复——软超时触发后 `warn_triggered` 锁存，后续 `check` 返回 `None`，若据此判"已恢复"会在告警后紧邻一帧误报 `Recovered`。改用底层锁存标志的边沿才能准确表达"告警→解除"。
**恢复场景**：
- 看门狗：活动恢复（`update_activity` 清除 Idle/Dead 触发标志并刷新 last_activity）
- 软超时：`reset()`（命令层 `reset_counters` / retry 路径清除 `warn_triggered`/`critical_triggered`）
**顺带说明（诚实记录）**：内建路径每轮先 `update_activity()` 再 `check_all()`，看门狗因活动被持续刷新、软超时单调递增，故内建循环内 `Recovered` 实际不常触发；本实现主要被"命令层共享实例 reset 后 / 看门狗真空闲后活动恢复"驱动。属正确且不误报的惰性触发，基础设施已就位。

## 影响范围（迭代主题 25）
- `crates/agent-runtime/src/loop_control.rs`：`SoftTimeout::is_alerted()`、`Watchdog::is_alerted()`、`LoopController::is_alerted()`。
- `crates/agent-runtime/src/agent.rs`：`AgentLoop` 增 `loop_control_warned` 字段；`emit_loop_recovered_if_needed()` 方法；循环块内调用。
- 新增单测：`soft_timeout_reset_emits_recovered`（软超时锁存期不误发 → reset 后边沿触发 Recovered(auto)）。
- 前端零改动（`useLoopControlRust` 对 `loop_eng_recovered` 无特殊处理，可忽略）。

## 验证方式（迭代主题 25）
- `cargo check`（crates/agent-runtime）：通过。
- `cargo test --lib`（crates/agent-runtime）：167 通过（含新 1 个恢复事件测试）。
- `cargo check`（crates/agent-commands）：通过（下游调用方签名未变）。