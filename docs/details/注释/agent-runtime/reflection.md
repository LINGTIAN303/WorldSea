# reflection.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/reflection.rs`
> 对应模式：#4 Reflection（ReflectionNode）+ #5 Self-Refine（RefineNode）
> 本次交付（2026-08-19）：Rust 侧补齐缺失的 Reflection / Self-Refine 模式节点

## 模块职责一句话

Reflection / Self-Refine 编排模式：ReflectionNode 用 LLM 评审上一条 assistant 输出（多维评分），低于阈值时 continue 到 RefineNode 依据评审反馈修正，再回 ReflectionNode 评审，直至收敛（评分达标 / 达最大轮数 / 连续无改进）。

## 架构与链路

```text
Execute 完成后
   ↓
ReflectionNode.execute
   ├─ 选评审目标（最后一条非空 assistant 消息）
   ├─ 渲染评审 prompt（维度 + 阈值）
   ├─ backend.prompt → LLM 评审 JSON
   ├─ 容错解析 → ReflectionResult（score/issues/suggestions/iteration）
   ├─ 广播 ReflectionResult + 写 system 消息
   └─ score ≥ threshold ? Done : Continue → Refine
       ↓
RefineNode.execute
   ├─ 读取最新 ReflectionResult，判断收敛
   │    ├─ 收敛 → Done（End）
   │    └─ 未收敛 → 渲染修正 prompt → LLM 修正 → 写 assistant 消息
   └─ Continue → reflection_node_id（默认 "reflection"）再评审
```

- 引擎：由 `DefaultOrchestrator`（orchestrator.rs）按图调度；
  链路在 `run_plan_execute` 中 `refine=true` 时装配（Execute → Reflection ⇄ Refine）

## ReflectionNode

- `ReflectionNodeConfig`：`prompt_template`（占位符 `{{input}}` `{{target}}` `{{dimensions}}`）/ `dimensions`（默认 correctness/completeness/style）/ `pass_threshold`（默认 70）/ `record_user_message` / `record_reflection_as_message` / `next_node_id`
- **评审维度默认三项**：正确性（事实/推理/逻辑）、完整性（覆盖需求）、风格（格式/表达）
- **返回值语义**：`score ≥ threshold` → `Done`（通过结束）；否则 `Continue` + `next_node_id` 指向 Refine
- **评审结果双写**：写入 `state.reflections`（供 RefineNode 读取）+ 原始评审 JSON **以 System 角色**追加到 messages（保留在对话历史中；N8 修复 2026-08-28：此前用 Assistant 角色，会让编排 `final_message` 取「最后一条 assistant」时顶替 execute/refine 的面向用户正文成为终稿）

### JSON 容错解析（评审结果）

`extract_json_object` 三级降级解析 LLM 返回的评审 JSON：
1. 整体 `JSON.parse`
2. 提取 ```` ```json ``` ```` 代码块
3. 提取首个 `{...}` 片段

字段规范化：`score`（0-100 整数，非法默认 50）、`issues`（severity 映射 info/warning/error）、`suggestions`（字符串列表）。

## RefineNode

- `RefineNodeConfig`：`prompt_template`（占位符 `{{input}}` `{{target}}` `{{iteration}}` `{{score}}` `{{issues}}` `{{suggestions}}`）/ `max_iterations`（默认 3）/ `min_score`（默认 90）/ `no_improvement_rounds`（默认 2）/ `reflection_node_id`（默认 "reflection"）
- **收敛三条件**（任一满足则 `Done`）：
  1. 迭代轮数达到 `max_iterations`
  2. 最新评分 ≥ `min_score`
  3. 连续 `no_improvement_rounds` 轮评分无提升
- 未收敛：渲染修正 prompt → LLM 输出修正后的完整内容（非 diff）→ 写入 assistant 消息 → `Continue` 回评审节点

## 与 TS 版的差异

| 维度 | TS（packages/agent-core/.../reflection-node.ts / refine-node.ts） | Rust（reflection.rs） |
|------|------|------|
| 收敛判断 | isConverged 回调可注入 | 三条件写死在 is_converged（可自行扩展 RefineNode） |
| Refine 目标 | 优先 reflection.target，回退最后 assistant | 仅 `latestReflection.target` 非空即用，否则回退 last assistant |
| 事件 | reflection_result | 复用 `OrchestratorEvent::ReflectionResult` |
| severity | info/warning/error | 同 |

## 测试覆盖（内嵌 mod tests）

- ReflectionNode：高分 done / 低分 continue 到下一跳 / 无目标 done / 解析失败 error / 代码块解析
- RefineNode：无评审 error / 评分达标收敛 / 达最大轮数收敛 / 未收敛修正并回跳 / 连续无改进收敛
- 组合逻辑与 TS 参考实现对齐，覆盖三条件收敛与迭代跳转

## 前端联动

真实环境里 ReflectionResult 经事件桥转发到 `agent:event:reflection:{session_id}`，
由 `usePlanRust.ts` 监听并推入 `reflections` 数组，PlanPanel.vue「自我评审」区展示
每轮评分 / 问题（severity 标注）/ 建议。已用真实 DeepSeek 验证：8 步计划执行后
评审方案 95 分一次收敛，UI 正确显示「自我评审 1 轮 + 评分 + 问题 + 建议」。