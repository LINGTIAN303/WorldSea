/**
 * 本文件于 Phase 3 从 src/plugins/official/workflow/api/workflowApi.ts 迁移到 apps/tauri/src/plugins/workflow/api/workflowApi.ts
 * 端分离：Tauri 端专用（依赖 @tauri-apps/api）
 */

/** Workflow 引擎 Tauri 命令调用层（镜像 28 个 #[tauri::command]），详细见 docs/details/注释/tauri/workflowApi.md */

import { invoke } from '@tauri-apps/api/core'

// ─── 类型定义（镜像 Rust 端 structs，serde camelCase） ─────────────────────────

/** Run 状态信息（镜像 runs.rs::RunStatusInfo，无 rename_all，字段 snake_case） */
export interface RunStatusInfo {
  run_id: string
  status: string
  current_node_id: string | null
}

/** Workflow 摘要（镜像 definitions.rs::WorkflowSummaryDto，#[serde(rename_all = "camelCase")]） */
export interface WorkflowSummaryDto {
  id: string
  latestVersion: number
  name: string
  category: string
  description: string | null
  updatedAt: number
}

/** DryRun 结果（镜像 dry_run.rs::DryRunResult，无 rename_all，字段 snake_case） */
export interface DryRunResult {
  ok: boolean
  errors: string[]
  workflow_id: string
  version: number
  node_count: number
  edge_count: number
}

/**
 * Run 记录摘要（镜像 worldsmith-core::storage::workflow::RunSummary）
 *
 * 注意：Rust 端无 #[serde(rename_all = "camelCase")]，序列化后字段保持 snake_case。
 * Tauri 只转 invoke 参数名（camelCase→snake_case），不转返回值字段名。
 *
 * duration_ms 是前端派生字段（completed_at - started_at），Rust 端不返回。
 */
export interface RunRecord {
  run_id: string
  workflow_id: string
  workflow_version: number
  status: string
  triggered_by: string
  started_at: number
  completed_at: number | null
  error: string | null
  /** 前端派生：执行时长（ms），null 表示未结束 */
  duration_ms?: number | null
}

/** 节点结果回调 payload（镜像 dispatch.rs::NodeResultPayload，无 rename_all，字段 snake_case） */
export interface NodeResultPayload {
  request_id: string
  output: unknown
  error?: string | null
}

/** 节点 chunk 回调 payload（镜像 dispatch.rs::NodeChunkPayload，无 rename_all，字段 snake_case） */
export interface NodeChunkPayload {
  request_id: string
  seq: number
  delta: string
  progress?: number | null
  done: boolean
  error?: string | null
}

/** 节点心跳 payload（镜像 dispatch.rs::NodeHeartbeatPayload，无 rename_all，字段 snake_case） */
export interface NodeHeartbeatPayload {
  request_id: string
  progress?: number | null
}

/** 节点取消确认 payload（镜像 dispatch.rs::NodeCancelAckPayload，无 rename_all，字段 snake_case） */
export interface NodeCancelAckPayload {
  request_id: string
  reason?: string | null
}

/** 节点配置字段 schema（Rust NodeConfigFieldSchema 的宽松镜像，按需扩展） */
export type NodeConfigFieldSchema = Record<string, unknown>

/**
 * 节点元数据（镜像 node_meta.rs::NodeMetadata，无 rename_all，字段 snake_case）
 * 注意：r#type 序列化为 "type"；category 是 snake_case enum（"builtin"/"plugin"）
 */
export interface NodeMetadata {
  type: string
  category: 'builtin' | 'plugin'
  label: string
  icon: string
  color: string
  plugin_id: string
  description: string
  config_schema: Record<string, NodeConfigFieldSchema>
}

/** 注册节点类型 payload（镜像 node_meta.rs::RegisterNodeTypePayload，无 rename_all，字段 snake_case） */
export interface RegisterNodeTypePayload {
  type: string
  plugin_id: string
  label: string
  category: string
  icon?: string | null
  color?: string | null
  description: string
  config_schema?: Record<string, NodeConfigFieldSchema>
}

// ─── Definitions (7) ─────────────────────────────────────────────────────────

/** 列表（category / keyword / limit 过滤） */
export async function workflowList(args?: {
  category?: string
  keyword?: string
  limit?: number
}): Promise<WorkflowSummaryDto[]> {
  return invoke<WorkflowSummaryDto[]>('workflow_list', args ?? {})
}

/** 取最新版本 */
export async function workflowGet(id: string): Promise<unknown> {
  return invoke('workflow_get', { id })
}

/** 校验 + 保存（version 不自增，沿用 body 传入） */
export async function workflowCreate(definition: unknown): Promise<unknown> {
  return invoke('workflow_create', { definition })
}

/** version 自增 + 校验 + 保存 */
export async function workflowUpdate(id: string, definition: unknown): Promise<unknown> {
  return invoke('workflow_update', { id, definition })
}

/** 业务层守护（有 runs 引用则拒绝） */
export async function workflowDelete(id: string): Promise<void> {
  return invoke<void>('workflow_delete', { id })
}

/** YAML / JSON 序列化 */
export async function workflowExport(id: string, format: 'json' | 'yaml'): Promise<string> {
  return invoke<string>('workflow_export', { id, format })
}

/** 解析 + 校验 + 保存 */
export async function workflowImport(source: string, format?: 'json' | 'yaml'): Promise<unknown> {
  return invoke('workflow_import', { source, format })
}

// ─── Dry Run (1) ─────────────────────────────────────────────────────────────

