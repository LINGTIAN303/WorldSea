/**
 * 全局 Window 扩展声明
 *
 * 集中声明 worldsmith 项目注入到 window 上的全局变量类型，
 * 消除散落在源码中的 (window as any).__XXX 模式。
 */

declare global {
  interface Window {
    /** Tauri 内部对象（由 Tauri 运行时注入） */
    __TAURI_INTERNALS__?: unknown
    /** Tauri 旧版全局对象 */
    __TAURI__?: unknown
    /** 子 Agent 注册表（由 useOrchestrator 维护，供 PipelineStepNode 读取） */
    __worldsmith_sub_agents?: Map<string, unknown>
    /** WASM 失败通知回调（由 AppMessageHandler 注册，供 worldsmithCore 调用） */
    __worldsmith_notify_wasm_failure__?: (reason: string) => void
    /** Notebook 列表摘要（调试用，由 NotebookView 注入） */
    __worldsmith_notebook_list__?: unknown
    /** Notebook 搜索摘要（调试用，由 NotebookView 注入） */
    __worldsmith_notebook_search__?: unknown
    /** Mindmap 结构快照（由 useAgentBridge 注入，供外部调试读取） */
    __worldsmith_mindmap_structure__?: unknown
    /** WASM 核心测试键（由 coreBackend 用于检测 WASM 后端可用性） */
    __worldsmith_core_wasm_test__?: unknown
    /** 动态键访问的索引签名兜底（用于运行时键名检测场景） */
    [key: `__worldsmith_${string}`]: unknown
  }
}

export {}
