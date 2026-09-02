# deepseek-harness 调研与借鉴方案

> 调研开始：2026-09-01
> 调研对象：https://github.com/deepseek-ai/deepseek-harness（master 分支，MIT，**开发者预览期**）
> 调研方式：官方文档 + 关键源码（不克隆仓库，按需取文件）
> 调研目的：为 WorldSmith 的**上下文压缩 / 会话持久化契约 / 回源一致性**三个议题找外部参照
> 关联文档：[Trae Agent 调研与借鉴方案](./trae-agent-调研与借鉴方案.md)

> **本文档为「持续增长」形态**：每深挖一个子系统就往 [十、后续调研队列](#十后续调研队列) 之前追加一章，
> 并把该子系统从队列移到正文。本次为**子系统①：Compaction（上下文压缩）**。

---

## 零、一句话结论

**Compaction 在 dsh 里不是"删历史"，而是"在不可变事件日志上追加一条 replace 记录"。**

这个定性差异带来三个 dsh 有、而 WorldSmith 目前没有的性质：

1. **可回溯** —— 原文永远留在日志里，摘要只是遮蔽它；
2. **可崩溃恢复** —— 事务状态写在日志里（`compaction/start` 无匹配 `compaction/end` = 检测到孤儿锁），不依赖进程内存；
3. **可持久** —— 压缩结果本身就是一条普通消息事件，刷新/重启后回源天然生效。

WorldSmith 当前的 `enforce_context_budget()` 是**内存态的头部硬丢弃**，三个性质全无，
且存在**破坏 tool_call/tool_result 配对**的实际风险（见 [六、WorldSmith 现状盘点](#六worldsmith-现状盘点)）。

---

## 一、全景：Compaction 是一个「能力缝隙」

dsh 把 Bash 一样的 **capability seam（能力缝隙）** 三角色拆分套用到了压缩上：

```text
Service Definition（接口）   →  dsh-compaction        ctx.compaction
Service Provider（实现）     →  dsh-compaction-basic  注册 ctx.compaction
Optional Provider（可选）    →  dsh-compaction-tool-result-pruner   ctx.toolResultPruner
Human Consumer（人类入口）   →  dsh-command-compact   /compact 命令
```

关键定性：**Compaction 是一个可选能力，不是 agent-loop 脊柱的一部分。**
所以它的词汇表住在 `docs/subsystems/compaction.md`，而不在 `core.md` 里。

最小可运行组合（YAML 组合式装配）：

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-token-meter'
- name: '@deepseek-ai/dsh-compaction-tool-result-pruner'   # 可选
- name: '@deepseek-ai/dsh-compaction-basic'
- name: '@deepseek-ai/dsh-command-compact'                 # 可选
```

> **对 WorldSmith 的含义**：Cargo feature 或 trait 对象即可表达同样的缝隙（Rust 编译期装配 vs dsh 运行时装配，
> 是取舍而非优劣）。真正要抄的是**四个角色的边界划分**，尤其是「测量服务」独立于「压缩后端」这一点。

### 1.1 源码地图

| 文件 | 角色 |
|---|---|
| `packages/compaction/compaction/src/types.ts` | 缝隙契约：结果类型 + 4 个 `compaction/*` 事件（声明合并进 `SessionEventMap`） |
| `packages/compaction/compaction/src/checkpoint.ts` | `compactCheckpointSource()` —— 替换消息的身份构造函数 + `isCompactCheckpointSource()` 谓词 |
| `packages/compaction/compaction/src/tool-pairing.ts` | `toolPairingBalancedBefore/After` —— 工具调用/结果配对边界判定 |
| `packages/compaction/compaction-basic/src/index.ts` | 插件入口：自动监听器（pre-step / request-error）、入口分发 |
| `packages/compaction/compaction-basic/src/region.ts` | ★ 保留策略选择 + 共享的「括号优先」事务 |
| `packages/compaction/compaction-basic/src/summarizer.ts` | 默认 `ctx.llm.stream()` 摘要、检查点装帧、安全投影 |
| `packages/compaction/compaction-basic/src/config.ts` | 加载期校验 + 按路由模型的策略解析 |
| `packages/compaction/compaction-tool-result-pruner/src/index.ts` | `pruneSession` / `pruneContent` / `measureContent` |

---

## 二、前置知识：Surface 为什么是压缩的地基

压缩之所以能"只追加不修改"，全靠 Session 层的 **Surface** 抽象。这是整个设计的地基，必须先讲。

### 2.1 日志是唯一事实源

Session 是 **append-only 事件日志**，LLM 消息历史由 `deriveMessages()` **派生**，从不单独存储；
回放 = 重新派生。

### 2.2 只有三类事件产出消息

```text
SurfaceEventType = 'user/message' | 'assistant/message' | 'tool/result'
```

每个这类事件都必须携带 `SurfaceOp`：

| SurfaceOp | 语义 |
|---|---|
| `'append'` | 正常尾部追加 |
| `{ op: 'replace', start, end }` + `sourceEventSeqs` | **遮蔽 [start, end] 位置区间并替换** |

> **压缩是唯一使用 `replace` 的表面变更。** 摘要本身不新增事件类型，而是搭在一条普通的
> `user/message` 上（带 `replace` op）。这是 dsh 刻意的设计——理由见其 Agent Note：
> 复用 `user/message` 而非新增 `compaction/summary` 表面事件，是为了让所有下游消费者
> （投影、UI、派生）零改动就能理解"这里被替换了"。

### 2.3 位置跨度 ≠ 序号区间

`shadowedRange: { start, end }` 是**表面位置跨度**，不是数值区间。
因为前一次 replace 会把一条高 seq 的摘要节点放到旧位置，所以 **`start` 可能大于 `end`**。
权威的被遮蔽集合是 `shadowedSeqs: number[]`（按表面顺序）。

> 这是很容易写错的一个点：**任何"按 seq 数值区间裁剪"的实现在二次压缩后都会算错区间。**

---

## 三、四个 `compaction/*` 事件（全部 log-only）

通过 TS 声明合并扩展 `SessionEventMap`。**全部不进 Surface**（`SurfaceEventType` 刻意不扩展）。

| 事件 | 载荷要点 | 角色 |
|---|---|---|
| `compaction/start` | `{ compactionId, sourceCommandId?, turn: number \| null }` | **获取锁**。数字 turn = 被某个开启的轮次严格包围；`null` = 轮次间的独立手工事务 |
| `compaction/summary` | `{ summary, rawOutput?, llmStreamCall?, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | 安全摘要投影 + 遮蔽范围 + 摘要调用的信封（provider/model/maxTokens），**使一次性请求可从日志+代码重建** |
| `compaction/prune` | `{ shadowedRange, shadowedSeqs, shadowedTokenCount }` | 一次无模型裁剪的 **shadow price（影子价格）** |
| `compaction/end` | `{ turn, error? }` | **释放锁**，`error` 记录失败尝试 |

### 3.1 括号即事务

顺序严格为：

```text
compaction/start → [摘要] → compaction/summary → user/message(replace) → compaction/end
```

**最后才释放锁**，是关键决策：中途崩溃会留下一个**可检测的孤儿锁**
（有 `compaction/start` 无 `compaction/end`），而不是一个"谎称压缩已完成"的 `compaction/end`。

- 活着的未匹配 start 会**阻塞所有入口**
- 位于更新的 `session/end-seed` 之前的未匹配 start 属于上一个生命周期的陈旧证据，**忽略**
- 关闭失败的尝试**故意留下阻塞孤儿**（宁可卡住，不可静默）

### 3.2 标记是时间点，不是排他容器

手工压缩期间允许无关注入出现在 start/end 之间。手工路径**只重新校验它选中的位置跨度**，
所以注入的内容在替换检查点之后仍然存活。

---

## 四、关键机制逐条

### 4.1 三个抽象操作

| 方法 | 触发 | 语义 |
|---|---|---|
| `compactIfNeeded(agent, trigger, signal)` | 自动 | `trigger: 'pressure' \| 'context-overflow'`，在 `agent/pre-step` 瀑布中、请求派生前运行 |
| `compactNow(agent, signal, sourceCommandId?)` | 手工 `/compact` | 轮次间的维护；无可用区间时**不写任何东西**直接返回 `null`；`turn: null` 独立括号 |
| `compactRegion(start, end, agent, signal?)` | 强制 | 按表面位置强制压缩闭区间 |

`compactNow()` 的顺序很讲究：**同步启动空闲任务 → 选区间（no-op 则不写）→ 追加 `compaction/start` → 摘要**。
后来排队的 prompt 按 FIFO 接受，但要等可选的持久化检查点 + 空闲任务结算之后才启动。

### 4.2 触发阈值与保留策略（默认值）

| 字段 | 默认 | 含义 |
|---|---|---|
| `thresholdRatio` | `0.8` | 到 `floor(路由模型上下文窗口 × ratio)` 才开始压缩 |
| `retainRatio` | `0.16` | 最近对话逐字保留比例；与 `retainTokens` 互斥 |
| `retainTokens` | — | 绝对保留预算；必须小于阈值 |
| `summarizationProvider/Model` | `''` | 空则回退到最近一次路由请求目标，再回退 `AgentOptions` |
| `maxTokens` | `8192` | 摘要请求输出上限（可能含 reasoning token） |
| `compactionRetries` | `1` | 压力仍超阈值时的额外压缩次数 |
| `maxOverflowRetries` | `1` | 确认溢出后的最大重试；`0` 只关恢复 |
| `modelPolicies` | `[]` | 精确 `{ provider, model, ...partialPolicy }` 覆盖 |
| `auto` | `true` | 关掉即纯手工 |

**配置错误快速失败**：未知设置、重复的模型覆盖、两种保留形式同时给、ratio 不低于阈值 → **加载期拒绝插件**。

### 4.3 区间选择：保留尾部 + 最老平衡段

来自 `region.ts` 的核心算法：

1. 用**同一个** `ctx.tokenMeter` 给当前表面每个节点定价（一个被消费的日志修订版本上）
2. 从尾部往前累加，直到触及保留预算 → 得到 **retained tail**
3. 头部剩下的就是候选；**按工具调用/结果配对边界取最老的平衡段**
4. 摘要生成后**必须 shrink**：不比源小的摘要 → 拒绝

> **注意**：区间边界**保护工具调用配对，但不保护整轮**。
> 一个超大轮次的早期已闭合 step 可以被单独压缩掉。

### 4.4 工具配对边界（WorldSmith 最该抄的一条）

`dsh-compaction` 导出两个纯函数：

```text
toolPairingBalancedBefore(session, seq) : boolean
toolPairingBalancedAfter(session, seq)  : boolean
```

两者都**校验当前表面成员身份、拒绝缺失 seq 和孤儿结果**。

> **这条是硬约束**：OpenAI/DeepSeek 类 API 要求 `assistant.tool_calls[i]` 与后续 `tool` 消息一一对应。
> 从中间切断会产生悬空 `tool_call_id`，下一次请求直接 400。

### 4.5 摘要请求复用 provider 暖前缀（很聪明的一招）

摘要调用**逐字重放**上一次路由请求的 system prompt、tools schema 和被遮蔽区间的消息，
只在最后追加一条压缩指令作为最终 user message。

效果：辅助调用成为对话的**真前缀**，provider 的 prefix cache 只到尾部指令才失效。

```text
[system prompt + tools + 被遮蔽区间消息]  ← 与主对话逐字一致 → 命中暖前缀
[压缩指令]                                 ← 未缓存
[摘要输出]                                 ← 未缓存
```

代价提示：把摘要器路由到**不同的** provider/model，或压缩非头部区间，就放弃了这层复用。

`GenerateOptions.purpose` 设为 `compaction`；**只有返回的 text 进检查点**（排除 reasoning 和 tool calls）。

### 4.6 检查点装帧

替换用的 `user/message` 内容为：**固定前言 + 空行 + `<compacted-summary>` + 摘要 + `</compacted-summary>`**。

固定前言（可直接抄）：

```markdown
This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.
```

压缩指令（final user message）的 8 个固定章节，值得直接借鉴：

```text
## Primary Request and Intent   — 用户原始与演进的目标，关键处逐字引用
## Key Technical Concepts       — 技术栈、框架、模式、约定
## Files and Code               — 精确路径: 为何重要、关键改动或片段
## Errors and Fixes             — 错误: 如何解决 + 相关用户反馈
## Pending Jobs                 — 明确要求但未完成的工作
## Current Work                 — 检查点时刻正在进行的事
## Next Step                    — 单个下一步动作，或 "(none)"
## Critical Context             — 决策与理由、约束、用户偏好、开放问题
```

三条规则尤其重要：
- 保留精确的文件路径、命令、错误串、标识符、数值、函数签名、语法片段
- 忠实捕获用户反馈与明确指令，**尤其是纠正**
- **若对话中已有 `<compacted-summary>` 块，那是先前检查点——不要逐字照抄向前传递**：
  保留仍为真的事实，丢弃过时的，把新信息合并进同一结构的单份摘要

> 最后一条解决了"多轮压缩导致摘要漂移/膨胀"的问题，是工程经验，很值钱。

### 4.7 工具结果裁剪（模型无关，先裁剪再决定要不要摘要）

`ctx.toolResultPruner` 在**压缩触发确认之后、区间选择之前**运行。

| 字段 | 默认 | 含义 |
|---|---|---|
| `thresholdChars` | `8192` | 超过此 Unicode 码点数才裁 |
| `headChars` | `4096` | 保留的头部码点数 |
| `tailChars` | `1024` | 保留的尾部码点数 |

```text
[head 4096 码点] \n\n[... tool result middle pruned ...]\n\n [tail 1024 码点]
```

四个设计要点：

1. **确定性一次收敛** —— 按 Unicode 码点切片（不是 UTF-16 码元，所以不会劈开代理对）；
   输出严格小于输入、且不超过 `thresholdChars`，不会反复重写。
2. **替换而非修改** —— 原事件留在 append-only 日志里；替换事件通过 `sourceEventSeqs` 引用它，
   **回放能恢复产生裁剪结果的精确输入**。
3. **不调模型** —— 裁剪本身零 LLM 调用；裁剪后重测若已低于阈值，**直接跳过摘要**。
4. **只在触发后运行** —— 低于压力的对话永远不动。

> **对 WorldSmith 的直接对照**：`clamp_tool_result` 是"入库前截断"，原文本丢失；
> dsh 是"入库后替换"，原文保留可回放。见 [六、](#六worldsmith-现状盘点)。

### 4.8 shadow price 协议（一个巧妙的纯消费者设计）

> **协议**：一个表面 `replace` 事件的价格，由**紧邻它之前的**计量事件给出
> （摘要压缩是 `compaction/summary`，裁剪是 `compaction/prune`）。
> 该事件声明被替换区间的启发式 token 价格，于是**纯消费者可以直接相减，
> 无需为每个节点保留价格状态**。

`compaction/prune` 的 JSDoc 明确：**替换必须同步紧跟在该事件之后追加**（契约性相邻）。

这对 WorldSmith 的前端很有价值：`turnModel.ts` 的归约器是纯函数折叠，
若要做"已压缩掉多少 token"的展示，这个协议让归约器保持无状态。

### 4.9 溢出恢复

`agent/request-error` 监听器响应 provider 确认的 `CONTEXT_WINDOW_EXCEEDED`：
- **绕过**常规阈值与保留策略
- 尝试**一次最大化平衡头部削减**
- **仅当表面替换代次（generation）确实推进了**才授权重试
- 即使裁剪已经落地、后续摘要抛错，也按"裁剪后的持久表面"继续
- 取消始终优先

### 4.10 手工压缩的错误分类

```text
'busy' | 'cancelled' | 'changed' | 'summary' | 'commit' | 'persistence'
```

- `changed` / `summary`：**表面不变**，但仍把失败的尝试**关闭并持久化**到日志
- `commit`：可能跟随部分变更
- `persistence`：内存括号已关闭但 flush 失败
- `cancelled`：清理后**抛出原始 abort reason**（不吞掉取消语义）

---

## 五、时序：一次自动压力压缩

```text
agent/pre-step (waterfall, 请求派生前)
  │
  ├─ ctx.tokenMeter 给「最近一次持久路由请求信封 + 当前表面」定价
  │     └─ 未过阈值 → 原样继续
  │
  ├─ 过阈值 → 调用 ctx.toolResultPruner.pruneSession(session)   [可选]
  │     └─ 每个超预算结果：compaction/prune(影子价格) → tool/result(replace, 引用原 seq)
  │
  ├─ 重测 → 若已低于阈值，跳过摘要，直接继续
  │
  └─ 仍需摘要 → region 事务：
        1. 校验区间 + 活体锁
        2. 同步追加 compaction/start
        3. summarize()   ← 唯一子类钩子；复用暖前缀；forward signal
        4. 重新校验稳定性（自动=整个表面 / 手工=仅选中跨度）
        5. 摘要未 shrink → 拒绝
        6. 追加 compaction/summary + user/message(replace)
        7. 恰好一次 compaction/end 尝试
```

---

## 六、WorldSmith 现状盘点（实测证据，2026-09-01）

### 6.1 已有的东西

| 能力 | 位置 | 现状 |
|---|---|---|
| 上下文预算裁剪 | `crates/agent-kernel/src/agent/mod.rs:730` `enforce_context_budget()` | 有，但见 6.2 |
| 裁剪执行 | `crates/agent-kernel/src/agent/interaction.rs:65` `trim_context(up_to_index)` | 双向 drain |
| backend 侧裁剪 | `crates/agent-kernel/src/llm/genai_backend.rs:634` | `messages.drain(0..up_to_index)` |
| 工具结果长度限制 | `crates/agent-kernel/src/agent/tools.rs:16` `TOOL_RESULT_STR_LIMIT = 12_000` | 入库**前**截断 |
| 消息 blob 持久化 | `crates/agent-commands/src/session_store.rs:245` | `(session_id, seq, msg_json)`，整条 JSON blob |
| 扩展位 | `crates/agent-kernel/src/types.rs:87` `OrchestratorMessage.meta` | `Option<HashMap<String, serde_json::Value>>`，**不进 LLM 上下文** |

### 6.2 与 dsh 的四个硬差距

**差距 1：裁剪是"内存态头部硬丢弃"，不持久、不可回溯**

```rust
// interaction.rs:65 —— 只动内存，不写持久化
self.backend.trim_context(up_to_index).await?;
let mut state = self.state.lock().await;
state.messages.drain(0..up_to_index);
```

原文**永久丢失**；且 `session_store` 里的历史不会被同步裁剪 →
**刷新页面回源后，被裁掉的旧消息又完整回来了**。裁剪只在当前进程生命周期内有效。

**差距 2：无 tool_call / tool_result 配对保护（真实 BUG 风险）**

`enforce_context_budget` 按字节累加算 `drop` 条数，切点完全可能落在
`assistant(tool_calls)` 与其 `tool` 结果之间：

```rust
// mod.rs:759 —— 逐条从头减字节，不看角色/配对
for m in state.messages.iter() {
    if drop >= keep_from || acc <= HISTORY_BUDGET_BYTES { break; }
    acc -= m.content.len() + 32;
    drop += 1;
}
```

dsh 用 `toolPairingBalancedBefore/After` 专门防这个。

**差距 3：无 token 计量**

全 `crates/` 搜索 `context_window|contextWindow|count_tokens|token_count|estimate_tokens|max_context|num_tokens|tiktoken` **零命中**。
阈值用字节数粗估（`m.content.len() + 32`），与模型实际上下文窗口**无关联**——
换一个 8k 上下文的小模型，160_000 字节的预算毫无意义。

**差距 4：阈值标记为占位待定**

`mod.rs:731-738` 有显式 `TODO(await-user · 2026-08-30)` 注释：

```rust
const HISTORY_BUDGET_BYTES: usize = 160_000;  // ⚠ 占位待定
const HISTORY_KEEP_MESSAGES: usize = 12;      // ⚠ 占位待定
```

即**该机制尚未经过用户确认**，本次调研正好可以为这个待定项提供决策材料。

### 6.3 附带发现：截断是"入库前"，与 dsh 相反

`clamp_tool_result` 在工具结果**进入消息历史之前**截断：

```rust
// tools.rs:32
*s = format!("{}\n…[已截断，省略 {} 字节]", &s[..end], omitted);
```

- 只保头、丢尾（dsh 保头 + 保尾）
- 原文不可恢复（dsh 保留原事件，替换引用其 seq）
- 阈值是**字节**且按 `String::len()` 算（dsh 按 Unicode 码点，明确避免劈开代理对）

---

## 七、差距矩阵

| 能力 | dsh | WorldSmith | 优先级 |
|---|---|---|---|
| 压缩语义 | 日志上的 `replace` 记录 | 内存 drain | **P0** |
| 原文可回溯 | 是（append-only 日志） | 否 | **P0** |
| 压缩结果可持久 | 是（本身就是事件） | 否（刷新即复活） | **P0** |
| tool 配对保护 | `toolPairingBalancedBefore/After` | 无 | **P0** |
| token 计量 | 独立 `ctx.tokenMeter` 服务 | 无（字节粗估） | **P1** |
| 阈值与模型上下文挂钩 | `thresholdRatio × routedContextWindow` | 无关联 | **P1** |
| 崩溃可检测 | 孤儿 `compaction/start` | 无事务 | P1 |
| 工具结果裁剪（保头尾/可回溯） | pruner 包 | 入库前截断，只保头 | P2 |
| 溢出后恢复重试 | `agent/request-error` + generation 推进 | 无 | P2 |
| 暖前缀复用 | 逐字重放 system/tools | 不适用（无压缩调用） | P2 |
| 手工触发 | `/compact` 命令 | 无 | P3 |

---

## 八、借鉴方案（分阶段，待确认后执行）

> 全部为**提案**，未改任何代码。

### 阶段 A：止血（P0，改动小）

**A1. 给 `enforce_context_budget` 加配对保护**

在 `mod.rs` 的 drop 循环中，把切点**回退到最近的安全边界**：

```text
候选切点 i → 若 messages[i] 是 ToolResult，或 messages[i-1] 带未闭合 tool_calls，
             则把 i 往后推到配对完整处
```

建议实现为纯函数 `fn safe_trim_index(msgs: &[OrchestratorMessage], want: usize) -> usize`，
放在 `agent-kernel/src/agent/` 下并配单测（与 `turnModel` 纯函数化思路一致）。

**A2. 裁剪同步到持久化**

`trim_context` 目前只动 backend + state 两份内存。
最小改法：在 `session_store` 增加按 `seq` 删除/标记的能力，
或者**改为"替换首条为一条摘要消息"而非删除**（见阶段 B）。

### 阶段 B：引入 replace 语义（P0/P1，核心）

利用**已有的** `OrchestratorMessage.meta` 扩展位，零 SQLite 迁移：

```rust
// 给被遮蔽的消息打标，不删除
msg.meta.insert("shadowed_by".into(), json!(summary_seq));
```

派生 LLM 上下文时跳过带 `shadowed_by` 的消息 → **等价于 dsh 的 Surface replace**，
且原文完整保留、刷新可回源。

配套需要：
1. **一个摘要调用**：复用 `genai_backend` 现有链路，`purpose` 标记为 compaction
2. **缩水校验**：摘要 token 数不显著小于源 → 放弃压缩（对齐 dsh 的 shrink 校验）
3. **触发时机**：从 AfterRun 挪到**请求派生前**（对齐 dsh 的 `agent/pre-step`），
   否则"先超窗口报错、再压缩"的顺序是反的
4. **事件上抛**：新增 `CompactionStart/Summary/End` 事件，让前端 `turnModel.ts` 能渲染检查点

### 阶段 C：测量与策略（P1）

1. 引入极简 token 估算服务（dsh 用 4 字符/token 启发式，且自认低估 CJK 与 JSON schema）
2. 阈值改为「模型上下文窗口 × ratio」，模型的 `context_window` 需要在 `ProviderConfig` 里可声明
3. 保留策略：尾部保留 + 头部最老平衡段（对齐 dsh 4.3）

### 阶段 D：裁剪与恢复（P2）

1. `clamp_tool_result` 改为**保头 + 保尾**（当前只保头），并考虑改为入库后替换以保可回溯
2. 溢出错误分类 + 压缩后重试一次

---

## 九、风险点（需用户决定，不自动处理）

| # | 风险 | 影响 | 建议 |
|---|---|---|---|
| R1 | **A1 缺失会导致真实 400 错误** —— 悬空 `tool_call_id` | 长会话触发裁剪后，下一次请求可能直接失败 | 优先修，改动 < 30 行 |
| R2 | **阶段 B 需要新增 LLM 摘要调用** —— 增加成本与延迟 | 每次压缩一次额外请求 | 建议默认 `auto: true` 但可关；阈值设保守值 |
| R3 | **阶段 B 改变用户可见行为** —— 会话中出现检查点消息 | 属 UX 变更（信息层级），需确认渲染形态 | 前端如何呈现检查点，需你定 |
| R4 | **触发时机从 AfterRun 挪到派生前** —— 属架构变更 | 影响 `RunPhase` 语义 | 需确认 |
| R5 | **阶段 C 需要模型 `context_window` 声明** —— 涉及 `ProviderConfig` 数据结构 | 数据模型变更，需确认 | 可先做固定默认值 |
| R6 | **dsh 处于开发者预览期** —— 破坏兼容变更频繁 | 调研结论可能过期 | 已锁定 master 分支快照，文档内注明 |

---

## 十、后续调研队列

| 子系统 | 为什么值得看 | 状态 |
|---|---|---|
| **tool 执行管线** | 工具调用/结果的权威事件源设计，WorldSmith 的 `tools.rs` 可对位 | 待启动 |
| **subagent** | 子 Agent 的会话隔离与结果回传 | 待启动 |
| **agent-team** | 多 Agent 协作（experimental 包） | 待启动 |
| **token-meter** | 独立测量服务，直接影响阶段 C | 待启动（建议与阶段 C 同步） |
| **session projections** | 增量折叠 + 快照，对应前端回源 | 待启动 |

---

## 附：本次读过的权威来源

| 来源 | 用途 |
|---|---|
| `docs/subsystems/compaction.md` | 子系统参考：词汇表、结果类型、服务行为（权威） |
| `packages/compaction/README.md` | 包族地图 + 缝隙三角色 |
| `packages/compaction/compaction/src/types.ts` | 4 个事件的精确字段与 JSDoc |
| `packages/compaction/compaction-basic/README.md` | 默认值、保留策略、模型体验、已知限制 |
| `packages/compaction/compaction-tool-result-pruner/README.md` | 裁剪策略、码点切片、shadow price |
| `docs/architecture.md` | Cordis 五概念、Profile/Bundle |
| `docs/subsystems/session.md` | Session 日志、Surface、投影 |
| `docs/cordis-primer.md` | 插件即 Service、5 种派发模式、可逆 effect |
