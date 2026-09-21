/**
 * S2 管理面与发现面契约测试（2026-09-18）
 *
 * 覆盖：① 创建模板（规范 SKILL.md + sidecar，生成物回读自检合规）
 * ② 导入组装（composeSkillMd / sidecarJsonFromMeta / validateSkillMdText 前置校验口径）
 * ③ 发现面合并策略（D3：安装根覆盖同名内置 + warning，被覆盖内置从视图剔除）。
 */

import { describe, it, expect } from 'vitest'
import {
  buildSkillTemplate,
  composeSkillMd,
  buildSidecarJson,
  sidecarJsonFromMeta,
  validateSkillMdText,
  isCreatableSkillId,
} from '../creator'
import { parseWorldSeaSkillSidecar } from '../sidecar'
import { mergeInstalledOverBuiltin } from '../registry'
import type { SkillMeta } from '../registry'

describe('buildSkillTemplate · 创建模板（S2）', () => {
  it('合法输入生成合规 SKILL.md（回读自检无 error）', () => {
    const tpl = buildSkillTemplate({ id: 'my-skill', name: '我的技能', description: '做某事。当用户提到 X 时使用。' })
    expect(tpl.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(tpl.skillMd.startsWith('---\nname: my-skill\n')).toBe(true)
    expect(tpl.skillMd).toContain('# 我的技能')
    expect(tpl.skillMd).toContain('## 何时使用')
    expect(tpl.sidecarJson).toBeUndefined()
  })

  it('描述折行被压平（行级解析器契约）', () => {
    const tpl = buildSkillTemplate({ id: 'flat-skill', description: '第一行\n第二行' })
    expect(tpl.skillMd).toContain('description: 第一行 第二行')
    expect(validateSkillMdText(tpl.skillMd, 'flat-skill').filter((i) => i.level === 'error')).toEqual([])
  })

  it('非法 id 产生 name error（由调用方拦截或放行）', () => {
    const tpl = buildSkillTemplate({ id: 'Bad_ID', description: 'x' })
    expect(tpl.issues.some((i) => i.level === 'error' && i.field === 'name')).toBe(true)
    expect(isCreatableSkillId('Bad_ID')).toBe(false)
    expect(isCreatableSkillId('good-id-2')).toBe(true)
  })

  it('私有字段生成 sidecar（可被 sidecar 解析器读回）', () => {
    const tpl = buildSkillTemplate({
      id: 'with-sidecar',
      description: 'd',
      icon: 'sparkles',
      priority: 9,
      tags: ['t1', 't2'],
    })
    expect(tpl.sidecarJson).toBeTruthy()
    const parsed = parseWorldSeaSkillSidecar(tpl.sidecarJson)
    expect(parsed).toMatchObject({ icon: 'sparkles', priority: 9, tags: ['t1', 't2'] })
  })

  it('缺省 name 时正文标题回退为 id', () => {
    const tpl = buildSkillTemplate({ id: 'no-name', description: 'd' })
    expect(tpl.skillMd).toContain('# no-name')
  })
})

describe('导入组装（S2）', () => {
  it('composeSkillMd：frontmatter 只含规范必填字段', () => {
    const md = composeSkillMd('imported-skill', '导入的技能描述', '# 正文\n内容')
    expect(md).toBe('---\nname: imported-skill\ndescription: 导入的技能描述\n---\n\n# 正文\n内容\n')
  })

  it('validateSkillMdText：name 与目录不同名报 error；同名无 error', () => {
    const md = composeSkillMd('skill-a', 'd', 'body')
    expect(validateSkillMdText(md, 'skill-a').filter((i) => i.level === 'error')).toEqual([])
    expect(validateSkillMdText(md, 'skill-b').some((i) => i.level === 'error')).toBe(true)
  })

  it('buildSidecarJson：无有效字段返回 undefined；空 icon 被忽略', () => {
    expect(buildSidecarJson({})).toBeUndefined()
    expect(buildSidecarJson({ icon: '   ' })).toBeUndefined()
    expect(buildSidecarJson({ priority: 3 })).toContain('"priority": 3')
  })

  it('sidecarJsonFromMeta：默认值不入 sidecar（icon=module-builder / visibility=always）', () => {
    const meta = makeMeta({ icon: 'module-builder', visibility: 'always', priority: 5 })
    const json = sidecarJsonFromMeta(meta)
    const parsed = parseWorldSeaSkillSidecar(json)
    expect(parsed?.icon).toBeUndefined()
    expect(parsed?.visibility).toBeUndefined()
    // priority 为 5（默认）仍写入——数值无「默认等于不写」语义，便于用户显式调整
    expect(parsed?.priority).toBe(5)
  })

  it('sidecarJsonFromMeta：编排字段完整携带', () => {
    const meta = makeMeta({
      icon: 'sparkles',
      visibility: 'developer',
      tags: ['t'],
      capabilities: { internal: ['entity_list'], cli: [], mcp: [] },
      outputPreferences: [{ channel: 'a2ui', component: 'EntityCard' }],
      pluginTools: [{ pluginId: 'outline', tools: ['create_node'] }],
    })
    const parsed = parseWorldSeaSkillSidecar(sidecarJsonFromMeta(meta))
    expect(parsed).toMatchObject({
      icon: 'sparkles',
      visibility: 'developer',
      tags: ['t'],
      capabilities: { internal: ['entity_list'], cli: [], mcp: [] },
      outputPreferences: [{ channel: 'a2ui', component: 'EntityCard', plugin: undefined, condition: undefined }],
    })
    expect(parsed?.pluginTools?.[0].pluginId).toBe('outline')
  })
})

describe('发现面合并策略（D3：安装根 > 内置）', () => {
  const builtin = [makeMeta({ id: 'a' }), makeMeta({ id: 'b' })]
  const installed = [makeMeta({ id: 'b', name: '覆盖版' }), makeMeta({ id: 'c' })]

  it('同名覆盖：内置被剔除、安装版生效、登记 warning', () => {
    const warnings: string[] = []
    const merged = mergeInstalledOverBuiltin(builtin, installed, warnings)
    // 顺序 = 未被覆盖的内置 + 已安装（覆盖版本的位次随已安装列表）
    expect(merged.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(merged.find((s) => s.id === 'b')?.name).toBe('覆盖版')
    expect(warnings.some((w) => w.includes('覆盖了同名内置'))).toBe(true)
  })

  it('无冲突时顺序为「内置 + 已安装」且无 warning', () => {
    const warnings: string[] = []
    const merged = mergeInstalledOverBuiltin(builtin, [makeMeta({ id: 'c' })], warnings)
    expect(merged.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(warnings).toEqual([])
  })

  it('已安装为空时返回内置列表原样', () => {
    const merged = mergeInstalledOverBuiltin(builtin, [])
    expect(merged.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

/** 构造测试用 SkillMeta（仅覆盖测试需要的字段） */
function makeMeta(overrides: Partial<SkillMeta> & { id?: string } = {}): SkillMeta {
  return {
    id: overrides.id ?? 'demo',
    name: overrides.name ?? '演示',
    icon: overrides.icon ?? 'sparkles',
    description: overrides.description ?? '描述',
    category: overrides.category ?? 'action',
    enabled: overrides.enabled ?? true,
    visibility: overrides.visibility ?? 'always',
    version: overrides.version ?? '1.0.0',
    promptFile: overrides.promptFile ?? 'SKILL.md',
    allowedTools: overrides.allowedTools ?? [],
    baseTools: overrides.baseTools ?? [],
    tags: overrides.tags,
    priority: overrides.priority,
    capabilities: overrides.capabilities,
    outputPreferences: overrides.outputPreferences,
    pluginTools: overrides.pluginTools,
    relatedPlugins: overrides.relatedPlugins,
    triggers: overrides.triggers,
  }
}