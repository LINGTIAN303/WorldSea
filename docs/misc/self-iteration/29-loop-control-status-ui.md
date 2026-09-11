# 迭代 29：Loop Control 实时状态展示 UI

> 状态：执行中
> 决策点：85-86
> 关联：迭代 26/27 已完成"共享 LoopController + 前端会话绑定"，但命令层状态对用户不可见

## 背景

迭代 26-28 打通了 Loop Controller 的完整链路：内建与命令层共享单实例、前端会话绑定
（`lc_{sessionId}`）、宽松配置不误停守护。但桌面端**没有任何 UI 展示 Loop Controller 的
实时状态**——`useLoopControlRust` composable 已具备全部数据（计数器、事件历史、触发状态），
却从未被渲染。用户无法感知速率限制、重试、软超时、看门狗等 Loop Engineering 机制的运行情况。

## 决策点 85：新增只读状态条组件，不提供控制入口

**选择**：新增 `apps/tauri/src/agent/components/LoopControlStatus.vue`，作为对话头部下方的
一条**只读**、极简状态条，实时展示当前会话 loop_control 状态：

- **计数条**：轮次 / 工具调用 / Token / 已运行时长（每 2s `getStatus` 轮询刷新）
- **状态徽标**：限流（红）/ 重试（琥珀）/ 软超时提醒（橙）/ 看门狗空闲（橙）/
  重试耗尽·软超时临界·看门狗失联（红）/ 已恢复（绿）——弱提示、不弹窗、不阻塞
- **触发高亮**：存在非恢复类事件或最近命令错误时，状态条背景微黄提示

**理由**：
- **只读**与"无强制中断"原则一致：状态条只呈现，不注入控制入口；手动控制命令
  （getConfig / resetCounters 等）留给未来专门的配置面板，避免过度设计。
- **极简弱提示**符合项目 UI 偏好（calm、minimal、弱提示优先），事件以彩色徽标呈现，
  不抢对话主视觉。
- 数据完全来自既有 composable（`tasks` 响应式状态 + `getStatus` 轮询 + 事件流累加），
  **零后端改动**，纯前端织入。

## 决策点 86：以当前会话 ID 定位任务，组件自包含

**选择**：组件内部通过 `useAgentRust().currentSessionId` 计算任务 ID `lc_{sessionId}`，
从 `useLoopControlRust().tasks` 取任务状态；不通过 prop 从 App.vue 注入。

**理由**：
- `useAgentRust` / `useLoopControlRust` 均为模块级单例，组件内直接调用即可拿到
  `currentSessionId` 与任务 Map，避免 App.vue 额外透传 prop，组件可独立复用。
- 会话切换时 `currentSessionId` 变化 → `taskState` 计算属性自动切换到新会话的控制器，
  轮询 watch 随之重启（`immediate: true` + 活跃判断），无需额外联动。

## 验证

- `npm run typecheck`（apps/tauri，vue-tsc --noEmit）→ ok，无类型错误
- 纯前端改动，无 Rust / Cargo 影响

## 影响面

- 新增 `apps/tauri/src/agent/components/LoopControlStatus.vue`
- 修改 `apps/tauri/src/App.vue`：import + 在 chat-header 下方挂载 `<LoopControlStatus />`
- 零后端 / 零 composable 改动

## 待办

- 桌面端真实 LLM 冒烟：生成过程中观察状态条计数递增、事件徽标出现（需真实模型，可后置）