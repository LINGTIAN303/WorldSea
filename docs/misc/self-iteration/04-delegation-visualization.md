## 迭代主题 4：子 Agent 委派过程可视化（事件广播 + 超时 + 上下文迁移）

> 前面几个主题解决了子 Agent 编排的**能力**（注册/委派/白名单/热更新），但前端对委派过程完全是"黑盒"——用户看不到主 Agent 正在委派给谁、跑没跑完、是否超时。本轮打通**委派过程的可观测链路**：Rust 广播事件 → Tauri 转发 → 前端订阅展示，并顺带补上超时控制与规格变更时的上下文迁移。

### 决策点 21：子 Agent 委派通过主 Agent 的 `EventBroadcaster` 广播 `OrchestratorEvent`，而非新建独立事件通道

**背景**：`SubAgentManager::delegate` 执行子 Agent 时，前端无感知。要让前端看到委派过程，需把委派事件推送到前端。已有两条事件通道：主 Agent 的 `EventBroadcaster`（`agent:event:*` 经 Tauri 转发）与独立的 subagent 事件集。

**选择**：在 `SubAgentManager` 注入主 Agent 的 `Arc<RwLock<EventBroadcaster>>`（新增 `set_broadcaster` 方法），`delegate` 内广播 `OrchestratorEvent::SubAgentStarted/Completed/Error`。

**理由**：
- 复用既有 `EventBroadcaster` 分发机制，零新基础设施；`OrchestratorEvent` 枚举本就是 agent-runtime 中心的跨模块事件类型，扩展它语义最自然。
- Tauri 端 `TauriAgentEventEmitter` 已订阅主 Agent 广播器，子 Agent 事件经同一 `broadcast` 路径转发到前端，无需另起炉灶。
- 前端统一通过 `agent:event:{type}:{session_id}` 模式监听，与既有的 `deep_phase_changed` / `a2ui` 监听风格一致。

**代价**：事件枚举新增 3 个变体，`matches!`/`match` 处需同步处理（本次已覆盖 commands.rs 转发）。

### 决策点 22：委派事件经 `agent:event:subagent:{session_id}` 通道透传前端

**选择**：`TauriAgentEventEmitter` 对 `SubAgentStarted/Completed/Error` 分别 `emit` 到 `agent:event:subagent:{session_id}`，payload 用 camelCase（`subAgentId`/`subAgentName`/`taskDescription`/`outputChars`/`durationMs`/`error`），`type` 字段取 `start`/`completed`/`error` 区分事件类型。

**理由**：与既有的 `agent:event:deep_phase_changed:` / `agent:event:a2ui:` 通道模式完全一致，前端 `listen` 同一命名空间，便于统一管理监听器生命周期。

### 决策点 23：委派设置超时（默认 120s），超时返回 `ToolError::Timeout` 并广播 `SubAgentError`

**背景**：子 Agent 复用主 Agent 的 backend，若 LLM 挂起或工具阻塞，`delegate` 会无限等待，阻塞主 Agent 的 ReAct 循环（`send_message` 前端等不到回复）。

**选择**：`SubAgentManager` 增加 `delegate_timeout`（默认 120s，`with_delegate_timeout` 可覆盖），`delegate` 用 `tokio::time::timeout` 包裹 `agent.run(...)`。超时则广播 `SubAgentError`（错误信息含超时时长）并返回 `ToolError::Timeout`。

**理由**：防御子 Agent 卡死对主循环的级联阻塞；超时信息随事件广播到前端，用户能看到"某子 Agent 执行超时"而非无限 loading。

**代价**：`ToolError::Timeout` 是新增变体，需在 `agent-runtime` 的 `ToolError` 中定义（已加）。

### 决策点 24：规格变更重建实例时迁移旧实例的非 system 消息，保留专业对话历史

**背景**：决策点 17 的重建策略在规格变更时**丢弃**旧实例全部上下文（新实例从零开始）。但多数规格变更只是微调 `system_prompt`/`max_iterations`，用户希望保留子 Agent 已积累的专业对话历史，仅换新"身份定义"。

**选择**：`get_or_create_agent` 重建新实例时，把旧实例消息中**非 system 角色**的消息（user/assistant/tool_result）迁移到新实例，仅替换 system_prompt 对应的 system 消息。

