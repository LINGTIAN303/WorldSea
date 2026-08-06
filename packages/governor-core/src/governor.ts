/** 调控器核心实现（工厂 + 激活/停用 + 批量启动），详细见 docs/details/注释/packages/governor-core/governor.md */
import type {
  Governor,
  GovernorOptions,
  Environment,
  CapabilityTag,
  ModuleDescriptor,
  ModulePriority,
  ActivationResult,
  BootReport,
  ModuleInfo,
  ModuleFailure,
  GovernorAPI,
} from './types'
import { detectEnvironment } from './environment'
import { ModuleRegistry, checkEnvironmentMatch, resolveDependencies } from './registry'

/* ════════════════════════════════════════
   默认 API 工厂（空实现）
   ════════════════════════════════════════ */

/**
 * 默认 apiFactory：返回空 GovernorAPI。
 *
 * 适用于 Agent 包等无 UI 依赖的场景。
 * 模块 activate 函数应自包含，不依赖 GovernorAPI 的注册方法。
 */
function defaultApiFactory(
  moduleId: string,
  moduleName: string,
  moduleVersion: string,
  env: Environment,
): GovernorAPI {
  return {
    module: { id: moduleId, name: moduleName, version: moduleVersion },
    env,
    hasCapability(tag: CapabilityTag): boolean {
      return env.capabilities.has(tag)
    },
    registerEntityV2() {},
    registerFacet() {},
    registerRelationV2() {},
    registerView() {},
    registerNodeType() {},
    registerWorkflowTemplate() {},
    registerHook() {},
    async getEntities() { return [] },
    async getEntity() { return null },
    async getRelations() { return [] },
  }
}

/* ════════════════════════════════════════
   调控器实现
   ════════════════════════════════════════ */

