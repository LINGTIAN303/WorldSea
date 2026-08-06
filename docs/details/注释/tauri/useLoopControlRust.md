# useLoopControlRust.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/agent/composables/useLoopControlRust.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 6-78 行）

# useLoopControlRust — Loop Engineering 的前端适配层

阶段 2.6（Loop Engineering 批次3）新增。本文件桥接前端 Vue 层与
Rust 端 `agent_runtime::loop_control::LoopController`，通过 Tauri `invoke` + `listen` 通信。

## 职责

  1. 通过 Tauri 命令管理 LoopController 实例（create / check / recordTurn / 等 11 个命令）
  2. 监听 `loop_control:event:{taskId}` 事件流，分发到订阅者
  3. 维护多个 Loop Control 任务的响应式状态（计数器、触发状态、事件历史）
  4. 提供 Reactive 视图（lastCheck / status / events / 触发计数）供 UI 组件使用

## 与 useMultiAgentRust / useGoTRust / useToTRust / useSupervisorRust 的差异

Loop Engineering 是**横切关注点**（cross-cutting concern），不是独立编排节点：
- **索引键不同**：按 `task_id` 索引（与 `LongTaskRecord.task_id` 对齐），
  其他 composable 按 `session_id` 索引（一个会话一个节点）
- **无 LLM/tool 调用**：LoopController 只做检查与状态聚合，不执行任务
  （因此无 `run` / `abort` 方法，由 AgentLoop 驱动）
- **无编排节点**：不参与 OrchestratorState，不返回 NodeResult
- **事件由命令层显式 emit**：`LoopEngRetrying` / `LoopEngRetryExhausted` / `LoopEngRecovered`
  由 AgentLoop 在重试/恢复时直接 emit（命令层不介入）
- **状态来源**：状态由 `getStatus` / `check` 命令返回 + 事件流累加双重维护

## Tauri 命令映射

| TS 函数            | Rust 命令                            |
|--------------------|--------------------------------------|
| `create`           | `cmd_loop_control_create`            |
| `check`            | `cmd_loop_control_check`             |
| `recordTurn`       | `cmd_loop_control_record_turn`       |
| `recordToolCall`   | `cmd_loop_control_record_tool_call`  |
| `recordTokens`     | `cmd_loop_control_record_tokens`     |
| `updateActivity`   | `cmd_loop_control_update_activity`   |
| `resetCounters`    | `cmd_loop_control_reset_counters`    |
| `getConfig`        | `cmd_loop_control_get_config`        |
| `getStatus`        | `cmd_loop_control_get_status`        |
| `destroy`          | `cmd_loop_control_destroy`           |
| `listTasks`        | `cmd_loop_control_list_tasks`        |

## 事件命名约定

- 事件名：`loop_control:event:{taskId}`（与 `agent:event:*` / `multi_agent:event:*` 并列）
- Payload 字段：snake_case（Rust 端 `LoopControlEventPayload` 只对变体名用
  `rename_all = "snake_case"`，变体内部字段保持 snake_case）
- 变体 tag：snake_case（如 `loop_eng_rate_limit_exceeded` / `loop_eng_recovered`）

## 配置参数命名

Rust 端 `LoopControlConfig` / `RateLimitConfig` / `RetryConfig` /
`SoftTimeoutConfig` / `WatchdogConfig` 启用 `#[serde(rename_all = "camelCase")]`，
前端用 camelCase。

## Duration 序列化

Rust serde 默认将 `std::time::Duration` 序列化为 `{secs: u64, nanos: u32}` 对象。
前端构造时使用 `secsToDuration` / `msToDuration` 辅助函数，
读取时使用 `durationToMs` / `durationToSecs` 辅助函数。

## RateLimitExceeded / WatchdogAlert 序列化

- `RateLimitExceeded`：`#[serde(tag = "type", rename_all = "snake_case")]`
  - `{"type":"turns","current":100,"max":100}`
  - `{"type":"tool_calls","current":200,"max":200}`
  - `{"type":"tokens","current":100000,"max":100000}`
  - `{"type":"duration","current":{secs,nanos},"max":{secs,nanos}}`
- `WatchdogAlert`：`#[serde(tag = "level", rename_all = "lowercase")]`
  - `{"level":"idle","last_activity":"2026-...","elapsed":{secs,nanos}}`
  - `{"level":"dead","last_activity":"2026-...","elapsed":{secs,nanos}}`

## SoftTimeoutLevel 序列化

`#[serde(rename_all = "lowercase")]` → `"warning"` / `"critical"`

## 多任务并发

模块级 `lcTasks` Map 支持多个 Loop Control 任务并发。
每个任务独立的事件监听器、状态、订阅者集合。
一个 Agent 会话可能同时有多个长任务，每个长任务对应独立的 LoopController。

## 注释块 2（原文件第 69-80 行）

Rust `agent_runtime::loop_control::RateLimitConfig` 的前端镜像

Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
任意一项超限即触发 `shouldStop = true`。设为 `null` 表示不限制该维度。

