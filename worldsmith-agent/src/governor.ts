/**
 * worldsmith-agent/src/governor.ts — Agent 包轻量调控器入口
 *
 * 为 Agent 包（Web 端 + CLI 端）提供基于 governor 的模块编排。
 *
 * 与 src/governor 的关系：
 * - 复用 src/governor/types 的类型定义（通过类型导入，无运行时依赖）
 * - 复用 src/governor/registry 的 ModuleRegistry + checkEnvironmentMatch + resolveDependencies
 * - 复用 src/governor/environment 的 detectEnvironment（Web 端）或自定义检测（CLI 端）
 * - 不依赖 Vue/Pinia（terminal 环境无 UI）
 *
 * 使用方式：
 *   import { createAgentGovernor } from 'worldsmith-agent/governor'
 *   const governor = createAgentGovernor()
 *   const report = await governor.boot()
 *   if (report.hasCriticalFailure) {
 *     throw new Error('Agent 启动失败: ' + report.failed.map(f => f.id).join(', '))
 *   }
 */
import type {
  Environment,
  CapabilityTag,
  ModuleDescriptor,
  ModulePriority,
  BootReport,
  ActivationResult,
} from '../../src/governor/types'
import {
  ModuleRegistry,
  checkEnvironmentMatch,
  resolveDependencies,
} from '../../src/governor/registry'
import { detectEnvironment as detectWebEnvironment } from '../../src/governor/environment'
import { agentModules, cliAgentModules, webAgentModules } from './governor-modules'

/* ════════════════════════════════════════
   Agent 环境检测
   ════════════════════════════════════════ */

/**
 * 检测 Agent CLI 运行环境。
 *
 * Agent CLI 运行在 Node.js 环境（terminal 宿主），
 * 能力后端为 js-fallback（无 WASM/Tauri）。
 *
 * 与 src/governor/environment.detectEnvironment 的区别：
 * - src/governor/environment 通过 typeof window === 'undefined' 检测 terminal
 * - Agent CLI 进程中 window 未定义，会被正确识别为 terminal
 * - 但 Agent CLI 可能在某些场景下被 Web 端通过 HybridBackend 调用，
 *   此时需要显式标记 __WORLDSMITH_AGENT__
 *
 * 此函数仅在 Agent CLI 进程中调用，Web 端 Agent 使用 detectWebEnvironment()。
 */
export function detectAgentEnvironment(): Environment {
  const phase = (typeof process !== 'undefined' && process.env?.NODE_ENV) || 'production'
  const isDev = phase === 'development'

  // terminal 宿主能力集合
  const capabilities = new Set<CapabilityTag>([
    'fs',
    'db',
    'network',
    'llm-provider',
    'embedding',
    'mcp',
    'heavy-cpu',
  ])

  return {
    phase: isDev ? 'development' : 'production',
    host: 'terminal',
    backend: 'js-fallback',
    capabilities,
  }
}

/**
 * 根据运行上下文选择环境检测策略。
 *
 * - 在 Node.js CLI 进程中（typeof window === 'undefined'）：使用 detectAgentEnvironment()
 * - 在浏览器/Tauri 中：使用 src/governor/environment.detectEnvironment()
 *
 * 这样可以正确处理：
 * 1. CLI 模式：worldsmith-agent chat
 * 2. Web 端 Agent：通过 createWorldSmithAgent 创建
 * 3. HybridBackend：Web 端通过 WS 调用 CLI Agent
 */
export function detectAgentOrWebEnvironment(): Environment {
  // 检测是否在 Node.js CLI 进程中
  if (typeof window === 'undefined') {
    return detectAgentEnvironment()
  }
  // Web 端使用主项目的环境检测
  return detectWebEnvironment()
}

/* ════════════════════════════════════════
   Agent 调控器
   ════════════════════════════════════════ */

/**
 * Agent 调控器接口（轻量版，不含 UI 相关方法）。
 */
export interface AgentGovernor {
  getEnvironment(): Environment
  hasCapability(tag: CapabilityTag): boolean
  register(descriptor: ModuleDescriptor): void
  registerAll(descriptors: ModuleDescriptor[]): void
  activate(id: string): Promise<ActivationResult>
  isActive(id: string): boolean
  boot(): Promise<BootReport>
  getActiveModules(): Array<{ id: string; name: string; priority: ModulePriority }>
  getFailedModules(): Array<{ id: string; error: string; priority: ModulePriority }>
  getSkippedModules(): Array<{ id: string; reason: string }>
}

