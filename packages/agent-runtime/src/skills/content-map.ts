// Auto-generated skill content map (H3 ignition 2026-08-30). DO NOT edit by hand.
// Why: Vite8/Rolldown import.meta.glob silently matches nothing for module-relative patterns,
// so we use explicit dynamic imports instead. Regenerate when skill files change.
// 2026-09-18 S4 存量处置：随技能退役累计移除 25 条映射（第一批 9 + smart-fill 1 + instructions 类 15）；
// 2026-09-21 世界观芽工具整合（批 3）：26 项芽所属技能退役（其「使用方法」迁 worldview 工具），
// 移除 37 条映射——仅保留挂账的 creation-orchestrator（单独议，见 docs/plans/2026-09-17-三域对齐dsh/05-instructions类技能评估.md）。
export type SkillContentLoader = () => Promise<{ default: string }>

export const SKILL_CONTENT_LOADERS: Record<string, SkillContentLoader> = {
  'creation-orchestrator/instructions.md': () => import('./creation-orchestrator/instructions.md?raw'),
}
