# subagent.rs 详细注释文档（agent-commands）

> 来源：`crates/agent-commands/src/subagent.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 subagent_tests.rs

## 注释块 1（原文件第 1-16 行）

# 子 Agent 编排（sub-agent orchestration）

把子 Agent 编排能力接入主对话循环：在主 Agent 的 `AgentLoop` 工具总线上
注册 `delegate_to_sub_agent` / `list_sub_agents` 工具。主 Agent 在 ReAct
循环中遇到子任务时，调用 `delegate_to_sub_agent` 把任务派发给一个专长子
Agent（也是一个 `AgentLoop`），等待其返回结果后继续。

## 设计
- 子 Agent 复用主 Agent 的 `backend`（同一 LLM 配置）与 `tool_bus`（同一
  工具集），不单独创建运行时。
- 子 Agent 实例按 `sub_agent_id` 懒加载 + 池化复用（`RwLock<HashMap>`），
  首次委派时创建，后续复用，累积专业上下文。
- 子 Agent 规格（`SubAgentSpec`）由调用方通过 `register_subagent_spec`
  注册，`delegate_to_sub_agent` 按 `sub_agent_id` 查找。
- 子 Agent 的流式事件不直接透传前端（Phase 5.4 既定约束），仅最终结果
  作为工具结果回填主 Agent。

## 注释块 2（原文件第 89-101 行）

事件广播器（可选，None 时静默；一般指向主 Agent 的广播器）

委派子 Agent 时通过它广播 `SubAgentStarted` / `SubAgentCompleted` /
`SubAgentError`，使订阅主 Agent 事件的监听器（如 Tauri 端）能收到子 Agent
的委派进度，前端据此展示"子 Agent 正在执行 / 已完成 / 超时"。

该字段在 `register_subagent_tools` 调用时尚未存在（主 Agent 的
`AgentLoop` 在其后创建），故由调用方在创建主 Agent 后通过
[`SubAgentManager::set_broadcaster`] 注入。

包一层 `std::sync::RwLock` 以支持通过 `&self` 写入（`set_broadcaster`），
`emit` 读取时用 `read()` 快速拿引用。

## 注释块 3（原文件第 494-505 行）

构建并注册子 Agent 编排工具（delegate + list）

调用方：`AgentCommandService::new_agent`，在创建 `SimpleToolBus` 后调用。

# 参数
- `bus`：注册目标工具总线（主 Agent 的 ToolBus）
- `backend`：共享 LLM 后端（子 Agent 复用）
- `tool_bus`：共享工具总线（子 Agent 复用）
- `specs`：共享规格注册表（跨会话共享，由 `AgentCommandService` 持有）

返回 `Arc<SubAgentManager>`，其持有与 `specs` 相同的注册表，因此
运行期 `register_subagent_spec` 的变更对所有会话的子 Agent 管理器可见。
