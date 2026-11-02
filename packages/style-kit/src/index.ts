export * from './packs'
export * from './contract'
export { applyPersistedStyle, useStyle } from './composables/useStyle'
export type { GlassVariant } from './composables/useStyle'
export {
  applyPersistedBackground, useBackground,
  normalizeTargetConfig, normalizeGlobalConfig, normalizeProjectConfig, migrateV1Config,
  BACKGROUND_KEY, BACKGROUND_V1_KEY, BACKGROUND_TARGETS, BACKGROUND_THEMES, BACKGROUND_TARGET_CAPS,
  BACKGROUND_DEFAULTS,
} from './composables/useBackground'
export type {
  BackgroundFit, FocusStep,
  BackgroundTarget, BackgroundTheme, BackgroundScope, BackgroundImageRef,
  BackgroundTargetConfig, BackgroundGlobalConfig, BackgroundProjectConfig,
} from './composables/useBackground'
