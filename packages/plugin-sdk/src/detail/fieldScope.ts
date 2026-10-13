import type { Entity } from '@worldsea/entity-core'
import type { DetailFieldMeta } from './fieldMeta'

/**
 * 自定义字段的作用域（实体级 / 类型级）。归属按「这份定义是谁的数据」分：类型级进 `fieldRegistry`
 * （同类型共享）；实体级进该实体 `properties.__fieldDefs`——**它是那个实体自己的数据**，随 .ws 导出/导入
 * 保真、删实体一起消失，不在注册表留无主定义。详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md §六
 */
export type FieldScope = 'entity' | 'type'

export const ENTITY_FIELD_DEFS_KEY = '__fieldDefs'

/** 实体级字段定义的落库形态（只存定义，值仍平铺在 properties） */
export interface EntityFieldDef {
  key: string
  label: string
  fieldType: string
  options?: { value: string; label: string }[]
  refType?: string
}

/** 读实体级字段定义（缺省或形态异常时按空处理，不猜） */
export function readEntityFieldDefs(entity: Entity | null | undefined): EntityFieldDef[] {
  const raw = entity?.properties?.[ENTITY_FIELD_DEFS_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter((d: EntityFieldDef) => !!d && typeof d.key === 'string' && !!d.key)
}

/**
 * 两级合并成详情渲染用的字段清单：**类型级在前、同 key 以类型级为准**。
 * 实体级若出现与类型级同名的 key，视为无效重复（值本来就是同一个 properties key）。
 */
export function mergeScopedFields(typeFields: DetailFieldMeta[], entityFields: DetailFieldMeta[]): DetailFieldMeta[] {
  const seen = new Set(typeFields.map(f => f.key))
  return [...typeFields, ...entityFields.filter(f => !seen.has(f.key))]
}

/** 把实体级定义写成 properties 补丁（保留其余 properties 键——properties 是整体替换语义） */
export function buildFieldDefsPatch(entity: Entity, defs: EntityFieldDef[]): { properties: Record<string, unknown> } {
  const properties = { ...(entity.properties ?? {}) }
  if (defs.length) properties[ENTITY_FIELD_DEFS_KEY] = defs
  else delete properties[ENTITY_FIELD_DEFS_KEY]
  return { properties }
}

/** 该 key 能否新增：任一层已有则拒绝（否则两个作用域会互相看不见对方） */
export function isFieldKeyTaken(key: string, typeFields: DetailFieldMeta[], entityDefs: EntityFieldDef[]): boolean {
  const k = key.trim()
  return typeFields.some(f => f.key === k) || entityDefs.some(d => d.key === k)
}

/** 实体级 → 类型级：从实体定义里摘掉这一条（值不动，仍留在 properties） */
export function defsAfterPromote(defs: EntityFieldDef[], key: string): EntityFieldDef[] {
  return defs.filter(d => d.key !== key)
}

/** 类型级 → 实体级：把该定义塞回实体，返回待写入的定义清单 */
export function defsAfterDemote(defs: EntityFieldDef[], field: EntityFieldDef): EntityFieldDef[] {
  if (defs.some(d => d.key === field.key)) return defs
  return [...defs, field]
}
