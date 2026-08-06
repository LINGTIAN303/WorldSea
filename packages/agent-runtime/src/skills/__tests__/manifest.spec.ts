/** manifest.ts 单元测试：验证 frontmatterToSkillMeta 转换逻辑，详细见 docs/details/注释/packages/agent-runtime/skills-tests-manifest-spec.md */
import { describe, it, expect } from 'vitest'
import { frontmatterToSkillMeta } from '../manifest'
import type { ParsedSkillMd } from '../parser'

/** 构造最小 frontmatter 测试数据 */
function makeFm(overrides: Partial<ParsedSkillMd['frontmatter']> = {}): ParsedSkillMd['frontmatter'] {
  return {
    name: '',
    description: '',
    allowedTools: [],
    baseTools: [],
    ...overrides,
  }
}

describe('frontmatterToSkillMeta', () => {
  it('emoji 图标清洗为默认图标 module-builder', () => {
    const fm = makeFm({ id: 'test', name: '测试', icon: '🎯' })
    const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
    expect(meta.icon).toBe('module-builder')
  })

  it('空图标回退为默认图标', () => {
    const fm = makeFm({ id: 'test', name: '测试', icon: '' })
    const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
    expect(meta.icon).toBe('module-builder')
  })

  it('合法图标名（Naive UI 图标）保持不变', () => {
    const fm = makeFm({ id: 'test', name: '测试', icon: 'globe' })
    const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
    expect(meta.icon).toBe('globe')
  })

  it('无效 category 降级为 action', () => {
    const fm = makeFm({ id: 'test', name: '测试', category: 'invalid' as any })
    const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
    expect(meta.category).toBe('action')
  })

  it('合法 category（domain/action/persona）保持不变', () => {
    for (const cat of ['domain', 'action', 'persona'] as const) {
      const fm = makeFm({ id: 'test', name: '测试', category: cat })
      const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
      expect(meta.category).toBe(cat)
    }
  })

  it('capabilities 传递到 SkillMeta', () => {
    const fm = makeFm({
      id: 'test',
      name: '测试',
      capabilities: { internal: ['entity.list'], cli: [], mcp: [] },
    })
    const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
    expect(meta.capabilities).toBeDefined()
    expect(meta.capabilities!.internal).toEqual(['entity.list'])
  })

  it('schemaContext 传递到 SkillMeta', () => {
    const fm = makeFm({
      id: 'test',
      name: '测试',
      schemaContext: { entityTypes: ['region'], fieldPolicy: 'prefer-defined' },
    })
    const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
    expect(meta.schemaContext).toBeDefined()
    expect(meta.schemaContext!.entityTypes).toEqual(['region'])
  })

  it('id 缺失时用 installDir 兜底', () => {
    const fm = makeFm({ name: '测试' }) // 无 id
    const meta = frontmatterToSkillMeta(fm, 'my-skill-dir', 'SKILL.md')
    expect(meta.id).toBe('my-skill-dir')
  })

  it('name 缺失时用 id 兜底，再缺失用 installDir', () => {
    const fm1 = makeFm({ id: 'my-id' }) // 无 name
    expect(frontmatterToSkillMeta(fm1, 'dir', 'SKILL.md').name).toBe('my-id')

    const fm2 = makeFm({}) // 无 id 无 name
    expect(frontmatterToSkillMeta(fm2, 'dir', 'SKILL.md').name).toBe('dir')
  })

  it('promptFile 传递（SKILL.md / instructions.md）', () => {
    const fm = makeFm({ id: 'test', name: '测试' })
    expect(frontmatterToSkillMeta(fm, 'test', 'SKILL.md').promptFile).toBe('SKILL.md')
    expect(frontmatterToSkillMeta(fm, 'test', 'instructions.md').promptFile).toBe('instructions.md')
  })

  it('默认值：version=1.0.0, priority=5, enabled=true, visibility=always', () => {
    const fm = makeFm({ id: 'test', name: '测试' })
    const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
    expect(meta.version).toBe('1.0.0')
    expect(meta.priority).toBe(5)
    expect(meta.enabled).toBe(true)
    expect(meta.visibility).toBe('always')
  })

  it('enabled: false 时 enabled 为 false', () => {
    const fm = makeFm({ id: 'test', name: '测试', enabled: false })
    const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
    expect(meta.enabled).toBe(false)
  })

  it('显式 priority 覆盖默认值', () => {
    const fm = makeFm({ id: 'test', name: '测试', priority: 10 })
    const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
    expect(meta.priority).toBe(10)
  })

  it('triggers/tags/autoActivate 传递', () => {
    const fm = makeFm({
      id: 'test',
      name: '测试',
      triggers: ['生成', '批量'],
      tags: ['创作'],
      autoActivate: true,
    })
    const meta = frontmatterToSkillMeta(fm, 'test', 'SKILL.md')
    expect(meta.triggers).toEqual(['生成', '批量'])
    expect(meta.tags).toEqual(['创作'])
    expect(meta.autoActivate).toBe(true)
  })
})