默认值（`RateLimitConfig::default()`）：
- `maxTurns = 100`
- `maxToolCalls = 200`
- `maxTokens = 100_000`
- `maxDuration = 6h`（`{secs: 21600, nanos: 0}`）

## 注释块 3（原文件第 92-103 行）

Rust `agent_runtime::loop_control::RetryConfig` 的前端镜像

Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。

默认值（`RetryConfig::default()`）：
- `maxRetries = 3`
- `initialBackoff = 1s`
- `backoffMultiplier = 2.0`
- `maxBackoff = 30s`
- `retryableErrors = ["rate_limit", "timeout", "server_error", "connection_reset"]`

## 注释块 4（原文件第 117-126 行）

Rust `agent_runtime::loop_control::SoftTimeoutConfig` 的前端镜像

Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
软超时仅提醒不强制终止，符合"无强制中断"原则。

默认值（`SoftTimeoutConfig::default()`）：
- `warnThreshold = 30min`
- `criticalThreshold = 2h`

## 注释块 5（原文件第 134-143 行）

Rust `agent_runtime::loop_control::WatchdogConfig` 的前端镜像

Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。

默认值（`WatchdogConfig::default()`）：
- `idleThreshold = 5min`
- `deadThreshold = 30min`
- `autoRecovery = false`（默认仅通知，不自动恢复）

## 注释块 6（原文件第 153-164 行）

Rust `agent_runtime::loop_control::LoopControlConfig` 的前端镜像

Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
聚合速率限制、重试策略、软超时、看门狗四项配置。

默认值（`LoopControlConfig::default()`）：
- 速率限制：100 turns / 200 tool_calls / 100k tokens / 6h
- 重试：3 次，指数退避 1s/2s/4s
- 软超时：30min 提醒，2h 临界
- 看门狗：5min 无活动触发 Idle，30min 触发 Dead，不自动恢复

## 注释块 7（原文件第 199-208 行）

Rust `agent_runtime::loop_control::WatchdogAlert` 的前端镜像

Rust 端 `#[serde(tag = "level", rename_all = "lowercase")]` → 内部标签模式。
变体名 lowercase（`idle` / `dead`）。

注意：
- `lastActivity` 为 RFC3339 字符串（chrono DateTime<Utc> 默认序列化）
- `elapsed` 为 Rust Duration 对象 `{secs, nanos}`

## 注释块 8（原文件第 233-242 行）

Rust `agent_bridge::loop_control_registry::LoopControlStatus` 的前端镜像

Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。

由 `cmd_loop_control_get_status` 返回，前端可据此展示：
- 当前 turns / toolCalls / tokens 计数
- 已运行时长（elapsedMs）
- 各组件触发状态（rateLimit / softTimeout / watchdog）

## 注释块 9（原文件第 351-371 行）

Rust `commands::loop_control::LoopControlEventPayload` 的前端镜像

**重要**：字段为 **snake_case**！

原因：Rust 端 `LoopControlEventPayload` 只对变体名用 `rename_all = "snake_case"`
（生成 `loop_eng_rate_limit_exceeded` / `loop_eng_recovered` 等 tag），
变体内部字段保持 snake_case（`task_id` / `limit_type` / `attempt` / `max_retries` /
`backoff_ms` / `elapsed_secs` / `threshold_secs` / `last_activity` / `idle_secs` /
`turn_count` / `recovery_method`）。

与 `RustMultiAgentEventPayload` / `RustGoTEventPayload` 命名约定一致：
编排层级事件保持 snake_case，不与流式 message 事件（启用 camelCase）混淆。

## 事件来源

- `loop_eng_rate_limit_exceeded` / `loop_eng_soft_timeout_warning` /
  `loop_eng_soft_timeout_critical` / `loop_eng_watchdog_idle` /
  `loop_eng_watchdog_dead`：由 `cmd_loop_control_check` 在检测到非空结果时 emit
- `loop_eng_retrying` / `loop_eng_retry_exhausted` / `loop_eng_recovered`：
  由 AgentLoop 在重试/恢复时直接 emit（命令层不介入）

## 注释块 10（原文件第 552-566 行）

单个 Loop Control 任务的响应式状态

镜像 Rust 端 LoopController 状态 + 事件流累加计数器。
UI 组件通过 `lcTasks.get(taskId)` 读取并渲染。

## 与 MultiAgentSessionState 的差异

- **索引键**：`taskId`（非 `sessionId`），与 `LongTaskRecord.task_id` 对齐
- **无 run/abort**：LoopController 只做检查，不执行任务
- **状态来源**：`status` 由 `getStatus` / `check` 命令返回 + 事件流累加双重维护
- **事件类型**：8 个 Loop Engineering 专用事件（rate_limit / retrying /
  retry_exhausted / soft_timeout_warning / soft_timeout_critical /
  watchdog_idle / watchdog_dead / recovered）
- **无编排节点**：不参与 OrchestratorState，不返回 NodeResult

## 注释块 11（原文件第 660-669 行）

为指定任务设置事件监听器

监听 `loop_control:event:{taskId}` 事件，收到 Rust payload 后：
1. 转换为 TS 事件（camelCase）
2. 更新模块级响应式状态（lcTasks）
3. 分发给所有订阅者

