// 技能可见性计算（原 registry.ts 内部辅助函数），SKILL_REGISTRY 数据拆分后供 skills/data 数据文件与 registry.ts 复用，见 docs/details/注释/packages/agent-runtime/skills-registry.md
import type { SkillVisibility } from '../registry'

const SKILL_DEVELOPER_TOOLS = [
  'code-reviewer', 'test-automator', 'doc-generator', 'security-scanner', 'sys-inspector',
]

const SKILL_ADVANCED_TOOLS = [
  'pkg-manager', 'git-operator', 'web-cli-operator', 'terminal-operator', 'terminal-launcher',
]

export function getSkillVisibility(skillId: string): SkillVisibility {
  if (SKILL_DEVELOPER_TOOLS.includes(skillId)) return 'developer'
  if (SKILL_ADVANCED_TOOLS.includes(skillId)) return 'advanced'
  return 'always'
}
