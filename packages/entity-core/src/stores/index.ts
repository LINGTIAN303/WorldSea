export { useEntityStore } from './entityStore'
export { useRelationStore } from './relationStore'
export { useFileStore, onFilePersisted } from './fileStore'
export type { FilePersistedEvent } from './fileStore'
export { usePluginStore } from './pluginStore'
export { useTemplateStore, type Template } from './templateStore'
export { useFieldOrderStore } from './fieldOrderStore'
export { useTrashStore, type TrashItem } from './trashStore'
// 共享 stores（Phase 4 从根 src/stores/ 下沉到 entity-core）
export { useFontStore } from './fontStore'
export type {
  FontLayer,
  FontLayerPref,
  FontPreferences,
} from './fontStore'
export { useUIStore } from './uiStore'
export { useSettingsStore } from './settingsStore'
export type {
  PluginToggle,
  CustomProviderEntry,
} from './settingsStore'

// Phase 8a: personaStore（从根 src/stores/personaStore.ts 下沉）
export { usePersonaStore } from './personaStore'
export type { SavedPersona } from './personaStore'

// Phase 8a: customModuleStore（从根 src/stores/customModuleStore.ts 下沉）
export { useCustomModuleStore } from './customModuleStore'
