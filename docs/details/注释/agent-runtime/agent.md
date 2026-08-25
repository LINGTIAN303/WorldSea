# agent.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/agent.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 src/agent/tests.rs（原 agent_tests.rs）
> 拆分记录（2026-08-06）：agent.rs 按职责拆为 src/agent/ 目录（config/state/error/loop_control/memory/llm/tools/interaction/long_task）

## 注释块 1（原文件第 1-36 行）

# AgentLoop — ReAct 模式的核心循环

对应 TS 版 `pi-agent-core` 的 `Agent` 类核心循环逻辑。
阶段 1.3 实现 ReAct（Reasoning + Acting）模式的最小可用版本。

## 架构位置

```text
┌────────────────────────────────────────────┐
│  编排框架层（Orchestrator + Node）           │  ← 阶段 2
├────────────────────────────────────────────┤
│  AgentLoop（本模块）                        │  ← 阶段 1.3
├────────────────────────────────────────────┤
│  LLM 通信层（GenaiBackend）                 │  ← 阶段 1.2
└────────────────────────────────────────────┘
```

## ReAct 循环流程

```text
用户输入
   ↓
┌──→ LLM 调用（backend.prompt）
│      ↓
│   响应含 tool_calls?
│      ├─ 否 → 返回最终文本（循环结束）
│      └─ 是 ↓
│         执行工具（tool_bus.call_tool）
│            ↓
│         推入 toolResult 消息
│            ↓
└──── 继续循环（iteration+1）
```

## 与 TS 版的差异

- **单层循环**：阶段 1.3 只实现单层 tool_call 循环，外层 follow-up 由调用方驱动
- **同步工具执行**：阶段 1.3 工具串行执行，阶段 1.4 再支持并行
- **不传工具定义给 LLM**：阶段 1.3 通过系统提示词告知工具列表，阶段 1.4 再接入完整 tools 参数

---

## 注释块 2（原文件第 113-123 行）

内建 LoopController 配置（`None`=禁用内建自动控制，默认启用宽松配置）

阶段 2.6 的 `LoopController` 聚合 RateLimiter/RetryPolicy/SoftTimeout/Watchdog。
默认启用（`LoopControlConfig::default()` 宽松配置：100 turns / 200 tools / 6h），
在内层 ReAct 循环自动驱动：
- rate_limit 超限 → 抛 `AgentError::RateLimitExceeded` 停止循环
- soft_timeout / watchdog → 广播 `LoopEng*` 事件提醒（不强制停止）
- 重试路径 → 广播 `LoopEngRetrying` / `LoopEngRetryExhausted`

若需完全禁用内建自动控制，将其设为 `None`（命令层 `LoopControlRegistry`
的手动控制不受影响）。

---

## 注释块 3（原文件第 245-264 行）

AgentLoop — ReAct 模式的核心循环

持有 [`NodeBackendAccessor`]（LLM 调用）和 [`ToolBus`]（工具执行），
通过 `run` 方法启动 ReAct 循环。

# 使用示例

```rust,ignore
let backend = Arc::new(GenaiBackend::new(provider_config));
let tool_bus = Arc::new(SimpleToolBus::new());
tool_bus.register(Arc::new(EchoTool)).await;

let agent = AgentLoop::new(backend, tool_bus)
    .with_config(AgentLoopConfig {
        max_iterations: 10,
        system_prompt: Some("你是一个有用的助手".into()),
        ..Default::default()
    });

let response = agent.run("你好".into()).await?;
```

---

## 注释块 4（原文件第 287-297 行）

长任务管理器（Loop Engineering 核心组件，阶段 2.2 新增）

每个 AgentLoop 持有独立的 `LongTaskManager`，负责：
- 长任务状态机（running/completed/failed/cancelled）
- 心跳定时器（5s 间隔，UI 监控用）
- checkpoint 脏标记节流（避免频繁写 SQLite）
- 协作式取消标志（ReAct 循环每轮检查）

调用方通过 `long_task_manager()` 获取只读引用，调用 `start_task` / `complete_task`
/ `request_cancel` / `checkpoint` 等方法。持久化由 Tauri 端 `LongTaskRepository`
通过 `HeartbeatTick` 回调驱动，agent-runtime 不依赖 rusqlite。

---

## 注释块 5（原文件第 314-324 行）

最近一次 Deep Mode 阶段标签（P2 新增）

用于检测阶段切换：每次工具执行后调用 `classify_tool`，
若返回的标签与 `last_phase_label` 不同，则广播 `DeepPhaseChanged` 事件。

- 初始值 `None`：尚未执行任何工具，首次工具调用必定触发事件
- 后续值 `Some("证据收集")` 等：缓存上次阶段标签

