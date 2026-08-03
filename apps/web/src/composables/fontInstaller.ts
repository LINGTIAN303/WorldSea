/**
 * fontInstaller — 字体安装器（re-export）
 *
 * 实现已下沉到 @worldsmith/font-kit，与根 src/composables/fontInstaller.ts 一致。
 */
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
} from '@worldsmith/font-kit'
export type {
  FontVariantEntry,
  FontLibraryEntry,
  CssFontFaceInfo,
} from '@worldsmith/font-kit'
