/**
 * CLI Agent 连接管理
 *
 * 管理 Web 端与 CLI Agent Server 的连接，
 * 提供工具调用、健康检查、自动/手动连接等能力。
 */
import { ref, computed, readonly } from 'vue'
import { getWebCliAgentConnection } from './cliAgentConnection'
import { setActiveCliAgentConnection } from '@agent/index'

export interface CliAgentCapabilities {
  tools: string[]
  categories: Record<string, string[]>
  toolCount: number
}

export interface CliAgentStatus {
  connected: boolean
  url: string
  capabilities: CliAgentCapabilities | null
  serverVersion: string | null
  error: string | null
}

const STORAGE_KEY_CLI_URL = 'worldsmith_cli_agent_url'
const DEFAULT_CLI_URL = 'http://localhost:3100'

// 全局单例状态
const connected = ref(false)
const connecting = ref(false)
const capabilities = ref<CliAgentCapabilities | null>(null)
const serverVersion = ref<string | null>(null)
const error = ref<string | null>(null)
const wsInstance = ref<WebSocket | null>(null)

function getCliUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_CLI_URL) || DEFAULT_CLI_URL
  } catch {
    return DEFAULT_CLI_URL
  }
}

function setCliUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_CLI_URL, url)
  } catch { /* ignore */ }
}

export function useCliAgent() {
  const cliUrl = ref(getCliUrl())

  const status = computed<CliAgentStatus>(() => ({
    connected: connected.value,
    url: cliUrl.value,
    capabilities: capabilities.value,
    serverVersion: serverVersion.value,
    error: error.value,
  }))

  /** 健康检查 */
  async function healthCheck(url?: string): Promise<{ ok: boolean; version?: string; toolCount?: number }> {
    const target = url || cliUrl.value
    try {
      const resp = await fetch(`${target}/health`, { signal: AbortSignal.timeout(3000) })
      if (!resp.ok) return { ok: false }
      const data = await resp.json()
      return { ok: true, version: data.version, toolCount: data.toolCount }
    } catch {
      return { ok: false }
    }
  }

  /** 获取能力列表 */
  async function fetchCapabilities(url?: string): Promise<CliAgentCapabilities | null> {
    const target = url || cliUrl.value
    try {
      const resp = await fetch(`${target}/api/capabilities`, { signal: AbortSignal.timeout(5000) })
      if (!resp.ok) return null
      return await resp.json()
    } catch {
      return null
    }
  }

  /** 调用工具 */
  async function callTool(toolName: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; result?: string; error?: string; requestId?: string }> {
    if (!connected.value) {
      return { ok: false, error: 'CLI Agent 未连接' }
    }
    try {
      const resp = await fetch(`${cliUrl.value}/api/tools/${encodeURIComponent(toolName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args }),
      })
      return await resp.json()
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 连接 CLI Agent Server */
  async function connect(url?: string): Promise<boolean> {
    const target = url || cliUrl.value
    connecting.value = true
    error.value = null

    try {
      // 1. 健康检查
      const health = await healthCheck(target)
      if (!health.ok) {
        error.value = `无法连接到 ${target}，请确认 CLI Agent 已启动`
        connected.value = false
        return false
      }

      // 2. 获取能力
      const caps = await fetchCapabilities(target)
      if (!caps) {
        error.value = '获取工具列表失败'
        connected.value = false
        return false
      }

      // 3. 建立 WebSocket 连接
      const wsUrl = target.replace(/^http/, 'ws') + '/ws'
      const ws = new WebSocket(wsUrl)

      await new Promise<void>((resolve, reject) => {
        // 超时定时器必须在 resolve/reject 时清理，避免 5s 后触发 unhandled rejection
        const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 5000)
        ws.onopen = () => { clearTimeout(timer); resolve() }
        ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket 连接失败')) }
      })

      // 清理旧连接
      if (wsInstance.value) {
        wsInstance.value.close()
      }

      wsInstance.value = ws
      ws.onmessage = (event) => {
        // 处理 WS 事件（工具执行进度等）
        try {
          const data = JSON.parse(event.data)
          // 后续 HybridBackend 会消费这些事件
          if (data.type === 'connected') {
            serverVersion.value = data.serverVersion
          }
        } catch { /* ignore */ }
      }
      ws.onclose = () => {
        connected.value = false
        wsInstance.value = null
      }

      // 4. 更新状态
      cliUrl.value = target
      setCliUrl(target)
      capabilities.value = caps
      serverVersion.value = health.version || null
      connected.value = true
      error.value = null

      // 5. 同步 WebCliAgentConnection（供 HybridBackend 使用）
      const webConn = getWebCliAgentConnection()
      await webConn.connect(target)
      setActiveCliAgentConnection(webConn)

      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : '连接失败'
      connected.value = false
      return false
    } finally {
      connecting.value = false
    }
  }

  /** 断开连接 */
  function disconnect(): void {
    if (wsInstance.value) {
      wsInstance.value.close()
      wsInstance.value = null
    }
    connected.value = false
    capabilities.value = null
    serverVersion.value = null
    error.value = null

    // 同步断开 WebCliAgentConnection
    const webConn = getWebCliAgentConnection()
    webConn.disconnect()
    setActiveCliAgentConnection(null)
  }

  /** 更新 URL */
  function updateUrl(url: string): void {
    cliUrl.value = url
    setCliUrl(url)
  }

  /** 检查工具是否在 CLI Agent 能力范围内 */
  function isLocalTool(toolName: string): boolean {
    if (!capabilities.value) return false
    const localCategories = ['shell', 'git', 'file', 'project', 'system']
    for (const cat of localCategories) {
      const tools = capabilities.value.categories[cat]
      if (tools && tools.includes(toolName)) return true
    }
    return false
  }

  return {
    status,
    cliUrl: readonly(cliUrl),
    connecting: readonly(connecting),
    connected: readonly(connected),
    capabilities: readonly(capabilities),
    error: readonly(error),

    connect,
    disconnect,
    updateUrl,
    healthCheck,
    fetchCapabilities,
    callTool,
    isLocalTool,
  }
}
