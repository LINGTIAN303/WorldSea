export type MCPTransportType = 'streamable-http' | 'sse' | 'stdio'

export interface MCPConnectionConfig {
  id: string
  name: string
  transport: MCPTransportType
  url?: string
  command?: string
  args?: string[]
  enabled: boolean
  /** 自定义请求头（鉴权等）。数组元素为 [键, 值]，与 Rust McpConnectionConfig.headers（Vec<(String,String)>）对齐 */
  headers?: Array<[string, string]>
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
  /** 已连接服务器的工具数（来自 cmd_mcp_status 的 tool_count；tools 明细按需经 cmd_mcp_list_tools 拉取） */
  toolCount?: number
  error?: string
}
