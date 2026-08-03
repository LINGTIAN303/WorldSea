/**
 * @worldsmith/shared-ui — bubbles 系列（消息气泡 / 深度消息区）
 *
 * 从 `apps/web/src/agent/message-list` 迁移而来。
 * 字体 / 活动日志 / 头像 / 导出等 Web 端依赖统一通过 `useAgentUiDeps()` 注入式获取。
 */
export { default as DeepMessageArea } from './DeepMessageArea.vue'
export { default as NormalMessageBubble } from './NormalMessageBubble.vue'
export { default as MessageBlocks } from './MessageBlocks.vue'
export { useMarkdownRender } from './useMarkdownRender'
export { useMessageExport } from './useMessageExport'
export { formatTime, formatActivityTime } from './format'
export { DEEP_PHASES, ALL_PHASE_TOOLS, type PhaseGroup } from './deepPhases'
export { getToolLabel } from './toolLabels'
export type * from './types'