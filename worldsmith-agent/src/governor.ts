/**
 * worldsmith-agent/src/governor.ts — Agent 包轻量调控器入口
 *
 * 为 terminal 环境（worldsmith-agent CLI）提供轻量调控器。
 *
 * 与 src/governor 的区别：
 * - 不依赖 Vue/Pinia（terminal 环境无 UI）
 * - 只加载无 UI 的模块（fs/db/llm-provider/embedding/mcp）
 * - 跳过所有 requires: ['ui-render'] 的模块
 * - 复用 src/governor 的类型定义（通过类型导入，无运行时依赖）
 *
 * 使用方式：
 *   import { createAgentGovernor } from 'worldsmith-agent/governor'
 *   const governor = createAgentGovernor()
 *   await governor.boot()
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

/* ════════════════════════════════════════
   Agent 环境检测
   ════════════════════════════════════════ */

/**
 * 检测 Agent CLI 运行环境。
 *
 * Agent 包运行在 Node.js 环境（terminal 宿主），
 * 能力后端为 js-fallback（无 WASM/Tauri）。
 */
function detectAgentEnvironment(): Environment {
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
}

/**
 * 创建 Agent 调控器实例。
 *
 * @param options 可选配置
 * @returns AgentGovernor 实例
 */
export function createAgentGovernor(options: {
  environment?: Environment
  verbose?: boolean
} = {}): AgentGovernor {
  const env = options.environment ?? detectAgentEnvironment()
  const verbose = options.verbose ?? (env.phase === 'development')
  const registry = new ModuleRegistry()
  const activeModules = new Set<string>()
  const failures: Array<{ id: string; error: string; priority: ModulePriority }> = []

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
    const skipped: Array<{ id: string; reason: string }> = []
    let hasCriticalFailure = false

    const priorities: ModulePriority[] = ['critical', 'normal', 'lazy']

    for (const priority of priorities) {
      if (hasCriticalFailure) break

      const batchModules = registry.getByPriority(priority)
      if (batchModules.length === 0) continue

      const { sorted } = resolveDependencies(batchModules)
      const orderedIds = [...sorted, ...batchModules.map(m => m.id).filter(id => !sorted.includes(id))]

      for (const id of orderedIds) {
        const result = await activate(id)
        if (result.success) {
          activated.push(id)
        } else if (result.skipped) {
          skipped.push({ id, reason: result.reason || '环境不匹配' })
        } else {
          failed.push({ id, error: result.error || '未知错误', priority })
          if (priority === 'critical') {
            hasCriticalFailure = true
            break
          }
        }
      }
    }

    return {
      activated,
      failed,
      skipped,
      duration: Date.now() - startTime,
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
  }
}
