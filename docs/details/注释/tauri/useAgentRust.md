# useAgentRust.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/agent/composables/useAgentRust.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-40 行）

# useAgentRust — Tauri 端 Agent Backend 适配器（Phase 5.2）

## 架构位置

本文件是 Tauri 端的 Agent Backend 入口，对应 Web 端的 useAgent.ts。
通过 Tauri `invoke` 调用 Rust 命令层（`crates/agent-commands`），
打通「前端 → IPC → Rust 命令 → 响应」完整链路。

## 端分离策略

- 共享层：`@worldsmith/shared-composables/agent/useAgent`（inject 模式 + 类型定义）
- Tauri 端：本文件（Rust IPC 适配器）
- Web 端：`apps/web/src/agent/composables/useAgent.ts`（本地状态机 + 占位）

## 与 5.1 命令层的映射

| TS 方法             | Rust 命令                 | 说明                                    |
|---------------------|---------------------------|----------------------------------------|
| `newSession`        | `new_session`             | 新建会话（返回 SessionInfo）            |
| `listSessions`      | `list_sessions`           | 会话列表                                |
| `deleteSession`     | `delete_session`          | 删除会话                                |
| `prompt`/`sendMessage`| `send_message`           | ReAct 循环执行（返回 reply + state）    |
| `steer`/`followUp`  | `steer`                   | 中途引导（对应 sendBlockAction）        |
| `abort`             | `abort`                   | 中断当前运行                            |
| `clearHistory`      | `clear_history`           | 清空历史                                |
| `updateModel`       | `update_model`            | 热切换模型                              |
| `updateThinkingLevel`| `update_thinking_level`  | 更新思考级别                            |
| `getState`          | `get_state`               | 状态快照                                |
| `getMessages`       | `get_messages`            | 消息列表                                |
| `getHeartbeat`      | `get_heartbeat`           | 心跳状态（长任务监控）                  |
| `getProviderConfig` | `get_provider_config`     | Provider 配置                           |

## 状态设计

模块级单例（与 useLongTaskRust / useLoopControlRust 一致）：
多次调用返回同一组响应式状态与方法，避免多组件各自维护 session/messages。

## 事件

实现 `IAgentBackend.subscribe(listener)`，在 prompt / abort 等调用时
通过 `AgentEvent` 分发（agent_start / agent_end / message_start /
message_end / error）。当前已接入真实 genai 后端（RustProviderConfigFull
三模式），完整流式事件链路经 `agent:event:stream:{session_id}` 透传
（start/delta/end/error/agent_end，见注释块 3）。

## 注释块 2（原文件第 47-56 行）

Rust 子 Agent 委派事件 Payload

对应 `crates/agent-commands/src/subagent.rs` 的 `SubAgentManager::delegate`
广播的 OrchestratorEvent，经 Tauri `TauriAgentEventEmitter` 转发到前端
`agent:event:subagent:{session_id}` 通道。

事件类型（`type` 字段）：
- `start`：委派开始（子 Agent 正在执行）
- `completed`：委派完成（携带输出字符数与耗时）
- `error`：委派失败 / 超时（携带错误信息）

## 注释块 3（原文件第 128-139 行）

Rust 流式响应事件 Payload

对应 `crates/agent-runtime` 的 `AgentEvent::StreamStart/StreamDelta/StreamEnd/
Error/AgentEnd`，经 Tauri `TauriAgentEventEmitter` 转发到前端
`agent:event:stream:{session_id}` 通道，用于实现打字机效果。

事件类型（`type` 字段）：
- `start`：流式开始（携带模型 ID）
- `delta`：流式增量（追加到当前助手消息）
- `end`：流式结束（携带完整文本，作为最终权威内容）
- `error`：流式过程出错
- `agent_end`：Agent 循环结束（用于清理流式占位状态）

## 注释块 4（原文件第 198-208 行）

Rust `agent_runtime::llm::config::ProviderConfig` 镜像（tagged enum，`mode` 区分）

三种模式（serde tag = "mode"，lowercase）：
- `cloud`：`{ mode, provider, model_id, api_key }`
- `local`：`{ mode, endpoint, api_type, model_id }`
- `custom`：`{ mode, base_url, api_key, api_type, model_id, context_window, max_tokens }`

注意：`api_key` 在 Rust 侧 `skip_serializing`（不回显），但反序列化时
必需，故前端必须按模式补齐该字段。

## 注释块 5（原文件第 355-366 行）

为指定会话设置 DeepPhaseChanged 事件监听

监听 `agent:event:deep_phase_changed:{session_id}`，收到 Rust payload 后：
1. 按 phaseIndex 去重：同一阶段只保留首个 phase 段（避免重复累计）
2. 将 phase 段追加到 `deepSegments`（保持阶段出现的先后顺序）
3. 记录 triggerTool 到该阶段 tools（供 DeepProcessPanel 展示触发工具）
4. 依据 payload.toolStatus 更新工具状态（completed/failed）
5. 依据 payload.phaseCompleted 更新阶段状态（active/done）

幂等：若已存在监听器，直接返回（避免重复监听）。

> (已更新：2026-08-21 改为**双写 tool 事件行 + deepSegments**——不再由 deepPhases 构造带标签色带的 phase 段；`deepSegments` 保留供右侧轨迹面板 TracePanel / PhaseSection / ExecPanel 消费，见注释块 9)

