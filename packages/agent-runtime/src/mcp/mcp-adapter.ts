import type { ToolDefinition, ToolParameter } from '../bridge-types'
import type { MCPToolInfo } from './types'
import type { IToolContext } from '../toolbus/types'

function convertMCPParamsToToolParams(inputSchema: Record<string, unknown>): Record<string, ToolParameter> {
  const properties = (inputSchema.properties || {}) as Record<string, any>
  const required = new Set<string>(inputSchema.required as string[] || [])
  const params: Record<string, ToolParameter> = {}

  for (const [name, schema] of Object.entries(properties)) {
    const param: ToolParameter = {
      type: mapJsonSchemaType(schema.type),
      description: schema.description || '',
      required: required.has(name),
    }
    if (schema.enum) param.enum = schema.enum
    if (schema.type === 'array' && schema.items) {
      param.items = {
        type: mapJsonSchemaType(schema.items.type),
        description: schema.items.description || '',
      }
      if (schema.items.enum) param.items.enum = schema.items.enum
    }
    params[name] = param
  }

  return params
}

function mapJsonSchemaType(type: string | string[]): 'string' | 'number' | 'boolean' | 'array' | 'object' {
  if (Array.isArray(type)) {
    const filtered = type.filter(t => t !== 'null')
    return mapJsonSchemaType(filtered[0] || 'string')
  }
  switch (type) {
    case 'integer':
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    case 'array': return 'array'
    case 'object': return 'object'
    default: return 'string'
  }
}

function extractTextResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const r = result as any
    if (Array.isArray(r.content)) {
      return r.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n')
    }
    if (typeof r.content === 'string') return r.content
  }
  return JSON.stringify(result)
}

const FIRECRAWL_GUIDANCE =
  '（Firecrawl 免 Key 服务：优先用于网页搜索、整站爬取、站点地图扫描；' +
  '单页静态内容兜底请用 web_fetch，JS 渲染/反检测/批量单页请用 web_crawl。）'

function buildMcpDescription(toolInfo: MCPToolInfo, serverId: string): string {
  const base = `[MCP:${serverId}] ${toolInfo.description}`
  if (serverId === 'firecrawl-keyless') {
    return `${base} ${FIRECRAWL_GUIDANCE}`
  }
  return base
}

export class MCPToolAdapter {
  adapt(
    toolInfo: MCPToolInfo,
    serverId: string,
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  ): ToolDefinition {
    const mcpPrefixedName = `mcp_${serverId}_${toolInfo.name}`
    return {
      name: mcpPrefixedName,
      description: buildMcpDescription(toolInfo, serverId),
      parameters: convertMCPParamsToToolParams(toolInfo.inputSchema),
      execute: async (args: Record<string, unknown>, _ctx: IToolContext) => {
        const result = await callTool(toolInfo.name, args)
        return extractTextResult(result)
      },
    }
  }

  adaptAll(
    tools: MCPToolInfo[],
    serverId: string,
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  ): ToolDefinition[] {
    return tools.map(t => this.adapt(t, serverId, callTool))
  }
}
