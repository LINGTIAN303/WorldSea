import { describe, it, expect } from 'vitest'
import { ALL_TOOLS, TOOL_CATEGORIES, getToolsForSkills } from '../agent'

describe('ALL_TOOLS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(ALL_TOOLS)).toBe(true)
    expect(ALL_TOOLS.length).toBeGreaterThan(0)
  })

  it('contains tool objects with name and description', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool).toHaveProperty('name')
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(tool).toHaveProperty('description')
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it('has unique tool names', () => {
    const names = ALL_TOOLS.map(t => t.name)
    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(names.length)
  })
})

describe('TOOL_CATEGORIES', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(TOOL_CATEGORIES)).toBe(true)
    expect(TOOL_CATEGORIES.length).toBeGreaterThan(0)
  })

  it('contains category objects with id, label, and tools', () => {
    for (const cat of TOOL_CATEGORIES) {
      expect(cat).toHaveProperty('id')
      expect(typeof cat.id).toBe('string')
      expect(cat.id.length).toBeGreaterThan(0)
      expect(cat).toHaveProperty('label')
      expect(typeof cat.label).toBe('string')
      expect(cat.label.length).toBeGreaterThan(0)
      expect(cat).toHaveProperty('tools')
      expect(Array.isArray(cat.tools)).toBe(true)
    }
  })

  it('labels are Chinese strings', () => {
    const chineseRegex = /[\u4e00-\u9fff]/
    for (const cat of TOOL_CATEGORIES) {
      expect(chineseRegex.test(cat.label)).toBe(true)
    }
  })

  it('each category has unique id', () => {
    const ids = TOOL_CATEGORIES.map(c => c.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('each category\'s tools are a subset of ALL_TOOLS', () => {
    const allToolNames = new Set(ALL_TOOLS.map(t => t.name))
    for (const cat of TOOL_CATEGORIES) {
      for (const tool of cat.tools) {
        expect(allToolNames.has(tool.name)).toBe(true)
      }
    }
  })

  it('all tools from all categories combined equals ALL_TOOLS (no duplicates, no missing)', () => {
    const categoryToolNames = TOOL_CATEGORIES.flatMap(c => c.tools.map(t => t.name))
    const allToolNames = ALL_TOOLS.map(t => t.name)

    const categorySet = new Set(categoryToolNames)
    const allSet = new Set(allToolNames)

    // Every category tool must be in ALL_TOOLS
    for (const name of categoryToolNames) {
      expect(allSet.has(name)).toBe(true)
    }

    // Category tools cover ALL_TOOLS except SKILL_META_TOOLS (load_skill, etc.)
    // which are always available but not shown in any category
    const skillMetaNames = new Set(['load_skill', 'load_skill_reference', 'load_skill_asset'])
    const uncategorized = allToolNames.filter(n => !categorySet.has(n))
    // Any uncategorized tools should only be skill meta tools
    for (const name of uncategorized) {
      expect(skillMetaNames.has(name)).toBe(true)
    }
  })
})

describe('getToolsForSkills', () => {
  it('returns tools for known skill IDs', () => {
    const tools = getToolsForSkills(['worldbuilding'])
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0)
    // Should include base tools from the skill
    const toolNames = tools.map(t => t.name)
    expect(toolNames).toContain('entity_list')
    expect(toolNames).toContain('entity_get')
    // Should include skill meta tools (load_skill, load_skill_reference, load_skill_asset)
    expect(toolNames).toContain('load_skill')
  })

  it('returns only always-available + meta tools for unknown skill IDs', () => {
    const tools = getToolsForSkills(['nonexistent-skill-xyz'])
    expect(Array.isArray(tools)).toBe(true)
    // Unknown skills don't add any skill-specific tools,
    // but ALWAYS_AVAILABLE_TOOLS and SKILL_META_TOOLS are always present
    const toolNames = tools.map(t => t.name)
    // Should include skill meta tools
    expect(toolNames).toContain('load_skill')
    // Should include always-available tools
    expect(toolNames).toContain('entity_list')
    expect(toolNames).toContain('entity_get')
    // Should NOT include skill-specific tools like entity_create
    expect(toolNames).not.toContain('entity_create')
  })

  it('returns more tools when multiple skills are activated', () => {
    const singleTools = getToolsForSkills(['worldbuilding'])
    const multiTools = getToolsForSkills(['worldbuilding', 'content-craft'])
    expect(multiTools.length).toBeGreaterThan(singleTools.length)
  })

  it('deduplicates tools across skills', () => {
    const tools = getToolsForSkills(['worldbuilding', 'content-craft'])
    const names = tools.map(t => t.name)
    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(names.length)
  })
})

describe('声明式 meta 覆盖（LEGACY_TOOL_META 淘汰前提）', () => {
  it('所有 ALL_TOOLS 工具都声明了 meta（permission + category）', () => {
    // 任务3 后续：补全声明式 meta 后，LEGACY_TOOL_META 不再必要。
    // 本测试验证淘汰前提：每个活跃工具都有 meta，ToolRegistry 即可覆盖所有旧工具名。
    for (const tool of ALL_TOOLS) {
      expect(tool.meta, `工具 ${tool.name} 缺少声明式 meta`).toBeDefined()
      expect(tool.meta!.permission, `工具 ${tool.name} 缺少 permission`).toBeDefined()
      expect(tool.meta!.category, `工具 ${tool.name} 缺少 category`).toBeDefined()
    }
  })
})
