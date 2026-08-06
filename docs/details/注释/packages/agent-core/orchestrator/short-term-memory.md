# orchestrator/short-term-memory.ts 详细注释

> 来源：`packages/agent-core/src/orchestrator/short-term-memory.ts`
> 说明：本文件为 agent-core 短期记忆 trim 策略工具内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-32 行）

```
/**
 * ShortTermMemoryHelper — 短期记忆 trim 策略工具（阶段 0.6）
 *
 * 设计理念：
 * - 工具类（非节点）：供 Orchestrator 或其他节点按需调用
 * - 操作短期记忆：state.messages 数组（当前会话的消息历史）
 * - 与 MemoryNode 互补：MemoryNode 操作长期记忆，本类操作短期记忆
 *
 * 三类记忆的关系：
 * - 短期记忆：state.messages（本类管理 trim 策略）
 * - 工作记忆：state.extra.workingMemory（节点自定义，本类不涉及）
 * - 长期记忆：通过 MemoryAccessor 检索/注入（MemoryNode 管理）
 *
 * trim 策略：
 * 1. 估算 state.messages 总 token 数
 * 2. 超过 maxTokens 时，移除最早的非 system 消息
 * 3. 保留策略：
 *    - 保留所有 system 消息（系统提示词等）
 *    - 保留最近 keepRecentCount 条消息（维持上下文连贯）
 *    - 可选保留首条 user 消息（任务原始输入）
 *
 * 使用示例：
 *
 * ```ts
 * // 在 Orchestrator 每轮结束后调用
 * const helper = new ShortTermMemoryHelper({ maxTokens: 100000, keepRecentCount: 20 })
 * const removed = helper.trim(state, ctx)
 * if (removed > 0) {
 *   ctx.log('info', `Trimmed ${removed} messages to free context`)
 * }
 * ```
 */
```
