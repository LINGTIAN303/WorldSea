import type { ToolDefinition } from '../bridge-types'
import type { Platform } from './capability-types'
import { InternalChainRegistry } from './internal-registry'
import { findSkillById, resolveToolNames } from '../skills/registry'
import { resolvePluginToolNames } from '../skills/plugin-bridge'
import { SKILL_META_TOOLS } from '../skills/meta-tools'
import { getGlobalToolRegistry, getGlobalSkillRegistry } from '@worldsmith/agent-core'

export interface ToolBus {
  register(tool: ToolDefinition): void
  unregister(name: string): void
  registerInternal(registry: InternalChainRegistry): void
  registerMcpTools(serverId: string, tools: ToolDefinition[]): void
  unregisterMcpServer(serverId: string): void
  resolve(skillIds: string[], platform?: Platform): ToolDefinition[]
  getAll(): ToolDefinition[]
  getByName(name: string): ToolDefinition | undefined
  getInternalRegistry(): InternalChainRegistry | null
}

export class DefaultToolBus implements ToolBus {
  private internal = new Map<string, ToolDefinition>()
  private internalRegistry: InternalChainRegistry | null = null
  private mcp = new Map<string, Map<string, ToolDefinition>>()

  register(tool: ToolDefinition): void {
    this.internal.set(tool.name, tool)
  }

  unregister(name: string): void {
    this.internal.delete(name)
  }

  registerInternal(registry: InternalChainRegistry): void {
    this.internalRegistry = registry
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
   * 根据激活技能解析可用工具集
   *
   * 任务3 接线后采用三层数据源：
   * 1. 全局 SkillRegistry.resolveToolNames（声明式，从 ToolRegistry.getAlwaysAvailable 起步）
   * 2. 旧 resolveToolNames/resolvePluginToolNames（兼容本地 SKILL_REGISTRY 的 capabilities/pluginTools）
   * 3. InternalChainRegistry.resolve（能力链，entity-core/plugin-sdk/canvas-engine）
   *
   * 注意：bridge.ts 当前不调用 resolve（走 getToolsForSkills → config.tools → register），
   * 此方法供未来 resolveToolsForAgent 及动态技能切换使用。
   */
  resolve(skillIds: string[], platform?: Platform): ToolDefinition[] {
    const p = platform || 'web'

    if (this.internalRegistry) {
      return this.resolveWithRegistry(skillIds, p)
    }

    return this.resolveLegacy(skillIds)
  }

  private resolveWithRegistry(skillIds: string[], platform: Platform): ToolDefinition[] {
    const legacyNames = this.resolveLegacyNames(skillIds)
    const registryTools = this.resolveFromRegistry(skillIds, platform)
    const tools: ToolDefinition[] = []
    const seen = new Set<string>()

    for (const name of legacyNames) {
      const t = this.internal.get(name)
      if (t && !seen.has(name)) {
        tools.push(t)
        seen.add(name)
      }
    }

    for (const t of registryTools) {
      if (!seen.has(t.name)) {
        tools.push(t)
        seen.add(t.name)
      }
    }

    for (const t of SKILL_META_TOOLS) {
      if (!seen.has(t.name)) {
        tools.push(t)
        seen.add(t.name)
      }
    }

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

  private resolveFromRegistry(skillIds: string[], platform: Platform): ToolDefinition[] {
    if (!this.internalRegistry) return []
    const capabilityIds = new Set<string>()
    for (const id of skillIds) {
      const skill = findSkillById(id)
      if (skill?.capabilities) {
        for (const capId of skill.capabilities.internal) capabilityIds.add(capId)
        for (const capId of skill.capabilities.cli) capabilityIds.add(capId)
        for (const capId of skill.capabilities.mcp) capabilityIds.add(capId)
      }
    }
    if (capabilityIds.size === 0) return []
    return this.internalRegistry.resolve([...capabilityIds], platform)
  }

  private resolveLegacyNames(skillIds: string[]): string[] {
    // 任务3 收尾：声明式 SkillRegistry.resolveToolNames 已等价旧 resolveToolNames
    // （alwaysAvailable meta 对齐后，getAlwaysAvailable() == ALWAYS_AVAILABLE_TOOLS），
    // 移除旧 resolveToolNames 冗余并集；保留 resolvePluginToolNames（插件工具，SkillRegistry 不含）
    const skillRegistry = getGlobalSkillRegistry()
    const toolRegistry = getGlobalToolRegistry()
    const declarativeNames = skillRegistry.size > 0
      ? skillRegistry.resolveToolNames(skillIds, toolRegistry)
      : resolveToolNames(skillIds) // fallback：SkillRegistry 未注册时（模块加载时已注册，理论上不触发）
    const pluginNames = resolvePluginToolNames(skillIds)
    return [...new Set([...declarativeNames, ...pluginNames])]
  }

  private resolveLegacy(skillIds: string[]): ToolDefinition[] {
    const internalNames = resolveToolNames(skillIds)
    const pluginNames = resolvePluginToolNames(skillIds)
    const allNames = new Set([...internalNames, ...pluginNames])
    const tools: ToolDefinition[] = []
    const seen = new Set<string>()

    for (const name of allNames) {
      const t = this.internal.get(name)
      if (t && !seen.has(name)) {
        tools.push(t)
        seen.add(name)
      }
    }

    for (const t of SKILL_META_TOOLS) {
      if (!seen.has(t.name)) {
        tools.push(t)
        seen.add(t.name)
      }
    }

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
    for (const t of this.internal.values()) {
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
    const internal = this.internal.get(name)
    if (internal) return internal
    for (const serverTools of this.mcp.values()) {
      const found = serverTools.get(name)
      if (found) return found
    }
    return undefined
  }

  getInternalRegistry(): InternalChainRegistry | null {
    return this.internalRegistry
  }
}
