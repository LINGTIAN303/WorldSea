/**
 * io 模块 barrel 导出
 *
 * Phase 8a：io_export 链从根 src/core/ 下沉到 entity-core/core/io/
 */

// WorldSmithPack 类型与注册表
export {
  serializerRegistry,
  SerializerRegistry,
  PACK_VERSION,
} from './WorldSmithPack'
export type {
  WorldSmithManifest,
  WorldSmithPack,
  ImportReport,
} from './WorldSmithPack'

// PackageBuilder
export { PackageBuilder } from './PackageBuilder'
export type { PackageManifest } from './PackageBuilder'

// ExportController
export {
  ExportController,
  defaultFormatEncoder,
} from './ExportController'
export type {
  FormatEncoder,
  HtmlExportOptions,
} from './ExportController'

// ImportController
export {
  ImportController,
  importController,
} from './ImportController'

// io_export 编排层
export {
  getExportController,
  getImportController,
  exportData,
  parseImportData,
  importToDb,
} from './io_export'
export type { ExportData } from './io_export'

// DI 服务接口
export {
  registerDownloader,
  getDownloader,
  registerPackValidator,
  getPackValidator,
  registerAppVersionProvider,
  getAppVersionProvider,
} from './ioServices'
export type {
  Downloader,
  PackValidator,
  ValidationReport,
  AppVersionProvider,
} from './ioServices'
