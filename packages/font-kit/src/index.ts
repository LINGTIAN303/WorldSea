export {
  type FontSizeToken,
  type FontWeightToken,
  type LineHeightToken,
  type LetterSpacingToken,
  type FontCategoryToken,
  FONT_SIZE_VALUES,
  FONT_WEIGHT_VALUES,
  LINE_HEIGHT_VALUES,
  LETTER_SPACING_VALUES,
  FONT_FAMILY_VALUES,
  CSS_VAR_FONT_SIZE,
  CSS_VAR_FONT_WEIGHT,
  CSS_VAR_LINE_HEIGHT,
  CSS_VAR_LETTER_SPACING,
  CSS_VAR_FONT_FAMILY,
  type FontTokens,
  type SemanticFontTokens,
  COSMIC_FONT_TOKENS,
  cssFontSize,
  cssFontWeight,
  cssLineHeight,
  cssLetterSpacing,
  cssFontFamily,
  pxFontSize,
  numericWeight,
  numericLineHeight,
  cssFontShorthand,
} from './tokens'

export {
  type FontEntryStatus,
  type FontSourceUrl,
  type FontSourceBuffer,
  type FontSource,
  type FontEntry,
  type FontQuery,
  register,
  unregister,
  get,
  list,
  findByFamily,
  query,
  updateStatus,
  setFontFace,
  subscribe,
  clear,
} from './FontRegistry'

export {
  loadFont,
  loadFontFromDB,
  unloadFont,
  persistToDB,
  loadFromDB,
  removeFromDB,
  listDBKeys,
} from './FontLoader'

export {
  type ImageFormat,
  type TextRenderOptions,
  type RenderResult,
  renderText,
  measureText,
  toBlob,
  toDataURL,
  drawImageCover,
  drawImageContain,
  applyTextShadow,
} from './FontRenderer'

export {
  type TextAnimationEffect,
  type AnimatedTextOptions,
  type AnimatedTextFrame,
  type AnimatedTextResult,
  renderAnimatedText,
} from './AnimatedTextRenderer'

export {
  useFontRegistry,
  useFontRenderer,
  useFontPack,
  useSystemFonts,
  useFontPresets,
  useFontBootstrap,
  FONT_PRESETS,
} from './composables'

export type {
  UseFontRegistryReturn,
  UseFontRendererReturn,
  WsFontPackInput,
  WsFontManifest,
  UseFontPackReturn,
  SystemFontInfo,
  UseSystemFontsReturn,
  FontPresetEntry,
} from './composables'

export {
  isTauriAvailable,
  scanSystemFonts,
  readFontFile,
  type SystemFontInfo as TauriSystemFontInfo,
} from './TauriFontBridge'

export {
  WSFONT_VERSION,
  WSFONT_MAGIC,
  WSFONT_EXTENSION,
  type WsFontVariant,
  packWsFont,
  unpackWsFont,
  readWsFontManifest,
  isWsFontFile,
} from './WsFontPack'

export { fontKitDescriptor } from './agent-descriptor'

// Phase 8b: 字体安装器（从根 src/composables/fontInstaller.ts 下沉）
export {
  MAX_FONT_STORAGE,
  resolveFontFamily,
  extractFontUrlsFromCss,
  installFromWsfont,
  installFromRawFont,
  installFromWindfonts,
  installFromZip,
  restoreFromDB,
  removeFontData,
} from './fontInstaller'
export type {
  FontVariantEntry,
  FontLibraryEntry,
  CssFontFaceInfo,
} from './fontInstaller'

// Phase 8b: 字体库 store（从根 src/stores/fontLibraryStore.ts 下沉）
export { useFontLibraryStore } from './stores'
