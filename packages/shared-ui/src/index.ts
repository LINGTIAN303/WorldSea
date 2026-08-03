/**
 * @worldsmith/shared-ui — 三端（Web / Tauri / CLI）共享的 Agent UI 组件层
 *
 * 从 `apps/web/src/agent/` 迁移而来，统一通过 `useAgent()` 注入式获取后端。
 * 组件内部对 `@agent/*` 的引用统一替换为 `@worldsmith/agent-runtime/*`。
 */
export * from './agent/blocks/index'
export * from './agent/bubbles/index'
export * from './agent/message-list/index'