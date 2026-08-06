# orchestrator/nodes/reflection-node.ts 详细注释

> 来源：`packages/agent-core/src/orchestrator/nodes/reflection-node.ts`
> 说明：本文件为 agent-core ReflectionNode 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-32 行）

```
/**
 * ReflectionNode — Reflection 模式的评审节点
 *
 * 设计理念：
 * - 单次 execute = 一次 backend.prompt 调用 = 一次完整评审
 * - 评审目标默认为 state.messages 最后一条 assistant 消息
 * - 输出 JSON 格式评审结果（score/issues/suggestions），写入 state.reflections
 * - 发射 reflection_result 事件（前端可展示评分与问题）
 *
 * 评审维度（默认，可通过 dimensions 配置扩展）：
 * - correctness（正确性）：事实是否准确、逻辑是否自洽
 * - completeness（完整性）：是否覆盖所有需求点
 * - style（风格）：是否符合期望的输出风格
 *
 * JSON 输出格式约定：
 * ```json
 * {
 *   "score": 85,
 *   "issues": [
 *     { "severity": "warning", "description": "问题描述" }
 *   ],
 *   "suggestions": ["改进建议1", "改进建议2"]
 * }
 * ```
 *
 * 与 ReAct 循环集成：
 * - 编排图：ReactNode → 条件边（每 N 轮触发）→ ReflectionNode
 * - ReflectionNode → 条件边（score < threshold 且有改进空间）→ RefineNode/ReactNode（修正）
 * - ReflectionNode → 条件边（score >= threshold 或无 issues）→ 结束
 *
 * 注意：ReflectionNode 本身只负责评审，不负责修正。修正是 RefineNode 的职责（阶段 0.5）。
 */
```
