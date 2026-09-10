import type { Component } from 'vue'

/* ── 新槽位模型（P1 槽位优先） ── */

export type SlotArrangement =
  | 'horizontal' | 'vertical' | 'tabs' | 'grid'
  | 'accordion' | 'carousel' | 'split' | 'free'

export interface SlotSize {
  width?: number | 'auto'
  height?: number | 'auto'
  flex?: number
  minWidth?: number
  minHeight?: number
}

/** 槽位：递归结构单元。container 内含子槽位；leaf 内含组件。 */
export interface Slot {
  id: string
  name?: string
  arrangement: SlotArrangement
  kind: 'container' | 'leaf'
  size?: SlotSize
  /** 形态专属配置（grid: columns / tabs: labels / …） */
  options?: Record<string, unknown>
  children?: Slot[]
  components?: PlacedComponent[]
}

/* ── 旧模型（迁移源，仅用于读取历史数据） ── */

export interface LayoutSlot {
  id: string
  direction: 'horizontal' | 'vertical'
  children: LayoutSlotChild[]
  resizable?: boolean
  gap?: number
}

export type LayoutSlotChild =
  | { type: 'slot'; slot: LayoutSlot }
  | { type: 'zone'; zoneId: string; width?: number | 'auto'; height?: number | 'auto'; flex?: number; resizable?: boolean }

/* ── 组件 ── */

export interface PlacedComponent {
  id: string
  type: ComponentTypeId
  /** 旧模型 zoneId；新模型组件内嵌 leaf 槽位，可省略 */
  zoneId?: string
  config: Record<string, unknown>
  width?: number | 'auto'
  height?: number | 'auto'
  order: number
  x?: number
  y?: number
  expanded?: boolean
  childSlot?: Slot
  linkTo?: string[]
}

/* ── schema 主结构 ── */

export interface ModuleLayoutSchema {
  version: 2
  root: Slot
}

export function createEmptySlotRoot(): Slot {
  return { id: 'root', arrangement: 'vertical', kind: 'container', children: [] }
}

export function createEmptyLayoutSchema(): ModuleLayoutSchema {
  return { version: 2, root: createEmptySlotRoot() }
}

/* ── 组件类型 ── */

export type ComponentTypeId =
  | 'detail-panel' | 'edit-form' | 'property-panel' | 'field-group'
  | 'toolbar' | 'action-button' | 'batch-actions' | 'context-menu' | 'quick-actions'
  | 'search-box' | 'filter-bar' | 'sort-control'
  | 'entity-list' | 'entity-grid' | 'entity-table' | 'kanban-board' | 'entity-card'
  | 'chart-bar' | 'chart-pie' | 'chart-line' | 'relation-graph'
  | 'tab-container' | 'accordion-container' | 'split-panel'
  | (string & {})

export type ComponentCategory = 'detail-edit' | 'action-tool' | 'search-filter' | 'data-display' | 'visualization' | 'layout-container'

export type ActionType =
  | 'create' | 'delete' | 'save' | 'export' | 'import'
  | 'duplicate' | 'refresh' | 'custom'

export interface ConfigFieldDefinition {
  key: string
  label: string
  type: 'text' | 'select' | 'boolean' | 'number' | 'multiselect' | 'entity-type-ref' | 'field-ref'
  options?: string[]
  required?: boolean
  defaultValue?: unknown
}

export interface ComponentTypeDefinition {
  typeId: ComponentTypeId
  label: string
  icon: string
  category: ComponentCategory
  configSchema: ConfigFieldDefinition[]
  renderer: Component
  configurator?: Component
  defaultConfig: Record<string, unknown>
}
