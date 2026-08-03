/**
 * governor/environment.ts — 环境检测（re-export 自 @worldsmith/governor-core）
 *
 * 核心检测逻辑已下沉到 @worldsmith/governor-core 包。
 * 此文件仅作兼容性 re-export，保持现有 import 路径不变。
 */
export {
  detectEnvironment,
  setEnvironment,
  _resetEnvironmentCache,
} from '@worldsmith/governor-core/environment'
