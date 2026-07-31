/**
 * # ExecutionAdapter 工厂注册模式
 *
 * 端无关的执行适配器入口。不直接 import 任何端特定 adapter，
 * 通过 registerExecutionAdapterFactory 由各端入口注入实现。
 *
 * 端注册示例：
 * ```typescript
 * // CLI 端（apps/cli/src/bootstrap.ts）
 * registerExecutionAdapterFactory({
 *   createNodeAdapter: () => new NodeExecutionAdapter(),
 * })
 *
 * // Web 端（apps/web/src/bootstrap.ts）
 * registerExecutionAdapterFactory({
 *   createWsAdapter: (config) => new WebSocketExecutionAdapter(config),
 * })
 * ```
 */

import type { ExecutionAdapter } from './adapter'
import { isNodeEnv } from './env'

// 重导出 adapter 接口和 env 检测
export { isNodeEnv } from './env'
export type {
  ExecutionAdapter,
  ExecOptions,
  ExecResult,
  PtyOptions,
  ShellInfo,
  ShellSessionInfo,
  ShellExecResult,
} from './adapter'

/**
 * 检测当前是否在 Tauri 桌面环境中
 * 仅检测，不调用任何 Tauri API
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
}

/**
 * 获取 WebSocket 服务器 URL
 *
 * 优先级（从高到低）：
 * 1. localStorage.ws_server_url — 用户手动覆盖（运行时）
 * 2. import.meta.env.VITE_CLI_SERVE_URL — 构建时配置（Vite 环境变量）
 * 3. ws://localhost:3100 — 默认值（与 CLI serve 默认端口一致）
 *
 * 注意：import.meta.env 在非 Vite 环境（如 Node）可能未定义，需安全访问。
 */
export function getWsUrl(): string {
  // 1. localStorage 用户手动覆盖
  try {
    const stored = localStorage.getItem('ws_server_url')
    if (stored) return stored
  } catch {
    // localStorage 不可用（SSR 或隐私模式），继续降级
  }

  // 2. Vite 环境变量（构建时配置）
  //    非 Vite 环境下 import.meta.env 可能为 undefined，需安全访问
  try {
    const envUrl = (import.meta as any)?.env?.VITE_CLI_SERVE_URL
    if (typeof envUrl === 'string' && envUrl) return envUrl
  } catch {
    // import.meta 访问失败（部分打包器），继续降级
  }

  // 3. 默认值
  return 'ws://localhost:3100'
}

/**
 * 获取 CLI serve 鉴权 token
 *
 * 优先级（从高到低）：
 * 1. localStorage.ws_server_token — 用户手动覆盖（运行时）
 * 2. import.meta.env.VITE_CLI_SERVE_TOKEN — 构建时配置（Vite 环境变量）
 * 3. 'dev' — 默认值（开发模式免鉴权）
 */
export function getWsToken(): string {
  // 1. localStorage 用户手动覆盖
  try {
    const stored = localStorage.getItem('ws_server_token')
    if (stored) return stored
  } catch {
    // localStorage 不可用，继续降级
  }

  // 2. Vite 环境变量（构建时配置）
  try {
    const envToken = (import.meta as any)?.env?.VITE_CLI_SERVE_TOKEN
    if (typeof envToken === 'string' && envToken) return envToken
  } catch {
    // import.meta 访问失败，继续降级
  }

  // 3. 默认值（开发模式免鉴权）
  return 'dev'
}

/**
 * 端适配器工厂接口
 * 各端在启动时注册自己的实现
 */
export interface ExecutionAdapterFactory {
  /** Node.js 环境适配器工厂（CLI serve 模式） */
  createNodeAdapter?: () => ExecutionAdapter | Promise<ExecutionAdapter>
  /** Tauri 桌面环境适配器工厂 */
  createTauriAdapter?: () => ExecutionAdapter | Promise<ExecutionAdapter>
  /** 浏览器 WebSocket 适配器工厂 */
  createWsAdapter?: (config: { url: string; reconnect?: boolean }) => ExecutionAdapter | Promise<ExecutionAdapter>
}

// ─── 内部状态 ────────────────────────────────────────────────────

let factory: ExecutionAdapterFactory | null = null
let adapterInstance: ExecutionAdapter | null = null

// ─── 公共 API ────────────────────────────────────────────────────

/**
 * 注册端特定的 ExecutionAdapter 工厂
 * 由各端在启动时调用一次
 *
 * @param f 工厂对象，包含端特定的适配器创建函数
 */
export function registerExecutionAdapterFactory(f: ExecutionAdapterFactory): void {
  factory = f
  // 重置已缓存的实例，确保下次 createExecutionAdapter 使用新工厂
  resetExecutionAdapter()
}

/**
 * 创建执行适配器（端无关入口）
 *
 * 优先级由注册的工厂决定：
 * 1. Node.js 环境 → createNodeAdapter
 * 2. Tauri 桌面 → createTauriAdapter
 * 3. 浏览器 → createWsAdapter
 *
 * @throws {Error} 如果未注册工厂或当前环境无匹配的适配器
 */
export async function createExecutionAdapter(): Promise<ExecutionAdapter> {
  if (adapterInstance) return adapterInstance

  if (!factory) {
    throw new Error(
      'ExecutionAdapter factory not registered. ' +
      'Call registerExecutionAdapterFactory() at application startup.'
    )
  }

  if (isNodeEnv() && factory.createNodeAdapter) {
    adapterInstance = await factory.createNodeAdapter()
  } else if (isTauri() && factory.createTauriAdapter) {
    adapterInstance = await factory.createTauriAdapter()
  } else if (factory.createWsAdapter) {
    adapterInstance = await factory.createWsAdapter({ url: getWsUrl(), reconnect: true })
  } else {
    throw new Error(
      `No suitable ExecutionAdapter for current environment ` +
      `(node=${isNodeEnv()}, tauri=${isTauri()}, hasWs=${!!factory.createWsAdapter})`
    )
  }

  return adapterInstance
}

/**
 * 重置执行适配器实例
 * 断开当前连接并清除缓存，下次 createExecutionAdapter 将创建新实例
 */
export function resetExecutionAdapter(): void {
  if (adapterInstance && 'disconnect' in adapterInstance) {
    try {
      ;(adapterInstance as any).disconnect()
    } catch {
      // 忽略断开连接时的错误
    }
  }
  adapterInstance = null
}
