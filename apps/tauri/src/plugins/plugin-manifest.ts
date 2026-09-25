/**
 * 官方芽权威清单。
 * 所有官方芽的 id、导入路径、默认激活状态均在此定义。
 * app.vue 和 PluginSandbox 均从该清单加载，避免硬编码重复。
 */
export interface OfficialSproutEntry {
  id: string
  /** import 路径，相对 src/sprouts/official */
  importPath: string
  /** 是否默认激活 */
  defaultActive: boolean
  /** 人类可读名（兜底用） */
  name?: string
}

export const OFFICIAL_SPROUTS: readonly OfficialSproutEntry[] = [
  { id: 'official.custom', importPath: './custom/index', defaultActive: false, name: '自定义' },
  { id: 'official.graph', importPath: './graph/index', defaultActive: true, name: '图谱' },
  { id: 'official.tactical-board', importPath: './tactical-board/index', defaultActive: true, name: '战术板' },
  { id: 'official.workflow', importPath: './workflow/index', defaultActive: true, name: '工作流' },
] as const

export const OFFICIAL_SPROUT_IDS: ReadonlySet<string> = new Set(OFFICIAL_SPROUTS.map(p => p.id))
