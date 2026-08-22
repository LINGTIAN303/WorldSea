/**
 * @worldsmith/shared-ui — 三端（Web / Tauri / CLI）共享的 Agent UI 组件层
 *
 * 从 `apps/web/src/agent/` 迁移而来，统一通过 `useAgent()` 注入式获取后端。
 * 组件内部对 `@agent/*` 的引用统一替换为 `@worldsmith/agent-runtime/*`。
 */
// 可访问性降级：减弱动态效果时停用 Agent 组件动画（三端统一）
import './styles/reduced-motion.css'

export * from './agent/blocks/index'
export * from './agent/bubbles/index'
export * from './agent/message-list/index'
export * from './agent/a2ui/index'