// coreBackend 实体校验领域（原 coreBackend.ts 拆分），详细见 docs/details/注释/tauri/coreBackend.md
import type {
  CoreValidationReport,
  CoreReferenceCheckResult,
  CoreMigrationResult,
  CoreDiagnosticSummary,
} from '@worldsmith/core-api-types'
import { backendCall } from './runtime'

export async function validateEntity(
  entityJson: string,
  schemaJson?: string,
): Promise<CoreValidationReport | null> {
  return backendCall(
    'cmd_validate_entity',
    { entityJson, schemaJson: schemaJson ?? null },
    'validateEntity',
    [entityJson, schemaJson],
    null,
  )
}

export async function validateEntities(
  entitiesJson: string,
  schemasJson?: string,
): Promise<CoreValidationReport | null> {
  return backendCall(
    'cmd_validate_entities',
    { entitiesJson, schemasJson: schemasJson ?? null },
    'validateEntities',
    [entitiesJson, schemasJson],
    null,
  )
}

export async function checkReferences(
  entitiesJson: string,
  relationsJson: string,
): Promise<CoreReferenceCheckResult | null> {
  return backendCall(
    'cmd_check_references',
    { entitiesJson, relationsJson },
    'checkReferences',
    [entitiesJson, relationsJson],
    null,
  )
}

export async function migrate(
  packJson: string,
  fromVersion: number,
): Promise<{ result: CoreMigrationResult; data: unknown } | null> {
  return backendCall(
    'cmd_migrate',
    { packJson, fromVersion },
    'migrate',
    [packJson, fromVersion],
    null,
  )
}

export async function runDiagnostics(
  entitiesJson: string,
  relationsJson: string,
  schemasJson?: string,
): Promise<CoreDiagnosticSummary | null> {
  return backendCall(
    'cmd_run_diagnostics',
    { entitiesJson, relationsJson, schemasJson: schemasJson ?? null },
    'runDiagnostics',
    [entitiesJson, relationsJson, schemasJson],
    null,
  )
}
