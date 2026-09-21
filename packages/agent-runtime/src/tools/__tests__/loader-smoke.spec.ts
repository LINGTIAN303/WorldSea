/**
 * H3 Skills 点火冒烟（2026-08-30）：loader 的 content-map 懒加载实证
 * 背景：桌面真机 load_skill('worldbuilding') 返回 has no instructions，
 * 但 SKILL.md/references 文件都在——怀疑 glob 在运行环境未命中，此测试定位。
 *
 * 2026-09-21 世界观芽工具整合（批 3）：26 项芽所属技能退役（含原冒烟对象 worldbuilding），
 * 冒烟对象改为挂账的 creation-orchestrator（content-map 现仅此一条）；
 * 芽的「使用方法」改由 worldview 工具提供（tools/worldview/guides.ts）。
 */
import { describe, it, expect } from 'vitest'
import { loadSkillPrompt } from '../../skills/loader'
import { findSkillById } from '../../skills/registry'

describe('loader 冒烟（H3 点火）', () => {
  it('内置 creation-orchestrator 技能应能加载出提示词正文', async () => {
    const skill = findSkillById('creation-orchestrator')
    expect(skill).toBeTruthy()
    expect(skill!.promptFile).toBe('creation-orchestrator/instructions.md')
    const prompt = await loadSkillPrompt(skill!)
    // 桌面真机表现为空（has no instructions）——此处复现即为 loader/内容表层问题
    expect(prompt).toBeTruthy()
    expect(prompt!.length).toBeGreaterThan(100)
  })
})
