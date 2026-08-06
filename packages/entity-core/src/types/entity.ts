import type {
  FieldTypeSchema as CoreFieldTypeSchema,
  EntityTypeSchema as CoreEntityTypeSchema,
  ViewDeclaration,
  ValidationRule,
} from '@worldsmith/core-api-types'
import type { RelationTypeSchema } from './relation'

/** 字段 schema：复用契约 FieldTypeSchema（fieldType/options 对象数组），扩展运行时 relationType */
export interface FieldSchema extends CoreFieldTypeSchema {
  /** 实体引用字段关联的关系类型（运行时扩展，契约层无） */
  relationType?: string
}

/**
 * 实体类型 schema：主键与契约层对齐（typeKey），核心字段复用契约，运行时扩展可选。
 * 契约层必填的 relations/validations/views/iconMap/idPrefix 在此放宽为可选，
 * 供前端模块注册轻量构造；与后端互通时由 SchemaRenderer 桥接补默认值。
 */
export interface EntityTypeSchema
  extends Omit<CoreEntityTypeSchema, 'fields' | 'icon' | 'relations' | 'validations' | 'views' | 'iconMap' | 'idPrefix'> {
  icon?: string
  fields: FieldSchema[]
  /** 用户自定义字段（运行时扩展，契约层无） */
  customFields?: FieldSchema[]
  relations?: RelationTypeSchema[]
  validations?: ValidationRule[]
  views?: ViewDeclaration[]
  iconMap?: Record<string, string>
  idPrefix?: string
}

export interface Entity {
  id: string
  type: string
  name: string
  description: string
  properties: Record<string, unknown>
  tags: string[]
  avatar?: string
  coverImage?: string
  coverPosition?: string
  coverZoom?: number
  /** Facet 数据块，key 为 facet ID，value 为 facet 字段数据 */
  facets?: Record<string, Record<string, unknown>>
  createdAt: string
  updatedAt: string
}
