import type { MCPConnectionConfig, MCPConnectionState, MCPToolInfo } from './types'
import { MCPToolAdapter } from './mcp-adapter'
import type { ToolBus } from '../toolbus/toolbus'

interface MCPRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface MCPResponse {
  jsonrpc: '2.0'
  id: number
  result?: any
  error?: { code: number; message: string; data?: unknown }
}

class MCPHttpTransport {
  private url: string
  private headers: Record<string, string>
  private nextId = 1
  private sessionId: string | null = null

  constructor(url: string, headers?: Record<string, string>) {
    this.url = url
    this.headers = headers || {}
  }

  async send(request: MCPRequest): Promise<MCPResponse> {
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...this.headers,
    }
    if (this.sessionId) {
      reqHeaders['Mcp-Session-Id'] = this.sessionId
    }

    const resp = await fetch(this.url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(request),
    })

    const sid = resp.headers.get('Mcp-Session-Id')
    if (sid) this.sessionId = sid

    if (!resp.ok) {
      throw new Error(`MCP HTTP ${resp.status}: ${await resp.text().catch(() => '')}`)
    }

    const ct = resp.headers.get('content-type') || ''
    if (ct.includes('text/event-stream')) {
      return this.parseSSE(resp)
    }

    return resp.json()
  }

  private async parseSSE(resp: Response): Promise<MCPResponse> {
    const reader = resp.body?.getReader()
    if (!reader) throw new Error('No response body for SSE')

    const decoder = new TextDecoder()
    let buffer = ''
    const pendingData: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '') {
            if (pendingData.length > 0) {
              const fullData = pendingData.join('\n')
              pendingData.length = 0
              try {
                const parsed = JSON.parse(fullData)
                if ('id' in parsed && typeof parsed.id === 'number') return parsed as MCPResponse
              } catch {}
            }
            continue
          }
          pendingData.push(data)
        }
      }
    }

    if (pendingData.length > 0) {
      const fullData = pendingData.join('\n')
      try {
        const parsed = JSON.parse(fullData)
        if ('id' in parsed && typeof parsed.id === 'number') return parsed as MCPResponse
      } catch {}
    }

    if (buffer.trim().startsWith('data: ')) {
      const data = buffer.trim().slice(6).trim()
      if (data !== '') {
        try {
          const parsed = JSON.parse(data)
          if ('id' in parsed && typeof parsed.id === 'number') return parsed as MCPResponse
        } catch {
          pendingData.push(data)
          const fullData = pendingData.join('\n')
          try {
            const parsed = JSON.parse(fullData)
            if ('id' in parsed && typeof parsed.id === 'number') return parsed as MCPResponse
          } catch {}
        }
      }
    }

    throw new Error('SSE stream ended without response')
  }

  allocateId(): number {
    return this.nextId++
  }

  async initialize(): Promise<any> {
    const resp = await this.send({
      jsonrpc: '2.0',
      id: this.allocateId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'worldsmith-agent', version: '1.0.0' },
      },
    })
    if (resp.error) throw new Error(`MCP init error: ${resp.error.message}`)
    await this.sendNotification('notifications/initialized')
    return resp.result
  }

  async listTools(): Promise<MCPToolInfo[]> {
    const resp = await this.send({
      jsonrpc: '2.0',
      id: this.allocateId(),
      method: 'tools/list',
    })
    if (resp.error) throw new Error(`MCP listTools error: ${resp.error.message}`)
    return (resp.result?.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {},
    }))
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const resp = await this.send({
      jsonrpc: '2.0',
      id: this.allocateId(),
      method: 'tools/call',
      params: { name, arguments: args },
    })
    if (resp.error) throw new Error(`MCP callTool error: ${resp.error.message}`)
    return resp.result
  }

  async close(): Promise<void> {
    this.sessionId = null
  }

  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.headers,
    }
    if (this.sessionId) {
      reqHeaders['Mcp-Session-Id'] = this.sessionId
    }

    const notification: { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> } = {
      jsonrpc: '2.0',
      method,
    }
    if (params) notification.params = params

    await fetch(this.url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(notification),
    })
  }
}

export class MCPManager {
  private connections = new Map<string, MCPConnectionState>()
  private transports = new Map<string, MCPHttpTransport>()
  private adapter = new MCPToolAdapter()
  private toolBus: ToolBus | null = null
  private onToolsChanged: (() => Promise<void>) | null = null

