# 群聊 LLM 通道桥 Rust 会话 — 实施计划

> status: 已完成
> 日期：2026-08-09
> 决策：用户已选 **方案 A（per-participant Rust session）**——每群聊参与者 = 一个独立 Rust AgentLoop 会话，TS 引擎继续负责轮次调度
> 目标：替换 `createWorldSmithAgent` stub（packages/agent-runtime/src/agent.ts L278），让群聊参与者走真实 LLM
>
> **完成记录（2026-08-09，commit 81e3a23）**：T1 新建 `apps/tauri/src/space/group-chat/rust/RustGroupChatBackend.ts`（per-participant 工厂，独立流式监听 delta→message_update 转发）；T2 替换 GroupChatCoordinator / GroupChatEngine / AgentPrivateChat 三处 stub import，删除零调用 resolveAgentTools；T3 providerConfig 回退逻辑已在 Coordinator L168 就位（`(p.providerConfig as any) || providerConfig`）；T4 typecheck 0 错误 + cargo check 通过（Rust 侧零改动）+ 浏览器冒烟（无 vite-error-overlay、.group-chat-layout 正常挂载不白屏）。工具桥 `cmd_agent_tool_result` 与真实 LLM 桌面冒烟列为二期。

---

## 1. 背景与关键结论

### 1.1 现状（调研确认）

- **TS 群聊引擎**（packages/agent-runtime/src/group-chat/ + apps/tauri/src/space/group-chat/GroupChatCoordinator.ts）是**纯调度层**：轮次调度靠自研 `SpeakerSelector`，对参与者的唯一消费是 `IAgentBackend` 四件事——`prompt()` 调用 / `subscribe()` 流式 / `state.messages` 读取（moderator）/ 生命周期（clearHistory/updateModel/dispose）
- **stub 现状**：`createWorldSmithAgent` 只 emit `message_start` + `message_end`，**不发 `message_update`** → Coordinator 的 `currentContent` 恒空 → 会议模式全是"空回复"提示
- **Rust 侧命令层已就绪**（关键利好）：`new_session(system_prompt, provider_config)` / `send_message` / `abort` / `steer` / `clear_history` / `trim_context` / `update_model` / `update_thinking_level` / `get_messages` / `get_state` / `delete_session` 全部已存在（crates/agent-commands/src/lib.rs）；流式事件通道 `agent:event:stream:{session_id}`（start/delta/end/error/agent_end）已由 `TauriAgentEventEmitter` 转发（src-tauri/src/commands.rs L157，EMITTER_REGISTRY 按 sessionId 复用）
- **Rust 侧唯一缺口**：`cmd_agent_tool_result`（工具桥回传）不存在——但**群聊首期可不启用工具**（参与者用纯文本对话），工具桥列为二期

### 1.2 结论

- **Rust 侧零改动**（复用既有会话命令 + 流式事件通道），不必新增 group_chat.rs 模块
- 核心工作在 TS 侧：**新增一个 RustGroupChatBackend 工厂**（per-participant 映射 Rust 会话 + message_update 事件转发），替换 3 处 stub import

---

## 2. 架构

```
GroupChatCoordinator / GroupChatEngine / AgentPrivateChat
   │  调 createRustGroupChatBackend(participant)   ← 替换 createWorldSmithAgent
   ▼
RustGroupChatBackend（新，apps/tauri/src/space/group-chat/rust/RustGroupChatBackend.ts）
   │  实现 IAgentBackend
   ├─ prompt(text)  → invoke('send_message', { sessionId, text })   ← 整轮结果 { reply, usage }
   ├─ subscribe(l)  → listen(`agent:event:stream:{sid}`)
   │                    start→emit message_start / delta→emit message_update / end→emit message_end+usage
   │                    error→emit error / agent_end→emit agent_end
   ├─ updateModel   → invoke('update_model', ...)
   ├─ abort/clearHistory/dispose → invoke 对应命令 + 清理监听器
   └─ state         → 缓存 send_message 返回的 state 快照（供 moderator 读 messages）
```

**每参与者会话生命周期**：
- 创建：`RustGroupChatBackendFactory.create(participant)` → `new_session(participant.systemPrompt, providerConfig)` → 得 `rustSessionId`，返回 backend
- 发言：Coordinator 已自行拼接群聊上下文为 prompt 文本（GroupChatCoordinator.ts L385-395），`prompt(text)` 全量带上下文 → Rust 会话无需共享群聊历史
- 销毁：`dispose()` → `delete_session(rustSessionId)` + 移除监听器 + 清 participant→session 映射

**工具桥（二期）**：Rust emit `agent:tool_call:{sessionId}` → 前端用 `ALL_TOOLS_MAP` 执行 TS 工具 → 新增 `cmd_agent_tool_result` 回传。首期不启用（participant.enabledTools 为空）。