**理由**：保留专业上下文（历史任务、已确认的结论）能显著提升子 Agent 后续委派质量；system_prompt 是"身份"来源，规格变了就该换，但历史事实不该丢。

**代价**：迁移需在创建新 `AgentLoop` 后手动 `extend` 消息；迁移后消息条数增加，理论上更接近上下文上限（正常行为，子 Agent 亦有 `max_iterations` 约束）。

### 决策点 25：前端新增 `subAgents` 响应式状态与监听生命周期，随会话切换/删除/释放同步清理

**选择**：`useAgentRust.ts` 新增：
- `SubAgentState` 接口（`id`/`subAgentId`/`subAgentName`/`taskDescription`/`status`/`outputChars`/`durationMs`/`error`/`startedAt`）。
- `subAgents` 响应式数组 + `setupSubAgentListener`/`teardownSubAgentListener`（按 sessionId 索引，幂等）。
- 在 `newSession`/`switchSession`/`deleteSession`/`dispose` 中接入监听器的建立与清理，切换会话时清空 `subAgents`。

**理由**：与既有的 `deepPhaseUnlistenFns`/`a2uiUnlistenFns` 生命周期管理模式一致；避免会话切换后旧会话事件污染新会话视图，避免 `dispose` 后残留监听器。

### 决策点 26：前端新增 `SubAgentSection.vue` 内联展示委派过程（运行中/完成/失败）

**选择**：新建 `apps/tauri/src/agent/components/SubAgentSection.vue`，订阅 `backend.subAgents`，按状态渲染：
- `running`：蓝色脉冲指示 + 「运行中」徽章。
- `completed`：绿色 + 「已完成」+ 输出字符数/耗时。
- `error`：红色 + 「失败」+ 错误信息。

挂载到 `App.vue` 对话视图（A2UI 区与输入栏之间），随会话切换自动清空。

**理由**：对话视图是用户观察主 Agent 行为的主场景，委派过程内联展示最直观；不新增独立 tab，避免打断对话流。样式沿用现有极简风格（无 emoji 图标，纯 CSS 圆点 + 文字徽章）。

**代价**：子 Agent 规格管理（能力配置）仍在「子 Agent」tab（迭代主题 2），委派过程（运行观察）在对话视图——能力配置与运行观测分属两处，符合"配置 vs 使用"的直觉分离。

## 影响范围（迭代主题 4）
- `crates/agent-runtime/src/event.rs`：`OrchestratorEvent` 新增 `SubAgentStarted/Completed/Error` 变体。
- `crates/agent-runtime/src/tool.rs`：`ToolError` 新增 `Timeout` 变体 + `WhitelistToolBus`（决策点 14 既有）。
- `crates/agent-commands/src/subagent.rs`：`delegate_timeout` + `set_broadcaster` + `emit` + 委派事件广播 + 重建时上下文迁移。
- `crates/agent-commands/Cargo.toml`：新增 `tracing` 依赖。
- `apps/tauri/src-tauri/src/commands.rs`：`TauriAgentEventEmitter` 转发 3 个子 Agent 事件到 `agent:event:subagent:{session_id}`。
- `apps/tauri/src/agent/composables/useAgentRust.ts`：`subAgents` 状态 + 监听生命周期 + 导出。
- `apps/tauri/src/agent/components/SubAgentSection.vue`：委派过程展示组件。
- `apps/tauri/src/App.vue`：挂载 `SubAgentSection`。

## 验证方式（迭代主题 4）
- `cargo test -p agent-commands`：21 lib/e2e（非 ignore）通过，含 `delegate_broadcasts_start_then_completed`、`delegate_broadcasts_start_then_error_on_timeout`、`delegate_applies_timeout`、`get_or_create_agent_reuses_or_rebuilds_by_spec`、`spec_change_migrates_context_to_new_instance`。
- `npm run typecheck`（apps/tauri）：vue-tsc 通过。
- **实测结果（2026-08-05）**：agent-commands 21 通过（17 lib + 1 e2e + 1 loop_control + 3 subagent 事件/超时/迁移）；`useAgentRust.ts` 修复 `sessionId` 未使用（TS6133）后 typecheck 通过。

