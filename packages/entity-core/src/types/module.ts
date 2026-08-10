import type { ModuleLayoutSchema } from './layoutSchema'

/** 字段类型支持全集 */
export type FieldType =
  | 'text' | 'textarea' | 'number' | 'boolean'
  | 'date' | 'datetime' | 'time'
  | 'select' | 'multi-select' | 'tags'
  | 'image' | 'url' | 'email' | 'color'
  | 'rich-text' | 'markdown'
  | 'rating' | 'slider'
  | 'entity-ref'
  | 'entity-refs'
  | 'formula' | 'computed' | 'template' | 'location' | 'file'

/** 单个字段定义 */
export interface ModuleField {
  key: string
  label: string
  type: FieldType
  required?: boolean
  defaultValue?: unknown
  placeholder?: string
  helpText?: string
  /** select / multi-select */
  options?: string[]
  /** number min/max */
  min?: number
  max?: number
  step?: number
  /** regex 验证 */
  regex?: string
  /** 是否在列表视图中显示 */
  showInList?: boolean
  /** 引用类型：引用的实体类型名称 */
  refType?: string
}

/** 实体类型定义 */
export interface ModuleEntityType {
  name: string
  label: string
  icon: string
  color: string
  fields: ModuleField[]
}

/** 关系类型定义 */
export interface ModuleRelationType {
  name: string
  label: string
  sourceTypes: string[]
  targetTypes: string[]
  directed: boolean
  properties: ModuleField[]
  icon?: string
}

/** 视图配置 */
export interface ModuleViewConfig {
  id: string
  label: string
  icon: string
  type: 'list' | 'grid' | 'table' | 'gallery' | 'kanban' | (string & {})
  entityType: string
  showFields: string[]
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  filters?: { field: string; operator: string; value: string }[]
  viewOptions?: Record<string, unknown>
  _viewConfig?: ModuleViewConfig
}

export interface ModuleDependency {
  moduleId: string
  requiredTypes: string[]
}

export interface CustomModule {
  id: string
  name: string
  icon: string
  description: string
  entityTypes: ModuleEntityType[]
  relationTypes: ModuleRelationType[]
  views: ModuleViewConfig[]
  dependencies?: ModuleDependency[]
  createdAt: string
  updatedAt: string
  layoutSchema?: ModuleLayoutSchema
}

/** 构件箱中的构件类型 */
export type ComponentType =
  | 'entity-type'
  | 'field'
  | 'relation-type'
  | 'view'
