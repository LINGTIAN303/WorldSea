# 编排模式补齐交付清单（Plan-Execute / Reflection / Self-Refine）

> status: 已完成
> 日期：2026-08-19
> 关联：[agent-orchestration-roadmap.md](../plans/agent-orchestration-roadmap.md)（M2 阶段 13 模式闭环）
> 本次补齐 Rust 侧缺失的 3/4/5 三个编排模式 + 前端计划面板 UI，并经真实 DeepSeek 端到端实测。

---

## 一、背景

[agent-orchestration-roadmap.md](../plans/agent-orchestration-roadmap.md) 宣称 M2「13 种模式全部可用」，但实际 Rust 端只落地了 9 个（编排层 ToT/GoT/Multi-Agent/Supervisor/Router 5 节点 + AgentLoop 原子 + ToolBus + Memory + LoopEngineering），**3/4/5（Plan-and-Execute / Reflection / Self-Refine）只有 `NodeType` 枚举、没有节点实现**。

本次交付即补全这 3 个模式 + 前端入口，使 13 模式在 Rust/桌面端真正闭环。

## 二、代码变更清单

### 新增文件（4）

| 文件 | 内容 |
|------|------|
| [crates/agent-runtime/src/plan.rs](../../crates/agent-runtime/src/plan.rs) | PlanNode（计划生成）+ ExecuteNode（逐步执行） |
| [crates/agent-runtime/src/reflection.rs](../../crates/agent-runtime/src/reflection.rs) | ReflectionNode（评审）+ RefineNode（自我优化） |
| [apps/tauri/src/agent/composables/usePlanRust.ts](../../apps/tauri/src/agent/composables/usePlanRust.ts) | 前端编排图适配器（invoke + 评审事件监听） |
| [docs/misc/orchestration-patterns-delivery.md](orchestration-patterns-delivery.md) | 本交付清单 |

### 修改文件（10）

| 文件 | 变更 |
|------|------|
| crates/agent-runtime/src/lib.rs | 注册 `plan`/`reflection` 模块 + 导出类型 |
| crates/agent-runtime/src/agent/mod.rs | AgentLoop 新增 `node_backend()` 访问器 |
| crates/agent-runtime/src/orchestrator.rs | `OrchestratorResult` 加 Serialize；循环检测改动态（无进展才判死循环） |
| crates/agent-runtime/src/event.rs | `OrchestratorEndStatus` 加 Serialize |
| crates/agent-commands/src/lib.rs | `PlanExecuteOptions` + `run_plan_execute` 编排图服务 |
| apps/tauri/src-tauri/src/commands.rs | `orchestrator_run_plan` 命令 + `ReflectionResult` 事件通道 + `ensure_emitter_registered` |
| apps/tauri/src-tauri/src/lib.rs | 注册 `orchestrator_run_plan` 到 invoke_handler |
| apps/tauri/src/agent/panels/PlanPanel.vue | 编排入口 + 自我评审展示区 |
| docs/plans/agent-orchestration-roadmap.md | 状态同步（待办部分） |

## 三、架构与链路

```
PlanNode → ExecuteNode → (可选) ReflectionNode ⇄ RefineNode
（DefaultOrchestrator 图执行器串行调度）
```

- 链路组合：`refine=false` 走 Plan→Execute；`refine=true` 走 Plan→Execute→Reflection⇄Refine
- ExecuteNode 采用**内部循环**（一次 execute 跑完所有 pending 步骤），规避 `MAX_VISIT_PER_NODE` 误报
- 动态调整：ExecuteNode 解析 LLM 输出的 `<new_tasks>` 标记可追加新步骤
- 收敛三条件（RefineNode）：max_iterations / min_score / no_improvement_rounds
- 事件链路：编排事件 → 会话广播器 → Tauri 事件桥 → `agent:event:plan_*` / `agent:event:reflection` → 前端

## 四、关键修复（实测中发现）

1. **循环检测误报** — 原固定阈值(5 次)会误伤 Reflection⇄Refine 合法循环。改为**无进展动态检测**：记录节点连续无进展访问次数，messages/plan/reflections 任一增长即重置；空转累计超阈值(10)才判死循环。
2. **静默失败** — 编排图"完成但内部失败"时 `result.error` 未展示。前端显式反映。
3. **事件桥接缺失** — emitter 仅在 `send_message` 时订阅，新建会话未发消息时编排事件到不了前端。抽 `ensure_emitter_registered` 供两命令共用。

## 五、验证

### 单测 / 编译（全绿）
- agent-runtime：`cargo test` 221 lib + 5 doc（新增 25 个节点/循环检测/编排图集成测试）
- agent-commands：`cargo test` 68 + 1
- Tauri：`cargo check` 通过
- 前端：`vue-tsc --noEmit` 通过

### 真实 DeepSeek 端到端实测（Tauri 桌面）
- **refine=false**：输入"为王国设计三条贸易路线" → PlanNode 生成 9 步计划 → ExecuteNode 逐步执行（9/9）→ **动态追加新步骤**触发 → 计划面板实时更新
- **refine=true**：8 步计划 → 逐步执行（8/8）→ ReflectionNode 评审输出 **95/100** → 收敛 done → 计划面板显示「自我评审 1 轮」+ 3 条问题 + 3 条建议

## 六、遗留风险 / 待办

1. **Refine 迭代循环未实测**：本次评审 95 分一次收敛，未触发 Refine→再评审循环。低分场景的 Refine 迭代需另行构造低质量任务验证。
2. **前端评审事件按 session 单桶累积**：跨会话会覆盖，建议后续按 session 分桶。
3. 详细注释文档（docs/details/注释/agent-runtime/plan.md / reflection.md / usePlanRust.md）待补。

## 七、提交记录

| Commit | 内容 |
|--------|------|
| `2229ef8` | feat(orchestration): 补齐 Plan-Execute/Reflection/Self-Refine 编排模式与计划面板 UI |
| `e2bafce` | fix(tauri): 计划编排链路修复——静默失败提示 + 编排事件桥接 |