# AgentChat.vue 详细注释

> 来源：`apps/web/src/agent/AgentChat.vue`
> 说明：本文件为 AgentChat 组件内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。
> 2026-08-06 拆分记录：Loop/ToT/GoT/MA/Supervisor 会话生命周期与命令处理已迁至 `chat/useSessionStatusBars.ts`，对应详细注释移至 [chat/useSessionStatusBars.md](chat/useSessionStatusBars.md)；本文件仅保留 Router 部分。

## Router：路由决策会话生命周期管理（/router 命令驱动）

```
/router 命令触发 Router 会话创建并执行路由决策：
  - 用户输入 `/router <task>` → handleRouterCommand → create + run
  - 会话切换 → destroy 旧会话（避免跨会话残留）
  - 组件卸载 → destroy 残留会话

仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
RouterStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。

与 Supervisor 的差异：
- 纯决策节点：Router 不执行子 Agent，只输出 `nextNodeId` 供 Orchestrator 调度
- 无 tool_bus / agent_pool：仅有 getTargets 命令用于查询分支配置
- 事件聚焦于决策结果（decisionMade / noMatch / error）
- 路由策略可选：LLM 决策（默认）或关键词匹配
- Fallback 机制：无匹配时可走 fallbackTargetId（触发 isFallback=true）
```

## 处理 /router 命令：流程与错误处理

```
从输入框解析 `/router <task>` 并启动 Router 路由决策

# 流程
1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
2. 若已有 RTR 会话，先销毁（保证单会话）
3. 构建 targets（2 分支：coder + writer）并 create（含 fallbackTargetId: 'writer'）
4. 清空输入框
5. 异步 run(sessionId, task)，事件流推送决策结果（decisionMade/noMatch/error）

# 错误处理
- 非 Rust 后端：warn 并返回
- 任务为空：warn 并返回
- ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
- create 失败：error 并返回（routerSessionId 保持 null）
- run 失败：error 但不重置 routerSessionId（保留会话供查看错误状态）
```
