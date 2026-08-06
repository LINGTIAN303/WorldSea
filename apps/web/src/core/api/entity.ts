/** Web 端 coreBackend 领域层 — entity 实体校验：validate/checkReferences/migrate/runDiagnostics API，详细见 docs/details/注释/web/core/coreBackend.md */

import { backendCall } from './runtime'
import type {
  CoreValidationReport,
  CoreReferenceCheckResult,
  CoreDiagnosticSummary,
  CoreMigrationResult,
} from '@worldsmith/core-api-types'

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
