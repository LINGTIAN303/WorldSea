export const fieldTypes = [
  { value: 'text', label: '文本' },
  { value: 'textarea', label: '长文本' },
  { value: 'richtext', label: '富文本' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '下拉选择' },
  { value: 'multi-select', label: '多选' },
  { value: 'tags', label: '标签' },
  { value: 'boolean', label: '开关' },
  { value: 'date', label: '日期' },
  { value: 'rating', label: '评分' },
  { value: 'slider', label: '滑块' },
  { value: 'color', label: '颜色' },
  { value: 'entityRef', label: '关联实体' },
]

export const viewTypeOptions = [
  { value: 'list', label: '列表' },
  { value: 'card', label: '卡片' },
  { value: 'kanban', label: '看板' },
  { value: 'tree', label: '树形' },
  { value: 'table', label: '表格' },
]

export const cardSortOrderOptions = [
  { value: 'asc', label: '升序' },
  { value: 'desc', label: '降序' },
]

export function fieldTypeIcon(type: string): string {
  const map: Record<string, string> = {
    text: '📝',
    textarea: '📄',
    richtext: '✍️',
    number: '🔢',
    select: '📋',
    'multi-select': '☑️',
    tags: '🏷️',
    boolean: '🔘',
    date: '📅',
    rating: '⭐',
    slider: '🎚️',
    color: '🎨',
    entityRef: '🔗',
  }
  return map[type] || '◻'
}

import type { ComponentTypeDefinition, ConfigFieldDefinition } from './types/layoutSchema'
import DetailPanelRenderer from './runtime/ComponentRenderers/DetailPanelRenderer.vue'
import EditFormRenderer from './runtime/ComponentRenderers/EditFormRenderer.vue'
import PropertyPanelRenderer from './runtime/ComponentRenderers/PropertyPanelRenderer.vue'
import FieldGroupRenderer from './runtime/ComponentRenderers/FieldGroupRenderer.vue'
import ToolbarRenderer from './runtime/ComponentRenderers/ToolbarRenderer.vue'
import ActionButtonRenderer from './runtime/ComponentRenderers/ActionButtonRenderer.vue'
import BatchActionsRenderer from './runtime/ComponentRenderers/BatchActionsRenderer.vue'
import ContextMenuRenderer from './runtime/ComponentRenderers/ContextMenuRenderer.vue'
import QuickActionsRenderer from './runtime/ComponentRenderers/QuickActionsRenderer.vue'
import SearchBoxRenderer from './runtime/ComponentRenderers/SearchBoxRenderer.vue'
import FilterBarRenderer from './runtime/ComponentRenderers/FilterBarRenderer.vue'
import SortControlRenderer from './runtime/ComponentRenderers/SortControlRenderer.vue'
import EntityListRenderer from './runtime/ComponentRenderers/EntityListRenderer.vue'
import EntityGridRenderer from './runtime/ComponentRenderers/EntityGridRenderer.vue'
import EntityTableRenderer from './runtime/ComponentRenderers/EntityTableRenderer.vue'
import KanbanBoardRenderer from './runtime/ComponentRenderers/KanbanBoardRenderer.vue'
import EntityCardRenderer from './runtime/ComponentRenderers/EntityCardRenderer.vue'
import ChartBarRenderer from './runtime/ComponentRenderers/ChartBarRenderer.vue'
import ChartPieRenderer from './runtime/ComponentRenderers/ChartPieRenderer.vue'
import ChartLineRenderer from './runtime/ComponentRenderers/ChartLineRenderer.vue'
import RelationGraphRenderer from './runtime/ComponentRenderers/RelationGraphRenderer.vue'
import TabContainerRenderer from './runtime/ComponentRenderers/TabContainerRenderer.vue'
import AccordionContainerRenderer from './runtime/ComponentRenderers/AccordionContainerRenderer.vue'
import SplitPanelRenderer from './runtime/ComponentRenderers/SplitPanelRenderer.vue'
import { registerComponentType } from './registry/componentTypeRegistry'

const entityTypeRefConfig: ConfigFieldDefinition = { key: 'entityType', label: '实体类型', type: 'entity-type-ref', required: true }

