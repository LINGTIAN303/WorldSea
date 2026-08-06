# orchestrator/nodes/plan-node.ts 详细注释

> 来源：`packages/agent-core/src/orchestrator/nodes/plan-node.ts`
> 说明：本文件为 agent-core PlanNode 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-27 行）

```
/**
 * PlanNode — Plan-and-Execute 模式的计划生成节点
 *
 * 设计理念：
 * - 单次 execute = 一次 backend.prompt 调用 = 生成完整计划
 * - 要求 LLM 输出 JSON 数组格式（[{title, description}, ...]）
 * - 解析后写入 state.plan，发射 plan_created 事件
 * - 节点本身不循环，执行完毕返回 'done'
 *
 * JSON 格式约定：
 * ```json
 * [
 *   { "title": "步骤标题", "description": "步骤描述" },
 *   ...
 * ]
 * ```
 *
 * 容错策略：
 * 1. 直接 JSON.parse
 * 2. 失败则用正则提取首个 [...] 块再 parse
 * 3. 仍失败则返回 error（可由自定义 parsePlan 回调覆盖）
 *
 * 与 ExecuteNode 的协作：
 * - PlanNode 生成计划 → ExecuteNode 逐步执行
 * - 编排图边：PlanNode → ExecuteNode（无条件）
 * - ExecuteNode 完成一项后 → 条件边回到自身（还有 pending）或结束
 */
```