使用 `StdRwLock<String>` 而非 `Mutex<String>`：
- 临界区极短（仅读写一个 `Option<String>`），不跨 await
- 读写比例约 1:1，RwLock 略优于 Mutex

---

## 注释块 6（原文件第 518-532 行）

启动 ReAct 循环

# 参数

- `user_input`：用户输入文本

# 返回

最终响应文本（LLM 在最后一轮未触发工具调用时的回复）

# 流式事件

- `AgentStart`：循环开始（携带 `backend.current_model()` 返回的模型 ID）
- `UserMessage`：用户消息推入
- `StreamStart`：首次 LLM 调用前（携带模型 ID）
- `StreamDelta`：流式增量（由 backend 桥接转发）
- `StreamEnd`：最终文本返回
- `AgentEnd`：循环结束

---

## 注释块 7（原文件第 666-676 行）

ReAct 核心循环

单层循环：LLM 调用 → 工具执行 → LLM 再调用 → ... → 最终文本

# Loop Engineering 集成（阶段 2.2 批次3）

- **协作式取消**（批次3.2）：每轮迭代开始检查 `long_task_manager.is_cancel_requested()`，
  若为 true 调用 `cancel_task()` 转换状态机并返回 `Aborted`。
  设计动机：让当前 tool call 完成后优雅停止，而非强制中断（符合"无强制中断"需求）。
- **事件驱动 checkpoint**（批次3.3）：每次工具执行完成后调用 `long_task_manager.checkpoint()`，
  更新 `turn_count` / `current_tool` / checkpoint 快照（含完整 messages 用于断点恢复）。
  节流策略：仅在 `has_active_task()` 时生成 checkpoint 快照，避免无活跃任务时的无效克隆。

---

## 注释块 8（原文件第 727-736 行）

Loop Engineering 批次5：内建 LoopController 驱动

每轮迭代开始：
- 更新看门狗活动时间（watchdog.update_activity）
- 记录 turns 计数（rate_limiter.inc_turns）
- check_all() 一站式检查速率限制 / 软超时 / 看门狗
- 软超时 / 看门狗 → 广播 LoopEng* 事件（提醒，不强制停止，符合"无强制中断"需求）
- 速率限制超限 → 广播 LoopEngRateLimitExceeded 并停止循环

设计：与命令层 `LoopControlRegistry`（按 task_id 手动 check_and_emit）互补。
本块是 AgentLoop 内建自动驱动，仅当 `config.loop_control = Some(...)`（默认启用）时生效。

---

## 注释块 9（原文件第 757-766 行）

风险点修复：同步 state.messages → backend（2026-08-04）

架构问题：AgentLoop 把消息放在 state.messages，但 backend.prompt 只接收
单个 prompt 字符串，backend 内部自维护自己的 messages（初始为空）。
此前 AgentLoop 传空字符串 prompt，导致真实用户消息（system/user）从未传给
backend，LLM 收到的只有空 user 消息 → 不触发工具调用（实测复现）。

修复：每次 LLM 调用前，把 state.messages 完整同步给 backend。
注意：backend.prompt 返回后会在 backend.messages 追加 assistant 消息，
但工具执行产生的 toolResult 消息只在 state.messages，故每轮必须重新同步。

---

## 注释块 10（原文件第 869-880 行）

Loop Engineering 批次3.3：事件驱动 checkpoint 更新

每次 tool_execution_end + turn_end 触发 checkpoint 更新：
- progress_turn_count：当前迭代轮次（用于 UI 显示进度）
- progress_current_tool：最后一个工具名（用于 UI 显示当前阶段）
- new_checkpoint：完整 messages 快照（用于断点恢复续跑）

节流优化：仅当有活跃长任务时才生成 checkpoint 快照（克隆 messages 有开销）
持久化节流：dirty 标记由心跳定时器（5s 一次）批量写库，避免每轮都落 SQLite

P2 新增：Deep Mode 阶段判定与事件广播

在 checkpoint 前计算 current_phase，使长任务持久化时也带上阶段标签；
同时检测阶段变化并广播 `DeepPhaseChanged` 事件，前端构建 deepSegments。

---

## 注释块 11（原文件第 974-985 行）

广播恢复事件（`LoopEngRecovered`）

# 触发

内建 LoopController 的告警锁存态（`is_alerted()`）由 `true → false` 跳变时触发。
基于底层触发标志（SoftTimeout/Watchdog 的 `*_triggered`）而非 `check_all` 返回级别，
避免软超时锁存后"后续 check 返回 None"被误判为恢复。

# 恢复场景

