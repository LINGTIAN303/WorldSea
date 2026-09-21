/**
 * 技能创建/导入组装层：生成规范 SKILL.md + 可选 sidecar（生成物回读自检），详细见 docs/details/注释/packages/agent-runtime/skills-creator.md
 *
 * 纯函数；error 级问题由调用方决定拦截或经 allowNonCompliant 放行。
 */

import type { SkillMeta } from './registry'
import { parseFrontmatter } from './parser'
import { validateSkillFrontmatter, isValidSkillName } from './validator'
import type { SkillValidationIssue } from './validator'

/** 创建技能输入（私有字段可选，缺省即不产 sidecar） */
export interface SkillCreateInput {
  /** 技能 id（同时作为目录名与规范 name，须为小写 kebab） */
  id: string
  /** 展示名（缺省同 id；写入 SKILL.md 正文标题，不进 frontmatter） */
  name?: string
  description: string
  icon?: string
  category?: 'domain' | 'action' | 'persona'
  priority?: number
  tags?: string[]
}

/** 创建结果 */
export interface SkillCreateTemplate {
  /** 规范 SKILL.md 全文（frontmatter + 正文骨架） */
  skillMd: string
  /** worldsea.skill.json 文本（无私有字段时为 undefined） */
  sidecarJson?: string
  /** 生成物自检问题（error 级需拦截或显式放行） */
  issues: SkillValidationIssue[]
}

/** frontmatter 单行值转义：折行/冒号前空格等会破坏行级解析，统一压平 */
function inlineValue(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}

/** 组装规范 SKILL.md（frontmatter 仅 name/description；body 为可编辑骨架/原文） */
export function composeSkillMd(id: string, description: string, body: string): string {
  return `---\nname: ${id}\ndescription: ${inlineValue(description)}\n---\n\n${body.trim()}\n`
}

/** 创建向导的正文骨架（规范推荐四段：何时使用 / 步骤 / 注意事项 / 验证） */
function buildBodySkeleton(name: string, description: string): string {
  return [
    `# ${name}`,
    '',
    '## 何时使用',
    '',
    `- ${inlineValue(description)}`,
    '',
    '## 步骤',
    '',
    '1. 明确目标与范围（不明确时先向用户确认）。',
    '2. 按技能目标逐步执行，并在每一步说明产出。',
    '',
    '## 注意事项',
    '',
    '- 与项目既有约定保持一致；不确定的取舍先询问用户。',
    '',
    '## 验证',
    '',
    '- 完成后自检：产出是否满足「何时使用」中描述的场景。',
  ].join('\n')
}

/**
 * 生成创建模板（规范 SKILL.md + 可选 sidecar）
 *
 * `issues` 为对生成物回读解析后的校验结果（自检）——合法输入应无 error。
 */
export function buildSkillTemplate(input: SkillCreateInput): SkillCreateTemplate {
  const id = input.id.trim()
  const name = (input.name ?? '').trim() || id
  const description = inlineValue(input.description)
  const skillMd = composeSkillMd(id, description, buildBodySkeleton(name, description))
  const sidecarJson = buildSidecarJson(input)
  const issues = validateSkillMdText(skillMd, id)
  return { skillMd, sidecarJson, issues }
}

/** 私有字段 → sidecar JSON 文本（无有效字段时返回 undefined） */
export function buildSidecarJson(input: {
  icon?: string
  category?: 'domain' | 'action' | 'persona'
  priority?: number
  tags?: string[]
}): string | undefined {
  const sidecar: Record<string, unknown> = {}
  if (input.icon && input.icon.trim()) sidecar.icon = input.icon.trim()
  if (input.category) sidecar.category = input.category
  if (typeof input.priority === 'number' && Number.isFinite(input.priority)) sidecar.priority = input.priority
  if (input.tags && input.tags.length > 0) sidecar.tags = input.tags
  return Object.keys(sidecar).length > 0 ? `${JSON.stringify(sidecar, null, 2)}\n` : undefined
}

/** SkillMeta → sidecar JSON 文本（导入路径用；仅收编私有字段，规范字段不入 sidecar） */
export function sidecarJsonFromMeta(meta: SkillMeta): string | undefined {
  const sidecar: Record<string, unknown> = {}
  if (meta.icon && meta.icon !== 'module-builder') sidecar.icon = meta.icon
  if (meta.category) sidecar.category = meta.category
  if (typeof meta.priority === 'number') sidecar.priority = meta.priority
  if (meta.visibility && meta.visibility !== 'always') sidecar.visibility = meta.visibility
  if (meta.tags && meta.tags.length > 0) sidecar.tags = meta.tags
  if (meta.triggers && meta.triggers.length > 0) sidecar.triggers = meta.triggers
  if (meta.autoActivate) sidecar.autoActivate = meta.autoActivate
  if (meta.capabilities && (meta.capabilities.internal.length || meta.capabilities.cli.length || meta.capabilities.mcp.length)) {
    sidecar.capabilities = meta.capabilities
  }
  if (meta.schemaContext && meta.schemaContext.entityTypes.length > 0) sidecar.schemaContext = meta.schemaContext
  if (meta.outputPreferences && meta.outputPreferences.length > 0) sidecar.outputPreferences = meta.outputPreferences
  if (meta.relatedPlugins && meta.relatedPlugins.length > 0) sidecar.relatedPlugins = meta.relatedPlugins
  if (meta.pluginTools && meta.pluginTools.length > 0) sidecar.pluginTools = meta.pluginTools
  return Object.keys(sidecar).length > 0 ? `${JSON.stringify(sidecar, null, 2)}\n` : undefined
}

/** 解析 + 校验 SKILL.md 文本（导入前置校验；不落盘） */
export function validateSkillMdText(raw: string, dirName?: string): SkillValidationIssue[] {
  const fm = parseFrontmatter(raw).frontmatter
  return validateSkillFrontmatter(fm, dirName ? { dirName } : {})
}

/** 创建输入的基本合法性（供面板即时反馈；完整规则以校验器为准） */
export function isCreatableSkillId(id: string): boolean {
  return isValidSkillName(id)
}