// coreBackend schema 领域：契约校验 + Schema API（原 coreBackend.ts 拆分），详细见 docs/details/注释/tauri/coreBackend.md
import type { CoreValidationReport, EntityTypeSchema } from '@worldsmith/core-api-types'
import { backendCall, algoCall } from './runtime'

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

// ── Schema API ──

const EMPTY_ENTITY_TYPE_SCHEMA: EntityTypeSchema = { typeKey: '', label: '', icon: '', fields: [], relations: [], validations: [], views: [], iconMap: {}, idPrefix: '' }

export async function schemaRegisterEntityType(schemaJson: string): Promise<EntityTypeSchema> {
  return algoCall('cmd_schema_register_entity_type', { schemaJson }, c => c.schemaRegisterEntityType(schemaJson), EMPTY_ENTITY_TYPE_SCHEMA, true)
}

export async function schemaUnregisterEntityType(typeKey: string): Promise<void> {
  return algoCall('cmd_schema_unregister_entity_type', { typeKey }, c => c.schemaUnregisterEntityType(typeKey), undefined, false)
}

export async function schemaGetEntityType(typeKey: string): Promise<EntityTypeSchema | null> {
  return algoCall('cmd_schema_get_entity_type', { typeKey }, c => c.schemaGetEntityType(typeKey), null, true)
}

export async function schemaListEntityTypes(): Promise<EntityTypeSchema[]> {
  return algoCall('cmd_schema_list_entity_types', {}, c => c.schemaListEntityTypes(), [] as EntityTypeSchema[], true)
}

export async function schemaUpdateEntityType(typeKey: string, updatesJson: string): Promise<EntityTypeSchema> {
  return algoCall('cmd_schema_update_entity_type', { typeKey, updatesJson }, c => c.schemaUpdateEntityType(typeKey, updatesJson), EMPTY_ENTITY_TYPE_SCHEMA, true)
}

export async function schemaRegisterValidation(typeKey: string, ruleJson: string): Promise<void> {
  return algoCall('cmd_schema_register_validation', { typeKey, ruleJson }, c => c.schemaRegisterValidation(typeKey, ruleJson), undefined, false)
}

export async function schemaRegisterView(typeKey: string, viewJson: string): Promise<void> {
  return algoCall('cmd_schema_register_view', { typeKey, viewJson }, c => c.schemaRegisterView(typeKey, viewJson), undefined, false)
}
