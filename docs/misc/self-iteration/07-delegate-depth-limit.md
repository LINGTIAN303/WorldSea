## 迭代主题 7：子 Agent 委派深度限制（防递归委派膨胀）

> 决策点 7 曾记录"若未来需限制递归委派，可增加委派深度计数，超限返回错误。本迭代不实现"。本轮落实该扩展点：给 `SubAgentManager` 增加**最大委派深度**，防止子 Agent 复用主 Agent 工具总线后递归委派（孙 Agent）无限膨胀。

### 决策点 29：用 `tokio::task_local!` 在任务调用栈上跟踪委派深度，而非实例级计数

**背景**：子 Agent 复用主 Agent 的 `tool_bus`，因此也能看到 `delegate_to_sub_agent` / `list_sub_agents` 工具，理论上可递归委派（孙 Agent）。此前靠每个 `AgentLoop` 的 `max_iterations` 兜底，但 LLM 完全可能"迭代内无限递归委派"，撑爆调用栈/实例池。

**选择**：`SubAgentManager` 增加 `max_delegate_depth` 字段（默认 3，`with_max_delegate_depth` 可覆盖）。用 `tokio::task_local!` 定义 `DELEGATE_DEPTH: AtomicUsize`，在 `delegate` 入口通过 `try_with` 读当前深度并与上限比较，超限返回 `ToolError::Other`；委派子 Agent 时把 `agent.run(...)` 放入 `DELEGATE_DEPTH.scope(depth + 1, ...)` 执行，子 Agent 内再次委派即可读到递增后的深度。

**理由**：
- **任务本地存储天然匹配"递归调用"语义**：深度是"当前调用栈上嵌套了几层"这一**瞬时量**，随任务进出自动增/减，无需在 `SubAgentManager`/实例上维护计数器、也无需事后清理（`scope` 出栈自动还原）。若用实例级或管理器级计数器，多会话并发会互相污染，且需手动 decrement（易漏）。
- `try_with` 而非 `with`：顶层委派（主 Agent 直接调用，非 scope 内）未设置 `DELEGATE_DEPTH`，`try_with` 失败按 0 处理，避免 `with` panic。
- 深度检查放在 `delegate` **最入口**（先于规格查找）：即便规格未注册，递归委派也会先被深度拦截，且被拒委派不广播 `SubAgentStarted` 事件（不污染前端观测）。

**代价**：深度只在 `delegate` **显式调用链**内递增——若某条链路绕过 `delegate` 直接调 `agent.run`（本模块无此路径），深度不跟踪。当前所有子 Agent 执行都经 `delegate`，无遗漏。

### 决策点 30：默认 `max_delegate_depth = 3`（允许 3 层嵌套委派）

**选择**：默认 3。语义：主 Agent（depth 0）→ 子 Agent（1）→ 孙（2）→ 曾孙（3）→ 曾孙内再委派（depth 3 ≥ 3）被拒。

**理由**：3 层足够覆盖"主编排 → 专家 → 细分专家"的常见分层，同时阻断无意义的无限深挖掘；`with_max_delegate_depth` 允许调用方按需收紧（如沙箱场景设 1）。

**验证（2026-08-05）**：新增 3 个单测——`delegate_rejects_when_depth_at_limit`（手动 scope depth=3 应拒绝）、`delegate_allows_within_depth_limit`（depth=2 正常执行）、`delegate_respects_custom_max_depth`（自定义上限 1：depth=1 拒绝、depth=0 通过）。`cargo test -p agent-commands subagent::` 12/12 通过；agent-commands lib 25/25 无回归。此迭代为纯后端增强，零前端/部署改动。

