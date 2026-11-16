/**
 * 内置**装配预设**（阶段 2：「装配是数据不是代码」，2026-11-17）。
 *
 * 为什么需要这一层：产品形态的变体（纯写作 / 推演 / 观测 / 全量）此前只能靠用户
 * 在设置面板里逐个勾选 41 个芽开关来表达——形态选择散落在 UI 交互里，没有名字、
 * 不能复用、也无法被代码引用。dsh 侧对应物是 `cordis.patch.yml`：**一行配置组合
 * 改变产品形态**，且配置本身是一等公民（可版本化、可对比、可分发）。
 *
 * 本模块把「形态」变成数据：
 * - `ASSEMBLY_PRESETS` 是常量表，不依赖运行时状态（可在任何地方读、可被测试直接断言）；
 * - 每条预设 = 一组芽 id（`sproutIds`）+ 元数据（名称 / 说明 / 是否默认）；
 * - 应用预设走既有的 `applySproutGroup` 路径（它已实现「按 id 列表批量启停」）。
 *
 * 与「用户自建分组」的区别：预设是**内置常量**（随代码分发、不可删），
 * 分组是**用户数据**（存项目里、可增删改）。两者共用同一个应用入口，故 UI 不必分叉。
 */

import type { SproutGroup } from './settingsStore'

/** 一条内置装配预设。 */
export interface AssemblyPreset {
  /** 稳定 id（与用户分组的 `sg-*` 前缀区分开）。 */
  id: string
  /** 用户可见名（中性描述，不带引导词）。 */
  name: string
  /** 一句话说明「这个形态适合做什么」。 */
  description: string
  /** 启用的芽 id 全集；不在此列的一律停用。 */
  sproutIds: string[]
}

/**
 * 形态预设表。
 *
 * 命名口径：每条预设描述的是**工作形态**（正在做什么），不是「用户类型」。
 * 芽 id 取 manifest 的 `official.*` 形式（与 `sprouts` 表一致）。
 *
 * 维护约定：新增芽时**不必**改这里——未列入任何预设的芽在「全量」预设里自动可见；
 * 但若某个芽明显属于某形态的核心（如 `manuscript` 之于写作），应补进该预设，
 * 否则用户选了该形态却发现核心功能不在。
 */
export const ASSEMBLY_PRESETS: readonly AssemblyPreset[] = [
  {
    id: 'preset:writing',
    name: '写作',
    description: '正文、大纲、笔记本、时间线为核心；收起观测类与推演类，减少侧栏噪音',
    sproutIds: [
      'official.manuscript',
      'official.outline',
      'official.notebook',
      'official.timeline',
      'official.characters',
      'official.inspiration',
      'official.codex',
    ],
  },
  {
    id: 'preset:tactical',
    name: '推演',
    description: '战术棋盘与战力、武器、魔法、物种为核心；收起写作类',
    sproutIds: [
      'official.tactical-board',
      'official.combat_stats',
      'official.weapons',
      'official.apparel',
      'official.items',
      'official.magic',
      'official.species',
      'official.creatures',
      'official.characters',
    ],
  },
  {
    id: 'preset:worldbuilding',
    name: '世界观',
    description: '地理、社会、知识、生命四域全开；收起写作与推演，专注设定本身',
    sproutIds: [
      'official.buildings',
      'official.regions',
      'official.culture',
      'official.languages',
      'official.organizations',
      'official.faith',
      'official.conflict',
      'official.concepts',
      'official.magic',
      'official.species',
      'official.creatures',
      'official.plants',
      'official.items',
      'official.weapons',
      'official.codex',
    ],
  },
  {
    id: 'preset:review',
    name: '审视',
    description: '只留观测器与聚合视图，用于通读已有设定、查漏补缺',
    sproutIds: [
      'official.field-matrix',
      'official.codex',
      'official.gallery',
      'official.graph',
      'official.search',
    ],
  },
] as const

/**
 * 「全量」不是一条预设，而是一个**动作**：恢复所有芽为启用。
 *
 * 之所以不做成 `sproutIds` 列表：全量意味着「不排除任何芽」，而列表会随新芽增加而过期
 * （新芽不在列表里就被停用，与「全量」的语义相反）。故由调用方传「全部 id」。
 */
export const FULL_ASSEMBLY_LABEL = '全部启用'

/**
 * 把预设转成可应用的分组形状（复用 `applySproutGroup` 那条既有路径）。
 *
 * 这样 UI 与代码都只有一个应用入口，不必为「预设」与「分组」写两套。
 */
export function presetAsGroup(preset: AssemblyPreset): SproutGroup {
  return { id: preset.id, name: preset.name, sproutIds: [...preset.sproutIds] }
}

/**
 * 找出某组启用 id 匹配哪条预设（用于 UI 高亮「当前形态」）。
 *
 * 判据是**集合相等**而非包含：只启用了预设的一个子集不算命中——那是用户自定义形态。
 * 全量启用不匹配任何预设（返回 undefined），由调用方显示为「自定义」。
 */
export function matchPreset(activeIds: readonly string[]): AssemblyPreset | undefined {
  const active = new Set(activeIds)
  return ASSEMBLY_PRESETS.find(preset => {
    const ids = new Set(preset.sproutIds)
    if (ids.size !== active.size) return false
    for (const id of ids) if (!active.has(id)) return false
    return true
  })
}
