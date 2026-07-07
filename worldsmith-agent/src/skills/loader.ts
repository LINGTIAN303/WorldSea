/**
 * Skill 加载器
 *
 * 负责动态加载 Skill 的提示词文件（SKILL.md / instructions.md）、参考文献和资源文件。
 * 使用 Vite 的 import.meta.glob 实现懒加载，并通过内存缓存避免重复读取。
 *
 * SKILL.md 格式：YAML frontmatter（元数据） + Markdown body（Agent 提示词）
 * 本模块包含一个内联的 YAML frontmatter 解析器（parseFrontmatter）。
 */

import { findSkillById, getEnabledSkills, isInstalledSkill, getInstalledSkillDir } from './registry'
import type { SkillMeta } from './registry'
import { readInstalledSkillFile } from './manifest'
import type { SkillCapabilityBinding, SkillSchemaContext } from '../toolbus/capability-types'

/** 解析后的 SKILL.md 数据结构 */
interface ParsedSkillMd {
  frontmatter: {
    name: string
    description: string
    allowedTools: string[]
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
    metadata?: Record<string, string>
  }
  body: string
}

/** 内存缓存：已加载的 Skill 提示词 */
const skillCache = new Map<string, string>()
/** 内存缓存：已加载的参考文档 */
const referenceCache = new Map<string, string>()
/** 内存缓存：已加载的资源文件 */
const assetCache = new Map<string, string>()

/**
 * 解析 YAML frontmatter
 *
 * 支持格式：
 *   ---
 *   name: xxx
 *   description: xxx
 *   allowed-tools:
 *     - tool_a
 *     - tool_b
 *   ---
 *   (body)
 *
 * 注意：这是一个简化的行级解析器，不是完整的 YAML 解析器。
 * 只支持嵌套一层列表（capabilities 下的 internal/cli/mcp）。
 */
export function parseFrontmatter(raw: string): ParsedSkillMd {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) {
    return {
      frontmatter: { name: '', description: '', allowedTools: [] },
      body: raw,
    }
  }

  const yaml = match[1]
  const body = match[2]
  const fm: ParsedSkillMd['frontmatter'] = { name: '', description: '', allowedTools: [] }

  let inAllowedTools = false
  let inCapabilitiesInternal = false
  let inCapabilitiesCli = false
  let inCapabilitiesMcp = false
  let inSchemaContextEntityTypes = false
  let inTriggers = false
  let inTags = false
  let inCapabilities = false

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
    else if (key === 'allowed-tools') inAllowedTools = true
    else if (key === 'license') fm.license = val
    else if (key === 'compatibility') fm.compatibility = val
    else if (key === 'id') fm.id = val
    else if (key === 'icon') fm.icon = val
    else if (key === 'category' && ['domain', 'action', 'persona'].includes(val)) fm.category = val as any
    else if (key === 'priority') fm.priority = Number(val) || undefined
    else if (key === 'auto-activate') fm.autoActivate = val === 'true'
    else if (key === 'capabilities') inCapabilities = true
    else if (inCapabilities && key === 'internal') inCapabilitiesInternal = true
    else if (inCapabilities && key === 'cli') inCapabilitiesCli = true
    else if (inCapabilities && key === 'mcp') inCapabilitiesMcp = true
    else if (key === 'schema-context' || key === 'schemaContext') { /* enter schema context */ }
    else if ((key === 'entity-types' || key === 'entityTypes') && (val === '' || val.startsWith('[') === false)) inSchemaContextEntityTypes = true
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

/**
 * 加载 Skill 的提示词内容
 *
 * 查找顺序：SKILL.md → instructions.md
 * 使用 import.meta.glob 懒加载，解析 frontmatter 后只保留 body 部分
 *
 * @returns 解包后的 MD body 文本，文件不存在或加载失败返回 null
 */
