/**
 * re-export 兼容层 — 实际实现已迁移到 @worldsmith/entity-core/core/io
 * Phase 8a: io 模块下沉
 *
 * 注：原 downloadWS/download 方法依赖浏览器 document/URL API，
 *     下沉后通过 Downloader DI 接口注入（main.ts 中 registerDownloader）
 */
export {
  ExportController,
  defaultFormatEncoder,
} from '@worldsmith/entity-core'
export type {
  FormatEncoder,
  HtmlExportOptions,
} from '@worldsmith/entity-core'
