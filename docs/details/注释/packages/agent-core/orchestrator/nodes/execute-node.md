# orchestrator/nodes/execute-node.ts 详细注释

> 来源：`packages/agent-core/src/orchestrator/nodes/execute-node.ts`
> 说明：本文件为 agent-core ExecuteNode 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-26 行）

```
/**
 * ExecuteNode — Plan-and-Execute 模式的执行节点
 *
 * 设计理念：
 * - 单次 execute = 执行一个 pending PlanItem
 * - 执行完毕后检查是否还有 pending 项：
 *   - 有 → 返回 'continue'（编排图边循环回自身）
 *   - 无 → 返回 'done'
 * - 中断/恢复粒度细：每项之间可暂停
 *
 * 与 PlanNode 的协作：
 * - 编排图：PlanNode → ExecuteNode（无条件边）
 * - ExecuteNode 完成 → 条件边回自身（state.plan 还有 pending）
 * - ExecuteNode 完成 → 结束（无 pending）
 *
 * 动态调整：
 * - 每次执行后检查 LLM 输出是否包含新任务标记
 * - 默认标记格式：<new_tasks>[{"title":"...","description":"..."}]</new_tasks>
 * - 解析出的新任务追加到 state.plan 末尾
 * - 可通过 parseNewTasks 配置自定义解析逻辑
 *
 * 事件流：
 * - plan_step_update(status='in_progress')：步骤开始
 * - plan_step_update(status='completed', output)：步骤完成
 * - plan_step_update(status='failed')：步骤失败
 */
```

## 注释块 2（原文件第 70-79 行）

```
  /**
   * prompt 模板，支持占位符：
   * - {{input}}：用户原始输入
   * - {{stepTitle}}：当前步骤标题
   * - {{stepDescription}}：当前步骤描述
   * - {{completedSteps}}：已完成步骤摘要
   * - {{remainingSteps}}：剩余步骤摘要
   * - {{lastMessage}}：上一条消息内容
   * 省略时用默认模板
   */
```

