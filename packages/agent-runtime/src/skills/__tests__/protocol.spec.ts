/**
 * 协议校验器 + sidecar 契约测试（S1 协议基座，2026-09-17）
 *
 * 校验规则集对齐 Agent Skills 开放规范（name 与目录同名 / 长度上限 / 形态）；
 * sidecar（D2）验证宽容解析与「私有字段权威源」合并优先级。
 */

import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../parser'
import type { ParsedSkillMd } from '../parser'
import {
  validateSkillFrontmatter,
  isSkillCompliant,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
} from '../validator'
import { parseWorldSeaSkillSidecar } from '../sidecar'
import { frontmatterToSkillMeta } from '../manifest'

/** 构造一个合规 frontmatter（可局部覆盖） */
function baseFm(overrides: Partial<ParsedSkillMd['frontmatter']> = {}): ParsedSkillMd['frontmatter'] {
  return { name: 'demo-skill', description: '演示技能', allowedTools: [], baseTools: [], ...overrides }
}

describe('validateSkillFrontmatter · 规范规则集', () => {
  it('合规 frontmatter 无 error', () => {
    const issues = validateSkillFrontmatter(baseFm(), { dirName: 'demo-skill' })
    expect(isSkillCompliant(issues)).toBe(true)
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('name 缺失 / 超长 / 形态非法 / 与目录不同名均为 error', () => {
    expect(validateSkillFrontmatter(baseFm({ name: '' }))[0]).toMatchObject({ level: 'error', field: 'name' })
    expect(isSkillCompliant(validateSkillFrontmatter(baseFm({ name: 'a'.repeat(SKILL_NAME_MAX_LENGTH + 1) })))).toBe(false)
    for (const bad of ['Demo-Skill', '-demo', 'demo-', 'demo--skill', 'demo_skill']) {
      expect(isSkillCompliant(validateSkillFrontmatter(baseFm({ name: bad }))), bad).toBe(false)
    }
    const mismatch = validateSkillFrontmatter(baseFm({ name: 'other-name' }), { dirName: 'demo-skill' })
    expect(mismatch.some((i) => i.field === 'name' && i.level === 'error')).toBe(true)
  })

  it('description 缺失 / 超长为 error', () => {
    expect(isSkillCompliant(validateSkillFrontmatter(baseFm({ description: '' })))).toBe(false)
    expect(
      isSkillCompliant(validateSkillFrontmatter(baseFm({ description: 'x'.repeat(SKILL_DESCRIPTION_MAX_LENGTH + 1) }))),
    ).toBe(false)
  })

  it('compatibility 超长为 error（规范 ≤500）', () => {
    expect(isSkillCompliant(validateSkillFrontmatter(baseFm({ compatibility: 'x'.repeat(501) })))).toBe(false)
    expect(isSkillCompliant(validateSkillFrontmatter(baseFm({ compatibility: 'x'.repeat(500) })))).toBe(true)
  })

  it('顶层私有键为 warn（不阻断，提示迁 sidecar）', () => {
    const issues = validateSkillFrontmatter(baseFm({ icon: 'sparkles', priority: 8 }))
    const warns = issues.filter((i) => i.level === 'warn').map((i) => i.field)
    expect(warns).toContain('icon')
    expect(warns).toContain('priority')
    expect(isSkillCompliant(issues)).toBe(true)
  })

  it('空数组私有键不产生 warn（allowedTools=[] 为解析默认值）', () => {
    const warns = validateSkillFrontmatter(baseFm()).filter((i) => i.level === 'warn')
    expect(warns.some((w) => w.field === 'allowedTools')).toBe(false)
  })
})

describe('parseWorldSeaSkillSidecar · 宽容解析', () => {
  it('坏 JSON / 非对象 / 空对象均返回 null（不抛错、不阻断加载）', () => {
    expect(parseWorldSeaSkillSidecar('{ 坏 json')).toBeNull()
    expect(parseWorldSeaSkillSidecar('[1, 2]')).toBeNull()
    expect(parseWorldSeaSkillSidecar('{}')).toBeNull()
    expect(parseWorldSeaSkillSidecar(null)).toBeNull()
    expect(parseWorldSeaSkillSidecar(undefined)).toBeNull()
  })

  it('非法枚举值被丢弃，合法值保留', () => {
    const sidecar = parseWorldSeaSkillSidecar(
      JSON.stringify({
        icon: 'sparkles',
        category: 'bad-category',
        visibility: 'developer',
        priority: 9,
        triggers: ['写作'],
        capabilities: { internal: ['entity_list'], cli: [], mcp: [] },
      }),
    )
    expect(sidecar).toMatchObject({
      icon: 'sparkles',
      visibility: 'developer',
      priority: 9,
      triggers: ['写作'],
    })
    expect(sidecar?.category).toBeUndefined()
    expect(sidecar?.capabilities?.internal).toEqual(['entity_list'])
  })

  it('outputPreferences 按通道白名单过滤', () => {
    const sidecar = parseWorldSeaSkillSidecar(
      JSON.stringify({
        outputPreferences: [
          { channel: 'a2ui', component: 'EntityCard' },
          { channel: 'nope', component: 'X' },
        ],
      }),
    )
    expect(sidecar?.outputPreferences).toEqual([{ channel: 'a2ui', component: 'EntityCard', plugin: undefined, condition: undefined }])
  })

  it('schemaContext 缺 entityTypes 即视为无效', () => {
    const sidecar = parseWorldSeaSkillSidecar(JSON.stringify({ schemaContext: { fieldPolicy: 'open' } }))
    expect(sidecar).toBeNull()
  })
})

describe('frontmatterToSkillMeta · sidecar 合并优先级（D2）', () => {
  it('sidecar 为私有字段权威源，覆盖 frontmatter 顶层私有键', () => {
    const fm = baseFm({ icon: 'old-icon', priority: 3, tags: ['旧标签'] })
    const sidecar = { icon: 'new-icon', priority: 9, tags: ['新标签'], visibility: 'advanced' as const }
    const meta = frontmatterToSkillMeta(fm, 'demo-skill', 'SKILL.md', sidecar)
    expect(meta.icon).toBe('new-icon')
    expect(meta.priority).toBe(9)
    expect(meta.tags).toEqual(['新标签'])
    expect(meta.visibility).toBe('advanced')
  })

  it('sidecar 缺失时保持既有降级（visibility=always / priority=5 / id 兜底目录名）', () => {
    const meta = frontmatterToSkillMeta({ ...baseFm({ name: '' }), id: undefined }, 'demo-skill', 'SKILL.md')
    expect(meta.visibility).toBe('always')
    expect(meta.priority).toBe(5)
    expect(meta.id).toBe('demo-skill')
    expect(meta.name).toBe('demo-skill')
  })

  it('sidecar 提供编排字段（outputPreferences / pluginTools）', () => {
    const sidecar = {
      outputPreferences: [{ channel: 'chat' as const }],
      pluginTools: [{ pluginId: 'outline', tools: ['create_node'] }],
    }
    const meta = frontmatterToSkillMeta(baseFm(), 'demo-skill', 'SKILL.md', sidecar)
    expect(meta.outputPreferences).toEqual([{ channel: 'chat' }])
    expect(meta.pluginTools).toEqual([{ pluginId: 'outline', tools: ['create_node'], capabilities: undefined }])
  })

  it('规范字段（license/metadata）经 parser 后可在 meta 之外保留（不污染 SkillMeta）', () => {
    const fm = parseFrontmatter('---\nname: demo-skill\ndescription: d\nlicense: MIT\nmetadata:\n  author: x\n---\nbody').frontmatter
    expect(fm.license).toBe('MIT')
    expect(fm.metadata).toEqual({ author: 'x' })
    const meta = frontmatterToSkillMeta(fm, 'demo-skill', 'SKILL.md')
    expect(meta).not.toHaveProperty('license')
    expect(meta).not.toHaveProperty('metadata')
  })
})