- 看门狗：活动恢复（`update_activity` 清除 Idle/Dead 触发标志）
- 软超时：`reset()`（命令层 `reset_counters` / retry 路径）

符合项目"无强制中断"原则：恢复为协作式自动上报，不干预循环本身。

---

## 注释块 12（原文件第 1178-1187 行）

构建 PromptCallOptions

阶段 1.4：从 `tool_bus.list_all()` 拉取工具定义并填入 `tools` 字段，
让 LLM 能看到完整工具列表（含 JSON Schema）以触发 tool_calls。

阶段 3：记忆注入——把 `memory_context`（本轮 recall+inject 结果）拼进
system prompt override。backend 在存在 override 时会跳过 messages 中的
system 消息，故记忆只能经 override 注入（本方法拼接）。

每轮循环都重新拉取，确保动态注册的工具（如 MCP 工具）能被 LLM 调用。

---

## 注释块 13（原文件第 1214-1247 行）

调用 LLM，含限流/超时/重试（批次4）

包裹 `backend.prompt`，根据 [`AgentLoopConfig`] 应用以下策略：

# 1. 限流（`min_interval_between_calls`）

在每次 LLM 调用前检查距上次调用的间隔，不足则 sleep。
限流目的是避免触发 Provider 速率限制（如 DeepSeek 60次/分钟）。

# 2. 超时（`llm_timeout`）

用 `tokio::time::timeout` 包裹 `backend.prompt`，超时视为单次调用失败，
触发重试（若 `llm_max_retries > 0`）。
注意：超时只针对单次调用，不针对整个任务。

# 3. 重试（`llm_max_retries` + 指数退避）

失败时按 `delay = llm_retry_base_delay * 2^attempt` 等待后重试。
适用场景：网络抖动、429 Too Many Requests、5xx 服务器错误。
不区分错误类型：认证失败/参数错误重试也无效，但当前实现不细分（简化逻辑）。

# 4. 取消检查

每次重试前检查 `long_task_manager.is_cancel_requested()`，
若已请求取消则返回 [`AgentError::Aborted`]，避免无谓重试。

# 调用时机

- `run_react_loop` 中每轮 LLM 调用
- 不在 `follow_up` / `clear_history` 等非 LLM 调用中使用

# 参数

- `prompt_input`：用户输入文本（阶段 1.3 传空字符串，因消息已通过 state.messages 注入）
- `options`：PromptCallOptions（含工具定义、系统提示词等）

# 返回

- `Ok(PromptResponse)`：LLM 响应
- `Err(AgentError::Aborted)`：协作式取消
- `Err(AgentError::Backend(_))`：重试耗尽后的最后一次错误

---

## 注释块 14（原文件第 1355-1378 行）

执行单个工具调用，含超时/重试（批次4）

包裹 `tool_bus.call_tool`，根据 [`AgentLoopConfig`] 应用以下策略：

# 1. 超时（`tool_timeout`）

用 `tokio::time::timeout` 包裹 `tool_bus.call_tool`，超时视为单次执行失败。
超时后工具执行被视为失败，错误信息推入 toolResult 消息让 LLM 处理。

# 2. 重试（`tool_max_retries` + 指数退避）

失败时按 `delay = tool_retry_base_delay * 2^attempt` 等待后重试。
**默认 0=不重试**，因为工具可能有副作用（如写文件、发请求），
重复执行可能导致数据不一致。需要重试的工具应在 ToolBus 层自行实现。

# 3. 取消检查

每次重试前检查 `long_task_manager.is_cancel_requested()`，
若已请求取消则返回 [`ToolError::Aborted`]，避免无谓重试。

# 注意

- 仅在串行模式生效（`parallel_tool_calls=false`，默认配置）
- 并行模式因 `self` 无法 move 进 'static 闭包，不应用超时/重试

# 参数

- `name`：工具名
- `args`：工具参数（JSON Value）

---

## 注释块 15（原文件第 1443-1454 行）

执行工具调用

阶段 1.3：仅串行执行
阶段 1.4：根据 `config.parallel_tool_calls` 启用并行（基于 `tokio::task::JoinSet`）

# 并行模式策略

1. 主任务按顺序广播所有 `ToolCallStart`（UI 能先看到全部待执行工具）
2. 用 `JoinSet` 并发 spawn 每个工具调用
3. 收集结果后按原索引排序（保证 toolResult 消息顺序与 tool_calls 一致，便于 LLM 理解）
4. 主任务按顺序广播 `ToolCallEnd`

单工具调用时走串行路径（避免 spawn 开销）。

---

## 注释块 16（原文件第 1554-1566 行）

