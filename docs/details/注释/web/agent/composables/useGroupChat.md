# useGroupChat.ts 详细注释

> 来源：`apps/web/src/agent/composables/useGroupChat.ts`
> 说明：本文件为 useGroupChat composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-14 行）

```
/**
 * 群聊 Composable
 *
 * 管理多 Agent 群聊的完整生命周期：
 * - 为每个 AgentProfile 创建独立的 Agent Backend 实例
 * - 通过 MessageBus 广播群聊事件
 * - 通过 TurnEngine 决策发言顺序
 * - 通过 FlowController 控制请求并发
 * - 与 useAgent 并行运行，共享 toolContext
 *
 * 阶段 2.0 批次3：CoreBackend 已移除（依赖 pi-ai），群聊功能暂不可用。
 * Agent 循环已由 Rust 端接管，多 Agent 实例管理待后续在 Rust 端实现。
 * 以下函数调用时会抛错：createAgentBackend / setModeratorAgent / sendGroupMessage / sendPrivateMessage / promptSync
 */
```
