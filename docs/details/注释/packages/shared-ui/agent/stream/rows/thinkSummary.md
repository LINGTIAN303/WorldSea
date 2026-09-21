# thinkSummary 注释（推理行摘要的定向扫描实现）

> 位置：`packages/shared-ui/src/agent/stream/rows/thinkSummary.ts`
> 上游：[C1 对话区性能门禁](../../../../../../../plans/2026-09-18-对话区对齐dsh/03-对照与建议清单.md)（批次 D 施工记录）

## 一、这个模块为什么存在

推理行（`ThinkRow`）的折叠条要显示一行摘要：流式态取**末个非空行**、完成态取**首个非空行**，截断 80 字符。

原实现把摘要写在组件里：

```ts
const lines = computed(() => props.item.text.split('\n').map(s => s.trim()).filter(Boolean))
```

问题不在「算得对不对」，而在**算的时机**：`lines` 依赖 `item.text`，而 `item.text` 每个推理 delta 都变一次。于是每个 delta 都要对**整段推理全文**做一次 `split` + 逐行 `trim` + `filter` —— 分配一个长度等于「全文行数」的数组，外加每行一个 trim 后的新字符串。长推理（数千行 / 数万字符）流式下，这是每帧最重的 JS 级分配来源。

## 二、设计决策

### 2.1 只扫描目标行，不切分全文

- 末行：`lastIndexOf('\n')` 定位行尾边界（原生扫描，零分配），再从行首取前 80 字符。
- 首行：`indexOf('\n')` 同理。
- 行首空白用 sticky 正则 `[\s\uFEFF]*` 从行起点匹配（`\s` 覆盖 `String.prototype.trim` 的空白集），并把匹配长度**以行尾为上界截断**——否则 `\s` 会吞掉行尾换行、跨行匹配。
- 行尾空白只在「整行内容不足 80 字符」时才需要处理（切整行 + `trimEnd`）；超过 80 字符时行尾空白必在窗口之外，直接 `slice(0, 80)`。

结论：多行文本下成本 = 一次原生扫描 + ≤80 字符分配；单行文本（无换行）退化为**一次整串原生扫描**（`lastIndexOf` 找不到换行），这是该实现的成本上界，已在门禁中以「单行预算」单独锁住。

### 2.2 保留参考实现（`referenceThinkSummary`）

`referenceThinkSummary` 就是原来的全文逐行切分实现，**刻意留在源码内**：门禁需要它做两件事——

1. 等价性：两者在任意文本上必须逐字符一致（`__tests__/thinkSummary.spec.ts`）；
2. 判别力自证：参考实现的耗时**必须超出**预算（`benchmarks/conversation/conversation.bench.ts`）——以此证明「预算真的能捕获退回旧实现的回归」，而不是一个永远不会红的空门槛。

### 2.3 组件侧配套（`ThinkRow.vue`）

- 摘要走本模块（每次 delta 只扫目标行）。
- 正文文本不再直接绑 `item.text`，改为本地 `displayText`：**折叠态跳过更新**（正文高度 0 且 `aria-hidden`，不可见）、**展开态 rAF 合并**，展开瞬间同步到最新（避免闪现旧内容）。
- `followEnd`（流式跟随末尾）改监听 `displayText`，即「DOM 真正变化时才跟随」。

## 三、约束与边界

- 语义**必须**与参考实现一致：任何不等价都属于 BUG，不是「性能取舍」。
- 摘要上限 80 字符与既有行为一致，改动需同步 `thinkRow.spec.ts`。
- 本模块不引入状态（无缓存、无增量游标）：单次调用成本已足够低，增量状态会带来跨帧一致性负担（与 `markdownStream.ts` 的取舍不同——那里重渲成本是毫秒级，这里是一次扫描）。
