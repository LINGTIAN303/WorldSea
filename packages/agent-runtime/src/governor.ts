/**
 * worldsmith-agent/src/governor.ts — Agent 包轻量调控器入口
 *
 * 为 Agent 包（Web 端 + CLI 端）提供基于 governor 的模块编排。
 *
 * 与 src/governor 的关系：
 * - 核心逻辑复用 @worldsmith/governor-core（createGovernor/ModuleRegistry/...）
 * - 主应用通过 src/governor/governor.ts 包装 governor-core 并注入 createGovernorAPI
 * - Agent 包直接使用 governor-core 的 createGovernor（默认空 apiFactory，无 UI 依赖）
 * - 由此消除 src/governor 与 worldsmith-agent/src/governor 的重复实现
 *
 * 使用方式：
 *   import { bootAgentGovernor } from 'worldsmith-agent/governor'
 *   const governor = await bootAgentGovernor()
 */
import type {
  Environment,
  CapabilityTag,
  ModuleDescriptor,
  ModulePriority,
  BootReport,
  ActivationResult,
  Governor,
} from '@worldsmith/governor-core/types'
import {
  createGovernor as createGovernorCore,
} from '@worldsmith/governor-core/governor'
import { detectEnvironment as detectWebEnvironment } from '@worldsmith/governor-core/environment'
import { agentModules, cliAgentModules, webAgentModules } from './governor-modules'

/* ════════════════════════════════════════
   Agent 环境检测
   ════════════════════════════════════════ */

/**
 * 检测 Agent CLI 运行环境。
 *
 * Agent CLI 运行在 Node.js 环境（terminal 宿主），
 * 能力后端为 js-fallback（无 WASM/Tauri）。
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
 * - 在浏览器/Tauri 中：使用 governor-core 的 detectEnvironment()
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
 *
 * 这是 Governor 的子集——governor-core 返回完整 Governor，
 * 此接口仅暴露 Agent 包需要的方法。
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
 * 内部使用 governor-core 的 createGovernor（默认空 apiFactory），
 * Agent 模块的 activate 函数应自包含，不依赖 GovernorAPI 的注册方法。
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

  // 注册初始模块
  const initialModules = options.modules ?? agentModules

  // 使用 governor-core 的 createGovernor（默认空 apiFactory）
  // Agent 模块不依赖 GovernorAPI，activate 函数自包含
  const governor: Governor = createGovernorCore({
    environment: env,
    verbose,
    // 不传 apiFactory，使用 governor-core 默认空 API
  })

  // 注册初始模块
  governor.registerAll(initialModules)

  // AgentGovernor 是 Governor 的子集，直接返回
  return governor as unknown as AgentGovernor
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
