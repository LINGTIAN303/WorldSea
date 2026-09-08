/**
 * @worldsea/shared-ui — bubbles 系列（消息气泡 / 深度消息区）
 *
 * 从 `apps/web/src/agent/message-list` 迁移而来。
 * 字体 / 活动日志 / 头像 / 导出等 Web 端依赖统一通过 `useAgentUiDeps()` 注入式获取。
 *
 * Phase 4：已移除模式专属导出（AgentMessageBody/DeepMessageArea/NormalMessageBubble/
 * useAgentRenderPlan/deepPhases），保留供群聊/私聊链路的复用资产。
 */
export { default as MessageBlocks } from './MessageBlocks.vue'
// 代码语法高亮（Prism 轻量）：副作用 import 注入高亮器，须在使用前加载
import './codeHighlight'
export { useMarkdownRender, handleCodeCopyClick, renderMarkdownHtml, stripJsonBlocks } from './useMarkdownRender'
export { highlightCode } from './codeHighlight'
export { useMessageExport } from './useMessageExport'
export { useThinkingFold } from './useThinkingFold'
export { useMessageActions } from './useMessageActions'
export { formatTime, formatActivityTime } from './format'
export { getToolLabel, TOOL_LABELS } from './toolLabels'
export type * from './types'