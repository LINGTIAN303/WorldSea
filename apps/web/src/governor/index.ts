/**
 * governor/index.ts — 调控器包入口（Web 端迁移版）
 *
 * P3-W3 从根 src/governor/index.ts 迁移，统一导出调控器的所有公开 API。
 */
export type {
  LifecyclePhase,
  RuntimeHost,
  CapabilityBackend,
  CapabilityTag,
  Environment,
  ModuleDependency,
  ModulePriority,
  ModuleDescriptor,
  GovernorAPI,
  ActivationResult,
  BootReport,
  ModuleInfo,
  ModuleFailure,
  Governor,
  GovernorOptions,
} from './types'

export {
  detectEnvironment,
  setEnvironment,
  _resetEnvironmentCache,
} from './environment'

export {
  isVersionCompatible,
  checkEnvironmentMatch,
  resolveDependencies,
  ModuleRegistry,
} from './registry'

export {
  createGovernor,
  initGovernor,
  getGovernor,
  _resetGovernor,
} from './governor'

export { createGovernorAPI } from './api'

export {
  officialPluginToDescriptor,
  officialPluginsToDescriptors,
  customModuleToDescriptor,
  customModulesToDescriptors,
  setPluginCapabilities,
  getPluginCapabilities,
} from './adapters'
