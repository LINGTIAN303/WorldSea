import type { RelationTypeSchema as CoreRelationTypeSchema } from '@worldsea/core-api-types'
import type { FieldSchema } from './entity'

/** 关系类型的注册表项（V1，继承契约层 RelationTypeSchema，扩展运行时字段） */
export interface RelationTypeSchema extends CoreRelationTypeSchema {
  /** 逆关系类型 */
  inverseType?: string
  /** 是否自动创建逆关系 */
  autoCreateInverse?: boolean
  /** 关系属性字段 */
  properties?: FieldSchema[]
  /** 所属插件 ID */
  pluginId?: string
}

/**
 * 关系类型 V2——所有关系强制有向，强制声明逆关系。移除 directed 布尔值，所有关系都是有向的（source → target）。
 * 对称关系（如 borders）通过 inverseType 自动创建反向关系；inverseType 强制：每个关系必须声明其逆关系类型。
 * 语义上对称的关系，inverseType 指向自身（如 borders → borders）。
 */
export interface RelationTypeSchemaV2 {
  /** 关系类型唯一标识 */
  type: string
  /** 人类可读名称 */
  label: string
  /** 源实体类型列表 */
  sourceTypes: string[]
  /** 目标实体类型列表 */
  targetTypes: string[]
  /** 强制声明逆关系类型 */
  inverseType: string
  /** 逆关系的人类可读名称 */
  inverseLabel: string
  /** 是否语义对称（对称关系的 inverseType 指向自身） */
  symmetric: boolean
  /** 关系属性字段 */
  properties?: FieldSchema[]
  /** 所属领域分组（如 'person', 'geography', 'ownership', 'temporal'） */
  domain?: string
  /** 所属插件 ID（全局声明后可为空） */
  pluginId?: string
  /** 是否为用户自定义关系类型 */
  isCustom?: boolean
}

/** 关系实例（两个实体之间的有向边） */
export interface Relation {
  id: string
  type: string
  sourceId: string
  targetId: string
  label?: string
  properties: Record<string, unknown>
  pairId?: string
  createdAt: string
  updatedAt: string
}
