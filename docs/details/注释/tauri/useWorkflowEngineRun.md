# useWorkflowEngineRun.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/plugins/workflow/composables/useWorkflowEngineRun.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 6-21 行）

useWorkflowEngineRun — 直接 Dispatch 兜底通道的运行控制器

用途（P0-1-B1）：
  绕过 Agent 编排，直接通过 Rust Workflow 引擎 dispatch 一个 workflow，
  在 ExecutionPanel 中显示"Engine 通道"，与"Agent 通道"并列。

工作机制：
  1. start() 调用 workflow_run 拿到 run_id
  2. 监听 Tauri 事件 workflow:dispatch（节点派发）+ workflow:progress（节点进度）
  3. 同时用 setInterval 轮询 workflow_status 兜底（防止事件丢失）
  4. 终态（completed/failed/cancelled）自动停止轮询

注意：本通道仅用于"显示"，不在前端拦截节点回调（节点回调由 Rust 端
executor 自行处理；前端只展示状态）。
