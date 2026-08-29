/**
 * H3 Skills 点火冒烟（2026-08-30）：loader 的 import.meta.glob 懒加载实证
 * 背景：桌面真机 load_skill('worldbuilding') 返回 has no instructions，
 * 但 SKILL.md/references 文件都在——怀疑 glob 在运行环境未命中，此测试定位。
 */
import { describe, it, expect } from 'vitest'
import { loadSkillPrompt, loadSkillReference } from '../../skills/loader'
import { findSkillById } from '../../skills/registry'

describe('loader glob 冒烟（H3 点火）', () => {
  it('内置 worldbuilding 技能应能加载出提示词正文', async () => {
    const skill = findSkillById('worldbuilding')
    expect(skill).toBeTruthy()
    expect(skill!.promptFile).toBe('worldbuilding/SKILL.md')
    const prompt = await loadSkillPrompt(skill!)
    // 桌面真机表现为空（has no instructions）——此处复现即为 loader/glob 层问题
    expect(prompt).toBeTruthy()
    expect(prompt!.length).toBeGreaterThan(100)
  })

  it('内置 worldbuilding 技能应能加载 references/worldbuilding-checklist.md', async () => {
    const skill = findSkillById('worldbuilding')
    const content = await loadSkillReference(skill!, 'references/worldbuilding-checklist.md')
    expect(content).toBeTruthy()
  })
})
