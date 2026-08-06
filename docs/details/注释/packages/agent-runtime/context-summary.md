# summary.ts 详细注释文档（packages/agent-runtime/context）

> 来源：`packages/agent-runtime/src/context/summary.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 63-72 行）

```
截断消息列表以控制上下文长度

策略：保留所有 system 消息，只截断 user/assistant/tool 消息。
截断时保留最近的 maxCount 条非系统消息，并在中间插入截断提示。

@param messages 完整消息列表
@param maxCount 保留的最大非系统消息数，默认 40
@returns 截断后的消息列表
```
