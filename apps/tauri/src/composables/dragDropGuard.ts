/**
 * 全局文件拖拽兜底（2026-09-17，与 `tauri.conf.json` 的 `dragDropEnabled: false` 配套）
 *
 * 【背景 · 这是本项目在 Windows 上的一个**框架级**事实】
 * Tauri 窗口默认 `dragDropEnabled: true` —— 宿主会在 Windows 上装一个原生 OLE 拖放处理器，
 * **把拖放事件在 webview 看到之前就吃掉**。后果（症状具有极强的辨识度）：
 *   · 起手时光标就是「🚫」
 *   · `dragstart` 会触发，但 **`dragover` / `drop` / `dragleave` 一律不触发**
 *   · 所有基于 HTML5 拖拽的库/交互全部失效（Sortable/vuedraggable、自研 DnD、文件拖入）
 * 官方文档原文：*"Disabling it is required to use HTML5 drag and drop on the frontend on Windows."*
 *
 * 我们已在窗口配置里把它关掉（换来页面内拖拽可用）。**代价**：不再有宿主的文件拖放拦截，
 * 此时把一个文件拖到窗口的**非落点区域**，Chromium 的默认行为是**让 webview 导航到该文件**
 * （表现为整个界面被替换成文件内容）。本模块就是这条兜底。
 *
 * 【兜底策略】只针对**携带 `Files` 的拖拽**在 window 层 `preventDefault`：
 *   · `dragover` 必须 prevent（否则按规范 `drop` 根本不会触发，默认导航照样发生）
 *   · `drop` 再 prevent 掉默认导航
 * 效果：拖入的文件在**非落点区域被静默忽略**；`ChatInput` 之类的自有落点仍在目标阶段先处理，
 * 且它读的是标准的 `dataTransfer.files`（页面 API），不依赖已被关闭的宿主通道。
 *
 * 【代价的边界】关闭宿主通道后**拿不到文件系统路径**（只能读内容）。目前没有代码依赖路径
 * （全仓仅 `ChatInput.vue` 读 `dataTransfer.files`），将来若需要路径，需按 Tauri 的建议
 * 用「透明覆盖窗」方案，而不是把该开关改回 true（改回去会再次压掉全 app 的页面内拖拽）。
 */
/** 这次拖拽是否携带系统文件（`types` 在 dragover 阶段可读，数据不可读） */
export function carriesFiles(dt: DataTransfer | null | undefined): boolean {
  return !!dt && Array.from(dt.types ?? []).includes('Files')
}

export function installFileDragGuard(): void {
  window.addEventListener('dragover', e => {
    if (carriesFiles((e as DragEvent).dataTransfer)) e.preventDefault()
  })
  window.addEventListener('drop', e => {
    if (carriesFiles((e as DragEvent).dataTransfer)) e.preventDefault()
  })
}
