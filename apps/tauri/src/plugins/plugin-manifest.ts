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
  { id: 'official.characters', importPath: './characters/index', defaultActive: true, name: '角色' },
  { id: 'official.regions', importPath: './regions/index', defaultActive: true, name: '区域' },
  { id: 'official.timeline', importPath: './timeline/index', defaultActive: true, name: '时间线' },
  { id: 'official.organizations', importPath: './organizations/index', defaultActive: true, name: '组织' },
  { id: 'official.concepts', importPath: './concepts/index', defaultActive: true, name: '概念' },
  { id: 'official.items', importPath: './items/index', defaultActive: true, name: '物品' },
  { id: 'official.custom', importPath: './custom/index', defaultActive: false, name: '自定义' },
  { id: 'official.module-builder', importPath: './module-builder/index', defaultActive: false, name: '模块构建器' },
  { id: 'official.graph', importPath: './graph/index', defaultActive: true, name: '图谱' },
  { id: 'official.buildings', importPath: './buildings/index', defaultActive: true, name: '建筑' },
  { id: 'official.species', importPath: './species/index', defaultActive: true, name: '物种' },
  { id: 'official.magic', importPath: './magic/index', defaultActive: true, name: '魔法' },
  { id: 'official.outline', importPath: './outline/index', defaultActive: false, name: '大纲' },
  { id: 'official.languages', importPath: './languages/index', defaultActive: true, name: '语言' },
  { id: 'official.culture', importPath: './culture/index', defaultActive: true, name: '文化' },
  { id: 'official.conflict', importPath: './conflict/index', defaultActive: true, name: '冲突' },
  { id: 'official.inspiration', importPath: './inspiration/index', defaultActive: false, name: '灵感' },
  { id: 'official.plants', importPath: './plants/index', defaultActive: true, name: '植物' },
  { id: 'official.combat_stats', importPath: './combat_stats/index', defaultActive: true, name: '战斗属性' },
  { id: 'official.weapons', importPath: './weapons/index', defaultActive: true, name: '武器' },
  { id: 'official.manuscript', importPath: './manuscript/index', defaultActive: true, name: '手稿' },
  { id: 'official.drawing', importPath: './drawing/index', defaultActive: true, name: '绘画' },
  { id: 'official.tactical-board', importPath: './tactical-board/index', defaultActive: true, name: '战术板' },
  { id: 'official.apparel', importPath: './apparel/index', defaultActive: true, name: '服饰' },
  { id: 'official.notebook', importPath: './notebook/index', defaultActive: true, name: '笔记本' },
  { id: 'official.workflow', importPath: './workflow/index', defaultActive: true, name: '工作流' },
] as const

export const OFFICIAL_SPROUT_IDS: ReadonlySet<string> = new Set(OFFICIAL_SPROUTS.map(p => p.id))
