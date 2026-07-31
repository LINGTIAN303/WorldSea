// ----------------------------------------------------------------------------
// Re-exports from @worldsmith/ui-kit
// 以下 composables 已下沉到 ui-kit/composables/（Phase 6 跨包循环破除）
// plugin-sdk 保留 re-export 以维持向后兼容
// ----------------------------------------------------------------------------
export { useConfirm, type ConfirmType } from '@worldsmith/ui-kit'
export { useDialog } from '@worldsmith/ui-kit'
export { useResizable, getAllPanelWidths, resetPanelWidth, resetAllPanelWidths, PANEL_LABELS, type ResizableOptions } from '@worldsmith/ui-kit'
export { useShortcuts, formatKeysForDisplay, formatKeyForDisplay, type ShortcutScope, type ShortcutDef, type ShortcutConflict } from '@worldsmith/ui-kit'
export { useSelection, SelectionKey, provideGlobalSelection, type SelectionState } from '@worldsmith/ui-kit'

// ----------------------------------------------------------------------------
// Native to plugin-sdk (业务逻辑层 composables)
// ----------------------------------------------------------------------------
export { useLoading } from './useLoading'
export { useEntityEdit, type EditFormValues } from './useEntityEdit'
export { useBatchDelete } from './useBatchDelete'
export { useDuplicateNameCheck } from './useDuplicateNameCheck'
export { useUndoRedo, isUndoing } from '@worldsmith/entity-core/composables'
export { useHighlight, type HighlightOptions } from './useHighlight'
export { useErrorHandler, type ErrorCategory } from './useErrorHandler'
