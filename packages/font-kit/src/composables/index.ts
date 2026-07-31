export { useFontRegistry } from './useFontRegistry'
export type { FontEntry as FontEntry_composable, FontQuery, FontSource, UseFontRegistryReturn } from './useFontRegistry'

export { useFontRenderer } from './useFontRenderer'
export type { TextRenderOptions, ImageFormat, RenderResult, UseFontRendererReturn } from './useFontRenderer'

export { useFontPack } from './useFontPack'
export type { WsFontPackInput, WsFontManifest, UseFontPackReturn } from './useFontPack'

export { useSystemFonts } from './useSystemFonts'
export type { SystemFontInfo, UseSystemFontsReturn } from './useSystemFonts'

// Phase 8b: 字体预设管理（从根 src/composables/useFontPresets.ts 下沉）
export { useFontPresets, FONT_PRESETS } from './useFontPresets'
export type { FontPresetEntry } from './useFontPresets'

// Phase 8b: 字体引导（从根 src/composables/useFontBootstrap.ts 下沉）
export { useFontBootstrap } from './useFontBootstrap'