幂等：若已存在监听器，直接返回（避免重复监听）。

## 注释块 12（原文件第 754-777 行）

创建 LoopController 实例并注册到 Rust 端 registry

# 参数

- `taskId`：任务 ID（前端生成，建议前缀 `lc_`；与 `LongTaskRecord.task_id` 对齐）
- `config`：可选 LoopControlConfig（null=使用默认配置；仅无 sessionId 绑定时生效）
- `sessionId`：可选会话 ID。传入后 Rust 端通过 `register_session_loop_control`
  复用该会话 AgentLoop 内建 LoopController（共享单实例），消除"自动 vs 手动"双轨
  ——手动命令（recordTurn/getStatus/check）与自动驱动读取同一份计数器/状态。
  config 在绑定会话时被忽略（以会话内建控制器配置为准）。

# 行为

1. 调用 `cmd_loop_control_create` 在 Rust 端创建 LoopController
   - 有 sessionId：共享会话内建控制器（手动命令读数与自动驱动一致）
   - 无 sessionId：独立创建控制器（手动轨）
2. 创建前端响应式任务状态并加入 `lcTasks`
3. 设置事件监听器

# 错误

抛出 Rust 端返回的 `LoopControlRegistryError`（已序列化为 JS 对象）：
- `not_found`：任务/会话不存在
- `already_exists`：taskId 已存在
- `lock_error`：控制器锁冲突
- `invalid_config`：配置错误
- `internal`：会话不存在或绑定失败

## 注释块 13（原文件第 773-782 行）

销毁 LoopController 实例

1. 调用 `cmd_loop_control_destroy`：Rust 端移除注册
2. 清理前端事件监听器
3. 从 `lcTasks` 移除
4. 清理订阅者集合

任务完成后调用，避免内存泄漏。

## 注释块 14（原文件第 805-826 行）

执行一站式检查并 emit 事件

# 参数

- `taskId`：任务 ID

# 行为

1. 调用 `cmd_loop_control_check`，Rust 端执行 `controller.check_all()`
2. Rust 端根据 check 结果构造对应的 `LoopEng*` 事件并广播：
   - rate_limit 超限 → `loopEngRateLimitExceeded`
   - soft_timeout Warning → `loopEngSoftTimeoutWarning`
   - soft_timeout Critical → `loopEngSoftTimeoutCritical`
   - watchdog Idle → `loopEngWatchdogIdle`
   - watchdog Dead → `loopEngWatchdogDead`
3. 事件通过事件流推送到前端（handleTaskEvent 更新状态）
4. 返回 `RustLoopControlCheckResult`（含 hasAny / shouldStop / 各组件状态）

# 注意

即使 check 为空（hasAny=false）也会返回结果。
此命令不 emit `LoopEngRetrying` / `LoopEngRetryExhausted` / `LoopEngRecovered`，
这些事件由 AgentLoop 在重试/恢复时直接 emit。

## 注释块 15（原文件第 1010-1087 行）

Loop Engineering 前端 composable

模块级单例，多次调用返回同一组状态与方法。

# 使用示例

```ts
const {
  tasks,
  activeTaskCount,
  create,
  check,
  recordTurn,
  recordToolCall,
  recordTokens,
  updateActivity,
  resetCounters,
  getConfig,
  getStatus,
  destroy,
  listTasks,
  subscribe,
  generateTaskId,
  secsToDuration,
  msToDuration,
  durationToMs,
  durationToSecs,
} = useLoopControlRust()

// 创建任务（使用默认配置）
const taskId = generateTaskId()
await create(taskId)

// 或创建任务（自定义配置）
const customConfig: RustLoopControlConfig = {
  rateLimit: { maxTurns: 50, maxToolCalls: 100, maxTokens: 50000, maxDuration: secsToDuration(3600) },
  retry: {
    maxRetries: 5,
    initialBackoff: msToDuration(500),
    backoffMultiplier: 1.5,
    maxBackoff: msToDuration(10000),
    retryableErrors: ['timeout', 'server_error'],
  },
  softTimeout: {
    warnThreshold: secsToDuration(600),
    criticalThreshold: secsToDuration(1800),
  },
  watchdog: {
    idleThreshold: secsToDuration(120),
    deadThreshold: secsToDuration(600),
    autoRecovery: false,
  },
}
await create(taskId, customConfig)

// 订阅事件
const unsubscribe = subscribe(taskId, (event) => {
  if (event.type === 'loopEngRateLimitExceeded') {
    console.warn(`速率限制触发: ${event.limitType} (${event.current}/${event.max})`)
  }
})

// AgentLoop 每轮调用
await recordTurn(taskId)
const checkResult = await check(taskId)
if (checkResult.shouldStop) {
  // 速率限制超限，AgentLoop 应优雅停止
}

// 查询状态
const status = await getStatus(taskId)
console.log(`已运行 ${status.elapsedMs}ms, turns=${status.turns}`)

// 任务完成后清理
unsubscribe()
await destroy(taskId)
```
