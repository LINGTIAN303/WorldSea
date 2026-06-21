/**
 * governor/types.ts — 类型定义（re-export 自 @worldsmith/governor-core）
 *
 * 核心类型已下沉到 @worldsmith/governor-core 包，主应用与 Agent 包共享。
 * 此文件仅作兼容性 re-export，保持现有 import 路径不变。
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
} from '@worldsmith/governor-core/types'
