## 迭代主题：子 Agent 编排接入主对话循环

当前项目处于 Phase 5.4 高级能力补齐的最后一项（子 Agent 编排接入）。此前已交付：deep phases、A2UI、终端能力。本迭代把 **子 Agent 编排** 接入主对话循环。

### 决策点 1：采用「delegate 工具 + 实例池」方式，而非复用 SupervisorNode

**背景**：`agent-runtime` 已有 `SupervisorNode`（阶段 2 编排框架），但它运行在 `Orchestrator` 节点流里，与主对话使用的 `AgentLoop`（ReAct 单循环）是两套路径。主对话走 `AgentCommandService.send_message → AgentLoop.run`。

**选择**：在主 Agent 的 `AgentLoop` 工具总线上注册一个 `delegate_to_sub_agent` 工具。主 Agent 在 ReAct 循环中遇到子任务时，调用该工具把任务派发给一个专长子 Agent（也是 `AgentLoop`），等待其返回结果后继续。

**理由**：
- 复用现有 `AgentLoop` 作为子 Agent 运行时，零新运行时。
- 与主对话循环自然融合（工具调用即子任务派发），无需启动独立 Orchestrator。
- 前端看到的仍是主 Agent 的一次消息流，子任务结果作为工具结果回填，交互一致。

**代价**：子 Agent 的流式事件不直接透传前端（阶段 1.2 既定约束），仅最终结果作为工具结果返回。已在计划文档记录。

### 决策点 2：子 Agent 实例采用「按 spec.id 懒加载 + 池化复用」

复用 `SupervisorNode::get_or_create_agent` 的既有模式：`agents: Arc<RwLock<HashMap<String, Arc<AgentLoop>>>>`。首次委派时按 spec 创建并缓存，后续复用；避免每次任务都新建 AgentLoop（上下文不共享）。

**理由**：与 supervisor.rs 既有实现一致，避免重复造轮子；子 Agent 持有独立消息历史，多次委派可累积专业上下文。

### 决策点 3：子 Agent 共享主 Agent 的 backend 与 tool_bus

子 Agent 复用主 Agent 的 `Arc<dyn NodeBackendAccessor>`（同一 LLM 配置/API Key）与 `Arc<dyn ToolBus>`（同一工具集，含终端工具）。不单独创建子 Agent 的 backend/tool_bus。

**理由**：LLM 配置已在 `new_agent` 构造主 Agent 时确定，子 Agent 复用同一配置最省事；工具集共享使子 Agent 也能执行终端/文件等操作。若未来需要子 Agent 工具隔离，可在 spec 的 `tools_whitelist` 上扩展（当前 ToolBus 不支持白名单过滤，阶段 1.4 扩展点）。

### 决策点 4：子 Agent 规格由调用方提供（SubAgentSpec），通过 `register_subagent_spec` 注册

`SubAgentSpec` 复用 `agent-runtime::supervisor::SubAgentSpec`（id/name/description/system_prompt/tools_whitelist/max_iterations）。在 `AgentCommandService` 中维护一个 `RwLock<Vec<SubAgentSpec>>` 规格注册表，`delegate_to_sub_agent` 工具按 `sub_agent_id` 查找规格并创建/复用实例。

**理由**：与阶段 2 的 `SubAgentSpec` 类型完全一致，避免重复定义；规格可动态注册（前端/命令层可新增子 Agent 能力）。

### 决策点 5：规格注册表跨会话共享（单一 `Arc<RwLock<Vec<SubAgentSpec>>>`）

`AgentCommandService` 持有**一个**共享的 `subagent_specs: Arc<RwLock<Vec<SubAgentSpec>>>`，而非每个会话各持一份。`new_agent` 创建每个会话时，把该共享注册表传给 `SubAgentManager`，因此 `register_subagent_spec` 的变更对所有（已有 + 新建）会话的子 Agent 管理器立即可见。

**理由**：子 Agent 规格描述的是"系统具备哪些专长"，属全局能力，跨会话统一；避免每个会话重复注册、规格漂移。

### 决策点 6：`new_agent` 由静态关联函数改为 `&self` 方法

原 `new_agent(system_prompt, provider_config)` 是静态函数，无法访问服务级共享注册表。改为 `async fn new_agent(&self, ...)`，在内部读取 `self.subagent_specs` 并注入各会话的 `SubAgentManager`。`new_session` 相应改为 `self.new_agent(...)`。

**代价**：`new_agent` 不再是纯静态工具函数，但仅内部调用，无外部影响。

### 决策点 7：接受"子 Agent 可再委派"的递归风险（受 max_iterations 约束）

子 Agent 复用主 Agent 的 `tool_bus`，因此子 Agent 也能看到 `delegate_to_sub_agent` / `list_sub_agents` 工具，理论上可递归委派（孙 Agent）。当前接受该风险：

**理由**：
- 每个 `AgentLoop`（含子 Agent）有 `max_iterations` 上限，LLM 实际无限递归委派极难发生。
- 递归委派本身是"分层专业分工"的合理能力（主编排 → 子专家 → 更细专家），保留它反而灵活。
- 现有 `SubAgentManager` 的实例池按 `sub_agent_id` 复用，不会无限创建实例。

**若未来需限制**：可在 `SubAgentManager` 增加"委派深度"计数，超限返回错误。本迭代不实现。

## 影响范围
- 新增 `crates/agent-commands/src/subagent.rs`（子 Agent 编排工具 + 规格注册表）。
- `AgentCommandService` 增加 `SubAgentSpec` 注册表字段与 `register_subagent_spec` 方法，`new_agent` 中注册 `delegate_to_sub_agent` 工具。
- 前端后续可加子 Agent 规格管理 UI（本迭代不强制）。

