export { useEntityStore } from './entityStore'
export { useRelationStore } from './relationStore'
export { useFileStore, onFilePersisted } from './fileStore'
export type { FilePersistedEvent } from './fileStore'
export { usePluginStore } from './pluginStore'
export { useTemplateStore, type Template } from './templateStore'
export { useFieldOrderStore } from './fieldOrderStore'
export { useTrashStore, type TrashItem } from './trashStore'
export { useArtifactStore } from './artifactStore'
// 共享 stores（Phase 4 从根 src/stores/ 下沉到 entity-core）
export { useFontStore } from './fontStore'
export type {
  FontLayer,
  FontLayerPref,
  FontPreferences,
} from './fontStore'
export { useUIStore } from './uiStore'
export { useSettingsStore, SPROUT_CATEGORIES, ANIMATION_GROUPS } from './settingsStore'
export type {
  SproutToggle,
  SproutCategory,
  SproutGroup,
  CustomProviderEntry,
} from './settingsStore'

// Phase 8a: personaStore（从根 src/stores/personaStore.ts 下沉）
export { usePersonaStore } from './personaStore'
export type { SavedPersona } from './personaStore'


// B（2026-09-25）：视图可见性判定（侧栏/设置共用；含「清单外 pluginId 视为可见」口径）
export { hasSprout, isViewVisible } from './viewVisibility'