## 注释块 6（原文件第 580-589 行）

处理一条子 Agent 委派事件，增量更新 `subAgents` 列表

- `start`：追加一条 `running` 状态的委派记录
- `completed`：把对应 `running` 记录更新为 `completed`，填充输出字符数与耗时
- `error`：把对应 `running` 记录更新为 `error`，填充错误信息

匹配策略：按 `subAgentId` 找到该子 Agent 最新一条 `running` 记录更新，
以应对同一子 Agent 被连续多次委派的场景。

## 注释块 7（原文件第 848-857 行）

发送消息（对应 Rust `send_message`，ReAct 循环执行）

实现 `IAgentBackend.prompt`。流程：
1. 确保会话存在
2. 先推入用户消息（本地）
3. 触发 agent_start / message_start 事件
4. invoke `send_message`（阻塞直到完整回复返回）
5. 触发 message_end / agent_end 事件，更新消息 + 缓存

## 注释块 8（原文件第 1127-1136 行）

Tauri 端 Agent Backend composable

模块级单例，多次调用返回同一组状态与方法。
在应用入口调用 `provideAgentBackend(useAgentRust())` 注入。

实现 `IAgentBackend` 契约（prompt / steer / followUp / abort / updateModel /
updateThinkingLevel / clearHistory / subscribe / dispose / isStreaming），
并补充会话管理 / 消息列表 / 心跳等 UI 需要的扩展方法。

## 注释块 9（2026-08-21 事件行流重构）

# 事件行流引擎（agentStream）—— 2026-08-21 去模式化重构

移除 deep / normal / explore 三种 chatMode 形态，主对话流统一为单一
**事件行流** `agentStream`。

## 唯一渲染源

`agentStream: AgentStreamItem[]` 成为主对话流**唯一渲染源**，5 变体：

| 变体 | 渲染行 | 说明 |
|---|---|---|
| `user{msg}` | UserRow | 用户消息行 |
| `assistant{msg}` | AssistantRow | 助手消息行（复用 useMarkdownRender） |
| `think{text,status}` | ThinkRow | 思考行（动态折叠） |
| `tool{tc}` | ToolRow | 工具行（扁平行） |
| `divider{dividerText}` | DividerRow | 分隔行 |

渲染引擎：`packages/shared-ui/src/agent/stream/`（AgentStreamList + rows/）。
列表层 `AgentMessageList.vue` 直接消费 agentStream，
删除 isDeepMode / deepSegments 平铺 / turn-separator / DeepSegmentCard。

## 双写策略

**thinking 双写**：流式 reasoning 事件同时写 `AgentMessage.thinking` 字段 +
追加 think 事件行（供 AgentStreamList ThinkRow 动态折叠渲染）。

**deep_phase_changed 双写**：收到 `agent:event:deep_phase_changed:{session_id}`，
同时 ① 追加 tool 事件行（主对话流扁平化工具展示）；② 更新 `deepSegments`
（保持阶段先后顺序，供右侧轨迹面板 TracePanel / PhaseSection / ExecPanel
消费）。不再由 deepPhases 构造带标签色带的 phase 段（思维链改由 think 行表达）。

## 回源重建 + 时间分隔

**回源重建**：`rebuildStreamFromMessages` 从消息历史重建 agentStream
（刷新 / 回源后保持一致）。assistant 行 id 用 `msg.id`（与实时流
`upsertAssistantStreamRow` 对齐，N1 修复：否则恢复态 hover 操作栏永不显示）。

**>30min divider 合成**：`pushStreamItem` / `lastContentStreamItem` /
`AGE_DIVIDER_THRESHOLD` 判定超过 30 分钟，追加 divider 时间分隔行。

## 编排期间流式抑制（O1/O4 修复，2026-08-28）

**为什么**：编排引擎的节点 LLM 调用复用会话 backend，其 StreamDelta /
Reasoning 事件经 BackendEventBridge → 会话广播器直达本模块，与 react 主链路
同通道。不区分会导致：流式早期工具调用参数 JSON 逐字符渲染成正文（O4）、
execute 步骤产物与最终文档重复平铺（O1）、每节点 reasoning 块泛滥（O2 主因）。

**怎么做**：`handleStreamEvent` 顶部守卫——`activeRun`（useOrchestrationTrace
的活跃编排 run）存在时，`start/delta/reasoning/end` 四类正文事件直接丢弃。
过程呈现统一由编排段（OrchestrationSegment：阶段进度/摘要/终局结论）承载，
终稿由 `prompt()` 拿 `send_message` 返回的 reply 唯一渲染（lastStreamedMsg 为
null → 走新建 assistant 行分支）。react 退化 run 无 trace 事件、activeRun 恒空，
打字机流式不受影响。

**边界加固**：`prompt()` 入口对上一轮异常未收口的编排 run（后端 error 路径不产
pipe_finished）本地强制收口为 failed，防止残留 activeRun 误伤本轮 react 流式。

## finalOutput 移除 / deepSegments 保留

- `finalOutput` / `FinalOutput` 已删除：权威输出统一由事件行流
  （assistant{msg}）表达，无需独立冗余字段。
- `deepSegments` 保留：右侧轨迹面板 TracePanel / PhaseSection / ExecPanel
  仍消费（主对话流左侧已不再消费；见注释块 5 就地更新说明）。
