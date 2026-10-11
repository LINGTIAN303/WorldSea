// 主题管理（Phase 4 从根 src/composables/useTheme.ts 下沉到 entity-core；2026-09-13 收束为主题两轴）
export { useTheme, ACCENT_PRESETS, DEFAULT_ACCENT_ID } from './useTheme'
export type { ThemeDefinition, AccentPreset } from './useTheme'

// 文件系统监听（Phase 5a 从根 src/composables/useFsWatcher.ts 下沉到 entity-core）
export { useFsWatcher } from './useFsWatcher'

// 文件系统项目绑定与导出（Phase 5a 从根 src/composables/useFileSystemProject.ts 下沉到 entity-core）
export { useFileSystemProject } from './useFileSystemProject'

export { useAutoCreateEntity } from './useAutoCreateEntity'
export { useSmartFieldLink } from './useSmartFieldLink'
export { useTypeMapping } from './useTypeMapping'
export { useBidirectional } from './useBidirectional'
export { deduplicateEdges, type MergedEdge } from './useEdgeDedup'
export { useStorageStats, type StorageStats } from './useStorageStats'
export { useOrphanCleanup, type OrphanFile } from './useOrphanCleanup'
export { useUndoRedo, isUndoing, setUndoHistoryProvider } from './useUndoRedo'
export { useEntityImage } from './useEntityImage'
export { useImageResolver, type ImagePersistedEvent, type UseImageResolverOptions, type UseImageResolverReturn } from './useImageResolver'
export { useCascadeDelete } from './useCascadeDelete'
export { useDirtyTracker } from './useDirtyTracker'
export { useTrash } from './useTrash'
export { useArtifacts } from './useArtifacts'
export { useEntityTemplates } from './useEntityTemplates'
export { useAdvancedSearch, type SearchFilter } from './useAdvancedSearch'
export { useVersionSnapshot, type Snapshot } from './useVersionSnapshot'

// Phase 8a: 自动备份（从根 src/composables/useAutoBackup.ts 下沉）
export { useAutoBackup } from './useAutoBackup'
