/**
 * Skill 协议校验器：规范规则集（name/description/compatibility）+ 私有键 warn，详细见 docs/details/注释/packages/agent-runtime/skills-protocol.md
 *
 * 纯函数；error 级用于拒绝注册/安装，warn 级仅登记（调用方决定严格度）。
 */

import type { ParsedSkillMd } from './parser'

export type SkillValidationLevel = 'error' | 'warn'

/** 单条校验问题 */
export interface SkillValidationIssue {
  level: SkillValidationLevel
  /** 出问题的字段（顶层字段名） */
  field?: string
  message: string
}

/** 规范约束常量（单点定义，测试与文档同源） */
export const SKILL_NAME_MAX_LENGTH = 64
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024
export const SKILL_COMPATIBILITY_MAX_LENGTH = 500

/** 规范 name 形态：小写字母/数字 + 单连字符分隔（禁首尾连字符与连续连字符） */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** 是否为规范合法的技能 name（供创建/导入前置校验复用；长度与形态合一） */
export function isValidSkillName(name: string): boolean {
  const n = name.trim()
  return n.length > 0 && n.length <= SKILL_NAME_MAX_LENGTH && NAME_PATTERN.test(n)
}

/**
 * 顶层私有键（D2 裁定后应放 sidecar `worldsea.skill.json`）
 *
 * 说明：`license`/`compatibility`/`metadata` 为规范字段，不在此列。
 */
const PRIVATE_TOP_LEVEL_KEYS = [
  'id',
  'icon',
  'category',
  'version',
  'priority',
  'visibility',
  'enabled',
  'autoActivate',
  'triggers',
  'tags',
  'baseTools',
  'allowedTools',
  'capabilities',
  'schemaContext',
] as const

/**
 * 校验 frontmatter（规范规则集 + 私有键提示）
 *
 * @param fm parseFrontmatter 的 frontmatter
 * @param opts.dirName 技能目录名（用于规范「name 必须与父目录同名」；不传则跳过该条）
 */
export function validateSkillFrontmatter(
  fm: ParsedSkillMd['frontmatter'],
  opts: { dirName?: string } = {},
): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = []

  // name：必填 + 形态 + 长度 + 与目录同名
  const name = fm.name.trim()
  if (!name) {
    issues.push({ level: 'error', field: 'name', message: '缺少必填字段 name' })
  } else {
    if (name.length > SKILL_NAME_MAX_LENGTH) {
      issues.push({
        level: 'error',
        field: 'name',
        message: `name 超长（${name.length} > ${SKILL_NAME_MAX_LENGTH}）`,
      })
    }
    if (!NAME_PATTERN.test(name)) {
      issues.push({
        level: 'error',
        field: 'name',
        message: 'name 仅允许小写字母/数字/连字符，且不得首尾连字符或连续连字符',
      })
    }
    if (opts.dirName && name !== opts.dirName) {
      issues.push({
        level: 'error',
        field: 'name',
        message: `name（${name}）必须与父目录同名（${opts.dirName}）`,
      })
    }
  }

  // description：必填 + 长度
  const description = fm.description.trim()
  if (!description) {
    issues.push({ level: 'error', field: 'description', message: '缺少必填字段 description' })
  } else if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    issues.push({
      level: 'error',
      field: 'description',
      message: `description 超长（${description.length} > ${SKILL_DESCRIPTION_MAX_LENGTH}）`,
    })
  }

  // compatibility：可选 + 长度
  if (fm.compatibility != null && fm.compatibility !== '') {
    if (fm.compatibility.length > SKILL_COMPATIBILITY_MAX_LENGTH) {
      issues.push({
        level: 'error',
        field: 'compatibility',
        message: `compatibility 超长（${fm.compatibility.length} > ${SKILL_COMPATIBILITY_MAX_LENGTH}）`,
      })
    }
  }

  // 顶层私有键：warn（D2 裁定后应迁 sidecar，过渡期不阻断）
  for (const key of PRIVATE_TOP_LEVEL_KEYS) {
    const value = fm[key as keyof ParsedSkillMd['frontmatter']]
    if (value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    issues.push({
      level: 'warn',
      field: key,
      message: `${key} 为 WorldSea 私有字段，按协议应放入 sidecar（worldsea.skill.json）`,
    })
  }

  return issues
}

/** 是否通过（无 error 级问题） */
export function isSkillCompliant(issues: SkillValidationIssue[]): boolean {
  return !issues.some((issue) => issue.level === 'error')
}