# orchestrator-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/orchestrator-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-14 行）

```
Agent 调度器工具集

通过 window CustomEvent 机制调度子 Agent 执行任务。
支持 9 种子 Agent 类型：
  开发型：terminal-worker、review-worker、research-worker、test-worker、doc-worker、git-worker
  创作型：creation-worker、consistency-worker、batch-creation-worker

调度流程：
1. list_sub_agent_types: 列出可用子 Agent 类型
2. dispatch_sub_agent: 派发任务（通过 CustomEvent 传递给前端编排器）
3. get_sub_agent_status: 轮询子 Agent 状态和结果
4. cancel_sub_agent: 取消运行中的子 Agent
```
