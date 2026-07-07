/**
 * 工具总线
 *
 * 工具注册、解析和分发的核心总线。
 * 整合 ToolRegistry + SkillRegistry + MCP 工具，
 * 为 Agent 提供统一的工具集解析入口。
 */

import type { ToolDefinition, Platform } from '../types'
import type { ToolRegistry } from '../registry/tool-registry'
import type { SkillRegistry } from '../registry/skill-registry'

export interface ToolBus {
  /** 注册内部工具 */
  register(tool: ToolDefinition): void

  /** 注销工具 */
  unregister(name: string): void

  /** 注册 MCP 服务器工具 */
  registerMcpTools(serverId: string, tools: ToolDefinition[]): void

  /** 注销 MCP 服务器工具 */
  unregisterMcpServer(serverId: string): void

  /** 根据激活技能解析可用工具集 */
  resolve(skillIds: string[], platform?: Platform): ToolDefinition[]

  /** 获取所有已注册工具 */
  getAll(): ToolDefinition[]

  /** 按名称获取工具 */
  getByName(name: string): ToolDefinition | undefined
}

export class DefaultToolBus implements ToolBus {
  private mcp = new Map<string, Map<string, ToolDefinition>>()
  private metaTools: ToolDefinition[] = []

  private toolRegistry: ToolRegistry
  private skillRegistry: SkillRegistry

  constructor(toolRegistry: ToolRegistry, skillRegistry: SkillRegistry) {
    this.toolRegistry = toolRegistry
    this.skillRegistry = skillRegistry
  }

  register(tool: ToolDefinition): void {
    this.toolRegistry.register(tool)
  }

  unregister(name: string): void {
    this.toolRegistry.unregister(name)
  }

  registerMcpTools(serverId: string, tools: ToolDefinition[]): void {
    const serverTools = new Map<string, ToolDefinition>()
    for (const t of tools) {
      serverTools.set(t.name, t)
    }
    this.mcp.set(serverId, serverTools)
  }

  unregisterMcpServer(serverId: string): void {
    this.mcp.delete(serverId)
  }

  /**
   * 注册技能元工具（load_skill / load_skill_reference / load_skill_asset）
   */
  setMetaTools(tools: ToolDefinition[]): void {
    this.metaTools = tools
  }

  resolve(skillIds: string[], platform?: Platform): ToolDefinition[] {
    const p = platform || 'web'
    const tools: ToolDefinition[] = []
    const seen = new Set<string>()

    // 1. 从 SkillRegistry 解析工具名，再从 ToolRegistry 获取定义
    const names = this.skillRegistry.resolveToolNames(skillIds, this.toolRegistry)
    for (const name of names) {
      const t = this.toolRegistry.get(name)
      if (t && !seen.has(t.name)) {
        // 平台过滤
        if (t.meta.platforms && t.meta.platforms.length > 0 && !t.meta.platforms.includes(p)) {
          continue
        }
        tools.push(t)
        seen.add(t.name)
      }
    }

    // 2. 技能元工具
    for (const t of this.metaTools) {
      if (!seen.has(t.name)) {
        tools.push(t)
        seen.add(t.name)
      }
    }

    // 3. MCP 工具
    for (const serverTools of this.mcp.values()) {
      for (const t of serverTools.values()) {
        if (!seen.has(t.name)) {
          tools.push(t)
          seen.add(t.name)
        }
      }
    }

    return tools
  }

  getAll(): ToolDefinition[] {
    const tools: ToolDefinition[] = []
    const seen = new Set<string>()

    for (const t of this.toolRegistry.getAll()) {
      if (!seen.has(t.name)) { tools.push(t); seen.add(t.name) }
    }
    for (const serverTools of this.mcp.values()) {
      for (const t of serverTools.values()) {
        if (!seen.has(t.name)) { tools.push(t); seen.add(t.name) }
      }
    }
    return tools
  }

  getByName(name: string): ToolDefinition | undefined {
    const internal = this.toolRegistry.get(name)
    if (internal) return internal
    for (const serverTools of this.mcp.values()) {
      const found = serverTools.get(name)
      if (found) return found
    }
    return undefined
  }
}
