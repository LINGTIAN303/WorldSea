# speaking-desire.ts 详细注释文档（packages/agent-runtime/group-chat）

> 来源：`packages/agent-runtime/src/group-chat/speaking-desire.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-13 行）

```
群聊发言欲望系统

复用 companionModeTrigger 的概率引擎，将其适配到群聊场景。
每个 Agent 根据基础概率、话题相关度、近期参与度和全局运气系数决定是否主动发言。

参数映射：
  baseProbability × talkativeness → 基础发言意愿
  topicRelevance × 60            → 等效编辑时长（sceneFactor）
  recentMessageCount              → 亲密度（intimacy）
  secondsSinceLastSpoke           → 衰减（decay）
  luckState.coefficient           → 全局运气
```
