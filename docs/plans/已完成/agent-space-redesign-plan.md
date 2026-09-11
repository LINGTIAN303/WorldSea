# Agent 空间重构实现计划

status: 已完成
日期: 2026-08-09

## 依据

- 视觉稿：[docs/重构视觉稿/agent-space-redesign-v1.html](../../重构视觉稿/agent-space-redesign-v1.html)（已认可，双线分隔已补充）
- 已确认决策：模型 B 三区重组 / 执行轨迹入右侧执行面板 / 设置纵向分组导航
- 项目规则：双线分隔（double-rule separation，见 project_memory Hard Constraints 首条）

## 关键前提（实现前已核实）

- 执行轨迹（PhaseSection/SubAgentSection）现渲染于 **AgentWorkspace**（workbench 壳），**AgentSpace**（聊天空间）对话流本就纯净——无需剥离，右侧执行面板直接复用这两个组件。
- 数据源：`useAgentRust.deepSegments / subAgents` 已是模块级单例，ExecPanel 直接消费。

## 任务

- [x] T1: space-store 执行/配置双轨状态模型
  - goal: rightPanel 单槽拆分为「执行面板开关 + 配置抽屉选择器」双轨状态
  - files: apps/tauri/src/space/stores/space-store.ts
  - acceptance: `npm run typecheck` 通过；`execPanelOpen` / `configPanel` 新字段被引用无 TS 报错
  - spec: 重构视觉稿/agent-space-redesign-v1.html（右侧双轨）

- [x] T2: AgentSpace 三区双线分隔布局
  - goal: 主体区三栏（会话/对话/执行）各自独立边框 + 圆角 + 8px 缝隙，透出 app 底色
  - files: apps/tauri/src/space/AgentSpace.vue
  - acceptance: `npm run typecheck` 通过；浏览器渲染三栏独立块 + 缝隙（非共享单线）
  - spec: 项目规则双线分隔

- [x] T3: ExecPanel 执行面板组件（轨迹/活动/计划三 Tab）
  - goal: 新组件 ExecPanel.vue，三 Tab——轨迹（复用 PhaseSection + SubAgentSection）、活动（复用 ActivityLog）、计划（复用 PlanPanel）；轨迹 Tab 消费 useAgentRust deepSegments/subAgents
  - files: apps/tauri/src/space/panels/ExecPanel.vue（新建）
  - acceptance: `npm run typecheck` 通过；浏览器三 Tab 切换渲染正常
  - spec: 重构视觉稿（执行面板三 Tab）

- [x] T4: 顶栏动作分层（SpaceNavbar）
  - goal: 右侧按钮按组重排——对话上下文组（记忆架）+ 运行组（运行面板入口带徽标）+ 设置入口 + 「更多」菜单（工作台抽屉/切换工作台/全局设置收进）；活动日志/任务计划入口移除（并入执行面板）
  - files: apps/tauri/src/space/SpaceNavbar.vue
  - acceptance: `npm run typecheck` 通过；浏览器验证入口分组与「更多」菜单
  - spec: 重构视觉稿（顶栏分层）

- [x] T5: AgentSettingsPanel 纵向分组导航改造
  - goal: 11 面板分三组（模型与推理/能力与工具/边界与个性），横排按钮改左侧纵向分组导航 + 右侧内容区；用量面板恢复显示（embedded 模式也显示）
  - files: apps/tauri/src/agent/AgentSettingsPanel.vue
  - acceptance: `npm run typecheck` 通过；浏览器三组导航切换 + 用量面板可见
  - spec: 重构视觉稿（设置纵向抽屉）

- [x] T6: 配置抽屉接线（设置/记忆/人格）
  - goal: AgentSpace 中 MemoryShelf/PersonaMirror/AgentSettingsPanel 从单槽 rightPanel 改接 configPanel 抽屉（弹出层形态，双线分隔浮层）
  - files: apps/tauri/src/space/AgentSpace.vue
  - acceptance: `npm run typecheck` 通过；浏览器三配置项互斥弹出正常
  - spec: 重构视觉稿（配置弹出层）

- [x] T7: 运行联动（生成中自动打开执行面板）
  - goal: hasActive 触发时打开 execPanel 并切到活动 Tab（迁移原 activityPinned 逻辑）
  - files: apps/tauri/src/space/AgentSpace.vue、apps/tauri/src/space/panels/ExecPanel.vue
  - acceptance: `npm run typecheck` 通过；逻辑迁移无残留 rightPanel activity 引用
  - spec: 原 AgentSpace.vue watch(hasActive) 行为

- [x] T8: 收尾验证
  - goal: 全量 typecheck + cargo check + 浏览器冒烟（顶栏/三区/执行面板/设置抽屉）+ 桌面冒烟清单更新
  - files: 全局
  - acceptance: typecheck 0 错误；cargo check 通过；浏览器关键路径渲染正常
  - spec: 本计划全部任务

## 依赖

- T1 → T2/T3/T4/T5（状态模型先行）
- T2/T3 → T6/T7（布局与组件就位后接线）
- T3 组件内部可并行（轨迹/活动/计划复用既有组件）
