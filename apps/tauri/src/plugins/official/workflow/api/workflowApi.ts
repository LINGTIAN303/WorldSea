/**
 * Web 端 workflowApi — stub（引擎通道占位）
 *
 * 根版为 re-export 壳（指向 apps/tauri 的 Tauri invoke 实现，28 个 #[tauri::command]）。
 * Web 端无 Rust Workflow 引擎，保留全部类型签名 + 空实现（返回 []/null/false），
 * UI 显示"Engine 通道不可用"（见 useWorkflowEngineRun Web stub）。
 * 后续可经 apps/web 已有的 CLI serve /api 代理中转对接 REST 版引擎。
 */

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

/** Run 记录摘要（镜像 worldsmith-core::storage::workflow::RunSummary，字段 snake_case） */
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

/** 节点结果回调 payload（镜像 dispatch.rs::NodeResultPayload，字段 snake_case） */
export interface NodeResultPayload {
  request_id: string
  output: unknown
  error?: string | null
}

/** 节点 chunk 回调 payload（镜像 dispatch.rs::NodeChunkPayload，字段 snake_case） */
export interface NodeChunkPayload {
  request_id: string
  seq: number
  delta: string
  progress?: number | null
  done: boolean
  error?: string | null
}

/** 节点心跳 payload（镜像 dispatch.rs::NodeHeartbeatPayload，字段 snake_case） */
export interface NodeHeartbeatPayload {
  request_id: string
  progress?: number | null
}

/** 节点取消确认 payload（镜像 dispatch.rs::NodeCancelAckPayload，字段 snake_case） */
export interface NodeCancelAckPayload {
  request_id: string
  reason?: string | null
}

/** 节点配置字段 schema（Rust NodeConfigFieldSchema 的宽松镜像，按需扩展） */
export type NodeConfigFieldSchema = Record<string, unknown>

/** 节点元数据（镜像 node_meta.rs::NodeMetadata，字段 snake_case） */
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

/** 注册节点类型 payload（镜像 node_meta.rs::RegisterNodeTypePayload，字段 snake_case） */
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

export async function workflowList(_args?: {
  category?: string
  keyword?: string
  limit?: number
}): Promise<WorkflowSummaryDto[]> {
  return []
}

export async function workflowGet(_id: string): Promise<unknown> {
  return null
}

export async function workflowCreate(_definition: unknown): Promise<unknown> {
  return null
}

export async function workflowUpdate(_id: string, _definition: unknown): Promise<unknown> {
  return null
}

export async function workflowDelete(_id: string): Promise<void> {
  // Web 端 no-op
}

export async function workflowExport(_id: string, _format: 'json' | 'yaml'): Promise<string> {
  return ''
}

export async function workflowImport(_source: string, _format?: 'json' | 'yaml'): Promise<unknown> {
  return null
}

// ─── Dry Run (1) ─────────────────────────────────────────────────────────────

export async function workflowDryRun(_id: string): Promise<DryRunResult> {
  return { ok: false, errors: ['Web 端 Workflow 引擎不可用'], workflow_id: '', version: 0, node_count: 0, edge_count: 0 }
}

// ─── Runs (9) ────────────────────────────────────────────────────────────────

export async function workflowRun(_args: {
  id: string
  version?: number | null
  params: unknown
  triggeredBy: string
}): Promise<string> {
  return ''
}

export async function workflowRunSync(_args: {
  id: string
  version?: number | null
  params: unknown
  triggeredBy: string
}): Promise<unknown> {
  return null
}

export async function workflowPause(_runId: string): Promise<void> {
  // Web 端 no-op
}

export async function workflowResume(_runId: string, _decision?: unknown): Promise<void> {
  // Web 端 no-op
}

export async function workflowCancel(_runId: string): Promise<boolean> {
  return false
}

export async function workflowSkipTo(_runId: string, _targetNodeId: string): Promise<void> {
  // Web 端 no-op
}

export async function workflowStatus(_runId: string): Promise<RunStatusInfo | null> {
  return null
}

export async function workflowListRuns(_args?: {
  workflowId?: string
  status?: string
  limit?: number
}): Promise<RunRecord[]> {
  return []
}

export async function workflowGetRun(_runId: string): Promise<RunRecord> {
  return {
    run_id: '',
    workflow_id: '',
    workflow_version: 0,
    status: 'unknown',
    triggered_by: '',
    started_at: 0,
    completed_at: null,
    error: null,
  }
}

// ─── Dispatch (4) ────────────────────────────────────────────────────────────

export async function workflowNodeResult(_payload: NodeResultPayload): Promise<void> {
  // Web 端 no-op
}

export async function workflowNodeChunk(_payload: NodeChunkPayload): Promise<void> {
  // Web 端 no-op
}

export async function workflowNodeHeartbeat(_payload: NodeHeartbeatPayload): Promise<void> {
  // Web 端 no-op
}

export async function workflowNodeCancelAck(_payload: NodeCancelAckPayload): Promise<void> {
  // Web 端 no-op
}

// ─── Node Meta (4) ───────────────────────────────────────────────────────────

export async function workflowListNodeTypes(): Promise<NodeMetadata[]> {
  return []
}

export async function workflowGetNodeSchema(_type: string): Promise<NodeMetadata> {
  return {
    type: '',
    category: 'builtin',
    label: '',
    icon: '',
    color: '',
    plugin_id: '',
    description: '',
    config_schema: {},
  }
}

export async function workflowRegisterNodeType(_payload: RegisterNodeTypePayload): Promise<NodeMetadata> {
  return {
    type: '',
    category: 'builtin',
    label: '',
    icon: '',
    color: '',
    plugin_id: '',
    description: '',
    config_schema: {},
  }
}

export async function workflowUnregisterNodeType(_type: string): Promise<boolean> {
  return false
}

// ─── Settings (3) ────────────────────────────────────────────────────────────

export async function workflowGetSetting(_key: string): Promise<string | null> {
  return null
}

export async function workflowSetSetting(_key: string, _value: string): Promise<void> {
  // Web 端 no-op
}

export async function workflowPurgeRunsNow(): Promise<number> {
  return 0
}
