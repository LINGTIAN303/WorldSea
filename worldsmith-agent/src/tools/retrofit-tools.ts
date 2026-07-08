import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'

/**
 * 安全改造工具集 (Retrofit)
 *
 * 提供对项目结构的安全改造能力，包含完整的工作流生命周期：
 * 
 * 工作流阶段：Negotiate → Confirm → Apply → Verify → Complete
 * 
 * 支持的改造意图类型：
 * - 数据模型: AddView/ModifyView/RemoveView, AddField/ModifyField/RemoveField
 * - 行为: AddAction/ModifyAction/RemoveAction
 * - Schema: ModifySchema, AddEntityType/RemoveEntityType
 * - 主题: SetTheme, AddTheme/RemoveTheme
 * - 布局: SetLayout/AddLayout/RemoveLayout
 * - 样式: SetStyles/ModifyStyles
 *
 * 安全机制：
 * 1. Pre-check: 意图提交时进行安全检查
 * 2. Patch diff: 仅发送变更部分，节省 token
 * 3. Stage & Apply: 分批应用，支持单步回滚
 * 4. Post-check: 应用后进行健康验证
 * 5. Repair: 发现问题时可触发修复流程
 *
 * 所有工具依赖 Tauri invoke API，仅在 Tauri 桌面模式下可用。
 */

interface SafetyReport {
  allowed: boolean
  intentType: string
  warnings: string[]
  blockedReason: string | null
  preCheckPassed: boolean
  postCheckPassed: boolean | null
}

interface ConfirmResult {
  confirmedCount: number
  conflicts: ConflictReport
}

interface ConflictReport {
  hasConflicts: boolean
  conflicts: Array<{
    intentIndexA: number
    intentIndexB: number
    conflictType: string
    description: string
  }>
}

interface ApplyResult {
  changeId: string
  execution: {
    intentId: string
    success: boolean
    message: string
    sideEffects: string[]
  }
}

interface RetrofitResult {
  sessionId: string
  phase: string
  changesApplied: number
  changesRolledBack: number
  healthCheck: {
    healthy: boolean
    entityCount: number
    relationCount: number
    issues: string[]
  } | null
  executionResults: Array<{
    intentId: string
    success: boolean
    message: string
    sideEffects: string[]
  }>
  message: string
}

interface TokenEstimate {
  fullSendTokens: number
  patchTokens: number
  savedTokens: number
  savingRatio: number
  operationCount: number
}

async function invokeTauri(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}

