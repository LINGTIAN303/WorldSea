# groupTurns 注释（事件行流 → 轮次分组 + 整组复用）

> 位置：`packages/shared-ui/src/agent/stream/groupTurns.ts`
> 上游：[批次 D 走查后修复·流式帧率](../../../../../../plans/2026-09-18-对话区对齐dsh/03-对照与建议清单.md)（帧率修复③）

## 一、为什么单独成模块

原实现把分组逻辑内联在 `AgentStreamList.vue` 的 `groups` computed 里，每 delta 执行一次。问题不在逻辑，而在**产出对象的引用**：

```ts
for (const g of out) {
  if (!g.process.length) continue
  g.process = aggregatePlanBlocks(g.process)   // 每 delta 产出全新块对象
}
```

`ProcessBlocks` 收到的 `:blocks` 每 delta 都是新数组（元素也是新对象）→ props 引用变化 → Vue 对**窗口内所有轮次**的 `ProcessBlocks` 都重渲一次。而实际上每个 delta 只触及一个轮次。

提取为纯函数后，复用判据（引用全等）可以独立测试，也让「每 delta 只重渲一个轮次」成为可断言契约（`__tests__/groupTurns.spec.ts`）。

## 二、复用判据与依据

- **判据**：该轮次在窗口内的**源行引用序列逐项全等**（`prev.src.every((r, i) => r === src[i])`）。
- **为什么可行**：归约器不可变（`turnModel.reduceEvent` 产出新对象），未触及的行天然保持同一引用——上游 `useAgentRust.agentStream` 的两级缓存（轮次引用 / 行引用）已经把「未变行引用相同」变成不变量，本模块直接消费该不变量。
- **复用的是什么**：分组对象本身（含 `process` 块数组、`user`/`result`/`tail` 引用），不是重新拼一个内容相同的对象——**引用相同**才能让 Vue 跳过子树 patch。

## 三、边界与约束

- **缓存有界**：超过「当前窗口组数 × 2」时清理窗口外条目（窗口外的轮次不渲染，条目无复用价值；阈值触发 → 摊销 O(1)）。避免跨会话长期累积持有旧行对象。
- **孤儿组 / 异常双结果组 / tail 行**的分组语义与内联实现逐字段一致（等价性用例锁定）。
- 分组只做「切段」，**不改变行的相对顺序**——窗口化依赖渲染顺序与 `items` 顺序一致。
- 缓存由调用方（`AgentStreamList`）持有，随组件实例生命周期；组件卸载即释放。
