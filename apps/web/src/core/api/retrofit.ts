/** Web 端 coreBackend 领域层 — retrofit 安全改造会话：阶段推进/意图提交/补丁应用 API，详细见 docs/details/注释/web/core/coreBackend.md */

import { backendCall, getCoreCached } from './runtime'
import type {
  SafetyReport,
  ConflictEntry,
  ConflictReport,
  ConfirmResult,
  ExecutionResult,
  ApplyResult,
  HealthCheckResult,
  RetrofitResult,
  SessionPhase,
  CapabilityCatalog,
  PatchOperation,
  PatchDiffResult,
} from '@worldsmith/core-api-types'
export type {
  SafetyReport,
  ConflictEntry,
  ConflictReport,
  ConfirmResult,
  ExecutionResult,
  ApplyResult,
  HealthCheckResult,
  RetrofitResult,
  SessionPhase,
  CapabilityCatalog,
  PatchOperation,
  PatchDiffResult,
}

export async function retrofitDetectConflicts(): Promise<ConflictReport | null> {
  return backendCall(
    'cmd_retrofit_detect_conflicts',
    {},
    'retrofitDetectConflicts',
    [],
    null,
  )
}

export async function retrofitEndSession(): Promise<boolean> {
  return backendCall(
    'cmd_retrofit_end_session',
    {},
    'retrofitEndSession',
    [],
    false,
  )
}

export async function retrofitBeginSession(
  sessionId: string,
  catalog?: CapabilityCatalog,
): Promise<void> {
  const core = await getCoreCached()
  if (core && typeof core.retrofitBeginSession === 'function') {
    const catalogStr = catalog ? JSON.stringify(catalog) : undefined
    core.retrofitBeginSession(sessionId, catalogStr)
    return
  }
}

export async function retrofitSubmitIntent(
  intentJson: string,
): Promise<SafetyReport | null> {
  return backendCall(
    'cmd_retrofit_submit_intent',
    { intentJson },
    'retrofitSubmitIntent',
    [intentJson],
    null,
  )
}

export async function retrofitConfirmAndStage(): Promise<ConfirmResult | null> {
  return backendCall(
    'cmd_retrofit_confirm_and_stage',
    {},
    'retrofitConfirmAndStage',
    [],
    null,
  )
}

export async function retrofitApplyNext(
  beforeJson: string,
  afterJson: string,
): Promise<ApplyResult | null> {
  return backendCall(
    'cmd_retrofit_apply_next',
    { beforeJson, afterJson },
    'retrofitApplyNext',
    [beforeJson, afterJson],
    null,
  )
}

export async function retrofitVerifyAndAccept(
  entityCount: number,
  relationCount: number,
): Promise<RetrofitResult | null> {
  return backendCall(
    'cmd_retrofit_verify_and_accept',
    { entityCount, relationCount },
    'retrofitVerifyAndAccept',
    [entityCount, relationCount],
    null,
  )
}

export async function retrofitRequestRepair(
  message: string,
): Promise<void> {
  const core = await getCoreCached()
  if (core && typeof core.retrofitRequestRepair === 'function') {
    core.retrofitRequestRepair(message)
    return
  }
}

export async function retrofitRedirect(
  message: string,
): Promise<void> {
  const core = await getCoreCached()
  if (core && typeof core.retrofitRedirect === 'function') {
    core.retrofitRedirect(message)
    return
  }
}

export async function retrofitRollbackLast(): Promise<string | null> {
  return backendCall(
    'cmd_retrofit_rollback_last',
    {},
    'retrofitRollbackLast',
    [],
    null,
  )
}

export async function retrofitAbort(): Promise<string[]> {
  return backendCall(
    'cmd_retrofit_abort',
    {},
    'retrofitAbort',
    [],
    [],
  )
}

export async function retrofitSessionPhase(): Promise<SessionPhase | null> {
  return backendCall(
    'cmd_retrofit_session_phase',
    {},
    'retrofitSessionPhase',
    [],
    null,
  )
}

export async function retrofitPatchDiff(
  beforeJson: string,
  afterJson: string,
): Promise<PatchDiffResult | null> {
  return backendCall(
    'cmd_retrofit_patch_diff',
    { beforeJson, afterJson },
    'patchDiff',
    [beforeJson, afterJson],
    null,
  )
}

export async function retrofitPatchApply(
  docJson: string,
  patchJson: string,
): Promise<string | null> {
  return backendCall(
    'cmd_retrofit_patch_apply',
    { docJson, patchJson },
    'patchApply',
    [docJson, patchJson],
    null,
  )
}
