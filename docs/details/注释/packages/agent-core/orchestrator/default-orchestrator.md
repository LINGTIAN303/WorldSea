# orchestrator/default-orchestrator.ts 详细注释

> 来源：`packages/agent-core/src/orchestrator/default-orchestrator.ts`
> 说明：本文件为 agent-core 默认编排器实现内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-14 行）

```
/**
 * DefaultOrchestrator — 阶段 0 的简单编排器实现
 *
 * 特性：
 * - 线性/条件序列执行（不涉及并行/回溯，那些留给阶段 2）
 * - 支持中断/暂停/恢复
 * - 事件订阅与状态快照
 * - 最大轮次限制（防无限循环）
 *
 * 不包含（阶段 2 再做）：
 * - 并行节点执行（ToT/GoT 需要）
 * - 图的环路检测
 * - 节点超时（单个节点级别）
 */
```

## 注释块 2（原文件第 53-65 行）

```
/**
   * 中继事件 — 将外部事件注入 Orchestrator 的事件流
   *
   * 用途：PiBackendAccessor 订阅 CoreBackend 事件后，
   * 通过此方法将 LLM 事件（message_start/update/end 等）转发给 Orchestrator 的订阅者。
   *
   * 使用方式：
   * ```ts
   * const orchestrator = new DefaultOrchestrator()
   * const accessor = new PiBackendAccessor(coreBackend, orchestrator.relayEvent.bind(orchestrator))
   * orchestrator.setBackend(accessor)
   * ```
   */
```
