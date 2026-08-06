/** Web 端 coreBackend 基础设施层：WASM 后端检测、惰性加载单例、Worker 池调用封装，详细见 docs/details/注释/web/core/coreBackend.md */

import { callViaWorker, isHeavyMethod } from '../wasmWorkerPool'

type BackendType = 'wasm' | 'none'

export function wasmCall<T>(fn: () => T, fallback: T): T {
  try {
    const result = fn()
    return result ?? fallback
  } catch {
    return fallback
  }
}

let detectedBackend: BackendType | null = null

function detectBackend(): BackendType {
  if (detectedBackend) return detectedBackend
  try {
    if (typeof window !== 'undefined') {
      const testKey = '__worldsmith_core_wasm_test__'
      const modules = (window as any)[testKey]
      if (modules && typeof modules === 'object') {
        detectedBackend = 'wasm'
        return 'wasm'
      }
    }
  } catch {}
  detectedBackend = 'none'
  return 'none'
}

export function setWasmAvailable(available: boolean): void {
  if (available && detectedBackend === 'none') {
    detectedBackend = 'wasm'
  }
}

export function getBackendType(): BackendType {
  return detectBackend()
}

/* ════════════════════════════════════════
   懒惰加载单例 — 避免每个函数独立 import
   ════════════════════════════════════════ */

let _corePromise: Promise<unknown> | null = null
export async function getCoreCached(): Promise<{ [key: string]: (...args: any[]) => any } | null> {
  if (!_corePromise) {
    _corePromise = (async () => {
      const { getCore } = await import('../worldsmithCore')
      return getCore()
    })()
  }
  return _corePromise as Promise<{ [key: string]: (...args: any[]) => any } | null>
}

export async function backendCall<T>(
  tauriCmd: string,  // 保留参数名（用于日志）
  _tauriArgs: Record<string, unknown>,
  wasmMethod: string,
  wasmArgs: unknown[],
  fallback: T,
  transferable?: number[],
): Promise<T> {
  const core = await getCoreCached()
  if (core && typeof core[wasmMethod] === 'function') {
    // 重计算方法走 Worker
    if (isHeavyMethod(wasmMethod)) {
      try {
        const workerResult = await callViaWorker(wasmMethod, wasmArgs, () => {
          return (core[wasmMethod] as Function)(...wasmArgs)
        }, transferable)
        return workerResult as T
      } catch {
        // Worker 失败 → 降级主线程
        return (core[wasmMethod] as Function)(...wasmArgs)
      }
    }
    return (core[wasmMethod] as Function)(...wasmArgs)
  }
  // 无可用后端时记录降级
  if (!_algoDegradedNotified && fallback !== null) {
    _algoDegradedNotified = true
    console.warn(
      `[coreBackend] "${tauriCmd}" / "${wasmMethod}" 无可用后端，返回降级结果。`,
    )
  }
  return fallback
}

/** 算法降级通知计数器 — 避免频繁弹出相同通知 */
let _algoDegradedNotified = false

/**
 * 算法调用辅助 — WASM 后端 + JSON 序列化参数
 *
 * 对重计算方法自动走 Worker 池，避免阻塞主线程；
 * 轻量方法仍在主线程同步调用，减少通信开销。
 */
export async function algoCall<T>(
  tauriCmd: string,
  _tauriArgs: Record<string, unknown>,
  wasmFn: (core: NonNullable<Awaited<ReturnType<typeof getCoreCached>>>) => any,
  fallback: T,
  parseJson = false,
  wasmMethodName?: string,
  wasmMethodArgs?: unknown[],
  transferable?: number[],
): Promise<T> {
  const core = await getCoreCached()
  if (core) {
    // 重计算方法走 Worker 池
    if (wasmMethodName && wasmMethodArgs && isHeavyMethod(wasmMethodName)) {
      try {
        const workerResult = await callViaWorker(wasmMethodName, wasmMethodArgs, () => {
          return wasmCall(() => {
            const r = wasmFn(core)
            return parseJson ? JSON.parse(r) : r
          }, fallback)
        }, transferable)
        return (parseJson ? JSON.parse(workerResult as string) : workerResult) as T
      } catch {
        // Worker 失败 → 降级主线程
        return wasmCall(() => {
          const r = wasmFn(core)
          return parseJson ? JSON.parse(r) : r
        }, fallback)
      }
    }
    // 轻量方法直接主线程调用
    return wasmCall(() => {
      const r = wasmFn(core)
      return parseJson ? JSON.parse(r) : r
    }, fallback)
  }
  // WASM 不可用 — 返回降级值并通知
  if (!_algoDegradedNotified) {
    _algoDegradedNotified = true
    console.warn(
      `[coreBackend] 算法 "${tauriCmd}" 无可用后端，返回降级结果。WASM 不可用，部分功能受限。`,
    )
  }
  return fallback
}
