/**
 * 多平台技能格式适配器（Task 24 阶段4）
 *
 * 实现 WorldSmith 技能与 Claude Code / Cursor 格式的双向转换。
 *
 * 支持的平台格式：
 * - Claude Code：SKILL.md（YAML frontmatter: name/description/allowed-tools/license + Markdown body）
 * - Cursor：.mdc（YAML frontmatter: description/globs/alwaysApply + Markdown body）
 * - WorldSmith：skill.yaml（完整 manifest）+ SKILL.md（提示词）
 *
 * 导入：外部格式文本 → WorldSmith SkillMeta（复用 parser.ts 的 parseFrontmatter）
 * 导出：WorldSmith SkillMeta + 提示词 body → 外部格式文本
 *
 * 设计要点：
 * - 导入时字段映射保守：外部格式无的字段用 WorldSmith 默认值兜底
 * - 导出时只输出目标格式支持的字段，WorldSmith 特有字段丢弃
 * - Cursor 的 globs → WorldSmith 无直接对应，存入 tags 保留信息
 * - Claude Code 的 allowed-tools（连字符）↔ WorldSmith allowedTools（驼峰）
 */

import type { SkillMeta } from './registry'
import { parseFrontmatter } from './parser'
import type { ParsedSkillMd } from './parser'

/** 平台标识 */
export type SkillPlatform = 'worldsmith' | 'claude-code' | 'cursor'

/** 导入结果 */
export interface ImportResult {
  meta: SkillMeta
  body: string
  /** 检测到的源平台格式 */
  platform: SkillPlatform
  /** 导入时的警告信息（字段丢失/降级等） */
  warnings: string[]
}

/** 默认 SkillMeta 字段（外部格式无对应时兜底） */
function defaultSkillMeta(fallbackId: string): SkillMeta {
  return {
    id: fallbackId,
    name: fallbackId,
    icon: 'module-builder',
    description: '',
    category: 'action',
    enabled: true,
    visibility: 'always',
    version: '1.0.0',
    promptFile: 'SKILL.md',
    allowedTools: [],
    baseTools: [],
  }
}

/**
 * 检测文本的平台格式
 *
 * 启发式判断：
 * - 含 frontmatter 且有 alwaysApply 或 globs → cursor
 * - 含 frontmatter 且有 allowed-tools 或 name → claude-code
 * - 含 frontmatter 且有 id 或 baseTools → worldsmith
 * - 无 frontmatter → 未知（按 claude-code 处理，最通用）
 */
export function detectPlatform(raw: string): SkillPlatform {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) {
    // 无 frontmatter：可能是 WorldSmith skill.yaml（纯 YAML，无 --- 包裹）
    // 检查 worldsmith 特有字段（baseTools 驼峰 / id: 开头）
    if (/\bbaseTools\b/.test(raw) || /^\s*id\s*:/m.test(raw)) return 'worldsmith'
    return 'claude-code'
  }
  const yaml = match[1]

  // Cursor 特有字段优先检测（alwaysApply/globs 是 Cursor 独有）
  if (/\balwaysApply\b/.test(yaml) || /^\s*globs\s*:/m.test(yaml)) return 'cursor'
  // WorldSmith 特有字段（baseTools 驼峰是 WorldSmith 独有）
  if (/\bbaseTools\b/.test(yaml)) return 'worldsmith'
  // Claude Code 特有字段
  if (/\ballowed-tools\b/.test(yaml) || /^\s*name\s*:/m.test(yaml)) return 'claude-code'
  return 'claude-code'
}

/**
 * 从已解析的 frontmatter 构建 SkillMeta
 *
 * 复用 manifest.ts 的转换逻辑（保持一致性），但内联实现以避免循环依赖。
 * emoji 图标清洗 + category 规范化 + 默认值兜底。
 */
function frontmatterToMeta(
  fm: ParsedSkillMd['frontmatter'],
  fallbackId: string,
  warnings: string[],
): SkillMeta {
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u
  let icon = typeof fm.icon === 'string' ? fm.icon.trim() : ''
  if (!icon || EMOJI_RE.test(icon)) {
    icon = 'module-builder'
    if (fm.icon) warnings.push(`图标含 emoji 或为空，已替换为默认图标 module-builder`)
  }

  const rawCategory = String(fm.category)
  const category = rawCategory === 'domain' || rawCategory === 'action' || rawCategory === 'persona'
    ? rawCategory as SkillMeta['category']
    : 'action'
  if (fm.category && category !== rawCategory) {
    warnings.push(`category "${rawCategory}" 不合法，已降级为 action`)
  }

  return {
    id: fm.id || fallbackId,
    name: fm.name || fm.id || fallbackId,
    icon,
    description: fm.description || '',
    category,
    enabled: fm.enabled !== false,
    visibility: 'always',
    version: fm.version || '1.0.0',
    promptFile: 'SKILL.md',
    allowedTools: fm.allowedTools || [],
    baseTools: fm.baseTools || [],
    capabilities: fm.capabilities,
    schemaContext: fm.schemaContext,
    triggers: fm.triggers,
    tags: fm.tags,
    priority: fm.priority ?? 5,
    autoActivate: fm.autoActivate,
  }
}

