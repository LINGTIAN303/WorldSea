# AgentChat.vue 详细注释

> 来源：`apps/web/src/agent/AgentChat.vue`
> 说明：本文件为 AgentChat 组件内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 629-641 行）

```
/* ── Loop Engineering：LoopController 生命周期管理（批次4） ──
 *
 * 监听 activeTask.taskId 变化，自动 create/destroy LoopController：
 *   - 新任务出现 → create(taskId)，并设置 loopControlTaskId 驱动 UI 挂载
 *   - 任务切换   → 先 destroy 旧 taskId，再 create 新 taskId
 *   - 任务结束   → destroy(taskId)，loopControlTaskId 置 null
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * 组件卸载时清理残留 LoopController，避免 Rust 端 registry 泄漏。
 *
 * 注意：create/destroy 为异步，可能产生竞态（用户快速切换任务）。
 * 当前采用顺序 await，简单可靠；若未来出现性能问题可引入 AbortController。
 */
```

## 注释块 2（原文件第 691-704 行）

```
/* ── Tree of Thoughts：ToT 会话生命周期管理（批次4 UI 集成） ──
 *
 * /tot 命令触发 ToT 会话创建并执行思维树探索：
 *   - 用户输入 `/tot <task>` → handleTotCommand → create + run
 *   - 会话切换 → destroy 旧会话（避免跨会话残留）
 *   - 组件卸载 → destroy 残留会话
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * ToTStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
 *
 * 与 LoopControl 的差异：
 * - LoopControl 监听 activeTask.taskId 变化被动驱动
 * - ToT 由 /tot 命令主动驱动，不依赖 activeTask
 */
```

## 注释块 3（原文件第 708-724 行）

```
/**
 * 处理 /tot 命令：从输入框解析 `/tot <task>` 并启动 ToT 探索
 *
 * # 流程
 * 1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
 * 2. 若已有 ToT 会话，先销毁（保证单会话）
 * 3. create(sessionId, providerConfig) → totSessionId 赋值
 * 4. 清空输入框
 * 5. 异步 run(sessionId, task)，事件流推送思维节点状态
 *
 * # 错误处理
 * - 非 Rust 后端：warn 并返回
 * - 任务为空：warn 并返回
 * - ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
 * - create 失败：error 并返回（totSessionId 保持 null）
 * - run 失败：error 但不重置 totSessionId（保留会话供查看错误状态）
 */
```

## 注释块 4（原文件第 805-819 行）

```
/* ── Graph of Thoughts：GoT 会话生命周期管理（批次4 UI 集成） ──
 *
 * /got 命令触发 GoT 会话创建并执行思维图探索（支持多父聚合的图结构）：
 *   - 用户输入 `/got <task>` → handleGotCommand → create + run
 *   - 会话切换 → destroy 旧会话（避免跨会话残留）
 *   - 组件卸载 → destroy 残留会话
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * GoTStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
 *
 * 与 ToT 的差异：
 * - GoT 节点支持多父聚合（parents 字段非空时为聚合节点）
 * - 每层扩展后增加聚合阶段（ThoughtsAggregated 事件）
 * - 配置参数扩展 4 个聚合参数（aggregationEnabled / aggregationThreshold 等）
 */
```

## 注释块 5（原文件第 828-844 行）

```
/**
 * 处理 /got 命令：从输入框解析 `/got <task>` 并启动 GoT 探索
 *
 * # 流程
 * 1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
 * 2. 若已有 GoT 会话，先销毁（保证单会话）
 * 3. create(sessionId, providerConfig) → gotSessionId 赋值
 * 4. 清空输入框
 * 5. 异步 run(sessionId, task)，事件流推送思维节点/聚合状态
 *
 * # 错误处理
 * - 非 Rust 后端：warn 并返回
 * - 任务为空：warn 并返回
 * - ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
 * - create 失败：error 并返回（gotSessionId 保持 null）
 * - run 失败：error 但不重置 gotSessionId（保留会话供查看错误状态）
 */
```

## 注释块 6（原文件第 925-940 行）

```
/* ── Multi-Agent：多智能体协作会话生命周期管理（批次4 UI 集成） ──
 *
 * /ma 命令触发 Multi-Agent 会话创建并执行多智能体协作：
 *   - 用户输入 `/ma <task>` → handleMultiAgentCommand → create + run
 *   - 会话切换 → destroy 旧会话（避免跨会话残留）
 *   - 组件卸载 → destroy 残留会话
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * MultiAgentStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
 *
 * 与 ToT/GoT 的差异：
 * - Multi-Agent 需传入 specs（Agent 规格列表），此处使用预设 3 Agent 配置
 *   （coordinator + researcher + critic），用户无需手动定义
 * - 去中心化协作（Mesh 拓扑 + Hybrid 收敛），无中心调度者
 * - 事件聚焦于协作过程（轮次/消息/黑板更新），而非思维节点
 */
```

