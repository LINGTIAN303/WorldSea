// ----------------------------------------------------------------------------
// 转发自 @worldsea/ui-kit
// 以下 composables 已下沉到 ui-kit/composables/（为破除跨包循环）
// plugin-sdk 保留 re-export 以维持向后兼容
// ----------------------------------------------------------------------------
export { useConfirm, type ConfirmType } from '@worldsea/ui-kit'
export { useDialog } from '@worldsea/ui-kit'
export { useResizable, getAllPanelWidths, resetPanelWidth, resetAllPanelWidths, PANEL_LABELS, type ResizableOptions } from '@worldsea/ui-kit'
export { useShortcuts, currentSequence, formatKeysForDisplay, formatKeyForDisplay, type ShortcutScope, type ShortcutKind, type ShortcutDef, type ShortcutConflict } from '@worldsea/ui-kit'

// ----------------------------------------------------------------------------
// plugin-sdk 原生（业务逻辑层 composables）
// ----------------------------------------------------------------------------
export { useEntityEdit, type EditFormValues } from './useEntityEdit'
export { useBatchDelete } from './useBatchDelete'
export { useEntityPaging } from './useEntityPaging'
export { useDuplicateNameCheck } from './useDuplicateNameCheck'
export { useConsistencyChecker, type ConsistencyIssue, type ConsistencyCategory } from './useConsistencyChecker'
export { useUndoRedo, isUndoing } from '@worldsea/entity-core/composables'
export { useHighlight, type HighlightOptions } from './useHighlight'
export { useErrorHandler, type ErrorCategory } from './useErrorHandler'
export { useSelectedFollow } from './useSelectedFollow'