用 JoinSet 并发执行（每个 task 返回 (原索引, call_id, tool_name, result_value)）

Loop Engineering 批次4 集成：并行模式下的工具重试/超时限制
- **超时**：每个 task 独立应用 `tool_timeout`（spawn 内部用 `tokio::time::timeout`）
- **重试**：每个 task 独立重试（`tool_max_retries` 控制单工具重试次数）
- **限流**：不在并行模式应用（并行执行本身就不需要严格限流）

注意：spawn 内部不能调用 `self.execute_tool_with_retry`（因为 `self` 不能 move 进
'static 闭包），因此这里直接用 `tool_bus.call_tool`，不应用超时/重试。
若需在并行模式应用超时/重试，应在 ToolBus 层实现（如 `RetryToolBus` 装饰器）。
当前实现保持并行模式简单，超时/重试仅在串行模式生效（默认配置 parallel_tool_calls=false）。

---

## 注释块 17（原文件第 1756-1768 行）

重置实例状态（委派超时后调用）

当子 Agent 的 `run` future 被 `tokio::time::timeout` 丢弃时：
1. `run` 尾部复位 `is_streaming` 的语句不会执行（future 被 drop，剩余代码
   不运行），导致实例残留 `is_streaming=true`，前端/并发判断误以为仍在流式。
2. ReAct 循环可能在中途被丢弃，留下"含 `tool_calls` 但无配对 `toolResult` 的
   assistant 消息"，污染下次复用的对话上下文。

本方法复位 `is_streaming` 并裁剪尾部不完整的工具调用消息，保证实例下次可复用。

**注意**：不置位 `state.aborted`——置位会使实例永久不可复用（下次 `run` 立即
返回 `Aborted`），与"复用实例累积上下文"的目标冲突。若确需彻底停用实例，应调用
[`AgentLoop::dispose`]。

---

## 注释块 18（原文件第 1801-1812 行）

热切换模型 — 对应前端 `IAgentBackend.updateModel(...)`

委托给 `backend.update_provider`，不清空消息历史。
同时更新 config 的 temperature/max_tokens（若传入）。

# 参数

- `provider`：Provider ID（如 "deepseek"/"openai"/"anthropic"）
- `model_id`：模型 ID
- `base_url`：自定义 base URL
- `api_key`：API Key（None=保持原值）
- `temperature`：温度（None=保持原值）
- `max_tokens`：最大 token（None=保持原值）

---

## 注释块 19（原文件第 1880-1891 行）

获取长任务管理器引用

调用方通过此引用调用 `LongTaskManager` 的方法：
- `start_task` / `complete_task` / `fail_task` / `cancel_task`
- `request_cancel` / `is_cancel_requested`（协作式取消）
- `checkpoint`（事件驱动更新 checkpoint）
- `start_heartbeat` / `stop_heartbeat`（心跳定时器）
- `get_active_task` / `get_heartbeat_status`（UI 查询）

# 设计说明

返回 `&LongTaskManager`（Arc 解引用），调用方无法 clone Arc 自身，
但可以通过 `Arc::clone(&agent.long_task_manager())` 获取独立的所有权句柄。

---

## 注释块 20（原文件第 1903-1942 行）

启动长任务心跳定时器（helper 方法，批次3.4）

封装 [`LongTaskManager::start_heartbeat`]，让调用方无需手动传入 `manager_arc`。

# 参数

- `on_tick`：心跳 tick 回调（持久化逻辑）

# 行为

1. 获取 `long_task_manager` 的 Arc 句柄
2. 调用 `LongTaskManager::start_heartbeat(manager_arc, on_tick)`

# 调用时机

- **长任务启动后**：调用方先 `start_task()` 创建任务，再调用本方法启动心跳
- **断点恢复后**：调用方先 `resume_task()` 恢复内存状态，再调用本方法重启心跳

# 使用示例（Tauri 命令层）

```rust,ignore
agent_loop.start_long_task_heartbeat(|tick| async move {
    match tick {
        HeartbeatTick::HeartbeatOnly { task_id, last_heartbeat_at } => {
            // 轻量写入：仅更新 last_heartbeat_at 列
            if let Some(repo) = state.long_task_repository.get() {
                let _ = repo.update_heartbeat(task_id, last_heartbeat_at).await;
            }
        }
        HeartbeatTick::CheckpointFlush { task_id, record } => {
            // 重量级写入：upsert 完整 record（含最新 checkpoint）
            if let Some(repo) = state.long_task_repository.get() {
                let _ = repo.save(record).await;
            }
        }
    }
}).await;
```

# 设计说明

