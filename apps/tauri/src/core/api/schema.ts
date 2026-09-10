// coreBackend schema 领域：实体类型 Schema 统一数据源 = entity-core 旧版 entitySchemaRegistry
// （2026-09-09 三套注册表收口：WASM 域 schema_* 方法在 wasm_export.rs 根本不存在，恒返回 null；
//  官方插件 View / StepConfigEditor 改读注册表，写函数无消费方删除）。详细见 docs/details/注释/tauri/coreBackend.md
import type { CoreValidationReport, EntityTypeSchema } from '@worldsea/core-api-types'
import { entitySchemaRegistry, type EntityTypeSchema as RegistryEntityTypeSchema } from '@worldsea/entity-core'
import { backendCall } from './runtime'

export async function validatePack(
  packJson: string,
): Promise<CoreValidationReport | null> {
  return backendCall(
    'cmd_validate_pack',
    { packJson },
    'validatePack',
    [packJson],
    null,
  )
}

// ── Schema API（唯一事实源 = entitySchemaRegistry） ──

/** 注册表条目缺契约层必填字段（icon/iconMap/relations/validations/views/idPrefix 可为 undefined），
 *  补默认值映射为契约形状，防 SchemaRenderer 崩溃（Object.keys(iconMap) 等） */
function completeSchema(schema: RegistryEntityTypeSchema): EntityTypeSchema {
  return {
    ...schema,
    icon: schema.icon ?? '',
    iconMap: schema.iconMap ?? {},
    relations: schema.relations ?? [],
    validations: schema.validations ?? [],
    views: schema.views ?? [],
    idPrefix: schema.idPrefix ?? '',
  }
}

export async function schemaGetEntityType(typeKey: string): Promise<EntityTypeSchema | null> {
  const schema = entitySchemaRegistry.get(typeKey)
  return schema ? completeSchema(schema) : null
}

export async function schemaListEntityTypes(): Promise<EntityTypeSchema[]> {
  return entitySchemaRegistry.getAll().map(completeSchema)
}
