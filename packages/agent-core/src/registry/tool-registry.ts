/** 工具注册中心（元数据注册/查询/别名/平台过滤），详细见 docs/details/注释/packages/agent-core/registry/tool-registry.md */

import type {
  ToolDefinition,
  ToolMeta,
  PermissionLevel,
  ToolCategoryId,
  Platform,
} from '../types'

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()
  private aliasMap = new Map<string, string>() // alias → canonical name

  /**
   * 注册一个工具
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)

    // 注册别名
    if (tool.meta.aliases) {
      for (const alias of tool.meta.aliases) {
        this.aliasMap.set(alias, tool.name)
      }
    }
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
  }

  /**
   * 注销工具
   */
  unregister(name: string): void {
    const tool = this.tools.get(name)
    if (tool?.meta.aliases) {
      for (const alias of tool.meta.aliases) {
        this.aliasMap.delete(alias)
      }
    }
    this.tools.delete(name)
  }

  /**
   * 获取工具定义（支持别名解析）
   */
  get(name: string): ToolDefinition | undefined {
    const canonical = this.aliasMap.get(name)
    return this.tools.get(canonical || name)
  }

  /**
   * 获取工具元数据（支持别名解析）
   */
  getMeta(name: string): ToolMeta | undefined {
    return this.get(name)?.meta
  }

  /**
   * 解析工具名为规范名（别名→规范名）
   */
  resolveName(name: string): string {
    return this.aliasMap.get(name) || name
  }

  /**
   * 获取所有已注册工具
   */
  getAll(): ToolDefinition[] {
    return [...this.tools.values()]
  }

  /**
   * 获取所有工具名
   */
  getAllNames(): string[] {
    return [...this.tools.keys()]
  }

  /**
   * 按权限级别查询工具名
   *
   * 替代 useAgent.ts 中的 SAFE_TOOLS / MODERATE_TOOLS / DANGEROUS_TOOLS 硬编码列表。
   */
  getByPermission(level: PermissionLevel): string[] {
    return [...this.tools.values()]
      .filter(t => t.meta.permission === level)
      .map(t => t.name)
  }

  /**
   * 按分类查询工具
   */
  getByCategory(category: ToolCategoryId): ToolDefinition[] {
    return [...this.tools.values()]
      .filter(t => t.meta.category === category)
  }

  /**
   * 按平台过滤工具
   */
  getByPlatform(platform: Platform): ToolDefinition[] {
    return [...this.tools.values()]
      .filter(t => {
        if (!t.meta.platforms || t.meta.platforms.length === 0) return true
        return t.meta.platforms.includes(platform)
      })
  }

  /**
   * 获取所有始终可用的工具名
   *
   * 替代 registry.ts 中的 ALWAYS_AVAILABLE_TOOLS 硬编码列表。
   * 从工具元数据自动聚合，新增工具时只需声明 alwaysAvailable: true。
   */
  getAlwaysAvailable(): string[] {
    return [...this.tools.values()]
      .filter(t => t.meta.alwaysAvailable)
      .map(t => t.name)
  }

  /**
   * 获取所有别名映射
   */
  getAliasMap(): ReadonlyMap<string, string> {
    return this.aliasMap
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size
  }

  /**
   * 检查工具是否已注册
   */
  has(name: string): boolean {
    return this.tools.has(name) || this.aliasMap.has(name)
  }
}

/** 全局单例 */
let _globalRegistry: ToolRegistry | null = null

export function getGlobalToolRegistry(): ToolRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new ToolRegistry()
  }
  return _globalRegistry
}

export function resetGlobalToolRegistry(): void {
  _globalRegistry = null
}
