/**
 * ioServices — io 模块依赖注入接口
 * 将 io_export 链从 app 层下沉到 entity-core 时，需要将浏览器副作用（下载）
 * 和 app 层校验（validatePack）剥离为可注入接口，保持 entity-core 的纯逻辑性质。
 */

/** 下载器接口（剥离 document.createElement / URL.createObjectURL 副作用） */
export interface Downloader {
  /** 触发浏览器下载：给定文件名和 Blob 数据 */
  download(filename: string, blob: Blob): void
}

/** 包校验接口（剥离对 coreBackend.validatePack 的直接依赖） */
export interface PackValidator {
  /** 校验 pack JSON 字符串，返回校验报告；返回 null 表示无可用后端 */
  validatePack(packJson: string): Promise<ValidationReport | null>
}

/** 校验报告（与 coreBackend.CoreValidationReport 结构兼容） */
export interface ValidationReport {
  valid: boolean
  errors: Array<{ severity: string; message: string }>
}

/** 应用版本提供者（剥离对 Vite 全局变量 __APP_VERSION__ 的依赖） */
export interface AppVersionProvider {
  getAppVersion(): string
}

/* ─── 默认实现（noop / 降级） ─── */

const noopDownloader: Downloader = {
  download(filename, blob) {
    console.warn(`[io/Downloader] 无可用下载器实现，文件 "${filename}"（${blob.size} bytes）未下载。请通过 registerDownloader 注入浏览器实现。`)
  },
}

const noopPackValidator: PackValidator = {
  async validatePack() {
    return null
  },
}

const defaultAppVersionProvider: AppVersionProvider = {
  getAppVersion() {
    return '0.0.0'
  },
}

/* ─── 注册器 ─── */

let _downloader: Downloader | null = null
let _packValidator: PackValidator | null = null
let _appVersionProvider: AppVersionProvider | null = null

export function registerDownloader(api: Downloader): void {
  _downloader = api
}

export function getDownloader(): Downloader {
  return _downloader ?? noopDownloader
}

export function registerPackValidator(api: PackValidator): void {
  _packValidator = api
}

export function getPackValidator(): PackValidator {
  return _packValidator ?? noopPackValidator
}

export function registerAppVersionProvider(api: AppVersionProvider): void {
  _appVersionProvider = api
}

export function getAppVersionProvider(): AppVersionProvider {
  return _appVersionProvider ?? defaultAppVersionProvider
}
