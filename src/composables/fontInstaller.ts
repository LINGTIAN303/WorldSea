/**
 * fontInstaller — 字体安装器（re-export）
 *
 * Phase 8b：实现已下沉到 @worldsmith/font-kit/fontInstaller.ts
 * 本文件保留向后兼容的 re-export。
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
