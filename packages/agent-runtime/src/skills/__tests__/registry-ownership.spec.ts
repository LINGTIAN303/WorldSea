/**
 * 「独立 Skills = 0」归属核验（S5 收口，2026-09-18）
 *
 * 判据：SKILL_REGISTRY 的全部条目必须属于「芽声明集合」
 * （`WORLD_SMITH_PLUGIN_CAPABILITIES` 的 agentSkills 并集）或挂账白名单——
 * 否则说明出现了新的**独立技能**（非芽所属），需要评审后要么归芽、要么补白名单。
 * 本测试即该契约的回归守卫（新增/删除技能时会失败，提醒同步评审与索引）。
 *
 * 背景：S4-S5 累计退役 26 项（6 通用 SKILL.md + smart-fill + coding + 2 遗漏独立技能 +
 * 17 个 instructions 类 + 孤儿 atlas-cartographer）；详见
 * docs/plans/2026-09-17-三域对齐dsh/04-存量处置查清清单.md 与 05-instructions类技能评估.md
 */

import { describe, it, expect } from 'vitest'
import { SKILL_REGISTRY } from '../registry'
import { WORLD_SMITH_PLUGIN_CAPABILITIES } from '../plugin-bridge'

/** 挂账白名单（已裁定保留/待议，非芽所属） */
const INDEPENDENT_WHITELIST = ['creation-orchestrator']

describe('Skills 归属核验（独立 Skills = 0）', () => {
  it('注册表条目全部为「芽所属」或挂账白名单', () => {
    const sproutDeclared = new Set(WORLD_SMITH_PLUGIN_CAPABILITIES.flatMap((c) => c.agentSkills))
    const independent = SKILL_REGISTRY.map((s) => s.id).filter(
      (id) => !sproutDeclared.has(id) && !INDEPENDENT_WHITELIST.includes(id),
    )
    expect(independent).toEqual([])
  })

  it('核验快照：注册表规模 27（26 芽所属 + 1 挂账）；已退役 id 不复活', () => {
    const ids = SKILL_REGISTRY.map((s) => s.id)
    expect(ids).toHaveLength(27)
    expect(ids).toContain('creation-orchestrator')
    // 已退役 id 清单（抽样：各批次代表）——防止误复活
    for (const retired of ['coding', 'memory', 'smart-fill', 'project-io', 'knowledge-base', 'deep-thinking', 'task-execution', 'knowledge-explorer', 'data-analyst', 'relation-explorer', 'vision-analyzer', 'skill-creator', 'code-reviewer']) {
      expect(ids, `${retired} 不应在注册表中`).not.toContain(retired)
    }
  })
})