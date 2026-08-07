# TuiToast 组件注释

## 职责
TuiToast 是全局 Toast 的渲染器组件，依赖 `useTuiToast` 模块级单例；在 App 根组件挂载一次即可全局生效。

## 设计决策
- **Teleport to body**：不受组件树/overflow 影响，始终浮在最上层（`--z-toast: 2000`）。
- **TransitionGroup**：多条 toast 堆叠时，入场淡入+上移、离场淡出，堆叠顺序稳定。
- **aria-live="polite"**：屏幕阅读器可感知，但不过度打断。
- 语义色条（left 3px）+ 图标着色区分类型，底色统一玻璃白——弱提示不喧宾夺主。

## 约束
- 只需在根组件挂载一次；调用方仅用 `useTuiToast()`，不直接操作 DOM。
