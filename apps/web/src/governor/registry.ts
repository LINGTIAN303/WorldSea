/**
 * governor/registry.ts — 模块注册表（re-export 自 @worldsmith/governor-core）
 *
 * 核心注册表与依赖解析逻辑已下沉到 @worldsmith/governor-core 包。
 * 此文件仅作兼容性 re-export，保持现有 import 路径不变。
 */
export {
  isVersionCompatible,
  checkEnvironmentMatch,
  resolveDependencies,
  ModuleRegistry,
} from '@worldsmith/governor-core/registry'

export type {
  VersionMismatch,
  DependencyResolveResult,
} from '@worldsmith/governor-core/registry'
