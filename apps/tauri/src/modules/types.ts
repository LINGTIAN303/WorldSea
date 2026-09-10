/**
 * modules/types.ts — 模块系统类型定义
 *
 * 六层架构中最核心的类型文件，被 store / registry / namespace / builder 共享。
 */

/* ════════════════════════════════════════
   字段系统
   ════════════════════════════════════════ */

/** 所有支持的字段类型 */
export type FieldType =
  | 'text' | 'textarea' | 'number' | 'boolean'
  | 'date' | 'datetime' | 'time'
  | 'select' | 'multi-select'
  | 'image' | 'url' | 'email' | 'color'
  | 'rich-text' | 'markdown'
  | 'rating' | 'slider'
  | 'entity-ref' | 'entity-refs'
  // 扩展字段类型（由 FieldExtension 提供）
  | 'formula' | 'computed' | 'template' | 'location' | 'file'
  | (string & {})

/** 字段定义 */
export interface ModuleField {
  key: string
  label: string
  type: FieldType
  required?: boolean
  defaultValue?: unknown
  placeholder?: string
  helpText?: string
  options?: string[]
  min?: number; max?: number; step?: number
  regex?: string
  showInList?: boolean
  refType?: string           // entity-ref: 引用的实体类型名（含 namespace）
  formula?: string           // formula 字段：计算公式
  /** 来源芽 id（用于识别该字段类型由哪个 FieldExtension 提供） */
  extensionId?: string
}

/* ════════════════════════════════════════
   实体类型定义
   ════════════════════════════════════════ */

export interface ModuleEntityType {
  name: string          // 标识键，含 namespace 前缀
  label: string
  icon: string
  color: string
  fields: ModuleField[]
}

/* ════════════════════════════════════════
   关系类型定义
   ════════════════════════════════════════ */

export interface ModuleRelationType {
  name: string
  label: string
  sourceTypes: string[]
  targetTypes: string[]
  directed: boolean
  properties: ModuleField[]
  icon?: string
}

/* ════════════════════════════════════════
   视图配置
   ════════════════════════════════════════ */

export type ViewTypeId = 'list' | 'grid' | 'table' | 'kanban' | 'board' | 'calendar' | 'gallery' | (string & {})

export interface ModuleViewConfig {
  id: string
  label: string
  icon: string
  type: ViewTypeId
  entityType: string
  showFields: string[]
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  filters?: { field: string; operator: string; value: string }[]
  /** kanban/board 等视图的配置（由视图扩展自行解析） */
  viewOptions?: Record<string, unknown>
}

/* ════════════════════════════════════════
   模块依赖
   ════════════════════════════════════════ */

export interface ModuleDependency {
  moduleId: string
  /** semver 范围，如 >=1.0.0 <2.0.0 */
  version?: string
  /** 该模块期望从此依赖中使用的实体类型列表 */
  requiredTypes?: string[]
  /** 如果为 true，缺少此依赖不会阻止模块激活 */
  optional?: boolean
}

/* ════════════════════════════════════════
   模块清单（ModuleManifest）
   ════════════════════════════════════════ */

export interface ModuleManifest {
  id: string
  name: string
  version: string
  icon: string
  description: string
  author?: string
  /** 依赖的其他模块 */
  dependencies: ModuleDependency[]
  /** 此模块定义的所有实体类型 */
  entityTypes: ModuleEntityType[]
  /** 此模块定义的所有关系类型 */
  relationTypes: ModuleRelationType[]
  /** 此模块定义的所有视图 */
  views: ModuleViewConfig[]
  createdAt: string
  updatedAt: string
}

/* ════════════════════════════════════════
   扩展包类型
   ════════════════════════════════════════ */

/**
 * 字段类型扩展
 * 第三方库通过注册 FieldExtension 来新增字段类型
 */
export interface FieldExtension {
  id: string                    // 如 'formula-engine'
  name: string
  typeId: FieldType             // 新增的字段类型标识，如 'formula'
  /** 字段配置组件路径（Builder 中使用） */
  configComponent?: any
  /** 渲染组件路径（视图/详情面板中使用） */
  renderComponent?: any
  /** 该字段类型初始默认值 */
  defaultValue?: unknown
}

/**
 * 视图类型扩展
 * 第三方库通过注册 ViewExtension 来新增视图类型
 */
export interface ViewExtension {
  id: string                    // 如 'kanban-view'
  name: string
  typeId: ViewTypeId            // 新增的视图类型标识，如 'kanban'
  /** 视图渲染组件 */
  component: any
  /** 视图配置面板组件（Builder 中使用） */
  configComponent?: any
}

/* ════════════════════════════════════════
   模块实例（持久化形态）
   ════════════════════════════════════════ */

export interface ModuleInstance {
  id: string
  manifest: ModuleManifest
  /** 安装时间 */
  installedAt: string
  /** 安装来源：local | builtin | remote */
  source: 'local' | 'builtin' | 'remote'
  /** 当前是否激活 */
  active: boolean
}