- **不在 agent-runtime 内部自动启动**：持久化依赖 `LongTaskRepository`（Tauri 端），
  agent-runtime crate 不依赖 rusqlite，故心跳定时器必须由调用方显式启动。
- **回调闭包捕获**：`on_tick` 闭包可以捕获 Tauri `State` 等外部引用，
  通过 `Arc<LongTaskRepository>` 等方式访问持久化层。

---

## 注释块 21（原文件第 1993-2005 行）

Backend 事件桥接 listener

将 `NodeBackendAccessor`（如 `GenaiBackend`）广播的内部事件转发到
`AgentLoop` 的 `EventBroadcaster`，使订阅 AgentLoop 的监听器能收到
backend 的 `StreamStart`/`StreamDelta`/`StreamEnd`/`ToolCallStart`/`ToolCallEnd` 等事件。

# 设计动机

AgentLoop 和 Backend 各自持有独立的 `EventBroadcaster`：
- Backend 广播：LLM 流式增量、原始工具调用事件
- AgentLoop 广播：ReAct 循环级事件（AgentStart/UserMessage/AgentEnd 等）

若不桥接，订阅 AgentLoop 的监听器收不到 backend 的流式事件，
前端无法看到流式输出。

---

## 织入点 Hook 协议（matrix §8 里程碑 5，2026-08-25 实现）

> 代码：[kernel/agent/hooks.rs](../../../../crates/agent-runtime/src/kernel/agent/hooks.rs)
> 把 `AgentLoop::run` 生命周期内的横切织入位（记忆闭环 / 四管线路由 / DeepPhase 阶段判定）
> 显性化为统一位点契约，并提供外部扩展通道。**不改变**内置织入行为与对外契约。

### 位点清单（`RunPhase`）

| 位点 | run() 位置 | 内置织入（组织化内部方法） | 外部钩子可观察 |
|------|-----------|--------------------------|---------------|
| `BeforeReact` | run 开头、ReAct 循环前 | 记忆召回 `run_recall_memory` + 路由决策 `run_router_decision` | 本轮输入、backend、emitter |
| `AfterUserMessage` | user 消息入队并广播后 | 无 | 输入侧上下文 |
| `OnToolCall` | run_react_loop 每轮工具调用后 | DeepPhase 阶段切换事件 + long_task checkpoint | 当前工具名 `ctx.tool_name` |
| `AfterReact` | ReAct 循环结束、终态事件广播后 | 无 | 本轮成败 `ctx.succeeded` |
| `AfterRun` | run 收尾 | 记忆归档 `run_memory_archive` | 本轮成败 `ctx.succeeded` |

### 契约（`AgentLoopHook` trait）

每位点一个方法（`on_before_react` / `on_after_user_message` / `on_tool_call` /
`on_after_react` / `on_after_run`），默认空实现，实现方仅覆写关心的位点。
`HookContext` 注入只读上下文：`agent`（AgentLoop 只读引用）、`run_user_input`、
`tool_name`（OnToolCall）、`succeeded`（AfterReact/AfterRun）。

### 设计约束

1. **内置织入保持底座内聚**：记忆/路由/DeepPhase 重构成内部方法（`run_recall_memory` /
   `run_router_decision` / `run_memory_archive`）组织化，`with_memory`/`with_router` 启用
   语义不变；钩子仅作额外观察/扩展，不替代内置逻辑。
2. **零行为变化**：默认无钩子注册（`dispatch` 空快照短路），`run()` 对外行为与迁移前一致。
3. **hook 失败不阻断主流程**：协议约定实现方在 hook 内自行容错，调度方不捕获异常。

### 使用示例

```rust,ignore
struct UsageLogger;
#[async_trait]
impl AgentLoopHook for UsageLogger {
    async fn on_after_run(&self, ctx: &HookContext<'_>) {
        if let Ok(usage) = ctx.agent.get_usage().await {
            tracing::info!("本轮 usage: {:?}", usage);
        }
    }
}

let agent = AgentLoop::new(backend, tool_bus)
    .with_hook(Arc::new(UsageLogger));
// 或运行期追加：agent.register_hook(Arc::new(UsageLogger));
```

### 验证

`run_dispatches_hooks_in_order_and_keeps_behavior` 单测：注册 RecordingHook 跑一次
无工具调用 run，断言按 `before_react → after_user_message → after_react → after_run`
顺序调度，且返回文本与无钩子时一致（行为不变）。

---

## 模块职责一句话

AgentLoop ReAct 核心循环：配置管理、ReAct 主循环、工具执行（串行/并行）、限流/超时/重试、事件广播、记忆注入、长任务集成、织入点 Hook 协议（RunPhase 位点 + AgentLoopHook 扩展通道）。
