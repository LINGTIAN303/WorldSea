## 迭代主题 21：对话运行轮次展示，补 `getState` 无封装 + 生成中"跑到第几轮"不可见

> 延续"有 API 无入口"模式。`get_state` 命令存在（Hyper Constraints 已封装思路），返回 `AgentStateSnapshot.current_iteration`（ReAct 循环当前迭代次数），但 `useAgentRust` **未封装 `getState`**，对话 UI 生成中只能看到"思考中…"，无法得知 Agent 已执行到第几轮。本轮补齐运行轮次的可见性，契合用户"长任务支持 + 任务流完整展示"偏好。

### 决策点 66：`useAgentRust` 新增 `getState()` 封装，生成中轮询展示「第 N 轮」
**选择**：在 `useAgentRust` 新增 `getState()`（invoke `get_state` 返回 `RustStateSnapshot`），并在返回对象导出。`App.vue` 在生成中（`sending || isStreaming`）用 `setInterval(2s)` 轮询 `getState()` 取 `current_iteration` 存入 `currentIteration` ref，状态栏显示「思考中… 第 N 轮」；生成结束（`send`/`onStop` 完成）清空轮次并停止轮询，`onBeforeUnmount` 兜底清理。
**理由**：`current_iteration` 是 ReAct 多轮工具循环的进度信号，展示它让用户判断 Agent 是否在推进（而非卡死），是"长任务可观测性"的最轻量实现。轮询 2s 基于 `useLongTaskRust` 既有心跳间隔经验，IPC 开销可忽略；仅取迭代数，不把 `messages` 快照写回前端（避免覆盖流式状态）。

### 决策点 67：轮询只读 `current_iteration`，不写回 messages；心跳不纳入本轮
**选择**：轮询回调只更新 `currentIteration`（数字），忽略 snapshot 的 `messages` 字段；`getHeartbeat`（alive/stale/dead）**不纳入本轮**——正常对话非长任务时恒为 alive 价值有限，留待长任务调度器专项（`useLongTaskRust` 已有独立心跳）。
**理由**：避免把服务端 messages 快照盲目写回与流式状态冲突；聚焦"第 N 轮"这一高信噪比信号，避免 UI 塞入低价值心跳。极简 + 弱提示。

### 代价（迭代主题 21）
- Mock 后端下 `current_iteration` 可能恒定（ReAct mock 不真实递增），轮次展示在接入真实 LLM 后才有实际进度意义；UI 链路本身可验证。
- 轮询 2s 会产生周期性 IPC，生成中本就高频交互，开销可忽略；`onBeforeUnmount` 已清理，无泄漏。

## 影响范围（迭代主题 21）
- `apps/tauri/src/agent/composables/useAgentRust.ts`：新增 `getState()` 封装 + 导出。
- `apps/tauri/src/App.vue`：`currentIteration` ref + 生成中轮询 + 状态栏「第 N 轮」+ 清理。
- 后端零改动。

## 验证方式（迭代主题 21）
- `npx vue-tsc --noEmit`（apps/tauri）：通过。
- 后端零改动，agent-commands / tauri `cargo check` 基线保持绿色。
- 浏览器实测：生成中状态栏出现「第 N 轮」并随轮询更新、生成结束清空、无控制台轮询泄漏（真实 LLM 后轮次才真实递增）。

---

