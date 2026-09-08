/**
 * @worldsea/governor-core — 环境检测
 *
 * 静态检测三维度环境（phase × host × backend）+ 能力集合。
 * 启动时一次性检测，运行期不变。
 *
 * 纯逻辑，不依赖 Vue/Pinia，主应用与 Agent 包共享。
 */
import type {
  Environment,
  LifecyclePhase,
  RuntimeHost,
  CapabilityBackend,
  CapabilityTag,
} from './types'

/* ════════════════════════════════════════
   生命周期阶段检测
   ════════════════════════════════════════ */

/**
 * 检测生命周期阶段。
 *
 * 优先级：
 * 1. import.meta.env.MODE（Vite 标准变量）
 * 2. process.env.NODE_ENV（Node/Agent 环境）
 * 3. 兜底 'production'
 */
function detectPhase(): LifecyclePhase {
  try {
    // Vite 环境
    const mode = (import.meta as any).env?.MODE
    if (mode === 'development' || mode === 'production') return mode
  } catch {}
  try {
    // Node/Agent 环境
    const nodeEnv = (globalThis as any).process?.env?.NODE_ENV
    if (nodeEnv === 'development' || nodeEnv === 'production') return nodeEnv
  } catch {}
  return 'production'
}

/* ════════════════════════════════════════
   宿主形态检测
   ════════════════════════════════════════ */

/**
 * 检测宿主形态。
 *
 * 优先级：
 * 1. terminal：worldsea-agent CLI 进程（typeof window === 'undefined' 或显式标志）
 * 2. cloud：环境变量 WORLDSEA_CLOUD=1
 * 3. desktop：window.__TAURI_INTERNALS__ 或 window.__TAURI__ 存在
 * 4. browser：以上都不满足的兜底
 */
function detectHost(): RuntimeHost {
  // 1. terminal 检测：Agent CLI 进程
  try {
    if (typeof window === 'undefined') return 'terminal'
    // Agent 进程会设置显式标志
    if ((globalThis as any).__WORLDSEA_AGENT__ === true) return 'terminal'
  } catch {}

  // 2. cloud 检测
  try {
    const env = (globalThis as any).process?.env
    if (env?.WORLDSEA_CLOUD === '1') return 'cloud'
  } catch {}

  // 3. desktop 检测：Tauri 内部对象
  try {
    if (typeof window !== 'undefined') {
      const w = window as any
      if (w.__TAURI_INTERNALS__ || w.__TAURI__) return 'desktop'
    }
  } catch {}

  // 4. browser 兜底
  return 'browser'
}

/* ════════════════════════════════════════
   能力后端检测
   ════════════════════════════════════════ */

/**
 * 检测能力后端。
 *
 * 优先级：
 * 1. tauri：宿主为 desktop 时优先
 * 2. wasm：window.__worldsea_core_wasm_test__ 存在（由 worldseaCore.ts 设置）
 * 3. js-fallback：兜底
 */
function detectBackend(host: RuntimeHost): CapabilityBackend {
  if (host === 'desktop') return 'tauri'

  if (host === 'terminal' || host === 'cloud') {
    // terminal/cloud 环境通常无 WASM，使用 js-fallback
    // （Agent 包有自己的后端路由，不依赖此处的 backend）
    return 'js-fallback'
  }

  // browser：检测 WASM 是否已加载
  try {
    if (typeof window !== 'undefined') {
      const testKey = '__worldsea_core_wasm_test__'
      const modules = (window as any)[testKey]
      if (modules && typeof modules === 'object') return 'wasm'
    }
  } catch {}

  return 'js-fallback'
}

/* ════════════════════════════════════════
   能力集合检测
   ════════════════════════════════════════ */

/**
 * 根据宿主和后端推导能力集合。
 */
function detectCapabilities(
  host: RuntimeHost,
  backend: CapabilityBackend,
): Set<CapabilityTag> {
  const caps = new Set<CapabilityTag>()

  // 基础设施能力
  if (host === 'desktop' || host === 'terminal') {
    caps.add('fs')
  }
  if (host === 'desktop' || host === 'browser') {
    caps.add('db')
    caps.add('worker')
    caps.add('gpu')
    caps.add('ui-render')
    caps.add('canvas')
  }
  // network：所有宿主都有（fetch/API 调用）
  caps.add('network')

  // 后端能力
  if (host === 'desktop') {
    caps.add('tauri')
  }
  if (backend === 'wasm') {
    caps.add('wasm')
  }
  if (backend === 'tauri' || backend === 'wasm') {
    caps.add('native-algo')
  }

  // Agent 能力
  caps.add('llm-provider')
  caps.add('embedding')
  caps.add('mcp')

  // 资源特征
  caps.add('heavy-cpu')

  return caps
}

/* ════════════════════════════════════════
   统一环境检测入口
   ════════════════════════════════════════ */

/**
 * 缓存的环境快照。静态检测策略：首次调用后缓存，运行期不变。
 */
let cachedEnvironment: Environment | null = null

/**
 * 检测当前运行环境。
 *
 * 静态检测：首次调用后缓存结果，后续调用返回同一快照。
 */
export function detectEnvironment(): Environment {
  if (cachedEnvironment) return cachedEnvironment

  const phase = detectPhase()
  const host = detectHost()
  const backend = detectBackend(host)
  const capabilities = detectCapabilities(host, backend)

  cachedEnvironment = {
    phase,
    host,
    backend,
    capabilities,
  }

  return cachedEnvironment
}

/**
 * 重置环境缓存（仅用于测试）。
 * @internal
 */
export function _resetEnvironmentCache(): void {
  cachedEnvironment = null
}

/**
 * 手动设置环境（用于测试或 Agent 包强制指定）。
 * 设置后会缓存，后续 detectEnvironment() 返回此值。
 */
export function setEnvironment(env: Environment): void {
  cachedEnvironment = env
}
