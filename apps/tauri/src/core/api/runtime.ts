// ── Backend 类型与检测 ──

type BackendType = 'tauri' | 'none'

export function detectBackend(): BackendType {
  return 'tauri'
}

/** 保留为 no-op — 维持对外 API 签名兼容（Tauri 端不支持 WASM） */
export function setWasmAvailable(_available: boolean): void {
  // no-op: Tauri 端硬编码 'tauri'，WASM 状态不再影响后端选择
}

export function getBackendType(): BackendType {
  return detectBackend()
}

/* ════════════════════════════════════════
   懒惰加载单例 — 避免每个函数独立 import
   ════════════════════════════════════════ */

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
let tauriInvoke: InvokeFn | null = null
export async function getTauriInvoke(): Promise<InvokeFn> {
  if (!tauriInvoke) {
    const mod = await import('@tauri-apps/api/core')
    tauriInvoke = mod.invoke
  }
  return tauriInvoke
}

export async function backendCall<T>(
  tauriCmd: string,
  tauriArgs: Record<string, unknown>,
  _wasmMethod: string, // 保留参数名（已不使用，但保持签名）
  _wasmArgs: unknown[],
  _fallback: T,
): Promise<T> {
  // Tauri 端仅走 invoke 路径
  const invoke = await getTauriInvoke()
  return invoke(tauriCmd, tauriArgs) as Promise<T>
}

/**
 * Tauri-only 调用辅助 — 无 WASM 回退的场景（如空间索引）
 */
export async function tauriCall<T>(cmd: string, args: Record<string, unknown> = {}, _fallback?: T): Promise<T> {
  const invoke = await getTauriInvoke()
  return invoke(cmd, args) as Promise<T>
}

/**
 * 算法调用辅助 — Tauri 端仅走 invoke 路径 + JSON 序列化参数
 *
 * 保留 wasmFn / wasmMethodName / wasmMethodArgs 参数以维持签名兼容（已不使用）。
 */
export async function algoCall<T>(
  tauriCmd: string,
  tauriArgs: Record<string, unknown>,
  _wasmFn: (core: any) => any, // 已不使用，但保持签名
  _fallback: T,
  parseJson = false,
  _wasmMethodName?: string, // 已不使用
  _wasmMethodArgs?: unknown[], // 已不使用
): Promise<T> {
  const invoke = await getTauriInvoke()
  const result = await invoke(tauriCmd, tauriArgs)
  return (parseJson ? JSON.parse(result as string) : result) as T
}
