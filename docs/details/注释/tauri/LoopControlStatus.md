# LoopControlStatus.vue 详细注释文档（tauri）

> 来源：`apps/tauri/src/agent/components/LoopControlStatus.vue` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 2-22 行）

# LoopControlStatus — Loop Engineering 实时状态条

迭代 29 新增。展示当前会话绑定的 loop_control 控制器（`lc_{sessionId}`）的
实时运行状态，让 Loop Controller（速率限制 / 重试 / 软超时 / 看门狗）对用户可见。

## 数据来源

- `useAgentRust().currentSessionId`：定位当前会话 → 任务 ID `lc_{sessionId}`
- `useLoopControlRust().tasks`：任务响应式状态（计数器 + 事件历史）
- `getStatus` 轮询：每 2s 刷新计数（turns / toolCalls / tokens / elapsedMs）

## 展示内容

- 计数条：turns / toolCalls / tokens / 已运行时长
- 状态徽标：限流（红）/ 重试（琥珀）/ 软超时（橙）/ 看门狗（idle 橙、dead 红）/ 已恢复（绿）
- 最近事件（最多 4 条），弱提示、不打断对话

## 设计原则

- 只读展示，不提供任何控制入口（手动命令由命令层/未来 UI 提供）
- 无活跃事件时仅显示计数，保持极简；有告警事件时叠加彩色徽标
- 弱提示优先：事件以徽标 + 文案呈现，不弹窗、不阻塞
