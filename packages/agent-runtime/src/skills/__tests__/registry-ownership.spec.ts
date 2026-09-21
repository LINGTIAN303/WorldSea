/**
 * 技能归属核验（S5 收口 2026-09-18；批 3 重定 2026-09-21）
 *
 * 判据演进：
 * - S5（2026-09-18）：SKILL_REGISTRY ⊆ 芽声明集合 ∪ 挂账白名单——核验「独立 Skills = 0」，
 *   芽所属技能暂时保留（用户裁定「27 芽所属 Skills 后续会有单独改动」）。
 * - 批 3（2026-09-21，即该「单独改动」）：26 项芽所属技能退役——其「使用方法」迁入
 *   worldview 工具（tools/worldview/guides.ts）；SKILL_REGISTRY 仅存挂账的 creation-orchestrator。
 *   本测试相应重定为「注册表恰为挂账白名单」+ 26 项退役 id 不复活。
 *
 * 背景：S4-S5 累计退役 26 项（6 通用 SKILL.md + smart-fill + coding + 2 遗漏独立技能 +
 * 17 个 instructions 类 + 孤儿 atlas-cartographer）；批 3 再退役 26 项芽所属技能。
 * 详见 docs/plans/2026-09-17-三域对齐dsh/04-存量处置查清清单.md 与
 * docs/plans/2026-09-21-世界观芽工具整合.md。
 */

import { describe, it, expect } from 'vitest'
import { SKILL_REGISTRY } from '../registry'

/** 挂账白名单（已裁定保留/待议，非芽所属） */
const INDEPENDENT_WHITELIST = ['creation-orchestrator']

/** 批 3 退役的 26 项芽所属技能（不复活断言） */
const BATCH3_RETIRED = [
  'outline-architect', 'notebook-curator', 'tactical-planner', 'magic-system-designer',
  'character-profile', 'culture-customs', 'language-system', 'conflict-history',
  'building-geography', 'item-encyclopedia', 'lore-concepts', 'combat-system',
  'timeline-architect', 'graph-explorer', 'mindmap-builder', 'manuscript-author',
  'inspiration-curator', 'module-builder', 'worldbuilding', 'content-craft',
  'roleplay', 'analysis-engine', 'retrofit-architect', 'persona-possess',
  'web-scout', 'output-orchestrator',
]

describe('Skills 归属核验（批 3 重定）', () => {
  it('注册表恰为挂账白名单（芽所属技能已全部退役）', () => {
    const ids = SKILL_REGISTRY.map((s) => s.id)
    expect([...ids].sort()).toEqual([...INDEPENDENT_WHITELIST].sort())
  })

  it('核验快照：注册表规模 1（仅挂账）；已退役 id 不复活', () => {
    const ids = SKILL_REGISTRY.map((s) => s.id)
    expect(ids).toHaveLength(1)
    expect(ids).toContain('creation-orchestrator')
    // 批 3 退役的 26 项芽所属技能（不复活）
    for (const retired of BATCH3_RETIRED) {
      expect(ids, `${retired} 不应在注册表中`).not.toContain(retired)
    }
    // S4/S5 已退役 id 清单（抽样：各批次代表）——防止误复活
    for (const retired of ['coding', 'memory', 'smart-fill', 'project-io', 'knowledge-base', 'deep-thinking', 'task-execution', 'knowledge-explorer', 'data-analyst', 'relation-explorer', 'vision-analyzer', 'skill-creator', 'code-reviewer']) {
      expect(ids, `${retired} 不应在注册表中`).not.toContain(retired)
    }
  })
})
