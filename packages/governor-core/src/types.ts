/**
 * @worldsea/governor-core — 调控器类型定义
 *
 * 三维度环境模型 + 能力标签 + 模块描述符 + 调控器 API 契约。
 * 纯类型与逻辑，不依赖 Vue/Pinia，可供主应用和 Agent 包共享。
 */

/* ════════════════════════════════════════
   环境维度 1：生命周期阶段
   ════════════════════════════════════════ */

export type LifecyclePhase = 'development' | 'production'

/* ════════════════════════════════════════
   环境维度 2：宿主形态
   ════════════════════════════════════════ */

export type RuntimeHost = 'desktop' | 'browser' | 'terminal' | 'cloud'

/* ════════════════════════════════════════
   环境维度 3：能力后端
   ════════════════════════════════════════ */

export type CapabilityBackend = 'tauri' | 'wasm' | 'js-fallback'

/* ════════════════════════════════════════
   能力标签
   ════════════════════════════════════════ */

export type CapabilityTag =
  | 'fs'
  | 'db'
  | 'network'
  | 'worker'
  | 'gpu'
  | 'tauri'
  | 'wasm'
  | 'native-algo'
  | 'ui-render'
  | 'canvas'
  | 'llm-provider'
  | 'embedding'
  | 'mcp'
  | 'heavy-cpu'

/* ════════════════════════════════════════
   环境对象
   ════════════════════════════════════════ */

export interface Environment {
  phase: LifecyclePhase
  host: RuntimeHost
  backend: CapabilityBackend
  capabilities: ReadonlySet<CapabilityTag>
}

/* ════════════════════════════════════════
   模块依赖
   ════════════════════════════════════════ */

export interface ModuleDependency {
  moduleId: string
  version?: string
  requiredTypes?: string[]
  optional?: boolean
}

/* ════════════════════════════════════════
   模块优先级
   ════════════════════════════════════════ */

export type ModulePriority = 'critical' | 'normal' | 'lazy'

/* ════════════════════════════════════════
   模块描述符
   ════════════════════════════════════════ */

export interface ModuleDescriptor {
  id: string
  name: string
  version: string
  requires?: CapabilityTag[]
  hosts?: RuntimeHost[]
  phase?: LifecyclePhase[]
  dependencies?: ModuleDependency[]
  priority: ModulePriority
  activate: (api: GovernorAPI) => Promise<void> | void
  deactivate?: () => Promise<void> | void
  source?: 'builtin' | 'local' | 'remote'
  defaultActive?: boolean
  icon?: string
  description?: string
}

/* ════════════════════════════════════════
   调控器 API
   ════════════════════════════════════════ */

export interface GovernorAPI {
  readonly module: { id: string; name: string; version: string }
  readonly env: Environment
  hasCapability(tag: CapabilityTag): boolean
  registerEntityV2(params: {
    type: string
    label: string
    icon?: string
    traits: unknown[]
    ownFields: unknown[]
    facets?: string[]
  }): void
  registerFacet(facet: unknown): void
  registerRelationV2(schema: unknown): void
  registerView(view: unknown): void
  registerNodeType(nodeType: unknown): void
  registerWorkflowTemplate(template: unknown): void
  registerHook(name: string, fn: Function): void
  getEntities(type?: string): Promise<unknown[]>
  getEntity(id: string): Promise<unknown>
  getRelations(filter?: { type?: string; sourceId?: string; targetId?: string }): Promise<unknown[]>
}

/* ════════════════════════════════════════
   激活结果与启动报告
   ════════════════════════════════════════ */

export interface ActivationResult {
  success: boolean
  module: ModuleDescriptor
  error?: string
  skipped?: boolean
  reason?: string
}

export interface BootReport {
  activated: string[]
  failed: Array<{ id: string; error: string; priority: ModulePriority }>
  skipped: Array<{ id: string; reason: string }>
  duration: number
  hasCriticalFailure: boolean
}

/* ════════════════════════════════════════
   模块运行时状态
   ════════════════════════════════════════ */

export interface ModuleInfo {
  id: string
  name: string
  version: string
  priority: ModulePriority
  source?: 'builtin' | 'local' | 'remote'
  active: boolean
}

export interface ModuleFailure {
  id: string
  name: string
  priority: ModulePriority
  error: string
  timestamp: number
}

/* ════════════════════════════════════════
   调控器核心接口
   ════════════════════════════════════════ */

export interface Governor {
  getEnvironment(): Environment
  hasCapability(tag: CapabilityTag): boolean
  register(descriptor: ModuleDescriptor): void
  registerAll(descriptors: ModuleDescriptor[]): void
  activate(id: string): Promise<ActivationResult>
  deactivate(id: string): Promise<void>
  isActive(id: string): boolean
  getModule(id: string): ModuleDescriptor | undefined
  getAllModules(): ModuleDescriptor[]
  boot(): Promise<BootReport>
  getActiveModules(): ModuleInfo[]
  getFailedModules(): ModuleFailure[]
  getInactiveModules(): ModuleInfo[]
  /** 获取因环境不匹配而跳过的模块（含跳过原因） */
  getSkippedModules(): Array<{ id: string; reason: string }>
}

/* ════════════════════════════════════════
   调控器创建选项
   ════════════════════════════════════════ */

export interface GovernorOptions {
  environment?: Environment
  activeModuleIds?: string[]
  verbose?: boolean
  /**
   * API 工厂函数，为每个模块创建 GovernorAPI。
   * 主应用传入 createGovernorAPI（依赖 Vue/Pinia），
   * Agent 包默认返回空对象（无 UI 依赖）。
   */
  apiFactory?: (moduleId: string, moduleName: string, moduleVersion: string, env: Environment) => GovernorAPI
}
