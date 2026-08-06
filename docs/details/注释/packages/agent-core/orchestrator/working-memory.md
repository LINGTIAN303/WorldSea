# orchestrator/working-memory.ts 详细注释

> 来源：`packages/agent-core/src/orchestrator/working-memory.ts`
> 说明：本文件为 agent-core 工作记忆工具类内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-37 行）

```
/**
 * WorkingMemoryHelper — 工作记忆工具类（阶段 0.7）
 *
 * 设计理念：
 * - 工具类（非节点）：供 ReactNode/ReflectionNode/RefineNode 等按需调用
 * - 操作工作记忆：state.extra.workingMemory 数组（ReAct 循环内的临时观察缓冲）
 * - 与 ShortTermMemoryHelper 互补：ShortTerm 操作短期记忆（messages），本类操作工作记忆
 *
 * 三类记忆的关系：
 * - 短期记忆：state.messages（ShortTermMemoryHelper 管理 trim 策略）
 * - 工作记忆：state.extra.workingMemory（本类管理观察缓冲+容量控制+合并）
 * - 长期记忆：通过 MemoryAccessor 检索/注入（MemoryNode 管理）
 *
 * 工作记忆的特点：
 * - 临时性：仅在 ReAct 循环期间存在，循环结束可合并到 messages 或丢弃
 * - 高密度：仅存储工具调用的观察结果（不存完整消息）
 * - 可排序：按 importance + timestamp 优先级裁剪
 * - 可合并：循环结束时聚合为摘要消息，避免污染 messages 历史
 *
 * 使用示例：
 *
 * ```ts
 * // ReactNode 在工具调用后追加观察
 * const wm = new WorkingMemoryHelper({ maxEntries: 50, maxTokens: 8000 })
 * wm.pushObservation(state, ctx, 'search_web', '查找到3条结果：...', {
 *   toolCallId: 'call_001',
 *   importance: 0.7,
 * })
 *
 * // 容量超限时自动 trim（保留 importance 高的旧条目）
 * const snapshot = wm.getSnapshot(state)
 * ctx.log('info', `Working memory: ${snapshot.count} entries, ~${snapshot.estimatedTokens} tokens`)
 *
 * // 循环结束时合并到 messages（或丢弃）
 * wm.merge(state, ctx, { toMessages: true, maxTokens: 2000 })
 * ```
 */
```

## 注释块 2（原文件第 143-152 行）

```
/**
   * 推入一条观察记录
   *
   * 内部流程：
   * 1. 截断过长的 observation
   * 2. 生成 id 和 timestamp
   * 3. 追加到 state.extra.workingMemory
   * 4. 触发容量检查（超限时 trim）
   * 5. 发射 working_memory_push 事件
   */
```

## 注释块 3（原文件第 231-240 行）

```
/**
   * 执行容量控制 trim
   *
   * 策略：
   * 1. 若未超限，直接返回
   * 2. 超限时，按 importance 升序排列（低的先移除）
   * 3. 保留 importance >= threshold 的条目（不被裁剪）
   * 4. 移除 importance 最低的条目，直到容量达标
   * 5. 移除后按 timestamp 升序恢复原顺序
   */
```

## 注释块 4（原文件第 348-360 行）

```
/**
   * 合并工作记忆到 messages（或丢弃）
   *
   * 使用场景：ReAct 循环结束、Reflection 评估前、上下文压缩时
   *
   * @param options.toMessages 是否合并到 state.messages
   *   - true：将工作记忆聚合为一条 system 消息追加到 messages
   *   - false：直接清空（默认）
   * @param options.maxTokens 合并到 messages 时的最大 token 数（超出按重要性裁剪）
   * @param options.format 格式化方式
   *   - 'summary'：紧凑摘要（默认）
   *   - 'detailed'：完整观察列表
   */
```