/**
 * 创建 Agent 调控器实例。
 *
 * @param options 可选配置
 * @returns AgentGovernor 实例
 */
export function createAgentGovernor(options: {
  environment?: Environment
  modules?: ModuleDescriptor[]
  verbose?: boolean
} = {}): AgentGovernor {
  const env = options.environment ?? detectAgentOrWebEnvironment()
  const verbose = options.verbose ?? (env.phase === 'development')
  const registry = new ModuleRegistry()
  const activeModules = new Set<string>()
  const failures: Array<{ id: string; error: string; priority: ModulePriority }> = []
  const skipped: Array<{ id: string; reason: string }> = []

  // 注册初始模块
  const initialModules = options.modules ?? agentModules
  registry.registerAll(initialModules)

  function log(...args: unknown[]) {
    if (verbose) console.log('[AgentGovernor]', ...args)
  }

  function getEnvironment() {
    return env
  }

  function hasCapability(tag: CapabilityTag) {
    return env.capabilities.has(tag)
  }

  function register(descriptor: ModuleDescriptor) {
    registry.register(descriptor)
    log(`已注册: ${descriptor.id}`)
  }

  function registerAll(descriptors: ModuleDescriptor[]) {
    for (const d of descriptors) register(d)
  }

  async function activate(id: string): Promise<ActivationResult> {
    const descriptor = registry.get(id)
    if (!descriptor) {
      return {
        success: false,
        module: { id, name: id, version: '', priority: 'normal', activate: async () => {} },
        error: `模块 "${id}" 未注册`,
      }
    }

    if (activeModules.has(id)) {
      return { success: true, module: descriptor }
    }

    // 环境匹配检查
    const match = checkEnvironmentMatch(descriptor, env)
    if (!match.matched) {
      skipped.push({ id, reason: match.reason })
      return {
        success: false,
        module: descriptor,
        skipped: true,
        reason: match.reason,
      }
    }

    try {
      // Agent 环境无 pluginAPI，activate 函数应自包含
      // 传入空对象作为 api（Agent 模块不依赖 GovernorAPI）
      await descriptor.activate({} as any)
      activeModules.add(id)
      log(`已激活: ${id}`)
      return { success: true, module: descriptor }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      failures.push({ id, error: errorMsg, priority: descriptor.priority })
      console.warn(`[AgentGovernor] 激活失败: ${id} - ${errorMsg}`)
      return { success: false, module: descriptor, error: errorMsg }
    }
  }

  function isActive(id: string) {
    return activeModules.has(id)
  }

  async function boot(): Promise<BootReport> {
    const startTime = Date.now()
    const activated: string[] = []
    const failed: Array<{ id: string; error: string; priority: ModulePriority }> = []
    const bootSkipped: Array<{ id: string; reason: string }> = []
    let hasCriticalFailure = false

    const priorities: ModulePriority[] = ['critical', 'normal', 'lazy']

    for (const priority of priorities) {
      if (hasCriticalFailure) {
        log(`critical 失败，跳过 ${priority} 批次`)
        break
      }

      const batchModules = registry.getByPriority(priority)
      if (batchModules.length === 0) continue

      const { sorted } = resolveDependencies(batchModules)
      const orderedIds = [...sorted, ...batchModules.map(m => m.id).filter(id => !sorted.includes(id))]

      for (const id of orderedIds) {
        const result = await activate(id)
        if (result.success) {
          activated.push(id)
        } else if (result.skipped) {
          bootSkipped.push({ id, reason: result.reason || '环境不匹配' })
        } else {
          failed.push({ id, error: result.error || '未知错误', priority })
          if (priority === 'critical') {
            hasCriticalFailure = true
            console.error(`[AgentGovernor] critical 模块 "${id}" 失败，中止后续启动`)
            break
          }
        }
      }
    }

    const duration = Date.now() - startTime
    log(`启动完成: ${activated.length} 激活, ${failed.length} 失败, ${bootSkipped.length} 跳过, 耗时 ${duration}ms`)

    return {
      activated,
      failed,
      skipped: bootSkipped,
      duration,
      hasCriticalFailure,
    }
  }

  function getActiveModules() {
    return registry
      .getAll()
      .filter(m => activeModules.has(m.id))
      .map(m => ({ id: m.id, name: m.name, priority: m.priority }))
  }

  function getFailedModules() {
    return [...failures]
  }

  function getSkippedModules() {
    return [...skipped]
  }

  return {
    getEnvironment,
    hasCapability,
    register,
    registerAll,
    activate,
    isActive,
    boot,
    getActiveModules,
    getFailedModules,
    getSkippedModules,
  }
}

