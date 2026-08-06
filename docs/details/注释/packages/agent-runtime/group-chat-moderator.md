# moderator.ts 详细注释文档（packages/agent-runtime/group-chat）

> 来源：`packages/agent-runtime/src/group-chat/moderator.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-13 行）

```
群聊主持 Agent

Moderator 是一个真正的 Agent，拥有完整的工具和对话能力。
它不仅决定谁应该发言，自己也可以作为群聊参与者发言。

职责：
1. 调度：根据用户消息和对话上下文，决定哪些参与者应该发言
2. 参与：在需要时主动发言，引导话题、总结讨论、调解分歧

调度输出 JSON 格式的决策结果：{ nextSpeakers: string[], reason: string }
每次调度后清理调度历史，避免上下文膨胀。
```