## 注释块 7（原文件第 1008-1024 行）

```
/**
 * 处理 /ma 命令：从输入框解析 `/ma <task>` 并启动 Multi-Agent 协作
 *
 * # 流程
 * 1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
 * 2. 若已有 MA 会话，先销毁（保证单会话）
 * 3. 构建 specs（3 Agent Mesh 协作）并 create
 * 4. 清空输入框
 * 5. 异步 run(sessionId, task)，事件流推送轮次/消息/黑板/收敛状态
 *
 * # 错误处理
 * - 非 Rust 后端：warn 并返回
 * - 任务为空：warn 并返回
 * - ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
 * - create 失败：error 并返回（maSessionId 保持 null）
 * - run 失败：error 但不重置 maSessionId（保留会话供查看错误状态）
 */
```

## 注释块 8（原文件第 1110-1125 行）

```
/* ── Supervisor：中心化调度会话生命周期管理（批次4 UI 集成） ──
 *
 * /supervisor 命令触发 Supervisor 会话创建并执行中心化任务调度：
 *   - 用户输入 `/supervisor <task>` → handleSupervisorCommand → create + run
 *   - 会话切换 → destroy 旧会话（避免跨会话残留）
 *   - 组件卸载 → destroy 残留会话
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * SupervisorStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
 *
 * 与 Multi-Agent 的差异：
 * - 中心化调度：LLM 充当 Supervisor，决定将任务分配给哪个子 Agent
 * - 单轮执行（阶段 2.1）：仅执行一轮任务分配 + 子 Agent run + 汇总
 * - 无拓扑/收敛策略：所有子 Agent 由 Supervisor 直接调用
 * - 事件聚焦于任务分配与子 Agent 执行（assigned/started/completed）
 */
```

## 注释块 9（原文件第 1169-1185 行）

```
/**
 * 处理 /supervisor 命令：从输入框解析 `/supervisor <task>` 并启动 Supervisor 编排
 *
 * # 流程
 * 1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
 * 2. 若已有 SUP 会话，先销毁（保证单会话）
 * 3. 构建 specs（2 子 Agent：coder + writer）并 create
 * 4. 清空输入框
 * 5. 异步 run(sessionId, task)，事件流推送任务分配/子 Agent 执行/汇总结果
 *
 * # 错误处理
 * - 非 Rust 后端：warn 并返回
 * - 任务为空：warn 并返回
 * - ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
 * - create 失败：error 并返回（supSessionId 保持 null）
 * - run 失败：error 但不重置 supSessionId（保留会话供查看错误状态）
 */
```

## 注释块 10（原文件第 1270-1286 行）

```
/* ── Router：路由决策会话生命周期管理（批次4 UI 集成） ──
 *
 * /router 命令触发 Router 会话创建并执行路由决策：
 *   - 用户输入 `/router <task>` → handleRouterCommand → create + run
 *   - 会话切换 → destroy 旧会话（避免跨会话残留）
 *   - 组件卸载 → destroy 残留会话
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * RouterStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
 *
 * 与 Supervisor 的差异：
 * - 纯决策节点：Router 不执行子 Agent，只输出 `nextNodeId` 供 Orchestrator 调度
 * - 无 tool_bus / agent_pool：仅有 getTargets 命令用于查询分支配置
 * - 事件聚焦于决策结果（decisionMade / noMatch / error）
 * - 路由策略可选：LLM 决策（默认）或关键词匹配
 * - Fallback 机制：无匹配时可走 fallbackTargetId（触发 isFallback=true）
 */
```

## 注释块 11（原文件第 1321-1337 行）

```
/**
 * 处理 /router 命令：从输入框解析 `/router <task>` 并启动 Router 路由决策
 *
 * # 流程
 * 1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
 * 2. 若已有 RTR 会话，先销毁（保证单会话）
 * 3. 构建 targets（2 分支：coder + writer）并 create（含 fallbackTargetId: 'writer'）
 * 4. 清空输入框
 * 5. 异步 run(sessionId, task)，事件流推送决策结果（decisionMade/noMatch/error）
 *
 * # 错误处理
 * - 非 Rust 后端：warn 并返回
 * - 任务为空：warn 并返回
 * - ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
 * - create 失败：error 并返回（routerSessionId 保持 null）
 * - run 失败：error 但不重置 routerSessionId（保留会话供查看错误状态）
 */
```