export const retrofitBeginSession: ToolDefinition = {
  name: 'retrofit_begin_session',
  description: '开启一个改造会话。AI 可在会话中对项目的视图、字段、实体类型、主题、布局、样式等进行安全改造。可选传入自定义能力目录（catalogJson），否则使用宽松模式（允许所有非破坏性操作）。',
  parameters: {
    sessionId: { type: 'string', description: '会话唯一标识，如 "retrofit-2024-001"', required: true },
    catalogJson: { type: 'string', description: '能力目录 JSON（可选），定义允许的改造范围。不传则使用宽松模式', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '开启改造会话',
  } satisfies ToolMeta,
  execute: async (args) => {
    await invokeTauri('cmd_retrofit_begin_session', {
      sessionId: String(args.sessionId),
      catalogJson: args.catalogJson ? String(args.catalogJson) : null,
    })
    return JSON.stringify({ ok: true, sessionId: args.sessionId, message: '改造会话已开启，当前阶段: Negotiate' })
  },
}

export const retrofitSubmitIntent: ToolDefinition = {
  name: 'retrofit_submit_intent',
  description: `向当前改造会话提交一个改造意图。可用意图类型：
【数据模型】
- AddView: 添加视图（需 entity_type + view 定义）
- ModifyView: 修改视图（需 view_id + changes）
- RemoveView: 删除视图（需 view_id）
- AddField: 添加字段（需 entity_type + field 定义）
- ModifyField: 修改字段（需 entity_type + field_name + changes）
- RemoveField: 删除字段（需 entity_type + field_name）
- AddAction: 添加行为（需 target + action 定义）
- ModifyAction: 修改行为（需 action_id + changes）
- RemoveAction: 删除行为（需 action_id）
- ModifySchema: 修改 Schema（需 entity_type + changes）
- AddEntityType: 添加实体类型（需 type_name + fields）
- RemoveEntityType: 删除实体类型（需 type_name）
- AddRelationType: 添加关系类型（需 type_name + source_types + target_types）
- ModifyRelationType: 修改关系类型（需 type_name + changes）
- RemoveRelationType: 删除关系类型（需 type_name）
【样式改造】
- SetTheme: 设置全局主题（需 theme 定义，含 colors/typography/spacing/borderRadius）
- ModifyTheme: 修改主题（需 theme_id + changes，可部分更新颜色/字体/间距/圆角）
- ModifyLayout: 修改布局（需 layout 定义，含 target/structure/direction/sections）
- ModifyStyle: 修改样式（需 style 定义，含 target + properties，支持 Component/Element/CssVariable 三种目标）

提交后返回 SafetyReport，若 allowed=false 则意图被安全守卫拦截。`,
  parameters: {
    intentJson: { type: 'string', description: '改造意图 JSON，格式如 {"AddField":{"entityType":"character","field":{...}}} 或 {"SetTheme":{"theme":{"id":"dark",...}}}', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '提交改造意图',
  } satisfies ToolMeta,
  execute: async (args) => {
    const report = await invokeTauri('cmd_retrofit_submit_intent', {
      intentJson: String(args.intentJson),
    }) as SafetyReport
    if (!report.allowed) {
      return JSON.stringify({
        ok: false,
        allowed: false,
        blockedReason: report.blockedReason,
        warnings: report.warnings,
        message: `意图被安全守卫拦截: ${report.blockedReason}`,
      })
    }
    return JSON.stringify({
      ok: true,
      allowed: true,
      warnings: report.warnings,
      message: report.warnings.length > 0
        ? `意图已接受（有 ${report.warnings.length} 条警告）`
        : '意图已接受',
    })
  },
}

export const retrofitConfirmAndStage: ToolDefinition = {
  name: 'retrofit_confirm_and_stage',
  description: '确认所有已提交的意图并进入暂存阶段。返回确认数量和冲突检测报告。若存在冲突，AI 应先解决冲突再继续。',
  parameters: {},
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '确认并暂存',
  } satisfies ToolMeta,
  execute: async () => {
    const result = await invokeTauri('cmd_retrofit_confirm_and_stage') as ConfirmResult
    const conflictInfo = result.conflicts.hasConflicts
      ? `（检测到 ${result.conflicts.conflicts.length} 个冲突: ${result.conflicts.conflicts.map(c => c.description).join('; ')}）`
      : ''
    return JSON.stringify({
      ok: true,
      confirmedCount: result.confirmedCount,
      hasConflicts: result.conflicts.hasConflicts,
      conflicts: result.conflicts.conflicts,
      message: `已确认 ${result.confirmedCount} 个意图，进入 Staging 阶段${conflictInfo}`,
    })
  },
}

export const retrofitApplyNext: ToolDefinition = {
  name: 'retrofit_apply_next',
  description: '应用下一个改造意图。返回变更 ID 和执行结果（含成功状态、消息、副作用）。当所有意图都已应用时返回 null。需传入变更前后的快照 JSON。',
  parameters: {
    beforeJson: { type: 'string', description: '变更前状态快照 JSON', required: true },
    afterJson: { type: 'string', description: '变更后状态快照 JSON', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '应用下一意图',
  } satisfies ToolMeta,
  execute: async (args) => {
    const result = await invokeTauri('cmd_retrofit_apply_next', {
      beforeJson: String(args.beforeJson),
      afterJson: String(args.afterJson),
    }) as ApplyResult | null
    if (result) {
      return JSON.stringify({
        ok: true,
        changeId: result.changeId,
        execution: result.execution,
        message: `变更 ${result.changeId} 已应用: ${result.execution.message}`,
      })
    }
    return JSON.stringify({ ok: true, changeId: null, message: '所有意图已应用完毕，进入 Verifying 阶段' })
  },
}

export const retrofitVerifyAndAccept: ToolDefinition = {
  name: 'retrofit_verify_and_accept',
  description: '验收改造结果。库会执行健康检查（含自定义健康检查谓词），若不健康则自动回滚。传入当前实体和关系数量用于健康检查。',
  parameters: {
    entityCount: { type: 'number', description: '当前实体总数', required: true },
    relationCount: { type: 'number', description: '当前关系总数', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '验收改造',
  } satisfies ToolMeta,
  execute: async (args) => {
    const result = await invokeTauri('cmd_retrofit_verify_and_accept', {
      entityCount: Number(args.entityCount),
      relationCount: Number(args.relationCount),
    }) as RetrofitResult
    return JSON.stringify({
      ok: true,
      sessionId: result.sessionId,
      changesApplied: result.changesApplied,
      changesRolledBack: result.changesRolledBack,
      healthy: result.healthCheck?.healthy ?? true,
      issues: result.healthCheck?.issues ?? [],
      executionResults: result.executionResults,
      message: result.message,
    })
  },
}

export const retrofitRequestRepair: ToolDefinition = {
  name: 'retrofit_request_repair',
  description: '请求修复。当用户验收发现问题后，AI 进入修复阶段，可与用户边改边确认直到完成。',
  parameters: {
    message: { type: 'string', description: '问题描述，如 "字段显示位置不对"', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '请求修复',
  } satisfies ToolMeta,
  execute: async (args) => {
    await invokeTauri('cmd_retrofit_request_repair', { message: String(args.message) })
    return JSON.stringify({ ok: true, message: '已进入 Repair 阶段，可继续提交修复意图' })
  },
}

export const retrofitRedirect: ToolDefinition = {
  name: 'retrofit_redirect',
  description: '中途转向。用户在改造过程中改变想法时使用，AI 回到协商阶段重新讨论方案。已确认的意图将被清除。',
  parameters: {
    message: { type: 'string', description: '转向原因，如 "我改主意了，不想删这个字段"', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '中途转向',
  } satisfies ToolMeta,
  execute: async (args) => {
    await invokeTauri('cmd_retrofit_redirect', { message: String(args.message) })
    return JSON.stringify({ ok: true, message: '已回到 Negotiate 阶段，可重新提交意图' })
  },
}

export const retrofitRollbackLast: ToolDefinition = {
  name: 'retrofit_rollback_last',
  description: '回滚最近一次变更。撤销上一个应用的改造意图。',
  parameters: {},
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '回滚最近变更',
  } satisfies ToolMeta,
  execute: async () => {
    const rolledBackId = await invokeTauri('cmd_retrofit_rollback_last') as string | null
    if (rolledBackId) {
      return JSON.stringify({ ok: true, rolledBackId, message: `变更 ${rolledBackId} 已回滚` })
    }
    return JSON.stringify({ ok: true, rolledBackId: null, message: '没有可回滚的变更' })
  },
}

export const retrofitAbort: ToolDefinition = {
  name: 'retrofit_abort',
  description: '终止当前改造会话。所有已应用的变更将被回滚，会话进入 Aborted 状态。',
  parameters: {},
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '终止会话',
  } satisfies ToolMeta,
  execute: async () => {
    const rolled = await invokeTauri('cmd_retrofit_abort') as string[]
    return JSON.stringify({
      ok: true,
      rolledBackCount: rolled.length,
      rolledBackIds: rolled,
      message: `改造已终止，${rolled.length} 个变更已回滚`,
    })
  },
}

export const retrofitSessionPhase: ToolDefinition = {
  name: 'retrofit_session_phase',
  description: '查询当前改造会话的阶段。阶段: negotiate(协商) → staging(暂存) → applying(应用中) → verifying(验收) → completed(完成) | repair(修复) | aborted(已终止)',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'retrofit',
    displayName: '查询会话阶段',
  } satisfies ToolMeta,
  execute: async () => {
    const phase = await invokeTauri('cmd_retrofit_session_phase') as string | null
    if (!phase) {
      return JSON.stringify({ ok: true, phase: null, message: '当前没有活跃的改造会话' })
    }
    return JSON.stringify({ ok: true, phase, message: `当前阶段: ${phase}` })
  },
}

export const retrofitPatchDiff: ToolDefinition = {
  name: 'retrofit_patch_diff',
  description: '计算两个 JSON 之间的 RFC 6902 JSON Patch 差异。用于减少 AI Agent 的 token 消耗——只需发送 diff 操作而非完整对象。返回操作列表和 token 节省估算。',
  parameters: {
    beforeJson: { type: 'string', description: '变更前 JSON', required: true },
    afterJson: { type: 'string', description: '变更后 JSON', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'retrofit',
    displayName: '计算Patch差异',
  } satisfies ToolMeta,
  execute: async (args) => {
    const result = await invokeTauri('cmd_retrofit_patch_diff', {
      beforeJson: String(args.beforeJson),
      afterJson: String(args.afterJson),
    }) as { operations: unknown[]; tokenEstimate: TokenEstimate }
    return JSON.stringify({
      ok: true,
      operations: result.operations,
      operationCount: result.operations.length,
      tokenEstimate: result.tokenEstimate,
      message: `生成 ${result.operations.length} 个 Patch 操作，预估节省 ${Math.round(result.tokenEstimate.savingRatio * 100)}% token`,
    })
  },
}

export const retrofitPatchApply: ToolDefinition = {
  name: 'retrofit_patch_apply',
  description: '将 RFC 6902 JSON Patch 应用到目标 JSON。支持 add/remove/replace/move/copy/test 六种操作。用于 AI Agent 以最小化 token 消耗修改项目数据。',
  parameters: {
    docJson: { type: 'string', description: '目标文档 JSON', required: true },
    patchJson: { type: 'string', description: 'JSON Patch 操作列表，格式如 [{"op":"replace","path":"/name","value":"new"}]', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '应用Patch',
  } satisfies ToolMeta,
  execute: async (args) => {
    const result = await invokeTauri('cmd_retrofit_patch_apply', {
      docJson: String(args.docJson),
      patchJson: String(args.patchJson),
    }) as string
    return JSON.stringify({
      ok: true,
      resultJson: result,
      message: 'Patch 已成功应用',
    })
  },
}

export const retrofitDetectConflicts: ToolDefinition = {
  name: 'retrofit_detect_conflicts',
  description: '检测当前改造会话中待确认意图之间的冲突。返回冲突报告，包含冲突类型和描述。AI 应在确认前调用此工具检查冲突。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'retrofit',
    displayName: '检测冲突',
  } satisfies ToolMeta,
  execute: async () => {
    const result = await invokeTauri('cmd_retrofit_detect_conflicts') as ConflictReport | null
    if (!result) {
      return JSON.stringify({ ok: true, hasConflicts: false, message: '当前没有活跃的改造会话' })
    }
    return JSON.stringify({
      ok: true,
      hasConflicts: result.hasConflicts,
      conflicts: result.conflicts,
      message: result.hasConflicts
        ? `检测到 ${result.conflicts.length} 个冲突`
        : '没有检测到冲突',
    })
  },
}

export const retrofitEndSession: ToolDefinition = {
  name: 'retrofit_end_session',
  description: '结束当前改造会话并释放资源。在改造完成（completed）或终止（aborted）后调用，用于清理会话状态。',
  parameters: {},
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '结束会话',
  } satisfies ToolMeta,
  execute: async () => {
    const ended = await invokeTauri('cmd_retrofit_end_session') as boolean
    return JSON.stringify({
      ok: true,
      ended,
      message: ended ? '改造会话已结束' : '没有活跃的改造会话可结束',
    })
  },
}

export const retrofitApply: ToolDefinition = {
  name: 'retrofit_apply',
  description: '提交一个结构化修改意图到 Retrofit 引擎。Retrofit 是一个安全的批量修改系统：提交意图 → 确认 → 暂存 → 逐步应用 → 验证 → 可回滚。使用场景：批量修改多个实体、需要可回滚的安全修改。底层使用 Rust 核心库的 Retrofit 引擎，支持冲突检测和自动修复。',
  parameters: {
    intentJson: { type: 'string', description: '改造意图 JSON，格式如 {"AddField":{"entityType":"character","field":{...}}}', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '提交修改意图',
  } satisfies ToolMeta,
  execute: async (args) => {
    const report = await invokeTauri('cmd_retrofit_submit_intent', {
      intentJson: String(args.intentJson),
    }) as SafetyReport
    if (!report.allowed) {
      return JSON.stringify({
        ok: false,
        allowed: false,
        blockedReason: report.blockedReason,
        warnings: report.warnings,
        message: `意图被安全守卫拦截: ${report.blockedReason}`,
      })
    }
    return JSON.stringify({
      ok: true,
      allowed: true,
      warnings: report.warnings,
      message: report.warnings.length > 0
        ? `意图已接受（有 ${report.warnings.length} 条警告）`
        : '意图已接受',
    })
  },
}

export const retrofitUndo: ToolDefinition = {
  name: 'retrofit_undo',
  description: '回滚最近一次 Retrofit 修改。使用场景：修改结果不符合预期时撤销。底层使用 Rust 核心库的 Retrofit 引擎，支持逐步回滚。',
  parameters: {},
  meta: {
    permission: 'moderate',
    category: 'retrofit',
    displayName: '撤销修改',
  } satisfies ToolMeta,
  execute: async () => {
    const rolledBackId = await invokeTauri('cmd_retrofit_rollback_last') as string | null
    if (rolledBackId) {
      return JSON.stringify({ ok: true, rolledBackId, message: `变更 ${rolledBackId} 已回滚` })
    }
    return JSON.stringify({ ok: true, rolledBackId: null, message: '没有可回滚的变更' })
  },
}

export const retrofitTools: ToolDefinition[] = [
  retrofitApply,
  retrofitUndo,
  retrofitBeginSession,
  retrofitSubmitIntent,
  retrofitConfirmAndStage,
  retrofitApplyNext,
  retrofitVerifyAndAccept,
  retrofitRequestRepair,
  retrofitRedirect,
  retrofitRollbackLast,
  retrofitAbort,
  retrofitSessionPhase,
  retrofitDetectConflicts,
  retrofitEndSession,
  retrofitPatchDiff,
  retrofitPatchApply,
]