export async function loadSkillPrompt(skill: SkillMeta): Promise<string | null> {
  if (skillCache.has(skill.id)) return skillCache.get(skill.id)!

  if (!skill.promptFile) return null

  try {
    // 已安装技能（Skills Store）：从文件系统读取提示词
    if (isInstalledSkill(skill.id)) {
      const installDir = getInstalledSkillDir(skill.id)!
      const content = await readInstalledSkillFile(installDir, skill.promptFile)
      if (content == null) return null
      // SKILL.md 含 frontmatter，解析取 body；其他文件（如 instructions.md）直接用全文
      const result = skill.promptFile.toLowerCase().includes('skill.md')
        ? parseFrontmatter(content).body.trim()
        : content.trim()
      skillCache.set(skill.id, result)
      return result
    }

    // 内置技能：import.meta.glob（编译时打包）
    const dirName = skill.promptFile.split('/')[0]

    const skillMdModules = import.meta.glob('../skills/*/SKILL.md', { query: '?raw', import: 'default', eager: false })
    const skillMdPath = `../skills/${dirName}/SKILL.md`
    const skillMdLoader = skillMdModules[skillMdPath]
    if (skillMdLoader) {
      const content = (await skillMdLoader()) as string
      const parsed = parseFrontmatter(content)
      const result = parsed.body.trim()
      skillCache.set(skill.id, result)
      return result
    }

    const instructionsModules = import.meta.glob('../skills/*/instructions.md', { query: '?raw', import: 'default', eager: false })
    const instructionsPath = `../skills/${dirName}/instructions.md`
    const instructionsLoader = instructionsModules[instructionsPath]
    if (instructionsLoader) {
      const content = (await instructionsLoader()) as string
      const result = content.trim()
      skillCache.set(skill.id, result)
      return result
    }

    return null
  } catch {
    return null
  }
}

/** 加载 Skill 的参考文档（references/ 目录） */
export async function loadSkillReference(skill: SkillMeta, refPath: string): Promise<string | null> {
  const cacheKey = `${skill.id}:${refPath}`
  if (referenceCache.has(cacheKey)) return referenceCache.get(cacheKey)!

  try {
    // 已安装技能：从文件系统读取 references/<refPath>
    if (isInstalledSkill(skill.id)) {
      const installDir = getInstalledSkillDir(skill.id)!
      const relPath = refPath.startsWith('references/') ? refPath : `references/${refPath}`
      const content = await readInstalledSkillFile(installDir, relPath)
      if (content == null) return null
      referenceCache.set(cacheKey, content)
      return content
    }

    // 内置技能
    const modules = import.meta.glob('../skills/*/references/*.md', { query: '?raw', import: 'default', eager: false })
    const dirName = skill.promptFile?.split('/')[0]
    if (!dirName) return null
    const path = `../skills/${dirName}/references/${refPath}`
    const loader = modules[path]
    if (!loader) return null
    const content = (await loader()) as string
    referenceCache.set(cacheKey, content)
    return content
  } catch {
    return null
  }
}

/** 加载 Skill 的资源文件（assets/ 目录，支持 .md 和 .yaml） */
export async function loadSkillAsset(skill: SkillMeta, assetPath: string): Promise<string | null> {
  const cacheKey = `${skill.id}:asset:${assetPath}`
  if (assetCache.has(cacheKey)) return assetCache.get(cacheKey)!

  try {
    // 已安装技能：从文件系统读取 assets/<assetPath>
    if (isInstalledSkill(skill.id)) {
      const installDir = getInstalledSkillDir(skill.id)!
      const relPath = assetPath.startsWith('assets/') ? assetPath : `assets/${assetPath}`
      const content = await readInstalledSkillFile(installDir, relPath)
      if (content == null) return null
      assetCache.set(cacheKey, content)
      return content
    }

    // 内置技能
    const mdModules = import.meta.glob('../skills/*/assets/*.md', { query: '?raw', import: 'default', eager: false })
    const yamlModules = import.meta.glob('../skills/*/assets/*.yaml', { query: '?raw', import: 'default', eager: false })
    const allModules = { ...mdModules, ...yamlModules }
    const dirName = skill.promptFile?.split('/')[0]
    if (!dirName) return null
    const path = `../skills/${dirName}/assets/${assetPath}`
    const loader = allModules[path]
    if (!loader) return null
    const content = (await loader()) as string
    assetCache.set(cacheKey, content)
    return content
  } catch {
    return null
  }
}

/** 清除所有 Skill 内容缓存（提示词、参考、资源） */
export function clearSkillCache(): void {
  skillCache.clear()
  referenceCache.clear()
  assetCache.clear()
}

/**
 * 批量激活 Skill 并返回拼接的完整提示词
 * 每个已启用的 Skill 之间用 "---" 分隔
 */
export async function activateSkills(skillIds: string[]): Promise<string> {
  const enabled = getEnabledSkills()
  const enabledIds = new Set(enabled.map(s => s.id))
  const parts: string[] = []

  for (const id of skillIds) {
    if (!enabledIds.has(id)) continue
    const skill = findSkillById(id)
    if (!skill) continue
    const prompt = await loadSkillPrompt(skill)
    if (prompt) {
      parts.push(`## Skill: ${skill.name} (${skill.id})\n\n${prompt}`)
    }
  }

  return parts.join('\n\n---\n\n')
}
