# usePlanRust.ts 详细注释文档（tauri 前端）

> 来源：`apps/tauri/src/agent/composables/usePlanRust.ts`
> 对应：Rust 编排图（Plan→Execute→[Reflection→Refine]）的 Tauri 前端适配器
> 本次交付（2026-08-19）：为 3/4/5 编排模式提供前端 UI 触发入口

## 模块职责一句话

usePlanRust 是模块级单例 composable：封装 `orchestrator_run_plan` Tauri 命令触发编排图，监听 `agent:event:reflection:{session_id}` 评审事件，暴露运行状态、结果与评审历史，供 PlanPanel.vue 驱动编排 UI。

## 职责拆分

- **触发编排**：`runPlan(input, options)` → `invoke('orchestrator_run_plan', { sessionId, input, options })`
- **监听评审**：`setupReflectionListener(sessionId)` 幂等监听 `agent:event:reflection:{session_id}`，把每轮 `ReflectionResult` push 进 `reflections`
- **状态暴露**：`running` / `error` / `lastResult` / `reflections`（均 readonly）
- **计划步骤进度**：复用现有 `agent:event:plan_created/plan_update` 通道（useAgentRust 已驱动 usePlanStore / PlanPanel），不重复实现

## 类型对齐（与后端）

| 前端类型 | 后端对应 |
|------|------|
| `PlanRunOptions` | agent-commands::PlanExecuteOptions（camelCase 序列化：refine/maxItems/maxRefineIterations） |
| `OrchestratorResult` | agent-runtime::OrchestratorResult（status 为 snake_case，含 finalMessage/iterations/error/finalState） |
| `ReflectionResultPayload` | agent-runtime::ReflectionResult（target/score/issues/suggestions/iteration） |
| `ReflectionIssue` | agent-runtime::ReflectionIssue（severity/description） |

## 会话绑定

- 复用 `useAgentRust()` 的模块级单例 `currentSessionId`（同一 ref 引用）
- `runPlan` 校验：无活动会话时报错「无活动会话，请先新建或切换会话」
- **已知取舍**：`reflections` 为单桶数组，跨会话会覆盖（按 session 分桶待后续实现）

## 错误处理（实测修复）

- **显式展示 `result.error`**：编排图"完成但内部失败"（如计划解析失败 / LLM 调用失败）时
  Tauri invoke 不抛错（返回 OrchestratorResult），若不处理会静默失败。
  本适配器在拿到 result 后检查 `result.error` 并写入 `error.value`（"编排完成但出错：..."）
- **invoke 抛错**：catch 后亦写入 `error.value`
- 每次 `runPlan` 前重置 `error / lastResult / reflections`，避免旧失败残留

## 事件通道

- `agent:event:reflection:{session_id}`：后端 Tauri 事件桥转发 `ReflectionResult`
- `agent:event:plan_created/plan_update/plan_replanned:{session_id}`：计划进度（useAgentRust 处理）

## 使用示例（PlanPanel.vue）

```ts
const { running, error, reflections, runPlan } = usePlanRust()

// refine=true：Plan→Execute→Reflection⇄Refine
await runPlan('为王国设计三条贸易路线', { refine: true })
```

## 真实链路验证

已用真实 DeepSeek 桌面端验证：
- refi=false：9 步计划生成 + 逐步执行 + `<new_tasks>` 动态追加
- refine=true：8 步计划 + 逐步执行 + Reflection 评审 95 分收敛，策理面板显示「自我评审 1 轮」