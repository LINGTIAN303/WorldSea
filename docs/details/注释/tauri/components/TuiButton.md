# TuiButton 注释

## 职责
Tauri 端统一按钮，消除各视图按钮样式分叉（此前 App/SubAgent/Terminal/Memory 各自手写按钮 CSS）。

## 设计决策
- **变体体系**：primary（主操作）/ secondary（次操作描边）/ ghost（弱操作）/ danger（危险实心）/ danger-ghost（危险描边）。危险操作默认用描边（弱化强提示），hover 才转实心。
- **按压回弹**：`:active` 用 `--ease-spring` 缩放到 0.97，给点击一个克制的"手感"，非生硬变色。
- **尺寸档位** sm（28px，工具栏）/ md（34px，表单）；`loading` 态显示旋转 dots 并禁用。
- 图标经 `icon` prop 前置（内部用 WsIcon），文字用默认插槽。

## 约束
- 新增操作按钮一律用本组件；禁止自写 padding/border 拼按钮（样式已收敛）。
- 语义色只表达状态（danger=删除类），不要用彩色按钮装饰界面。
