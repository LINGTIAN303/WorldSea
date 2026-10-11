/**
 * Tauri 端全局 Window 扩展声明 — Phase 3 端分离
 *
 * 改造自 src/types/global.d.ts：
 * - 保留 __TAURI_INTERNALS__ / __TAURI__ 声明（Tauri 运行时注入）
 * - 保留所有 __worldsea_* 变量
 * - Tauri 端不需要 __worldsea_core_wasm_test__（不使用 WASM 检测），但保留声明以维持兼容
 */

declare global {
  interface Window {
    /** Tauri 内部对象（由 Tauri 运行时注入） */
    __TAURI_INTERNALS__?: unknown
    /** Tauri 旧版全局对象 */
    __TAURI__?: unknown
    /** WASM 失败通知回调（由 AppMessageHandler 注册，供 worldseaCore 调用） */
    __worldsea_notify_wasm_failure__?: (reason: string) => void
    /** Notebook 列表摘要（调试用，由 NotebookView 注入） */
    __worldsea_notebook_list__?: unknown
    /** Notebook 搜索摘要（调试用，由 NotebookView 注入） */
    __worldsea_notebook_search__?: unknown
    /** Mindmap 结构快照（由 useAgentBridge 注入，供外部调试读取） */
    __worldsea_mindmap_structure__?: unknown
    /** WASM 核心测试键（Tauri 端保留声明，但不用于后端检测） */
    __worldsea_core_wasm_test__?: unknown
    /** 动态键访问的索引签名兜底（用于运行时键名检测场景） */
    [key: `__worldsea_${string}`]: unknown
  }
}

export {}
