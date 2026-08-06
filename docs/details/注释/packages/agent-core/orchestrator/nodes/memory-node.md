# orchestrator/nodes/memory-node.ts 详细注释

> 来源：`packages/agent-core/src/orchestrator/nodes/memory-node.ts`
> 说明：本文件为 agent-core MemoryNode 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-25 行）

```
/**
 * MemoryNode — Memory Pattern 横切节点（阶段 0.6）
 *
 * 设计理念：
 * - 横切节点：可插入任何编排图，为其他节点提供记忆能力
 * - 四种动作：recall（检索）/ inject（注入）/ archive（归档）/ auto（检索+注入）
 * - 优雅降级：ctx.memory 未注入时返回 done，不阻塞编排流
 * - 解耦：通过 MemoryAccessor 接口访问记忆系统，不依赖具体实现
 *
 * 典型用法：
 *
 * 1. 会话开始时自动检索相关记忆（与 ReactNode 配合）：
 *    MemoryNode(auto) → ReactNode
 *
 * 2. 上下文接近阈值时触发归档：
 *    ReactNode → 条件边（检查 token 数）→ MemoryNode(archive) → ReactNode
 *
 * 3. 用户主动询问历史时检索：
 *    RouterNode → MemoryNode(recall) → ReactNode（基于检索结果回答）
 *
 * 占位符支持（queryTemplate 中）：
 * - {{input}}：用户原始输入（state.input）
 * - {{lastUserMessage}}：state.messages 中最后一条 role=user 的消息内容
 * - {{lastMessage}}：state.messages 最后一条消息内容
 */
```
