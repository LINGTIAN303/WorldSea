# event.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/event.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 138-149 行）

Supervisor Pattern 事件（阶段 2.4 新增）

这些事件用于跟踪 Supervisor 模式的任务分配、子 Agent 执行进度，
前端可据此展示"Supervisor 正在分析任务"、"子 Agent X 正在执行"等状态。

事件触发顺序：
```
SupervisorTaskAssigned → SubAgentStarted → SubAgentCompleted → (继续下一节点)
                         或 → SubAgentError (子 Agent 执行失败)
                         或 → SupervisorError (任务分配失败)
```

注意：阶段 1.2 不转发子 Agent 内部的 StreamDelta 等事件到父 Orchestrator，
前端通过 SubAgentStarted/Completed 两个边界事件了解子 Agent 执行进度。

---

## 注释块 2（原文件第 222-234 行）

Router Pattern 事件（阶段 2.5 新增）

这些事件用于跟踪 Router 模式的路由决策过程，
前端可据此展示"Router 正在分析输入"、"已路由到分支 X"等状态。

事件触发顺序：
```
RouterDecisionMade → (Orchestrator 调度下一节点)
或 → RouterNoMatch (无匹配路由，触发 fallback 或报错)
或 → RouterError (决策阶段失败)
```

注意：Router 是纯决策节点，不执行子 Agent，
所以没有 RouterBranchStarted/Completed 等执行类事件。
分支执行由 Orchestrator 按 next_node_id 调度，对应节点会触发自己的事件。

---

## 注释块 3（原文件第 275-289 行）

Tree of Thoughts 事件（阶段 2.1 新增）

这些事件用于跟踪 ToT 模式的思维树探索过程，
前端可据此展示"正在生成第 N 层思维"、"评分 X"、"已找到目标"等状态。

事件触发顺序（每层）：
```
ThoughtNodeCreated（每个生成的子节点）→ ThoughtNodeScored（每个评分完成的节点）
→ ThoughtBranchExplored（层扩展完成）→ ToTGoalReached 或继续下一层
```

终止时触发：
```
ToTGoalReached（LLM 判定目标达成）/ ToTTerminated（其他终止条件）
或 ToTError（执行失败）
```

注意：ToT 是树探索模式，不像 Supervisor 那样执行子 Agent，
所有思维生成/评分/目标检查都通过 LLM 调用完成。

---

## 注释块 4（原文件第 386-398 行）

Graph of Thoughts 事件（阶段 2.2 新增）

GoT 复用 ToT 的大部分事件（ThoughtNodeCreated / ThoughtNodeScored /
ThoughtBranchExplored / ToTGoalReached / ToTTerminated / ToTError），
仅新增 `ThoughtsAggregated` 一个事件用于跟踪跨节点聚合。

事件触发顺序（每层）：
```
ThoughtNodeCreated（每个生成的子节点）→ ThoughtNodeScored
→ ThoughtBranchExplored → ThoughtsAggregated（聚合阶段）
→ 下一层或 ToTGoalReached / ToTTerminated
```

注意：GoTNode.node_type() 返回 NodeType::Graph（与 ToTNode 的 Thought 区分），
前端可据此区分事件来自 ToT 还是 GoT。

---

## 注释块 5（原文件第 417-435 行）

Multi-Agent Pattern 事件（阶段 2.3 新增）

这些事件用于跟踪 Multi-Agent 模式的多轮协作过程，
前端可据此展示"第 N 轮协作开始"、"Agent A → Agent B 消息"、
"黑板已更新"、"协作收敛"等状态。

事件触发顺序（一轮成功路径）：
```
MultiAgentRoundStarted
  → MultiAgentMessageSent（每个 Agent 接收消息时）
  → MultiAgentBlackboardUpdated（Agent 写入黑板时）
→ MultiAgentRoundCompleted
→（继续下一轮 或 MultiAgentConverged）
```

失败路径：
- Agent 执行失败：MultiAgentError（agent_id=失败 Agent）
- 收敛检查失败：MultiAgentError（agent_id="system"）