---

## 3. 任务分解（文件级）

### T1：RustGroupChatBackend 工厂（新增，核心）

**文件**：`apps/tauri/src/space/group-chat/rust/RustGroupChatBackend.ts`（新建）
**内容**：
1. `RustGroupChatBackendFactory` 单例：`participantSessionMap: Map<participantId, rustSessionId>` + `listenerRegistry`（按 sessionId 记录清理函数）
2. `create(participant: { id, name, systemPrompt, providerConfig, modelId }, deps: { invoke, listen }) → Promise<IAgentBackend>`
   - `invoke('new_session', { systemPrompt, providerConfig })` → sessionId
   - `invoke('update_model', { sessionId, modelId, ... })` 热切换（participant.modelId）
   - 注册流式监听：`listen('agent:event:stream:' + sessionId)` → 按 payload.type 转 emit
3. `prompt(text)` 实现：
   - emit `message_start`（空 content 占位）
   - `invoke('send_message', { sessionId, text })` → 返回 `{ reply, usage, state }`
   - emit `message_end`（reply）+ `usage`（usage）
   - 缓存 `state`（供 `backend.state` 读取）
4. `abort/clearHistory/updateModel/updateThinkingLevel/steer/followUp/dispose` 映射到对应 invoke
5. `subscribe(listener)` 返回取消函数

**关键差异点**（vs 复用 useAgentRust）：useAgentRust 的 `handleStreamEvent`（useAgentRust.ts L624-667）**不向 listeners emit message_update**，只更新自己的 refs。本工厂的流式监听是**独立实现**——每个 delta 必须 emit `message_update`（Coordinator 打字机唯一来源）。

### T2：替换 3 处 stub import

| 文件 | 现状 | 改为 |
|---|---|---|
| `apps/tauri/src/space/group-chat/GroupChatCoordinator.ts` L163 | `createWorldSmithAgent({...})` | `RustGroupChatBackendFactory.create({ id, name, systemPrompt, providerConfig, modelId })` |
| `apps/tauri/src/space/group-chat/engine/GroupChatEngine.ts` L167/L284（casual 参与者 + moderator） | `createWorldSmithAgent` | 同上工厂 |
| `apps/tauri/src/space/group-chat/components/AgentPrivateChat.vue` L277（私聊 1v1） | `createWorldSmithAgent` | 同上工厂 |

**保留 stub**：`packages/agent-runtime/src/agent.ts` 的 createWorldSmithAgent 不动（Web 端继续占位）。

### T3：GroupChatView 接入会话创建

`GroupChatView.vue`（onStart L298-348 / onSelectGroup L274-276）：
- 确认每个 participant 的 `providerConfig`（`getProviderConfig()` 返回全局配置，per-participant 若为空则回退全局）
- Coordinator 创建时把 `participant.id ↔ backend` 映射传入（现有结构已支持）

### T4：验证

- typecheck 0 错误
- cargo check（agent-commands / src-tauri）——预期无 Rust 改动，仅确认
- 浏览器冒烟：stub 替换后群聊 UI 仍可走通（无 API Key 时 send_message 返回错误 → emit error → UI 显示失败，验证错误路径）
- **真实 LLM 验证需桌面冒烟 + API Key**（用户决策后执行，浏览器无 invoke 无法完整验证）

---

## 4. 风险与边界

| 风险 | 说明 | 处置 |
|---|---|---|
| providerConfig per-participant 为空 | 参与者未配模型，回退全局配置 | T3 中回退逻辑 |
| 流式监听泄漏 | 会话销毁未清理 listen 回调 | T1 dispose 显式移除 + factory 兜底清理 |
| send_message 无 API Key | 浏览器预览时返回错误 | emit error → Coordinator 失败分支（已有） |
| 工具桥缺失 | participant.enabledTools 非空但无桥 | 二期实现；首期 UI 不展示工具（或展示但提示不可用） |
| moderator 读 state.messages | Rust 返回 state 快照 | T1 prompt 缓存 state |

---

## 5. 验收标准

- [ ] 群聊会议模式创建参与者后，每个参与者对应一个 Rust 会话（`list_sessions` 可见）
- [ ] 发言时 UI 出现打字机流式效果（message_update 事件驱动）
- [ ] 无 API Key 时错误路径正常（UI 提示失败不白屏）
- [ ] 销毁群聊后参与者会话被清理（`delete_session`）
- [ ] typecheck 0 错误；单聊回归正常

---

## 6. 后续（二期）

- `cmd_agent_tool_result` 工具桥（participant 工具能力）
- Rust 侧 group_chat 会话持久化（复用 SessionRepository 模式）
- MultiAgentNode 内嵌为"群聊内子任务协作"编排能力（嵌套而非替代）
