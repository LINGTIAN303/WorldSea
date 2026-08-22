/**
 * @worldsmith/shared-ui — message-list 系列（消息列表展示组件）
 *
 * 从 `apps/web/src/agent/message-list` 迁移而来。
 */
export { default as StreamingPlaceholder } from './StreamingPlaceholder.vue'
export { default as ScrollToBottomButton } from './ScrollToBottomButton.vue'
export { default as MessageListEmpty } from './MessageListEmpty.vue'
export { default as ArchivedSection } from './ArchivedSection.vue'
export { default as DotNav } from './DotNav.vue'
export { default as DeepUserBar } from './DeepUserBar.vue'
export { default as TurnStatus } from './TurnStatus.vue'
export { default as ErrorRows, type ErrorRowItem } from './ErrorRows.vue'
export {
  formatDividerTime,
  truncateText,
  renderFinalOutput,
  renderArchiveSummary,
  findAssistantAfterUserMsg,
  type DisplayItem,
} from './utils'
export { useMessageWindowing } from './useMessageWindowing'
export { useDotAnimation } from './useDotAnimation'