注意：MultiAgentNode 是去中心化对等协作节点（与 Supervisor 中心化调度互补），
内部 N 个 AgentLoop 通过 mpsc 通道 + SharedBlackboard 协作。

---

## 注释块 6（原文件第 515-530 行）

Loop Engineering 事件（阶段 2.6 新增）

这些事件用于跟踪 Loop Engineering 的循环控制行为，
前端可据此展示"速率限制触发"、"重试中"、"软超时警告"等状态。

事件触发时机：
- RateLimitExceeded：ReAct 循环每轮检查时发现超限
- LoopEngRetrying：LLM/tool 调用失败，决定重试
- LoopEngRetryExhausted：重试次数用尽，放弃重试
- SoftTimeoutWarning / SoftTimeoutCritical：软超时阈值触发
- WatchdogIdle / WatchdogDead：看门狗检测到任务无活动
- LoopEngRecovered：任务恢复（手动或自动）

注意：Loop Engineering 事件不绑定特定 node_id，
因为它横切所有编排模式（ReAct / ToT / GoT / Multi-Agent 等）。
`task_id` 字段对应 `LongTaskRecord.task_id`。

---

## 注释块 7（原文件第 634-657 行）

Deep Mode 事件（阶段 P2 新增）

工具执行状态（用于 DeepPhaseChanged 事件标注触发工具状态）
序列化为小写（running/completed/failed），与前端 ToolCallView.status 一致。

阶段 P2 扩展：DeepPhaseChanged 新增 `tool_status`（工具完成状态）与
`phase_completed`（阶段完成标记），前端据此更新工具状态与阶段状态。

这些事件用于跟踪 Deep Mode 的阶段切换过程，
前端可据此构建 `deepSegments`，按"问题拆解→证据收集→推理分析→创作操作→结论输出"
五阶段分组展示工具调用。

事件触发时机：
- ReAct 循环每次执行工具后，调用 `classify_tool` 判定当前阶段
- 若与 `last_phase_label` 不同，则广播 `DeepPhaseChanged`
- 初始 `last_phase_label = None`，首次工具调用必定触发事件

设计选择：方案 A（Rust 端只发事件，前端构建 deepSegments）
- Rust 端不维护 segments 状态，只负责"阶段切换检测"
- 前端通过事件流构建 `deepSegments`（与 TS 版 `DeepMessageArea.vue` 一致）
- 优势：Rust 端状态最小化，与现有事件驱动架构一致

注意：`phase_index = -1` 表示"其他操作"（未匹配任何阶段），
前端可将其作为兜底分组或忽略。

---

## 注释块 8（原文件第 688-703 行）

A2UI 事件（阶段 P2 新增）

这些事件用于跟踪 Agent-to-UI 的画布操作，
前端可据此展示"Agent 创建了画布 X"、"Agent 更新了组件 Y"等状态。

事件触发时机：
- AgentLoop 执行 A2UI 工具（如 ui_create_surface / ui_update_components 等）后，
  工具通过 FrontendToolBridge 调用 TS 实现，TS 实现内部调用 ctx.emitA2UI
- FrontendToolBridge 将 emitA2UI 调用桥接回 Rust，封装为 A2UIEvent 广播
- Tauri 命令层将 A2UIEvent 转换为 AgentEventPayload::A2UI 推送到前端

设计说明：
- A2UI 事件本质是"工具副作用"，不依赖 Orchestrator 编排模式
- 包装在 OrchestratorEvent 内是为了走现有事件广播通道（EventBroadcaster）
- 与 Agent(AgentEvent::A2UI) 的关系：A2UIEvent 是 Orchestrator 层的包装，
  Tauri 端在转换时会同时处理两种形式（统一输出 AgentEventPayload::A2UI）

---

## 模块职责一句话

编排事件模型：AgentEvent 基础事件 + OrchestratorEvent 编排扩展事件（Supervisor/Router/ToT/GoT/Multi-Agent/LoopEng/DeepMode/A2UI）与事件广播器。