/**
 * 导入 Claude Code SKILL.md 格式
 *
 * frontmatter: name, description, allowed-tools（连字符）, license
 * body: Markdown 提示词
 */
export function importClaudeCodeSkill(raw: string, fallbackId: string): ImportResult {
  const warnings: string[] = []
  const parsed = parseFrontmatter(raw)
  const fm = parsed.frontmatter

  if (!fm.name && !fm.id) {
    warnings.push('SKILL.md 缺少 name 字段，使用 fallbackId 作为 id/name')
  }

  // Claude Code 的 allowed-tools（连字符）已被 parser 识别为 allowedTools（驼峰）
  const meta = frontmatterToMeta(fm, fallbackId, warnings)

  // Claude Code 无 category 概念，默认 action（已在 frontmatterToMeta 处理）
  if (!fm.category) warnings.push('Claude Code 格式无 category，默认 action')

  return { meta, body: parsed.body, platform: 'claude-code', warnings }
}

/**
 * 导入 Cursor .mdc 格式
 *
 * frontmatter: description, globs（文件匹配）, alwaysApply（布尔）
 * body: Markdown 提示词
 *
 * 字段映射：
 * - description → description（同时作为 name 兜底）
 * - globs → tags（保留信息，WorldSmith 无 globs 概念）
 * - alwaysApply → autoActivate（语义近似：总是应用 vs 自动激活）
 * - name 缺失时用 fallbackId
 */