  setToolBus(toolBus: ToolBus): void {
    this.toolBus = toolBus
  }

  setOnToolsChanged(callback: () => Promise<void>): void {
    this.onToolsChanged = callback
  }

  async addConnection(config: MCPConnectionConfig): Promise<MCPConnectionState> {
    const existing = this.connections.get(config.id)
    if (existing) {
      await this.disconnect(config.id)
    }

    const state: MCPConnectionState = {
      id: config.id,
      config,
      status: 'disconnected',
      tools: [],
    }
    this.connections.set(config.id, state)

    if (config.enabled) {
      await this.connect(config.id)
    }

    return state
  }

  async connect(serverId: string): Promise<void> {
    const state = this.connections.get(serverId)
    if (!state) throw new Error(`MCP connection "${serverId}" not found`)

    state.status = 'connecting'
    state.error = undefined

    try {
      if (state.config.transport === 'stdio') {
        const { StdioBridge } = await import('./stdio-bridge')
        const bridge = new StdioBridge()
        if (!bridge.isAvailable()) {
          throw new Error('stdio transport requires Tauri environment')
        }
        const cmd = state.config.command
        if (!cmd) throw new Error('stdio transport requires "command" in config')
        await bridge.spawnServer(serverId, cmd, state.config.args || [])
        state.status = 'connected'
        state.tools = []
        state.error = 'stdio transport: process spawned, JSON-RPC forwarding not yet implemented'
        return
      }

      const url = state.config.url
      if (!url) throw new Error('HTTP/SSE transport requires "url" in config')

      const transport = new MCPHttpTransport(url, state.config.headers)
      await transport.initialize()

      this.transports.set(serverId, transport)
      state.status = 'connected'

      try {
        state.tools = await transport.listTools()
      } catch (listErr) {
        state.status = 'error'
        state.error = `Connected but listTools failed: ${listErr instanceof Error ? listErr.message : String(listErr)}`
        console.error(`[MCP] listTools "${serverId}" failed:`, state.error)
        return
      }

      if (this.toolBus) {
        const adapted = this.adapter.adaptAll(state.tools, serverId, (name, args) =>
          this.callTool(serverId, name, args),
        )
        this.toolBus.registerMcpTools(serverId, adapted)
      }

      if (this.onToolsChanged) await this.onToolsChanged()
    } catch (err) {
      state.status = 'error'
      state.error = err instanceof Error ? err.message : String(err)
      console.error(`[MCP] Connection "${serverId}" failed:`, state.error)
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const state = this.connections.get(serverId)

    if (state?.config.transport === 'stdio') {
      try {
        const { StdioBridge } = await import('./stdio-bridge')
        const bridge = new StdioBridge()
        await bridge.killServer(serverId)
      } catch {}
    }

    const transport = this.transports.get(serverId)
    if (transport) {
      await transport.close()
      this.transports.delete(serverId)
    }

    if (state) {
      state.status = 'disconnected'
      state.tools = []
    }

    if (this.toolBus) {
      this.toolBus.unregisterMcpServer(serverId)
    }

    if (this.onToolsChanged) await this.onToolsChanged()
  }

  async removeConnection(serverId: string): Promise<void> {
    await this.disconnect(serverId)
    this.connections.delete(serverId)
  }

  async refreshTools(serverId: string): Promise<MCPToolInfo[]> {
    const transport = this.transports.get(serverId)
    if (!transport) return []

    const state = this.connections.get(serverId)
    if (state) {
      state.tools = await transport.listTools()

      if (this.toolBus) {
        this.toolBus.unregisterMcpServer(serverId)
        const adapted = this.adapter.adaptAll(state.tools, serverId, (name, args) =>
          this.callTool(serverId, name, args),
        )
        this.toolBus.registerMcpTools(serverId, adapted)
      }

      if (this.onToolsChanged) await this.onToolsChanged()
    }

    return state?.tools || []
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const transport = this.transports.get(serverId)
    if (!transport) throw new Error(`MCP connection "${serverId}" not connected`)
    return transport.callTool(toolName, args)
  }

  getConnectionStates(): MCPConnectionState[] {
    return [...this.connections.values()]
  }

  getState(serverId: string): MCPConnectionState | undefined {
    return this.connections.get(serverId)
  }

  async dispose(): Promise<void> {
    for (const [id] of this.connections) {
      await this.disconnect(id)
    }
    this.connections.clear()
  }
}
