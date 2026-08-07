# useTheme 注释

## 职责
Tauri 端主题管理（浅色 / 深色）。模块级单例：读取偏好、应用到 `<html data-theme>`、持久化。

## 设计决策
- **令牌覆盖驱动**：深色不是每个组件各自处理，而是在 `theme.css` 的 `[data-theme="dark"]` 块覆盖全部 CSS 变量——所有组件经 `var()` 引用，切主题即全端生效，零组件改动。
- **偏好优先级**：localStorage 已保存值 > 系统偏好（`prefers-color-scheme`）> 默认浅色。手动切换后写 localStorage，下次启动沿用。
- **初始应用时机**：`useTheme` 模块顶层只计算 `theme` ref；实际写 `html[data-theme]` 在 App.vue `onMounted` 调 `apply()`（避免模块加载时 DOM 未就绪）。
- 切换按钮放在左侧轨道底部（月亮/太阳图标随当前主题互换），弱提示 title 说明。

## 约束
- 新样式一律用令牌变量；新增色值时同步补浅色 + 深色两处。
- 勿在组件内硬编码色值（除品牌渐变等特殊场景）。
