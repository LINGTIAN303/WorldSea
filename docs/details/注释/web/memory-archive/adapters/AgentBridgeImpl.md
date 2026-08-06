# AgentBridgeImpl.ts 详细注释

> 来源：`apps/web/src/memory-archive/adapters/AgentBridgeImpl.ts`
> 说明：本文件为 AgentBridge 宿主实现内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-16 行）

```
/**
 * AgentBridgeImpl - AgentBridge 接口的宿主实现
 *
 * 对接 useAgent composable，为 memory-archive 框架提供消息访问、边界推进、
 * 摘要注入和工具注册能力。
 *
 * 关键设计：
 * 1. 消息转换：AgentMessage → AgentMessageSnapshot（'toolResult' → 'tool'）
 * 2. 边界推进：直接 splice useAgent().messages 数组（释放上下文窗口）
 * 3. 摘要注入：在 messages 开头插入系统消息（包含归档摘要）
 * 4. 工具注册：通过回调函数将工具传递给 useMemoryArchive（由其注入到 Agent）
 *    （IAgentBackend 不暴露 toolBus，需要 useMemoryArchive 在初始化时注入）
 * 5. 边界持久化（P12）：advanceBoundary 时写入 sessionStorage，
 *    restoreBoundary/resetBoundary 用于 abort/clearHistory 恢复
 * 6. 钩子摘要缓存（P12）：injectHookSummary 时缓存文本，getHookSummaryForPrompt 返回
 */
```

## 注释块 2（原文件第 78-94 行）

```
/**
 * 推进归档边界
 *
 * H1.2 修复：不再截断前端 useAgent().messages（用户仍可见完整历史），
 * 改为调用 backend.trimContext 清理 PI Agent 内部 state.messages，
 * 释放上下文窗口空间。
 *
 * 前端通过 archiveStore.archivedBoundaryIndex 显示"已归档 N 条"折叠提示，
 * 而非真正移除消息。
 *
 * P12 决策：同时将边界索引持久化到 sessionStorage，
 * 供 abort 重建 agent 后恢复。
 *
 * 注意：此操作不可逆，归档前确保记忆文件已持久化。
 *
 * @param archivedUpToIndex 本次归档的消息数（从消息数组开头计）
 */
```

## 注释块 3（原文件第 114-123 行）

```
/**
 * 注入钩子摘要到消息上下文
 *
 * 将归档钩子的摘要作为系统消息注入到 messages 数组开头，
 * 使 Agent 能感知之前对话的关键信息。
 *
 * P12 决策：同时缓存摘要文本，供 getHookSummaryForPrompt() 使用。
 *
 * @returns 注入的摘要文本
 */
```