/** 创建调控器实例（选项语义见文档），详细见 docs/details/注释/packages/governor-core/governor.md */
export function createGovernor(options: GovernorOptions = {}): Governor {
  const env: Environment = options.environment ?? detectEnvironment()
  const verbose = options.verbose ?? (env.phase === 'development')
  const apiFactory = options.apiFactory ?? defaultApiFactory

  // 内部状态
  const registry = new ModuleRegistry()
  const activeModules = new Set<string>()
  const failures: ModuleFailure[] = []
  const skipReasons = new Map<string, string>()

  /* ── 日志辅助 ── */
  function log(...args: unknown[]) {
    if (verbose) console.log('[Governor]', ...args)
  }
  function warn(...args: unknown[]) {
    console.warn('[Governor]', ...args)
  }

  /* ── 环境查询 ── */
  function getEnvironment(): Environment {
    return env
  }
  function hasCapability(tag: CapabilityTag): boolean {
    return env.capabilities.has(tag)
  }

  /* ── 模块注册 ── */
  function register(descriptor: ModuleDescriptor): void {
    if (registry.has(descriptor.id)) {
      warn(`模块 "${descriptor.id}" 已注册，将被覆盖`)
    }
    registry.register(descriptor)
    log(`已注册模块: ${descriptor.id} (${descriptor.priority})`)
  }

  function registerAll(descriptors: ModuleDescriptor[]): void {
    for (const desc of descriptors) register(desc)
  }

  function getModule(id: string): ModuleDescriptor | undefined {
    return registry.get(id)
  }

  function getAllModules(): ModuleDescriptor[] {
    return registry.getAll()
  }

  /* ── 单模块激活 ── */
  /** 激活单个模块（5 步流程见文档），详细见 docs/details/注释/packages/governor-core/governor.md */
  async function activate(id: string): Promise<ActivationResult> {
    const descriptor = registry.get(id)
    if (!descriptor) {
      return {
        success: false,
        module: { id, name: id, version: '', priority: 'normal', activate: async () => {} },
        error: `模块 "${id}" 未注册`,
      }
    }

    // 已激活则跳过
    if (activeModules.has(id)) {
      return { success: true, module: descriptor }
    }

    // 环境匹配检查
    const match = checkEnvironmentMatch(descriptor, env)
    if (!match.matched) {
      skipReasons.set(id, match.reason)
      return {
        success: false,
        module: descriptor,
        skipped: true,
        reason: match.reason,
      }
    }

    // 通过 apiFactory 创建 GovernorAPI 并激活
    try {
      const api = apiFactory(descriptor.id, descriptor.name, descriptor.version, env)
      log(`激活中: ${descriptor.id}`)
      await descriptor.activate(api)
      activeModules.add(id)
      log(`已激活: ${descriptor.id}`)
      return { success: true, module: descriptor }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      const failure: ModuleFailure = {
        id,
        name: descriptor.name,
        priority: descriptor.priority,
        error: errorMsg,
        timestamp: Date.now(),
      }
      failures.push(failure)
      warn(`激活失败: ${descriptor.id} - ${errorMsg}`)
      return {
        success: false,
        module: descriptor,
        error: errorMsg,
      }
    }
  }

  /* ── 单模块停用 ── */
  async function deactivate(id: string): Promise<void> {
    const descriptor = registry.get(id)
    if (!descriptor) {
      warn(`停用失败：模块 "${id}" 未注册`)
      return
    }
    if (!activeModules.has(id)) {
      return
    }

    try {
      if (descriptor.deactivate) {
        await descriptor.deactivate()
      }
      activeModules.delete(id)
      log(`已停用: ${id}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      warn(`停用失败: ${id} - ${errorMsg}`)
      // 停用失败仍从激活集合移除，避免状态不一致
      activeModules.delete(id)
    }
  }

  function isActive(id: string): boolean {
    return activeModules.has(id)
  }

  /* ── 批量启动 ── */
  /**
   * 按优先级分批 + 依赖拓扑排序自动激活所有可激活模块。
   */
  async function boot(): Promise<BootReport> {
    const startTime = Date.now()
    const activated: string[] = []
    const failed: Array<{ id: string; error: string; priority: ModulePriority }> = []
    const skipped: Array<{ id: string; reason: string }> = []
    let hasCriticalFailure = false

    // 用户配置过滤
    const activeIds = options.activeModuleIds
    function shouldAutoActivate(desc: ModuleDescriptor): boolean {
      if (!activeIds || activeIds.length === 0) {
        // 无配置时，只激活 defaultActive !== false 的模块
        return desc.defaultActive !== false
      }
      // 有配置时，激活配置中包含的模块
      return activeIds.includes(desc.id)
    }

    // 按优先级分批
    const priorities: ModulePriority[] = ['critical', 'normal', 'lazy']

    for (const priority of priorities) {
      // 如果 critical 批次已失败，中止后续批次
      if (hasCriticalFailure) {
        log(`critical 失败，跳过 ${priority} 批次`)
        break
      }

      // 收集本批模块（经用户配置过滤）
      const batchModules = registry
        .getByPriority(priority)
        .filter(shouldAutoActivate)

      if (batchModules.length === 0) continue

      // 拓扑排序
      const { sorted, missing, circular, versionMismatches } = resolveDependencies(batchModules)

      // 记录依赖问题（不阻止激活，仅警告）
      if (missing.length > 0) {
        warn(`[${priority}] 依赖缺失:`, missing)
      }
      if (circular.length > 0) {
        warn(`[${priority}] 循环依赖:`, circular)
      }
      if (versionMismatches.length > 0) {
        for (const vm of versionMismatches) {
          warn(`[${priority}] 版本不兼容: ${vm.moduleId} 需要 ${vm.depId}@${vm.required}，但安装的是 ${vm.depId}@${vm.installed}`)
        }
      }

      // 按拓扑顺序激活
      // sorted 中可能不包含所有模块（循环依赖的会被排除），补充激活
      const orderedIds = [...sorted, ...batchModules.map(m => m.id).filter(id => !sorted.includes(id))]

      for (const id of orderedIds) {
        const result = await activate(id)

        if (result.success) {
          activated.push(id)
        } else if (result.skipped) {
          skipped.push({ id, reason: result.reason || '环境不匹配' })
        } else {
          // 激活失败
          failed.push({
            id,
            error: result.error || '未知错误',
            priority,
          })

          // critical 失败则中止
          if (priority === 'critical') {
            hasCriticalFailure = true
            warn(`critical 模块 "${id}" 失败，中止后续启动`)
            break
          }
          // normal/lazy 失败继续
        }
      }
    }

    const duration = Date.now() - startTime
    log(`启动完成: ${activated.length} 激活, ${failed.length} 失败, ${skipped.length} 跳过, 耗时 ${duration}ms`)

    return {
      activated,
      failed,
      skipped,
      duration,
      hasCriticalFailure,
    }
  }

  /* ── 状态查询 ── */
  function getActiveModules(): ModuleInfo[] {
    return registry
      .getAll()
      .filter(m => activeModules.has(m.id))
      .map(m => ({
        id: m.id,
        name: m.name,
        version: m.version,
        priority: m.priority,
        source: m.source,
        active: true,
      }))
  }

  function getFailedModules(): ModuleFailure[] {
    return [...failures]
  }

  function getInactiveModules(): ModuleInfo[] {
    return registry
      .getAll()
      .filter(m => !activeModules.has(m.id))
      .map(m => ({
        id: m.id,
        name: m.name,
        version: m.version,
        priority: m.priority,
        source: m.source,
        active: false,
      }))
  }

  function getSkippedModules(): Array<{ id: string; reason: string }> {
    return Array.from(skipReasons.entries()).map(([id, reason]) => ({ id, reason }))
  }

  return {
    getEnvironment,
    hasCapability,
    register,
    registerAll,
    activate,
    deactivate,
    isActive,
    getModule,
    getAllModules,
    boot,
    getActiveModules,
    getFailedModules,
    getInactiveModules,
    getSkippedModules,
  }
}

/* ════════════════════════════════════════
   全局调控器实例（单例）
   ════════════════════════════════════════ */

let globalGovernor: Governor | null = null

/**
 * 初始化全局调控器实例。
 * 应在应用启动时（main.ts）调用一次。
 */
export function initGovernor(options: GovernorOptions = {}): Governor {
  if (globalGovernor) {
    console.warn('[Governor] 全局实例已存在，将被覆盖')
  }
  globalGovernor = createGovernor(options)
  return globalGovernor
}

/**
 * 获取全局调控器实例。
 * 必须先调用 initGovernor()。
 */
export function getGovernor(): Governor {
  if (!globalGovernor) {
    throw new Error('[Governor] 全局实例未初始化，请先调用 initGovernor()')
  }
  return globalGovernor
}

/**
 * 重置全局调控器（仅用于测试）。
 * @internal
 */
export function _resetGovernor(): void {
  globalGovernor = null
}
