/**
 * 内置技能 frontmatter 实测与合规报告（S1 协议基座，2026-09-17）
 *
 * 目的两件：
 * ① 端到端证据：真实文件（timeline-architect 的多行 flow 序列）在解析器升级后能取到
 *    allowed-tools（修复前恒空）——事实修正的可验证锚点。原锚点之一 atlas-cartographer
 *    已在 S4 存量处置退役（2026-09-18），回归锚点由 timeline-architect 承担。
 * ② 合规报告（只报不改）：遍历全部内置 SKILL.md，登记有/无 frontmatter 与校验问题分布，
 *    供存量处置（S4）逐项裁量使用；本测试不对存量合规性做断言（避免锁死待处置现状）。
 */

import { describe, it, expect } from 'vitest'
import { SKILL_CONTENT_LOADERS } from '../content-map'
import { parseFrontmatter } from '../parser'
import { validateSkillFrontmatter } from '../validator'
import { isSkillCompliant } from '../validator'

describe('内置技能 frontmatter 实测（S1 修复证据）', () => {
  it('timeline-architect 的 allowed-tools 可解析（修复前恒空）', async () => {
    const loader = SKILL_CONTENT_LOADERS['timeline-architect/SKILL.md']
    expect(loader, 'timeline-architect/SKILL.md 应在 content-map 中').toBeTruthy()
    const mod = await loader()
    const fm = parseFrontmatter(mod.default).frontmatter
    expect(fm.allowedTools.length, 'allowedTools 应非空').toBeGreaterThan(0)
  })

  it('全部内置 SKILL.md 可加载并解析，合规分布登记（只报不改）', async () => {
    const keys = Object.keys(SKILL_CONTENT_LOADERS).filter((k) => k.endsWith('/SKILL.md'))
    // S4 退役 7 个 SKILL.md（6 独立技能 + 孤儿）后余 30 个；下限断言只防「加载表被打空」
    expect(keys.length).toBeGreaterThanOrEqual(25)

    const report = { total: keys.length, withFrontmatter: 0, withoutFrontmatter: 0, compliant: 0, errorFields: new Set<string>() }
    for (const key of keys) {
      const mod = await SKILL_CONTENT_LOADERS[key]()
      const fm = parseFrontmatter(mod.default).frontmatter
      if (fm.name || fm.id) report.withFrontmatter += 1
      else report.withoutFrontmatter += 1
      const issues = validateSkillFrontmatter(fm, { dirName: key.split('/')[0] })
      if (isSkillCompliant(issues)) report.compliant += 1
      for (const issue of issues.filter((i) => i.level === 'error')) report.errorFields.add(issue.field ?? '?')
    }

    // 报告只登记不判罚：仅断言遍历完整（分布与错误面供 S4 使用）
    expect(report.withFrontmatter + report.withoutFrontmatter).toBe(report.total)
    console.log(
      `[内置技能 frontmatter 报告] 共 ${report.total} 个：有 frontmatter ${report.withFrontmatter} / 无 ${report.withoutFrontmatter}；` +
        `规范合规（无 error） ${report.compliant}；error 字段分布 = ${[...report.errorFields].join(', ') || '无'}`,
    )
  })
})