export const COMPONENT_TYPE_DEFINITIONS: ComponentTypeDefinition[] = [
  {
    typeId: 'detail-panel',
    label: '详情面板',
    icon: '📋',
    category: 'detail-edit',
    configSchema: [
      entityTypeRefConfig,
      { key: 'showFields', label: '显示字段', type: 'multiselect' },
      { key: 'editable', label: '可编辑', type: 'boolean', defaultValue: true },
    ],
    renderer: DetailPanelRenderer,
    defaultConfig: { entityType: '', showFields: [], editable: true },
  },
  {
    typeId: 'edit-form',
    label: '编辑表单',
    icon: '✏️',
    category: 'detail-edit',
    configSchema: [
      entityTypeRefConfig,
      { key: 'layout', label: '布局', type: 'select', options: ['vertical', 'grid'], defaultValue: 'vertical' },
    ],
    renderer: EditFormRenderer,
    defaultConfig: { entityType: '', layout: 'vertical' },
  },
  {
    typeId: 'property-panel',
    label: '属性面板',
    icon: '🏷️',
    category: 'detail-edit',
    configSchema: [
      entityTypeRefConfig,
      { key: 'fields', label: '显示字段', type: 'multiselect' },
      { key: 'compact', label: '紧凑模式', type: 'boolean', defaultValue: false },
    ],
    renderer: PropertyPanelRenderer,
    defaultConfig: { entityType: '', fields: [], compact: false },
  },
  {
    typeId: 'field-group',
    label: '字段分组',
    icon: '📁',
    category: 'detail-edit',
    configSchema: [
      { key: 'label', label: '分组名称', type: 'text' },
      { key: 'fields', label: '包含字段', type: 'multiselect' },
      { key: 'collapsible', label: '可折叠', type: 'boolean', defaultValue: true },
    ],
    renderer: FieldGroupRenderer,
    defaultConfig: { label: '', fields: [], collapsible: true },
  },
  {
    typeId: 'toolbar',
    label: '工具栏',
    icon: '🔧',
    category: 'action-tool',
    configSchema: [
      { key: 'actions', label: '操作列表', type: 'multiselect', options: ['create', 'delete', 'save', 'export', 'import', 'duplicate', 'refresh'] },
      { key: 'position', label: '位置', type: 'select', options: ['top', 'bottom'], defaultValue: 'top' },
    ],
    renderer: ToolbarRenderer,
    defaultConfig: { actions: ['create', 'delete'], position: 'top' },
  },
  {
    typeId: 'action-button',
    label: '操作按钮',
    icon: '🔘',
    category: 'action-tool',
    configSchema: [
      { key: 'label', label: '按钮文字', type: 'text' },
      { key: 'icon', label: '图标', type: 'text' },
      { key: 'action', label: '操作类型', type: 'select', options: ['create', 'delete', 'save', 'export', 'import', 'duplicate', 'refresh'], required: true },
    ],
    renderer: ActionButtonRenderer,
    defaultConfig: { label: '', icon: '', action: 'create' },
  },
  {
    typeId: 'batch-actions',
    label: '批量操作',
    icon: '☑️',
    category: 'action-tool',
    configSchema: [
      { key: 'actions', label: '操作列表', type: 'multiselect', options: ['delete', 'export'] },
      { key: 'selectionMode', label: '选择模式', type: 'select', options: ['single', 'multi'], defaultValue: 'multi' },
    ],
    renderer: BatchActionsRenderer,
    defaultConfig: { actions: ['delete'], selectionMode: 'multi' },
  },
  {
    typeId: 'context-menu',
    label: '右键菜单',
    icon: '📝',
    category: 'action-tool',
    configSchema: [
      { key: 'items', label: '菜单项', type: 'text' },
    ],
    renderer: ContextMenuRenderer,
    defaultConfig: { items: [] },
  },
  {
    typeId: 'quick-actions',
    label: '快捷操作',
    icon: '⚡',
    category: 'action-tool',
    configSchema: [
      { key: 'actions', label: '操作列表', type: 'multiselect', options: ['create', 'delete', 'save', 'refresh'] },
      { key: 'position', label: '位置', type: 'select', options: ['top-right', 'bottom-right', 'top-left', 'bottom-left'], defaultValue: 'top-right' },
      { key: 'trigger', label: '触发方式', type: 'select', options: ['hover', 'click'], defaultValue: 'click' },
    ],
    renderer: QuickActionsRenderer,
    defaultConfig: { actions: ['create', 'delete'], position: 'top-right', trigger: 'click' },
  },
  {
    typeId: 'search-box',
    label: '搜索框',
    icon: '🔍',
    category: 'search-filter',
    configSchema: [
      { key: 'placeholder', label: '占位文字', type: 'text', defaultValue: '搜索...' },
    ],
    renderer: SearchBoxRenderer,
    defaultConfig: { placeholder: '搜索...' },
  },
  {
    typeId: 'filter-bar',
    label: '筛选条件栏',
    icon: '🔽',
    category: 'search-filter',
    configSchema: [
      entityTypeRefConfig,
    ],
    renderer: FilterBarRenderer,
    defaultConfig: { entityType: '' },
  },
  {
    typeId: 'sort-control',
    label: '排序控件',
    icon: '↕️',
    category: 'search-filter',
    configSchema: [
      entityTypeRefConfig,
    ],
    renderer: SortControlRenderer,
    defaultConfig: { entityType: '' },
  },
  {
    typeId: 'entity-list',
    label: '实体列表',
    icon: '📋',
    category: 'data-display',
    configSchema: [
      entityTypeRefConfig,
      { key: 'showDescription', label: '显示描述', type: 'boolean', defaultValue: false },
    ],
    renderer: EntityListRenderer,
    defaultConfig: { entityType: '', showDescription: false },
  },
  {
    typeId: 'entity-grid',
    label: '实体网格',
    icon: '🔲',
    category: 'data-display',
    configSchema: [
      entityTypeRefConfig,
      { key: 'columns', label: '列数', type: 'number', defaultValue: 3 },
      { key: 'previewFields', label: '预览字段', type: 'multiselect' },
    ],
    renderer: EntityGridRenderer,
    defaultConfig: { entityType: '', columns: 3, previewFields: [] },
  },
  {
    typeId: 'entity-table',
    label: '实体表格',
    icon: '📊',
    category: 'data-display',
    configSchema: [
      entityTypeRefConfig,
      { key: 'displayColumns', label: '显示列', type: 'multiselect' },
    ],
    renderer: EntityTableRenderer,
    defaultConfig: { entityType: '', displayColumns: [] },
  },
  {
    typeId: 'kanban-board',
    label: '看板',
    icon: '📌',
    category: 'data-display',
    configSchema: [
      entityTypeRefConfig,
      { key: 'groupField', label: '分组字段', type: 'field-ref' },
    ],
    renderer: KanbanBoardRenderer,
    defaultConfig: { entityType: '', groupField: '' },
  },
  {
    typeId: 'entity-card',
    label: '实体卡片',
    icon: '🃏',
    category: 'data-display',
    configSchema: [
      entityTypeRefConfig,
      { key: 'showFields', label: '显示字段', type: 'multiselect' },
    ],
    renderer: EntityCardRenderer,
    defaultConfig: { entityType: '', showFields: [] },
  },
  {
    typeId: 'chart-bar',
    label: '柱状图',
    icon: '📊',
    category: 'visualization',
    configSchema: [
      entityTypeRefConfig,
      { key: 'title', label: '标题', type: 'text' },
      { key: 'labelField', label: '标签字段', type: 'field-ref' },
      { key: 'valueField', label: '数值字段', type: 'field-ref' },
    ],
    renderer: ChartBarRenderer,
    defaultConfig: { entityType: '', title: '', labelField: '', valueField: '' },
  },
  {
    typeId: 'chart-pie',
    label: '饼图',
    icon: '🥧',
    category: 'visualization',
    configSchema: [
      entityTypeRefConfig,
      { key: 'title', label: '标题', type: 'text' },
      { key: 'labelField', label: '标签字段', type: 'field-ref' },
      { key: 'valueField', label: '数值字段', type: 'field-ref' },
    ],
    renderer: ChartPieRenderer,
    defaultConfig: { entityType: '', title: '', labelField: '', valueField: '' },
  },
  {
    typeId: 'chart-line',
    label: '折线图',
    icon: '📈',
    category: 'visualization',
    configSchema: [
      entityTypeRefConfig,
      { key: 'title', label: '标题', type: 'text' },
      { key: 'labelField', label: '标签字段', type: 'field-ref' },
      { key: 'valueField', label: '数值字段', type: 'field-ref' },
      { key: 'smooth', label: '平滑曲线', type: 'boolean', defaultValue: true },
    ],
    renderer: ChartLineRenderer,
    defaultConfig: { entityType: '', title: '', labelField: '', valueField: '', smooth: true },
  },
  {
    typeId: 'relation-graph',
    label: '关系图谱',
    icon: '🕸️',
    category: 'visualization',
    configSchema: [
      entityTypeRefConfig,
      { key: 'relationType', label: '关系类型', type: 'text' },
    ],
    renderer: RelationGraphRenderer,
    defaultConfig: { entityType: '', relationType: '' },
  },
  {
    typeId: 'tab-container',
    label: '标签页容器',
    icon: '📑',
    category: 'layout-container',
    configSchema: [
      { key: 'tabs', label: '标签列表', type: 'multiselect' },
    ],
    renderer: TabContainerRenderer,
    defaultConfig: { tabs: ['标签1'] },
  },
  {
    typeId: 'accordion-container',
    label: '手风琴容器',
    icon: '🪗',
    category: 'layout-container',
    configSchema: [
      { key: 'sectionsText', label: '折叠区域（逗号分隔）', type: 'text', defaultValue: '区域1' },
    ],
    renderer: AccordionContainerRenderer,
    defaultConfig: { sectionsText: '区域1' },
  },
  {
    typeId: 'split-panel',
    label: '分割面板',
    icon: '↔️',
    category: 'layout-container',
    configSchema: [
      { key: 'direction', label: '方向', type: 'select', options: ['horizontal', 'vertical'] },
    ],
    renderer: SplitPanelRenderer,
    defaultConfig: { direction: 'horizontal' },
  },
]

export function initializeComponentTypes() {
  for (const def of COMPONENT_TYPE_DEFINITIONS) {
    registerComponentType(def)
  }
}
