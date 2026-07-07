/**
 * 技能注册中心
 *
 * 声明式技能管理，替代 registry.ts 中的硬编码 SKILL_REGISTRY 数组。
 * 核心能力：
 * - 注册技能声明
 * - 按激活技能合并可用工具集
 * - 按可见性过滤
 * - 技能索引提示词生成
 */

import type {
  SkillDeclaration,
  SkillCategory,
} from '../types'
import type { ToolRegistry } from './tool-registry'

export class SkillRegistry {
  private skills = new Map<string, SkillDeclaration>()

  /**
   * 注册一个技能
   */
  register(skill: SkillDeclaration): void {
    this.skills.set(skill.id, skill)
  }

  /**
   * 批量注册技能
   */
  registerAll(skills: SkillDeclaration[]): void {
    for (const skill of skills) {
      this.register(skill)
    }
  }

  /**
   * 注销技能
   */
  unregister(id: string): void {
    this.skills.delete(id)
  }

  /**
   * 获取技能声明
   */
  get(id: string): SkillDeclaration | undefined {
    return this.skills.get(id)
  }

  /**
   * 获取所有技能
   */
  getAll(): SkillDeclaration[] {
    return [...this.skills.values()]
  }

  /**
   * 获取已启用的技能
   */
  getEnabled(): SkillDeclaration[] {
    return this.getAll().filter(s => s.enabled)
  }

  /**
   * 按可见性过滤技能
   */
  getVisible(developerMode: boolean, advancedMode: boolean): SkillDeclaration[] {
    return this.getEnabled().filter(s => {
      if (s.visibility === 'hidden') return false
      if (s.visibility === 'always') return true
      if (s.visibility === 'advanced' && (advancedMode || developerMode)) return true
      if (s.visibility === 'developer' && developerMode) return true
      return false
    })
  }

  /**
   * 按分类查询技能
   */
  getByCategory(category: SkillCategory): SkillDeclaration[] {
    return this.getAll().filter(s => s.category === category)
  }

  /**
   * 根据激活技能合并可用工具名
   *
   * 替代 registry.ts 中的 resolveToolNames 硬编码逻辑。
   * 合并规则：
   * 1. 始终可用工具（从 ToolRegistry 自动聚合）
   * 2. 每个激活技能的 baseTools
   * 3. 每个激活技能的 allowedTools
   */
  resolveToolNames(
    activeSkillIds: string[],
    toolRegistry: ToolRegistry,
  ): string[] {
    const tools = new Set(toolRegistry.getAlwaysAvailable())

    for (const id of activeSkillIds) {
      const skill = this.skills.get(id)
      if (!skill) continue

      for (const t of skill.baseTools) {
        tools.add(toolRegistry.resolveName(t))
      }
      for (const t of skill.allowedTools) {
        tools.add(toolRegistry.resolveName(t))
      }
    }

    return [...tools]
  }

  /**
   * 根据激活技能获取工具定义
   */
  resolveTools(
    activeSkillIds: string[],
    toolRegistry: ToolRegistry,
  ): import('../types').ToolDefinition[] {
    const names = this.resolveToolNames(activeSkillIds, toolRegistry)
    const tools: import('../types').ToolDefinition[] = []
    const seen = new Set<string>()

    for (const name of names) {
      const tool = toolRegistry.get(name)
      if (tool && !seen.has(tool.name)) {
        tools.push(tool)
        seen.add(tool.name)
      }
    }

    return tools
  }

  /**
   * 生成技能索引提示词
   *
   * 用于系统提示词中列出可用技能。
   */
  buildIndexPrompt(developerMode: boolean, advancedMode: boolean): string {
    const visible = this.getVisible(developerMode, advancedMode)
    if (visible.length === 0) return ''

    const lines = visible.map(s => {
      const triggerStr = s.triggers?.length ? ` | 触发词: ${s.triggers.join('/')}` : ''
      return `- ${s.icon} **${s.name}** (\`${s.id}\`): ${s.description}${triggerStr}`
    })

    return `## 可用技能\n\n使用 \`load_skill\` 工具激活技能。可用技能列表：\n\n${lines.join('\n')}`
  }

  /**
   * 切换技能启用状态
   */
  toggle(id: string): boolean {
    const skill = this.skills.get(id)
    if (!skill) return false
    skill.enabled = !skill.enabled
    return true
  }

  /**
   * 获取技能数量
   */
  get size(): number {
    return this.skills.size
  }

  /**
   * 检查技能是否已注册
   */
  has(id: string): boolean {
    return this.skills.has(id)
  }
}

/** 全局单例 */
let _globalSkillRegistry: SkillRegistry | null = null

export function getGlobalSkillRegistry(): SkillRegistry {
  if (!_globalSkillRegistry) {
    _globalSkillRegistry = new SkillRegistry()
  }
  return _globalSkillRegistry
}

export function resetGlobalSkillRegistry(): void {
  _globalSkillRegistry = null
}