/** 仅校验，不启动 executor */
export async function workflowDryRun(id: string): Promise<DryRunResult> {
  return invoke<DryRunResult>('workflow_dry_run', { id })
}

// ─── Runs (9) ────────────────────────────────────────────────────────────────

/**
 * 启动工作流（异步，返回 run_id）
 *
 * executor 在后台线程跑，前端通过 workflow_status 轮询或 workflow_list_runs 查历史。
 * P0-1-B1 直接 Dispatch 兜底通道主入口。
 */
export async function workflowRun(args: {
  id: string
  version?: number | null
  params: unknown
  triggeredBy: string
}): Promise<string> {
  return invoke<string>('workflow_run', args)
}

/**
 * 启动并等结束（≤60s 超时）
 *
 * 仅用于端到端验证 / 调试，不推荐生产用。
 */
export async function workflowRunSync(args: {
  id: string
  version?: number | null
  params: unknown
  triggeredBy: string
}): Promise<RunStatusInfo> {
  return invoke<RunStatusInfo>('workflow_run_sync', args)
}

/** Phase 3 接入；当前 no-op */
export async function workflowPause(runId: string): Promise<void> {
  return invoke<void>('workflow_pause', { runId })
}

/** Phase 3 接入；当前 no-op */
export async function workflowResume(runId: string, decision?: unknown): Promise<void> {
  return invoke<void>('workflow_resume', { runId, decision })
}

/** 取消运行：设 cancel flag（幂等） */
export async function workflowCancel(runId: string): Promise<boolean> {
  return invoke<boolean>('workflow_cancel', { runId })
}

/** Phase 3 接入；当前 no-op */
export async function workflowSkipTo(runId: string, targetNodeId: string): Promise<void> {
  return invoke<void>('workflow_skip_to', { runId, targetNodeId })
}

/** 取运行状态（不存在返回 null） */
export async function workflowStatus(runId: string): Promise<RunStatusInfo | null> {
  return invoke<RunStatusInfo | null>('workflow_status', { runId })
}

/**
 * 列运行记录
 *
 * P0-1-A1 Run History 持久化主入口。
 * 返回 RunRecord 列表（按 started_at DESC 排序）。
 */
export async function workflowListRuns(args?: {
  workflowId?: string
  status?: string
  limit?: number
}): Promise<RunRecord[]> {
  return invoke<RunRecord[]>('workflow_list_runs', args ?? {})
}

/** 取单条 run 详情 */
export async function workflowGetRun(runId: string): Promise<RunRecord> {
  return invoke<RunRecord>('workflow_get_run', { runId })
}

// ─── Dispatch (4) — TS→Rust 节点回调 ──────────────────────────────────────────

/**
 * 终态回调：sync 节点直接收口；stream 节点若 done=true 同样收口
 *
 * P0-1-B1 直接 Dispatch 兜底通道用：TS 端执行完节点后回调此命令把结果送回 executor。
 */
export async function workflowNodeResult(payload: NodeResultPayload): Promise<void> {
  return invoke<void>('workflow_node_result', { payload })
}

/**
 * Stream 中间 chunk（累加到 chunk_acc，done=true 时收口）
 *
 * P0-1-B0 已修：此命令此前未在 lib.rs invoke_handler 注册，现已补上。
 */
export async function workflowNodeChunk(payload: NodeChunkPayload): Promise<void> {
  return invoke<void>('workflow_node_chunk', { payload })
}

/** 心跳：仅更新 last_heartbeat_at_ms（dispatcher watchdog / 调试用） */
export async function workflowNodeHeartbeat(payload: NodeHeartbeatPayload): Promise<void> {
  return invoke<void>('workflow_node_heartbeat', { payload })
}

/** Cancel ack：TS 端确认 cancel 收到，让 dispatch_blocking 立即返 Cancelled */
export async function workflowNodeCancelAck(payload: NodeCancelAckPayload): Promise<void> {
  return invoke<void>('workflow_node_cancel_ack', { payload })
}

// ─── Node Meta (4) ───────────────────────────────────────────────────────────

/** 全量列表（builtin + plugin，供 NodePalette 用） */
export async function workflowListNodeTypes(): Promise<NodeMetadata[]> {
  return invoke<NodeMetadata[]>('workflow_list_node_types')
}

/** 单个节点的 configSchema（供 NodeInspector 表单用） */
export async function workflowGetNodeSchema(type: string): Promise<NodeMetadata> {
  return invoke<NodeMetadata>('workflow_get_node_schema', { type })
}

/** 注册一个 plugin 节点类型 */
export async function workflowRegisterNodeType(payload: RegisterNodeTypePayload): Promise<NodeMetadata> {
  return invoke<NodeMetadata>('workflow_register_node_type', { payload })
}

/** 反注册一个 plugin 节点类型，返回是否成功删除 */
export async function workflowUnregisterNodeType(type: string): Promise<boolean> {
  return invoke<boolean>('workflow_unregister_node_type', { type })
}

// ─── Settings (3) ────────────────────────────────────────────────────────────

export async function workflowGetSetting(key: string): Promise<string | null> {
  return invoke<string | null>('workflow_get_setting', { key })
}

export async function workflowSetSetting(key: string, value: string): Promise<void> {
  return invoke<void>('workflow_set_setting', { key, value })
}

/** 立即执行 runs 清理（按保留策略），返回清理条数 */
export async function workflowPurgeRunsNow(): Promise<number> {
  return invoke<number>('workflow_purge_runs_now')
}
