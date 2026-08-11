import type { Slot, PlacedComponent } from './layoutSchema'
import { createEmptySlotRoot } from './layoutSchema'

/**
 * 新页面模型（以「工具条 + 视图」为画布）。
 * 一张插件页面 = 工具条区（顶部栏）+ 视图区（主体），各为一棵槽位树。
 * 挂载于 module.layoutSchema（契约层为 v1 类型，运行时强转读取）。
 */
export interface PageSchema {
  version: 3
  /** 工具条区槽位树（面包屑/搜索/筛选/新建/更多 等坑位） */
  toolbar: Slot
  /** 视图区槽位树（主体栏/堆/页签/网格…） */
  view: Slot
}

/** 工具条默认坑位（可编辑的容器 leaf） */
export function createDefaultToolbarRoot(): Slot {
  return {
    id: 'toolbar',
    name: '工具条',
    arrangement: 'horizontal',
    kind: 'container',
    children: [
      { id: 'toolbar-breadcrumb', name: '面包屑', arrangement: 'horizontal', kind: 'leaf', components: [] },
      { id: 'toolbar-search', name: '搜索', arrangement: 'horizontal', kind: 'leaf', components: [] },
      { id: 'toolbar-filter', name: '筛选', arrangement: 'horizontal', kind: 'leaf', components: [] },
      { id: 'toolbar-actions', name: '动作', arrangement: 'horizontal', kind: 'leaf', components: [] },
      { id: 'toolbar-create', name: '新建', arrangement: 'horizontal', kind: 'leaf', components: [] },
      { id: 'toolbar-more', name: '更多', arrangement: 'horizontal', kind: 'leaf', components: [] },
    ],
  }
}

export function createEmptyPageSchema(): PageSchema {
  return {
    version: 3,
    toolbar: createDefaultToolbarRoot(),
    view: createEmptySlotRoot(),
  }
}

/** 统计槽位树中的组件数 */
export function countComponents(slot: Slot): number {
  if (slot.kind === 'leaf') return (slot.components || []).length
  return (slot.children || []).reduce((n, c) => n + countComponents(c), 0)
}

export type { Slot, PlacedComponent }