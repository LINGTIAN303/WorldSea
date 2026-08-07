# TuiModal 注释

## 职责
Tauri 端弹窗基座：统一遮罩、面板、过渡、键盘交互。所有弹窗（模型配置 / 确认框 / 导入导出）都基于本组件。

## 设计决策
- **遮罩模糊 + 缩放/淡入过渡**：`backdrop-filter: blur()` 营造纵深，面板 `translateY(6px) scale(0.98)` 入场，比纯 opacity 更有"浮起"感。
- **Esc 关闭 + 自动聚焦**：打开时监听全局 keydown，Esc 关闭；聚焦面板（tabindex=-1）让键盘用户直接进入弹窗上下文。
- **点击遮罩关闭**（maskClosable 可关）：mousedown.self 只在遮罩本身触发，面板内点击不冒泡误关。
- **宽度档位** sm/md/lg：确认框用 sm，表单用 md，大内容用 lg，层级一致。

## 约束
- 所有弹窗必须经本组件，禁止自建遮罩层（避免 z-index 与视觉分叉）。
- 关闭语义统一 emit `close`；父级控制 `show`（v-model 由调用方显式绑定）。
