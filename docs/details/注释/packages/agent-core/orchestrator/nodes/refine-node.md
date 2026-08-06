# orchestrator/nodes/refine-node.ts 详细注释

> 来源：`packages/agent-core/src/orchestrator/nodes/refine-node.ts`
> 说明：本文件为 agent-core RefineNode 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-28 行）

```
/**
 * RefineNode — Self-Refine 模式的迭代优化节点
 *
 * 设计理念：
 * - 单次 execute = 一次 LLM 调用 = 基于最新 Reflection 修正内容
 * - 收敛判断由节点自己做（因为需要看 state.reflections 历史趋势）
 * - 未收敛 → continue + nextNodeId 指向 ReflectionNode（触发下一轮评审）
 * - 已收敛 → done
 *
 * 与 ReflectionNode 的协作（Self-Refine 编排图）：
 * ```
 *   ReactNode（初版） → ReflectionNode → RefineNode
 *                                          ↓
 *                          (未收敛) → ReflectionNode → RefineNode
 *                                          ↓
 *                               (收敛) → 结束
 * ```
 *
 * 收敛条件（满足任一即停止）：
 * 1. 迭代次数达到 maxIterations（默认 3）
 * 2. 最新评分 >= minScore（默认 90）
 * 3. 连续 noImprovementRounds 轮分数无提升（默认 2）
 *
 * 修正策略：
 * - prompt 包含原始任务、待修正内容、最新评审结果（评分/问题/建议）
 * - LLM 输出修正后的完整内容（非增量 diff）
 * - 修正后的内容作为新的 assistant 消息追加到 state.messages
 */
```

## 注释块 2（原文件第 66-76 行）

```
  /**
   * prompt 模板，支持占位符：
   * - {{input}}：用户原始输入
   * - {{target}}：待修正内容（最新 Reflection 的 target，或回退到最后一条 assistant）
   * - {{iteration}}：当前迭代轮次
   * - {{score}}：最新评分
   * - {{issues}}：问题列表
   * - {{suggestions}}：建议列表
   * - {{lastMessage}}：上一条消息内容
   * 省略时用默认模板
   */
```

