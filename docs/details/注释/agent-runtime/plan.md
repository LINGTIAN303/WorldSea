# plan.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/plan.rs`
> 对应模式：#3 Plan-and-Execute（PlanNode + ExecuteNode）
> 本次交付（2026-08-19）：Rust 侧补齐缺失的 Plan-and-Execute 模式节点

## 模块职责一句话

Plan-and-Execute 编排模式：PlanNode 用 LLM 把用户任务分解为结构化计划项（`state.plan`），ExecuteNode 逐项调用 LLM 执行并广播 `PlanStepUpdate`，支持执行中动态追加新任务。

## 架构与链路

```text
用户任务
   ↓
PlanNode.execute
   ├─ 渲染计划 prompt（默认 JSON 数组模板）
   ├─ backend.prompt → LLM 生成计划
   ├─ 容错解析 JSON → Vec<PlanItem>（写入 state.plan）
   └─ 广播 PlanCreated → 返回 Continue 跳转 Execute
       ↓
ExecuteNode.execute（内部循环：一次 execute 跑完所有 pending 步骤）
   ├─ 逐个步骤：in_progress → LLM 执行 → completed output
   ├─ 每项广播 PlanStepUpdate
   ├─ 解析 <new_tasks> 标记 → 动态追加新步骤
   └─ 全部完成 → 无追加则 Done / 有追加则 continue 回自身
```

- 组合链路：`refine=false` 时 ExecuteNode.next_node_id = None（执行完结束）；
  `refine=true` 时 = Some("reflection") 接入 Reflection/Self-Refine（见 reflection.md）
- 引擎：由 `DefaultOrchestrator`（orchestrator.rs）按图调度

## 关键设计：ExecuteNode 为何采用"内部循环"

TS 版 `execute-node.ts` 是**每次 execute 只执行一个步骤 + `continue` 回自身**。
Rust 版改为**一次 execute 跑完所有 pending 步骤**，原因：

- **规避循环误报**：Orchestrator 有循环检测（现为无进展动态检测），若每步一次 execute 回自身，
  单图节点高频自循环增加误判面；内部循环把 N 步 LLM 调用收敛在一次节点执行内
- **前端事件流等价**：每步仍独立 `PlanStepUpdate`，PlanPanel 进度展示无差别
- **next_node_id 语义清晰**：仅 3 种出口——有追加继续回自己 / 无追加走 next / 结束

## PlanNode

- `PlanNodeConfig`：`id` / `name` / `prompt_template`（占位符 `{{input}}` `{{maxItems}}`）/ `max_items`（默认 10）/ `record_user_message` / `next_node_id`
- **JSON 容错解析**（`extract_json_array` 三级降级）：
  1. 整体 `JSON.parse`
  2. 提取 ```` ```json ``` ```` 代码块
  3. 提取首个 `[...]` 片段
- 过滤空标题项；截断到 `max_items`
- 解析失败返回 `NodeResult::error`（前端据此提示"无法解析计划"）

## ExecuteNode

- `ExecuteNodeConfig`：`prompt_template`（占位符 `{{stepTitle}}` `{{stepDescription}}` `{{completedSteps}}` `{{remainingSteps}}`）/ `on_failure`（Skip|Abort）/ `next_node_id`
- **失败策略**：`Skip` 标记该步 Failed 继续（默认）；`Abort` 立即中止返回 error
- **动态追加**：解析 LLM 输出的 `<new_tasks>[...]</new_tasks>` 标记，
  追加 `PlanItem` 并排序号；有新 pending 则 `continue_to(self.id)` 触发下一轮 execute
- 每个步骤写 `plan_step_update` 事件（InProgress → Completed / Failed）

## 共享工具（模块内）

- `extract_code_block` / `extract_json_array` / `extract_json_object`：三级容错 JSON 解析
  （`extract_json_object` 供 reflection.rs 复用评审结果解析）
- `render_template`：占位符替换（`{{input}}` `{{lastMessage}}` + 自定义键）
- `gen_item_id` / `truncate`：ID 生成与长文本截断

## 与 TS 版的差异

| 维度 | TS（packages/agent-core/.../execute-node.ts） | Rust（plan.rs） |
|------|------|------|
| Execute 执行粒度 | 每次一个步骤 + continue 回自身 | 一次 execute 跑完所有 pending（内部循环） |
| 失败策略 | skip / abort / retry | Skip / Abort（未做 retry，避免图循环复杂化） |
| 新任务标记 | `<new_tasks>[...]` 一致 | 一致 |
| JSON 解析 | JSON.parse + 正则回退 | 三级降级（数组/对象通用） |

## 测试覆盖（内嵌 mod tests）

- PlanNode：直接 JSON / 代码块回退 / 解析失败报错 / 空标题过滤与截断
- ExecuteNode：多步串行完成 / 空 plan 报错 / Skip 失败继续 / Abort 中止 / `<new_tasks>` 动态追加
- JSON 工具：数组/对象从裸 JSON 与代码块提取
- 编排图集成：`plan_execute_via_orchestrator_graph` 用 `DefaultOrchestrator` 串联 Plan→Execute 验证链路