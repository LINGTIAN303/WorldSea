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
import { parseFrontmatter } from './parser'
import type { ParsedSkillMd } from './parser'

// 向后兼容：re-export parseFrontmatter / ParsedSkillMd（原内联于本模块，Task 24 阶段1 提取到 parser.ts 共用）
export { parseFrontmatter }
export type { ParsedSkillMd }

/** 内存缓存：已加载的 Skill 提示词 */
const skillCache = new Map<string, string>()
/** 内存缓存：已加载的参考文档 */
const referenceCache = new Map<string, string>()
/** 内存缓存：已加载的资源文件 */
const assetCache = new Map<string, string>()

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
