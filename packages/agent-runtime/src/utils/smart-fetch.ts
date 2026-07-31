/**
 * 统一网络请求工具
 *
 * 在 Tauri 桌面模式下使用 plugin:http|fetch 绕过 CORS，
 * 在 Web 模式下使用浏览器原生 fetch()。
 *
 * 所有 Agent 工具对外部 API 的请求都应通过此模块发出，
 * 确保在两种环境下都能正常工作。
 */

import { isTauri } from '../execution'
import { getProviderManifest } from '../providers/provider-registry'

// ─── Tauri invoke 缓存 ───

let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null

async function getTauriInvoke() {
  if (_invoke) return _invoke
  if (!isTauri()) return null
  try {
    const api = await import('@tauri-apps/api/core')
    _invoke = api.invoke
    return _invoke
  } catch {
    return null
  }
}

// ─── SmartResponse ───

export interface SmartResponse {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  text(): Promise<string>
  json(): Promise<any>
}

// ─── SmartFetchOptions ───

export interface SmartFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
  timeout?: number
}

// ─── smartFetch ───

/**
 * 统一网络请求函数
 *
 * - Tauri 模式：通过 plugin:http|fetch 发起请求，绕过浏览器 CORS 限制
 * - Web 模式：使用浏览器原生 fetch()
 *
 * 返回与标准 Response 兼容的 SmartResponse 对象。
 */
export async function smartFetch(url: string, options?: SmartFetchOptions): Promise<SmartResponse> {
  const invoke = await getTauriInvoke()

  if (invoke) {
    return tauriFetch(invoke, url, options)
  }

  return browserFetch(url, options)
}

/** Tauri 模式：通过 plugin:http|fetch 发起请求 */
async function tauriFetch(
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  url: string,
  options?: SmartFetchOptions,
): Promise<SmartResponse> {
  const method = (options?.method || 'GET').toUpperCase()
  const fetchArgs: Record<string, unknown> = {
    url,
    method,
    headers: options?.headers || {},
    connectTimeout: (options?.timeout || 30) * 1000,
  }

  if (options?.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    fetchArgs.body = { type: 'Text', content: String(options.body) }
  }

  try {
    const result = await invoke('plugin:http|fetch', fetchArgs) as {
      status: number
      statusText?: string
      headers: Record<string, string>
      body: string
      ok: boolean
    }

    const bodyStr = typeof result.body === 'string' ? result.body : JSON.stringify(result.body)

    return {
      ok: result.ok ?? (result.status >= 200 && result.status < 300),
      status: result.status,
      statusText: result.statusText || '',
      headers: result.headers || {},
      text: async () => bodyStr,
      json: async () => {
        try {
          return JSON.parse(bodyStr)
        } catch {
          throw new SyntaxError('smartFetch: 响应体不是有效的 JSON')
        }
      },
    }
  } catch (err) {
    // 将 Tauri invoke 错误包装为类似网络错误的对象
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      status: 0,
      statusText: message,
      headers: {},
      text: async () => message,
      json: async () => { throw new SyntaxError(message) },
    }
  }
}

/** Web 模式：使用浏览器原生 fetch */
async function browserFetch(url: string, options?: SmartFetchOptions): Promise<SmartResponse> {
  const fetchOptions: RequestInit = {
    method: options?.method || 'GET',
    headers: options?.headers || {},
  }

  if (options?.body) {
    fetchOptions.body = options.body
  }
  if (options?.signal) {
    fetchOptions.signal = options.signal
  }

  const resp = await fetch(url, fetchOptions)

  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    headers: Object.fromEntries(resp.headers.entries()),
    text: () => resp.text(),
    json: () => resp.json(),
  }
}

// ─── URL 解析辅助 ───

/**
 * 根据运行环境解析 API Base URL
 *
 * - Tauri 模式：返回供应商直连 URL（plugin:http 无 CORS 限制）
 * - Web 模式：返回 Vite 代理路径
 */
export function resolveApiBaseUrl(providerId: string): string {
  const manifest = getProviderManifest(providerId)
  if (!manifest) return ''

  if (isTauri()) {
    return manifest.directBaseUrl
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
  return `${origin}${manifest.proxyPath}`
}

/**
 * 解析聊天补全端点 URL
 *
 * - Tauri 模式：直连供应商 API
 * - Web 模式：走 Vite 代理
 */
export function resolveChatEndpoint(providerId: string): string {
  const manifest = getProviderManifest(providerId)
  if (!manifest) return ''

  if (isTauri()) {
    const chatPath = manifest.chatCompletionsPath || '/v1/chat/completions'
    return `${manifest.directBaseUrl}${chatPath}`
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
  return `${origin}${manifest.proxyPath}/chat/completions`
}
