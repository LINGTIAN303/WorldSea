/**
 * A2UI（Agent-to-UI）渲染组件
 *
 * 从 `apps/web/src/agent/a2ui/` 迁移而来，供 Web / Tauri 三端复用。
 * 依据 Rust 端 `A2UIMessage` 事件驱动，渲染 Agent 下发的 UI 画布与组件树。
 */

export { default as A2UIRenderer } from './A2UIRenderer.vue'
export { default as A2UIComponent } from './A2UIComponent.vue'
export { default as A2UIResolvedImage } from './A2UIResolvedImage.vue'