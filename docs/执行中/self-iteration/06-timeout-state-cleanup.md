## 迭代主题 6：子 Agent 委派超时后实例状态清理

> 上一轮已实现子 Agent 委派超时（`delegate_timeout`），但超时路径**未清理子 Agent 实例状态**：`tokio::time::timeout` 超时是把 `run` future **drop**（非 abort），`run` 末尾复位 `is_streaming=false` 的语句永不执行，实例残留 `is_streaming=true`；且 ReAct 循环可能中途被丢弃，留下"含 `tool_calls` 但无配对 `toolResult` 的 assistant 消息"，污染下次复用。

### 决策点 28：超时后调 `reset_after_timeout` 复位流式 + 裁剪不完整消息，而非 `abort()`

**背景**：快捷修法是超时分支调 `agent.abort()`。但 `abort()` 置位 `state.aborted=true`，使实例**永久不可复用**（下次 `run` 开头立即返回 `AgentError::Aborted`），与"复用实例累积上下文"的目标冲突。

**选择**：在 `AgentLoop` 新增 `reset_after_timeout()` 方法：
1. 复位 `is_streaming=false`（future 被 drop 后 run 尾部不复位，需外部兜底）。
2. 裁剪尾部"含 `tool_calls` 但无配对 `toolResult` 的 assistant 消息"（被 drop 的循环大概率留下的残缺消息）。
3. **不置位 `state.aborted`**——实例保持可复用。

在 `subagent.rs` 超时分支调用 `agent.reset_after_timeout().await`，位置在广播 `SubAgentError` 之前。

**理由**：
- 目标语义是"超时但不报废实例"，`abort()` 会误伤复用；`reset_after_timeout` 精准复位，代价最小。
- `is_streaming` 是前端 `IAgentBackend.isStreaming` 与并发判断的依据，卡在 true 会导致前端误显示"流式中"、且可能误判实例占用。
- 裁剪残缺 assistant 消息避免下次 LLM 收到畸形对话（assistant 请求工具但无工具结果）。

**代价**：极少数场景（一次循环内多个并行工具调用中途被 drop）可能残留更复杂的半截消息，本方法只裁剪最常见的"尾部单条无配对 assistant"案例；极端残留仍可能影响下次上下文质量，但不影响正确性。已记录为该主题的已知残留风险。

**验证**：新增单测 `timeout_resets_subagent_streaming_state`（断言超时后 `is_streaming=false` 且 `aborted=false`，实例可复用）。`cargo test -p agent-commands subagent::` 9/9 通过；`cargo test -p agent-runtime agent::` 18/18 通过无回归。

