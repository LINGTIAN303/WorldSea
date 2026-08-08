// ── Backend 类型与检测 ──
//
// Phase A 迁移：Tauri 端 core/api 切换为 WASM 路径（复用 web 端 WASM 核心）。
// 存储走 FileStorageBackend（Rust fs 命令），算法/校验走 WASM，Agent 走 Rust 命令。

import { callViaWorker, isHeavyMethod } from '../wasmWorkerPool'

type BackendType = 'wasm' | 'none'

/** WASM 后端检测：始终检测 WASM（Tauri 端复用 WASM 核心做算法/校验） */
function detectBackend(): BackendType {
  try {
    if (typeof window !== 'undefined') {
      const testKey = '__worldsmith_core_wasm_test__'
      const modules = (window as any)[testKey]
      if (modules && typeof modules === 'object') {
        return 'wasm'
      }
    }
  } catch {}
  return 'none'
}

export function setWasmAvailable(available: boolean): void {
  if (available) {
    try {
      if (typeof window !== 'undefined') {
        ;(window as any).__worldsmith_core_wasm_test__ = { loaded: true }
      }
    } catch {}
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

/** WASM 同步调用封装（带 fallback） */
export function wasmCall<T>(fn: () => T, fallback: T): T {
  try {
    const result = fn()
    return result ?? fallback
  } catch {
    return fallback
  }
}

/* ────────────────────────────────────────
   Tauri invoke 调用辅助（空间索引等 Tauri-only 命令保留 invoke 路径）
   ──────────────────────────────────────── */

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
let tauriInvoke: InvokeFn | null = null
export async function getTauriInvoke(): Promise<InvokeFn> {
  if (!tauriInvoke) {
    const mod = await import('@tauri-apps/api/core')
    tauriInvoke = mod.invoke
  }
  return tauriInvoke
}

/**
 * Tauri-only 调用辅助 — invoke 路径（无 WASM 回退）
 */
export async function tauriCall<T>(cmd: string, args: Record<string, unknown> = {}, _fallback?: T): Promise<T> {
  const invoke = await getTauriInvoke()
  return invoke(cmd, args) as Promise<T>
}

/* ════════════════════════════════════════
   backendCall / algoCall — WASM 路径
   ════════════════════════════════════════ */

/**
 * 通用后端调用：走 WASM 核心（tauriCmd 参数仅作日志/兜底标识，实际执行 wasmMethod）
 */
export async function backendCall<T>(
  tauriCmd: string,  // 保留参数名（用于日志/兜底标识）
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