/* ════════════════════════════════════════
   便捷创建函数
   ════════════════════════════════════════ */

/**
 * 创建 Web 端 Agent 调控器。
 *
 * 使用 detectWebEnvironment() 检测环境（browser/desktop），
 * 加载所有 agentModules（含 UI 相关模块）。
 */
export function createWebAgentGovernor(verbose?: boolean): AgentGovernor {
  return createAgentGovernor({
    environment: detectWebEnvironment(),
    modules: webAgentModules,
    verbose,
  })
}

/**
 * 创建 CLI 端 Agent 调控器。
 *
 * 使用 detectAgentEnvironment() 检测环境（terminal），
 * 加载 cliAgentModules（排除 UI 相关模块）。
 */
export function createCliAgentGovernor(verbose?: boolean): AgentGovernor {
  return createAgentGovernor({
    environment: detectAgentEnvironment(),
    modules: cliAgentModules,
    verbose,
  })
}

/* ════════════════════════════════════════
   全局 Agent 调控器实例（单例）
   ════════════════════════════════════════ */

let globalAgentGovernor: AgentGovernor | null = null
let globalAgentGovernorBooted = false

/**
 * 初始化全局 Agent 调控器。
 *
 * 应在 createWorldSmithAgent / createCliAgent 中调用一次。
 * 重复调用会覆盖已有实例。
 *
 * @param options 选项
 * @returns AgentGovernor 实例
 */
export function initAgentGovernor(options: {
  environment?: Environment
  modules?: ModuleDescriptor[]
  verbose?: boolean
} = {}): AgentGovernor {
  if (globalAgentGovernor) {
    console.warn('[AgentGovernor] 全局实例已存在，将被覆盖')
  }
  globalAgentGovernor = createAgentGovernor(options)
  globalAgentGovernorBooted = false
  return globalAgentGovernor
}

/**
 * 获取全局 Agent 调控器实例。
 * 必须先调用 initAgentGovernor()。
 */
export function getAgentGovernor(): AgentGovernor {
  if (!globalAgentGovernor) {
    throw new Error('[AgentGovernor] 全局实例未初始化，请先调用 initAgentGovernor()')
  }
  return globalAgentGovernor
}

/**
 * 确保全局 Agent 调控器已初始化并完成 boot。
 *
 * - 若全局实例未初始化，则用给定 options 创建（options 为空时使用默认策略）
 * - 若全局实例已初始化但未 boot，则执行 boot
 * - 若全局实例已 boot，则直接返回（幂等）
 *
 * @param options 创建选项（仅在首次创建时生效）
 * @returns 已 boot 的 AgentGovernor 实例
 * @throws 当 critical 模块激活失败时抛出
 */
export async function bootAgentGovernor(options: {
  environment?: Environment
  modules?: ModuleDescriptor[]
  verbose?: boolean
} = {}): Promise<AgentGovernor> {
  // 幂等：已 boot 则直接返回
  if (globalAgentGovernor && globalAgentGovernorBooted) {
    return globalAgentGovernor
  }
  // 未初始化则创建
  if (!globalAgentGovernor) {
    globalAgentGovernor = createAgentGovernor(options)
  }
  // 执行 boot
  const report = await globalAgentGovernor.boot()
  globalAgentGovernorBooted = true
  if (report.hasCriticalFailure) {
    const failedIds = report.failed.map(f => f.id).join(', ')
    throw new Error(`[AgentGovernor] critical 模块启动失败，中止: ${failedIds}`)
  }
  return globalAgentGovernor
}

/**
 * 重置全局 Agent 调控器（仅用于测试）。
 * @internal
 */
export function _resetAgentGovernor(): void {
  globalAgentGovernor = null
  globalAgentGovernorBooted = false
}
