/** CLI Agent 连接管理（Web 端 ↔ CLI Agent Server 连接），详细见 docs/details/注释/packages/shared-composables/agent/useCliAgent.md */
import { ref, computed, readonly } from 'vue'

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

const STORAGE_KEY_CLI_URL = 'worldsea_cli_agent_url'
const DEFAULT_CLI_URL = 'http://localhost:3100'

// 重连与心跳配置
const RECONNECT_MAX_RETRIES = 5       // 最大重试次数
const RECONNECT_BASE_DELAY = 1000     // 基础退避延迟（ms）
const RECONNECT_MAX_DELAY = 30000     // 最大退避延迟（ms）
const HEARTBEAT_INTERVAL = 30000      // 心跳发送间隔（ms）
const HEARTBEAT_TIMEOUT = 5000        // pong 超时阈值（ms），超时视为半开连接

// 全局单例状态
const connected = ref(false)
const connecting = ref(false)
const capabilities = ref<CliAgentCapabilities | null>(null)
const serverVersion = ref<string | null>(null)
const error = ref<string | null>(null)
const wsInstance = ref<WebSocket | null>(null)

// 重连状态（模块级，跨 useCliAgent 调用复用）
let retryCount = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let intentionalDisconnect = false      // 主动断开标志，阻止 onclose 触发重连

// 心跳状态
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null

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

/** 清理心跳定时器 */
function clearHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  if (heartbeatTimeoutTimer) { clearTimeout(heartbeatTimeoutTimer); heartbeatTimeoutTimer = null }
}

/** 启动心跳：每 30s 发送 ping，5s 内未收到 pong 视为半开连接并主动关闭触发重连 */
function startHeartbeat(ws: WebSocket): void {
  clearHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify({ type: 'ping' }))
      // 设置 pong 超时检测
      heartbeatTimeoutTimer = setTimeout(() => {
        // 超时未收到 pong，主动关闭连接触发重连
        if (ws.readyState === WebSocket.OPEN) {
          ws.close()
        }
      }, HEARTBEAT_TIMEOUT)
    } catch { /* ignore send error */ }
  }, HEARTBEAT_INTERVAL)
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

  /** 调度重连：指数退避 1s→2s→4s→8s→16s→30s（上限 30s）
   *  作为闭包定义在 useCliAgent 内部，以访问 connect 函数
   */
  function scheduleReconnect(targetUrl: string): void {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (retryCount >= RECONNECT_MAX_RETRIES) {
      error.value = `重连失败：已达最大重试次数 ${RECONNECT_MAX_RETRIES}`
      return
    }
    retryCount++
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, retryCount - 1), RECONNECT_MAX_DELAY)
    reconnectTimer = setTimeout(async () => {
      if (intentionalDisconnect) return
      // 复用 connect()，传入 isReconnect=true 跳过健康检查与 setCliUrl
      await connect(targetUrl, true)
    }, delay)
  }

  /** 连接 CLI Agent Server
   *  @param url 目标地址，缺省使用当前 cliUrl
   *  @param isReconnect 内部使用：标记本次连接由重连调度触发，跳过 setCliUrl 与健康检查的冗余日志
   */
  async function connect(url?: string, isReconnect = false): Promise<boolean> {
    const target = url || cliUrl.value
    connecting.value = true
    error.value = null
    intentionalDisconnect = false

    try {
      // 1. 健康检查（重连时跳过，避免 3s 超时拖慢重连节奏）
      if (!isReconnect) {
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
        capabilities.value = caps
        serverVersion.value = health.version || null
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
      if (wsInstance.value && wsInstance.value !== ws) {
        wsInstance.value.close()
      }

      wsInstance.value = ws
      ws.onmessage = (event) => {
        // 处理 WS 事件（工具执行进度等）
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'connected') {
            serverVersion.value = data.serverVersion
          } else if (data.type === 'pong') {
            // 收到 pong，清除超时检测
            if (heartbeatTimeoutTimer) {
              clearTimeout(heartbeatTimeoutTimer)
              heartbeatTimeoutTimer = null
            }
          }
        } catch { /* ignore */ }
      }
      ws.onclose = () => {
        connected.value = false
        wsInstance.value = null
        clearHeartbeat()
        // 非主动断开 且 未达最大重试次数 → 触发重连
        if (!intentionalDisconnect && retryCount < RECONNECT_MAX_RETRIES) {
          scheduleReconnect(target)
        }
      }

      // 4. 更新状态
      cliUrl.value = target
      if (!isReconnect) setCliUrl(target)
      connected.value = true
      error.value = null
      retryCount = 0  // 连接成功，重置重试计数

      // 5. 启动心跳
      startHeartbeat(ws)

      // 阶段 2.0 批次3：HybridBackend 已移除，不再同步 WebCliAgentConnection
      // CLI Agent 连接仅用于健康检查/能力查询，工具调用通过 useCliAgent.callTool 直连

      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : '连接失败'
      connected.value = false
      // 重连场景下连接失败 → 继续调度下一次重连
      if (isReconnect && !intentionalDisconnect && retryCount < RECONNECT_MAX_RETRIES) {
        scheduleReconnect(target)
      }
      return false
    } finally {
      connecting.value = false
    }
  }

  /** 断开连接（主动断开，不触发重连） */
  function disconnect(): void {
    intentionalDisconnect = true
    // 清理重连定时器
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    // 清理心跳
    clearHeartbeat()
    // 重置重试计数
    retryCount = 0

    if (wsInstance.value) {
      wsInstance.value.close()
      wsInstance.value = null
    }
    connected.value = false
    capabilities.value = null
    serverVersion.value = null
    error.value = null

    // 阶段 2.0 批次3：HybridBackend 已移除，不再需要同步断开 WebCliAgentConnection
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
