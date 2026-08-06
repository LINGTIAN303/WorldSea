# task-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/task-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 5-20 行）

```
task 模式专用控制工具：task_complete

作用：Agent 显式声明任务已完成。调用后前端停止自主执行循环（方向 B），
向用户展示任务总结。

设计依据（Anthropic agentic 三原则）：
  - 保持简单：一个工具，一个参数（总结文本）
  - 优先透明：Agent 必须给出完成总结，用户明确知道做了什么
  - ACI：Agent 通过调用此工具明确表达"完成"意图，区别于"中途停下问用户"

与"无 tool call 兜底停止"的关系：
  - 调用 task_complete → 显式完成（首选）
  - 纯文本回复无 tool call → 隐式交还控制权（兜底）
  - 两者都会停止自主循环
```
