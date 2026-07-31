export type MCPTransportType = 'streamable-http' | 'sse' | 'stdio'

export interface MCPConnectionConfig {
  id: string
  name: string
  transport: MCPTransportType
  url?: string
  command?: string
  args?: string[]
  enabled: boolean
  headers?: Record<string, string>
}

export interface MCPToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MCPConnectionState {
  id: string
  config: MCPConnectionConfig
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  tools: MCPToolInfo[]
  error?: string
}
