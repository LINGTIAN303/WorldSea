# turn-engine.ts 详细注释文档（packages/agent-runtime/group-chat）

> 来源：`packages/agent-runtime/src/group-chat/turn-engine.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-16 行）

```
群聊发言策略引擎

分层策略架构：
  层级1: @mention 优先路由（始终生效，不作为策略选项）
  层级2: 主策略 = random | speaking-desire | moderator

random:        随机选择 1-3 个 Agent（最简单，零开销）
speaking-desire: 概率引擎评估每个 Agent 的发言意愿（默认）
moderator:     独立 LLM 调用选择发言者（最精准，有额外成本）

TurnResult.mode 决定执行方式：
  sequential: 串行执行，后发言者能看到前者的回复
  parallel:   纯并行执行，Agent 间看不到彼此回复（模拟同时打字）
  staggered:  交错并行，第一个完成后后续者能看到其回复
```
