// 技能元数据（开发类），来源 registry.ts SKILL_REGISTRY 拆分，见 docs/details/注释/packages/agent-runtime/skills-registry.md
import type { SkillMeta } from '../registry'

export const DEVELOPMENT_SKILLS: SkillMeta[] = [
  // 2026-09-18 S5 收口：coding 技能亦已退役（T3：原被 CodingScenario.builtin_skills 硬引用，
  // 引用点已同步清空）。其编码工具面（read_file/write_file/edit_file/search_files/list_directory/
  // bash/powershell/web_search）为原生工具且已在 SYSTEM_BASE_TOOLS，跨场景直接可达；
  // 工具使用约定已并入 WORLDSEA.md「版本控制与工程操作」「代码审查 / 测试 / 文档」两条。
  //
  // 更早（S4 第三批）：14 个 instructions.md 类技能已退役——terminal-operator / fs-operator /
  // pkg-manager / git-operator / sys-inspector / web-cli-operator / code-reviewer / test-automator /
  // doc-generator / security-scanner / skill-creator / find-skills / terminal-launcher /
  // agent-orchestrator；评估见 docs/plans/2026-09-17-三域对齐dsh/05-instructions类技能评估.md
]