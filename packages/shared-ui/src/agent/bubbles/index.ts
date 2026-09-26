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
// 渲染内核 / 复制处理器 / 代码高亮已抽到产品级 `../markdown`（2026-09-27 E7）；此处保持旧调用面
import '../markdown'
export { useMarkdownRender, stripJsonBlocks } from './useMarkdownRender'
export { handleCodeCopyClick, renderMarkdownHtml, highlightCode } from '../markdown'
export { useMessageExport } from './useMessageExport'
export { useThinkingFold } from './useThinkingFold'
export { useMessageActions } from './useMessageActions'
export { formatTime, formatActivityTime } from './format'
export { getToolLabel, TOOL_LABELS } from './toolLabels'
export type * from './types'