export function importCursorRule(raw: string, fallbackId: string): ImportResult {
  const warnings: string[] = []
  const parsed = parseFrontmatter(raw)
  const fm = parsed.frontmatter

  // Cursor 的 description 作为 name 兜底（Cursor 无 name 字段）
  if (!fm.name && fm.description) {
    // 取 description 前 30 字符作为 name
    fm.name = fm.description.slice(0, 30)
  }

  const meta = frontmatterToMeta(fm, fallbackId, warnings)

  // Cursor 特有字段处理：手动提取 alwaysApply 和 globs（parser 不识别这两个 Cursor 独有 key）
  const yamlBlock = raw.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || ''

  // alwaysApply → autoActivate（语义近似：总是应用 vs 自动激活）
  const alwaysApplyMatch = yamlBlock.match(/^alwaysApply:\s*(.+)$/m)
  if (alwaysApplyMatch) {
    meta.autoActivate = alwaysApplyMatch[1].trim() === 'true'
  }

  // globs：支持单行格式（globs: "**/*.tsx"）和列表格式（globs:\n  - a\n  - b）
  // 注意：用 [ \t]* 代替 \s*，避免跨行匹配列表项
  const globsSingleMatch = yamlBlock.match(/^globs:[ \t]*(\S.*?)$/m)
  const globs: string[] = []
  if (globsSingleMatch) {
    // 单行格式：globs: "a, b" 或 globs: "[a, b]" 或 globs: a
    const val = globsSingleMatch[1].trim()
    if (val && !val.startsWith('[') || (val.startsWith('[') && val.endsWith(']'))) {
      const cleaned = val.replace(/[\[\]"']/g, '')
      globs.push(...cleaned.split(',').map(s => s.trim()).filter(Boolean))
    }
  } else {
    // 列表格式：globs: 后跟缩进的 - xxx 行
    const globsBlockMatch = yamlBlock.match(/^globs:\s*\n((?:\s+-\s+.+\n?)+)/m)
    if (globsBlockMatch) {
      const itemMatches = globsBlockMatch[1].matchAll(/^\s+-\s+(.+)$/gm)
      for (const m of itemMatches) {
        globs.push(m[1].trim().replace(/["']/g, ''))
      }
    }
  }
  if (globs.length > 0) {
    meta.tags = [...(meta.tags || []), ...globs.map(g => `cursor-glob:${g}`)]
    warnings.push(`Cursor globs ${JSON.stringify(globs)} 已存入 tags（前缀 cursor-glob:）`)
  }

  // Cursor 无 version/category，用默认值
  warnings.push('Cursor 格式无 version/category，使用默认值 1.0.0/action')

  return { meta, body: parsed.body, platform: 'cursor', warnings }
}

/**
 * 导入 WorldSmith skill.yaml 格式（包装成 frontmatter 解析）
 *
 * 完整 manifest：id/name/icon/description/category/version/enabled/priority/baseTools/allowedTools 等
 */
export function importWorldSmithYaml(raw: string, fallbackId: string): ImportResult {
  const warnings: string[] = []
  // skill.yaml 无 --- 分隔，包装后解析
  const wrapped = `---\n${raw}\n---\n`
  const parsed = parseFrontmatter(wrapped)

  if (!parsed.frontmatter.id && !parsed.frontmatter.name) {
    warnings.push('skill.yaml 缺少 id/name，使用 fallbackId')
  }

  const meta = frontmatterToMeta(parsed.frontmatter, fallbackId, warnings)
  // skill.yaml 是 manifest，body 为空，提示词需单独从 SKILL.md 读取
  return { meta, body: '', platform: 'worldsmith', warnings }
}

/**
 * 自动检测格式并导入
 *
 * @param raw 文件文本
 * @param fallbackId 当文件无 id/name 时的兜底 id（通常用文件名）
 */
export function autoImportSkill(raw: string, fallbackId: string): ImportResult {
  const platform = detectPlatform(raw)
  switch (platform) {
    case 'cursor':
      return importCursorRule(raw, fallbackId)
    case 'worldsmith':
      return importWorldSmithYaml(raw, fallbackId)
    case 'claude-code':
    default:
      return importClaudeCodeSkill(raw, fallbackId)
  }
}

// ── 导出适配器 ──

/**
 * 导出为 Claude Code SKILL.md 格式
 *
 * frontmatter: name, description, allowed-tools（连字符）
 * body: 原提示词
 */
export function exportToClaudeCodeSkill(meta: SkillMeta, body: string): string {
  const lines: string[] = ['---']
  lines.push(`name: ${meta.name}`)
  lines.push(`description: ${meta.description}`)
  if (meta.allowedTools.length > 0) {
    lines.push('allowed-tools:')
    for (const t of meta.allowedTools) {
      lines.push(`  - ${t}`)
    }
  }
  if (meta.version && meta.version !== '1.0.0') {
    lines.push(`version: ${meta.version}`)
  }
  lines.push('---')
  lines.push('')
  lines.push(body)
  return lines.join('\n')
}

/**
 * 导出为 Cursor .mdc 格式
 *
 * frontmatter: description, globs（从 tags 的 cursor-glob: 前缀提取）, alwaysApply
 * body: 原提示词
 */
export function exportToCursorRule(meta: SkillMeta, body: string): string {
  const lines: string[] = ['---']
  lines.push(`description: ${meta.description || meta.name}`)

  // 从 tags 提取 cursor-glob: 前缀的条目作为 globs
  const globs = (meta.tags || [])
    .filter(t => t.startsWith('cursor-glob:'))
    .map(t => t.slice('cursor-glob:'.length))

  if (globs.length > 0) {
    if (globs.length === 1) {
      lines.push(`globs: ${globs[0]}`)
    } else {
      lines.push('globs:')
      for (const g of globs) {
        lines.push(`  - ${g}`)
      }
    }
  }

  // alwaysApply：autoActivate 语义近似
  if (meta.autoActivate !== undefined) {
    lines.push(`alwaysApply: ${meta.autoActivate}`)
  }

  lines.push('---')
  lines.push('')
  lines.push(body)
  return lines.join('\n')
}

/**
 * 导出为 WorldSmith skill.yaml 格式
 *
 * 完整 manifest（不含提示词，提示词单独存 SKILL.md）
 */
export function exportToSkillYaml(meta: SkillMeta): string {
  const lines: string[] = []
  lines.push(`id: ${meta.id}`)
  lines.push(`name: ${meta.name}`)
  lines.push(`icon: ${meta.icon}`)
  lines.push(`description: ${meta.description}`)
  lines.push(`category: ${meta.category}`)
  lines.push(`version: ${meta.version}`)
  lines.push(`enabled: ${meta.enabled}`)
  lines.push(`priority: ${meta.priority ?? 5}`)
  if (meta.autoActivate !== undefined) lines.push(`autoActivate: ${meta.autoActivate}`)

  if (meta.baseTools.length > 0) {
    lines.push('baseTools:')
    for (const t of meta.baseTools) lines.push(`  - ${t}`)
  }
  if (meta.allowedTools.length > 0) {
    lines.push('allowedTools:')
    for (const t of meta.allowedTools) lines.push(`  - ${t}`)
  }
  if (meta.triggers && meta.triggers.length > 0) {
    lines.push('triggers:')
    for (const t of meta.triggers) lines.push(`  - ${t}`)
  }
  if (meta.tags && meta.tags.length > 0) {
    lines.push('tags:')
    for (const t of meta.tags) lines.push(`  - ${t}`)
  }

  return lines.join('\n')
}
