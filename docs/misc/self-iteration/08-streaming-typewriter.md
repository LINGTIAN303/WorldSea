## 迭代主题 8：前端流式输出（打字机效果）+ 消息区自动滚动

> 用户指示"这次看前端吧"。此前 `prompt` 是**一次性阻塞返回**（`send_message` 返回完整 `reply` 后才渲染），无打字机效果。本轮把 `genai_backend` 已广播的流式事件（`StreamStart/StreamDelta/StreamEnd`，Rust 侧早已存在）打通到前端，实现打字机效果，并补上打字机效果必需的消息区自动滚动跟随。

### 决策点 31：复用 Rust 既有 `AgentEvent::Stream*` 事件 + `agent:event:stream:{session_id}` 通道透传，而非新建流式通道

**背景**：`crates/agent-runtime/src/llm/genai_backend.rs` 在流式生成时已广播 `StreamStart/StreamDelta/StreamEnd`（含完整文本），经 `agent.rs` 的 `BackendEventBridge` 桥接到 AgentLoop 的 `EventBroadcaster`。但 Tauri 端 `TauriAgentEventEmitter::on_event` 只处理了 `DeepPhaseChanged`/`A2UI`/`SubAgent*`，**未处理 `OrchestratorEvent::Agent`**，导致前端收不到流式增量。

**选择**：在 `TauriAgentEventEmitter::on_event` 增加 `OrchestratorEvent::Agent(agent_event)` 分支，将 `StreamStart`→`{type:'start',model}`、`StreamDelta`→`{type:'delta',delta}`、`StreamEnd`→`{type:'end',fullText}`、`Error`→`{type:'error'}`、`AgentEnd`→`{type:'agent_end'}` 转发到 `agent:event:stream:{session_id}`；其余基础 Agent 事件（UserMessage/ToolCall*/A2UI）不在此通道转发。

**理由**：Rust 流式事件是**现成的唯一事实源**，前端只需补监听，不重复产生流式数据；`agent:event:{type}:{session_id}` 命名空间与既有 `deep_phase_changed`/`a2ui`/`subagent` 完全一致，监听器生命周期管理可复用同一模式。

### 决策点 32：`EMITTER_REGISTRY` 按会话复用 emitter，避免 `send_message` 重复订阅导致事件多播

**背景**：`send_message` 每次调用都 `agent.subscribe(emitter)`。虽 `EventBroadcaster::subscribe` 已按 `Arc::ptr_eq` 去重，但**每次新建 emitter 指针不同**，去重失效，导致前端重复收到同一 delta。

**选择**：新增 `static EMITTER_REGISTRY: OnceLock<StdMutex<HashMap<String, Arc<TauriAgentEventEmitter>>>>`，`send_message` 先查注册表，无则创建并 `subscribe`，有则复用。保证每会话仅订阅一次。

**理由**：按会话粒度复用 emitter 是"每会话一次订阅"的最直接实现；天然与 `deep_phase_changed`/`subagent` 等按会话索引的监听器生命周期对齐。

### 决策点 33：`send_message` 的注册表 MutexGuard 不跨 await 持有（future 非 Send 修复）

**实测修复**：初版在 `{ let mut registry = emitter_registry().lock(); ... agent.subscribe(...).await; registry.insert(...) }` 中，`MutexGuard` 跨 `await` 持有，`cargo check` 报 `future returned by send_message is not Send`。改为：先 `lock` 判断 `contains_key`（guard 随即释放）→ 在 guard 外 `agent.subscribe(...).await` → 重新 `lock` 用 `entry().or_insert()` 插入。消除跨 await 持有非 Send 锁句柄。

### 决策点 34：前端 `useAgentRust.ts` 新增流式状态与监听，`prompt` 的助手消息与流式消息去重

**选择**：新增 `RustStreamPayload` 联合类型、`streamingAssistant`/`lastStreamedMsg` 响应式状态、`setupStreamListener`/`teardownStreamListener`/`handleStreamEvent`/`upsertMsgInSession`，并接入 `newSession`/`deleteSession`/`switchSession`/`dispose` 生命周期。`prompt` 返回后：若已通过流式事件落地（`lastStreamedMsg` 非空），**复用该消息并以 `result.reply` 为最终权威内容**；否则（非流式后端）一次性创建助手消息。

**理由**：`StreamEnd` 携带完整文本，是比 delta 累积更权威的最终内容（避免截断/丢包）；`lastStreamedMsg` 标记"本回合已流式创建"，`prompt` 据此去重，不重复追加助手消息。

### 决策点 35：消息区「接近底部才跟随」的智能滚动，而非无条件置底

**背景**：打字机效果下消息内容实时变长，若滚动区不自动跟上，用户看不到实时输出；但若无条件置底，会打断用户上翻历史。

**选择**：`App.vue` 给 `.messages` 加 `ref` + `@scroll.passive`，维护 `followBottom`（`scrollHeight - scrollTop - clientHeight < 80` 时置 true）。watch 消息内容签名（`id + content.length` 拼接串）变化时，仅当 `followBottom` 为 true 才 `scrollToBottom`。

**理由**：用户在上翻（远离底部）时停止跟随，回到底部附近自动恢复；`@scroll.passive` 避免滚动阻塞；watch 用"内容签名"而非 deep watch，避免整数组深层遍历开销。

## 影响范围（迭代主题 8）
- `apps/tauri/src-tauri/src/commands.rs`：`TauriAgentEventEmitter` 新增 `OrchestratorEvent::Agent` 流式转发分支 + `EMITTER_REGISTRY` 会话级 emitter 复用 + `send_message` 多重锁不在 await 间持有。
- `crates/agent-runtime/src/event.rs`：`EventBroadcaster::subscribe` 按 `Arc::ptr_eq` 去重（既有，本轮复用）。
- `apps/tauri/src/agent/composables/useAgentRust.ts`：流式 payload 类型 + 状态 + 监听生命周期 + `prompt` 去重。
- `apps/tauri/src/App.vue`：消息区智能滚动跟随。

## 验证方式（迭代主题 8）
- `cargo check`（apps/tauri/src-tauri）：通过（修复决策点 33 后）。
- `npm run typecheck`（apps/tauri）：vue-tsc 通过。
- `npm run build`（apps/tauri）：vite build 通过（`✓ built in 6.63s`，仅既有 INEFFECTIVE_DYNAMIC_IMPORT/PLUGIN_TIMINGS 警告，非错误）。

> **备注**：打字机效果需真实 LLM 流式后端（`genai_backend`）运行于 Tauri 窗口内才能端到端观测；纯浏览器打开前端时 `invoke` 为 `undefined`（Tauri 运行时边界，非 bug）。编译链路（前端 typecheck + Rust cargo check）已闭环验证。

