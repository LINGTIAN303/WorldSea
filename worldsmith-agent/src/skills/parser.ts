/**
 * SKILL.md / skill.yaml frontmatter 解析器
 *
 * 从 loader.ts 提取，供 loader.ts 和 manifest.ts 共用，避免循环依赖。
 *
 * 支持格式：
 * - SKILL.md：`---\n<yaml>\n---\n<body>` 标准 frontmatter
 * - skill.yaml：无 --- 分隔的纯 YAML（由调用方包装后传入）
 *
 * 解析能力（覆盖 WorldSmith 原生 skill.yaml + Claude Code SKILL.md 两种格式）：
 * - 标量字段：id/name/description/icon/category/priority/auto-activate/license/compatibility/enabled/version
 * - 列表字段：allowed-tools/allowedTools、baseTools/base-tools、triggers、tags
 * - 嵌套对象：capabilities.internal/cli/mcp、schema-context.entity-types
 *
 * 同时识别连字符（allowed-tools）和驼峰（allowedTools）两种 key 风格，
 * 确保多平台技能格式互通（Task 24 阶段4 多平台适配器基础）。
 */

import type { SkillCapabilityBinding, SkillSchemaContext } from '../toolbus/capability-types'

/** 解析后的 SKILL.md / skill.yaml 数据结构 */
export interface ParsedSkillMd {
  frontmatter: {
    name: string
    description: string
    allowedTools: string[]
    baseTools: string[]
    capabilities?: SkillCapabilityBinding
    schemaContext?: SkillSchemaContext
    triggers?: string[]
    tags?: string[]
    priority?: number
    autoActivate?: boolean
    category?: 'domain' | 'action' | 'persona'
    icon?: string
    id?: string
    license?: string
    compatibility?: string
    version?: string
    enabled?: boolean
    metadata?: Record<string, string>
  }
  body: string
}

/**
 * 解析 YAML frontmatter
 *
 * 支持格式：
 *   ---
 *   name: xxx
 *   description: xxx
 *   allowed-tools:        # 或 allowedTools
 *     - tool_a
 *   capabilities:
 *     internal:
 *       - entity.list
 *   ---
 *   (body)
 *
 * 注意：这是一个简化的行级解析器，不是完整的 YAML 解析器。
 * 支持一层嵌套列表（capabilities 下的 internal/cli/mcp，schema-context 下的 entity-types）。
 */
export function parseFrontmatter(raw: string): ParsedSkillMd {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) {
    return {
      frontmatter: { name: '', description: '', allowedTools: [], baseTools: [] },
      body: raw,
    }
  }

  const yaml = match[1]
  const body = match[2]
  const fm: ParsedSkillMd['frontmatter'] = { name: '', description: '', allowedTools: [], baseTools: [] }

  let inAllowedTools = false
  let inBaseTools = false
  let inCapabilitiesInternal = false
  let inCapabilitiesCli = false
  let inCapabilitiesMcp = false
  let inSchemaContextEntityTypes = false
  let inTriggers = false
  let inTags = false
  let inCapabilities = false
  let inSchemaContext = false

  const internalArr: string[] = []
  const cliArr: string[] = []
  const mcpArr: string[] = []
  const entityTypesArr: string[] = []
  const triggersArr: string[] = []
  const tagsArr: string[] = []

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    if (inAllowedTools) {
      if (trimmed.startsWith('- ')) {
        fm.allowedTools.push(trimmed.slice(2).trim())
        continue
      }
      inAllowedTools = false
    }

    if (inBaseTools) {
      if (trimmed.startsWith('- ')) {
        fm.baseTools.push(trimmed.slice(2).trim())
        continue
      }
      inBaseTools = false
    }

    if (inCapabilitiesInternal) {
      if (trimmed.startsWith('- ')) { internalArr.push(trimmed.slice(2).trim()); continue }
      inCapabilitiesInternal = false
    }

    if (inCapabilitiesCli) {
      if (trimmed.startsWith('- ')) { cliArr.push(trimmed.slice(2).trim()); continue }
      inCapabilitiesCli = false
    }

    if (inCapabilitiesMcp) {
      if (trimmed.startsWith('- ')) { mcpArr.push(trimmed.slice(2).trim()); continue }
      inCapabilitiesMcp = false
    }

    if (inSchemaContextEntityTypes) {
      if (trimmed.startsWith('- ')) { entityTypesArr.push(trimmed.slice(2).trim()); continue }
      inSchemaContextEntityTypes = false
    }

    if (inTriggers) {
      if (trimmed.startsWith('- ')) { triggersArr.push(trimmed.slice(2).trim()); continue }
      inTriggers = false
    }

    if (inTags) {
      if (trimmed.startsWith('- ')) { tagsArr.push(trimmed.slice(2).trim()); continue }
      inTags = false
    }

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx < 0) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const val = trimmed.slice(colonIdx + 1).trim()

    if (key === 'name') fm.name = val
    else if (key === 'description') fm.description = val
    else if (key === 'allowed-tools' || key === 'allowedTools') inAllowedTools = true
    else if (key === 'base-tools' || key === 'baseTools') inBaseTools = true
    else if (key === 'license') fm.license = val
    else if (key === 'compatibility') fm.compatibility = val
    else if (key === 'id') fm.id = val
    else if (key === 'icon') fm.icon = val
    else if (key === 'version') fm.version = val
    else if (key === 'enabled') fm.enabled = val === 'true'
    else if (key === 'category' && ['domain', 'action', 'persona'].includes(val)) fm.category = val as any
    else if (key === 'priority') fm.priority = Number(val) || undefined
    else if (key === 'auto-activate' || key === 'autoActivate') fm.autoActivate = val === 'true'
    else if (key === 'capabilities') inCapabilities = true
    else if (inCapabilities && key === 'internal') inCapabilitiesInternal = true
    else if (inCapabilities && key === 'cli') inCapabilitiesCli = true
    else if (inCapabilities && key === 'mcp') inCapabilitiesMcp = true
    else if (key === 'schema-context' || key === 'schemaContext') inSchemaContext = true
    else if (inSchemaContext && (key === 'entity-types' || key === 'entityTypes') && (val === '' || val.startsWith('[') === false)) inSchemaContextEntityTypes = true
    else if (key === 'triggers') inTriggers = true
    else if (key === 'tags' && (val === '' || val === '[]')) inTags = true
  }

  if (internalArr.length > 0 || cliArr.length > 0 || mcpArr.length > 0) {
    fm.capabilities = { internal: internalArr, cli: cliArr, mcp: mcpArr }
  }
  if (entityTypesArr.length > 0) {
    fm.schemaContext = { entityTypes: entityTypesArr, fieldPolicy: 'prefer-defined' }
  }
  if (triggersArr.length > 0) fm.triggers = triggersArr
  if (tagsArr.length > 0) fm.tags = tagsArr

  if (!fm.capabilities && fm.allowedTools.length > 0) {
    fm.capabilities = { internal: fm.allowedTools, cli: [], mcp: [] }
  }

  return { frontmatter: fm, body }
}
