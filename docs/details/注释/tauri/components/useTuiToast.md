# TuiToast / useTuiToast 注释

## 职责
Tauri 端全局 Toast 提示系统（弱提示风格）。任何组件 `useTuiToast()` 后调用 `toast.success/info/warn/error(msg)`，消息堆叠在右下角，自动消失可手动关闭。

## 设计决策
- **模块级单例**：`toasts` ref 定义在模块顶层，`useTuiToast()` 返回同一引用——挂载一次 `<TuiToast/>` 后全局生效，无需逐组件传 props。
- **弱提示原则**：安静出现在右下角、不打断操作；类型用左侧 3px 语义色条区分（比整块底色更克制），符合用户「弱提示优于强提示」偏好。
- **玻璃质感**：白色半透明 + `backdrop-filter: blur(16px)`，与弹窗遮罩同语言。
- 默认 3s 自动消失，`duration` 可覆盖（传 0 则常驻，由用户手动关闭）。

## 约束
- 所有瞬态反馈（清空/压缩/删除/引导记录）统一走 toast，勿再散落"几秒后消失"的本地文本状态。
- 错误类用 `toast.error`；操作类用 `toast.info`；成功类用 `toast.success`。
