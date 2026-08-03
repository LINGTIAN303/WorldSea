import type { Component } from 'vue'

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

export interface PlacedComponent {
  id: string
  type: ComponentTypeId
  zoneId: string
  config: Record<string, unknown>
  width?: number | 'auto'
  height?: number | 'auto'
  order: number
  x?: number
  y?: number
  expanded?: boolean
  childSlot?: LayoutSlot
  linkTo?: string[]
}

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

export interface ModuleLayoutSchema {
  version: 1
  layout: LayoutSlot
  components: PlacedComponent[]
}
