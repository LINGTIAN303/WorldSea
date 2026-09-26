/**
 * [HTTP-BRIDGE] 临时：浏览器 → Tauri 真实后端的 transport
 *
 * 浏览器（vite dev，无 __TAURI_INTERNALS__）且配置了后端地址时：
 * - invoke → POST http://127.0.0.1:8787/rpc { cmd, args }
 * - listen → 单个 EventSource 订阅 /events（SSE），按事件名过滤分发
 * 否则回退原 mock（safeInvoke 的 mockInvoke）/ 真实 Tauri IPC。桌面端零改动。
 * 移除：删除本文件，还原 useAgentRust/useOrchEvents/useMultiAgentRust/useLoopControlRust 的 listen 导入。
 */
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'

const BACKEND_KEY = 'worldsea_backend_url'

export function getBackendUrl(): string | null {
  try {
    const fromLs = localStorage.getItem(BACKEND_KEY)
    if (fromLs) return fromLs
    const fromEnv = (import.meta as { env?: Record<string, string> }).env?.VITE_BACKEND_URL
    return fromEnv ?? null
  } catch {
    return null
  }
}

/** 是否启用 HTTP 后端（浏览器 preview 且配置了地址） */
export function isHttpBackend(): boolean {
  const isTauri = !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  return !isTauri && !!getBackendUrl()
}

/** RPC 调用：真实命令 → 返回 result；失败抛错 */
export async function invokeRpc<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const url = getBackendUrl()
  if (!url) throw new Error(`[HTTP-BRIDGE] 未配置后端地址（${BACKEND_KEY}）`)
  const res = await fetch(`${url}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd, args: args ?? {} }),
  })
  if (!res.ok) throw new Error(`[HTTP-BRIDGE] HTTP ${res.status}: ${cmd}`)
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || `[HTTP-BRIDGE] RPC ${cmd} 失败`)
  return data.result as T
}

/** 统一 invoke：HTTP 模式走 RPC，Tauri 模式走原生 IPC（替换直接调 tauri invoke 处） */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isHttpBackend()) return invokeRpc<T>(cmd, args)
  return tauriInvoke<T>(cmd, args)
}

// ── SSE 单例（按事件名分发） ──
let sse: EventSource | null = null
const sseListeners = new Map<string, Set<(payload: unknown) => void>>()

function ensureSse(): void {
  if (sse) return
  const url = getBackendUrl()
  if (!url) return
  sse = new EventSource(`${url}/events`)
  sse.addEventListener('message', (e) => {
    let d: { name?: string; payload?: unknown }
    try { d = JSON.parse((e as MessageEvent).data) } catch { return }
    const name = d.name
    if (!name) return
    const set = sseListeners.get(name)
    if (set) set.forEach((cb) => { try { cb(d.payload) } catch {} })
  })
}

/** 与 @tauri-apps/api/event 的 listen 同签名：HTTP 模式走 SSE，Tauri 模式走原生 */
export async function listen<T>(
  name: string,
  cb: (e: { event: string; payload: T }) => void,
): Promise<UnlistenFn> {
  if (isHttpBackend()) {
    ensureSse()
    if (!sseListeners.has(name)) sseListeners.set(name, new Set())
    const wrapped = (payload: unknown) => cb({ event: name, payload: payload as T })
    sseListeners.get(name)!.add(wrapped)
    return () => {
      sseListeners.get(name)?.delete(wrapped)
    }
  }
  return tauriListen<T>(name, cb)
}

export type { UnlistenFn }
