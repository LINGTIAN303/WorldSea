/**
 * # useSupervisorRust — Supervisor Pattern 的前端适配层
 *
 * 阶段 2.1（Supervisor Pattern 批次3.1）新增。本文件桥接前端 Vue 层与
 * Rust 端 `agent_runtime::supervisor::SupervisorNode`，通过 Tauri `invoke` + `listen` 通信。
 *
 * ## 职责
 *   1. 通过 Tauri 命令管理 Supervisor 实例（create / run / abort / destroy / 等 8 个命令）
 *   2. 监听 `supervisor:event:{sessionId}` 事件流，分发到订阅者
 *   3. 维护多个 Supervisor 会话的响应式状态（任务进度、子 Agent 输出、错误）
 *   4. 提供 Reactive 视图（subAgentStates / currentTask / errors）供 UI 组件使用
 *
 * ## 与 TS 版 `useOrchestrator` 的差异
 * - **后端**：TS 版直接调用 `IAgentBackend` 接口驱动子 Agent；
 *   Rust 版通过 Tauri 命令调用 Rust 端 `SupervisorNode::execute`，子 Agent 在 Rust 端创建
 * - **状态管理**：TS 版用模块级 `reactive(Map)`；Rust 版用 `reactive(Map)` 镜像 Rust 端 state
 * - **事件流**：Rust 端推送 `SupervisorEventPayload`，前端 listen 后转换分发
 * - **不实现 Pipeline 自动更新**：那是 TS 版独有的领域逻辑，Rust 版聚焦核心 Supervisor 模式
 * - **不实现子 Agent 长任务跟踪**：阶段 2.1 范围聚焦 Supervisor 编排层，子 Agent 事件仅作摘要展示
 *
 * ## Tauri 命令映射
 * | TS 函数            | Rust 命令                              |
 * |--------------------|----------------------------------------|
 * | `create`           | `cmd_supervisor_create`                |
 * | `run`              | `cmd_supervisor_run`                   |
 * | `abort`            | `cmd_supervisor_abort`                 |
 * | `destroy`          | `cmd_supervisor_destroy`               |
 * | `getState`         | `cmd_supervisor_get_state`             |
 * | `setState`         | `cmd_supervisor_set_state`             |
 * | `listSessions`     | `cmd_supervisor_list_sessions`         |
 * | `clearAgentPool`   | `cmd_supervisor_clear_agent_pool`      |
 *
 * ## 事件命名约定
 * - 事件名：`supervisor:event:{sessionId}`（与 `agent:event:*` 并列）
 * - Payload 字段：snake_case（Rust 端 `SupervisorEventPayload` 未启用 `rename_all = "camelCase"`）
 *   - `session_id` / `node_id` / `sub_agent_id` / `sub_agent_name` / `task_description`
 *   - `output_chars` / `duration_ms` / `reasoning` / `error` / `stage`
 * - 变体 tag：snake_case（如 `supervisor_task_assigned` / `sub_agent_started`）
 *
 * ## ProviderConfig 字段命名
 * 与 `useAgentRust` 一致：Rust 端 `ProviderConfig` 字段为 snake_case
 * （`model_id` / `base_url` / `api_key` / `api_type` / `context_window` / `max_tokens`），
 * 因此前端传入时用 snake_case。
 *
 * ## 多会话并发
 * 模块级 `supervisorSessions` Map 支持多个 Supervisor 会话并发。
 * 每个会话独立的事件监听器、状态、订阅者集合。
 * UI 通常只激活一个会话，但底层支持多会话切换。
 */

import { reactive, readonly, computed, shallowReactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
// 阶段 3.2 整合：复用 useAgentRust 的 RustProviderConfig 类型定义
// 避免在两个文件中重复维护同一 Rust 端类型的镜像
import type { RustProviderConfig } from './useAgentRust'

// Re-export：让从 useSupervisorRust 导入 RustProviderConfig 的代码无需改路径
// （本文件历史版本曾本地定义此类型，re-export 保持向后兼容）
export type { RustProviderConfig }

// ─── Rust 端类型镜像 ────────────────────────────────────────────

/**
 * Rust `agent_runtime::supervisor::SubAgentSpec` 的前端镜像
 *
 * Rust 端 `SubAgentSpec` 未启用 `rename_all`，字段保持 snake_case。
 * 前端调用 `cmd_supervisor_create` 时，`specs` 数组用此类型。
 */
export interface RustSubAgentSpec {
  /** 子 Agent 唯一 ID */
  id: string
  /** 人类可读名称 */
  name: string
  /** 能力描述（供 LLM 选择时参考） */
  description: string
  /** 系统提示词（定义子 Agent 专长与行为边界） */
  system_prompt: string
  /** 工具白名单（None=继承所有工具；阶段 2.1 仅作元数据，实际不隔离） */
  tools_whitelist?: string[]
  /** 子 Agent 最大迭代次数（None=用 AgentLoopConfig 默认值） */
  max_iterations?: number
}

/**
 * Rust `commands::supervisor::AgentLoopConfigOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 与 `useAgentRust` 的 `RustCreateAgentOptions` 字段对齐，
 * 但作为独立类型避免跨模块依赖。
 */
export interface RustAgentLoopConfigOptions {
  systemPrompt?: string
  maxIterations?: number
  temperature?: number
  maxTokens?: number
  parallelToolCalls?: boolean
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high'
  // ─── Loop Engineering 参数 ───
  llmMaxRetries?: number
  llmRetryBaseDelayMs?: number
  llmTimeoutMs?: number
  toolMaxRetries?: number
  toolRetryBaseDelayMs?: number
  toolTimeoutMs?: number
  minIntervalBetweenCallsMs?: number
}

/**
 * Rust `commands::supervisor::AssignmentPromptTemplateOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 */
export interface RustAssignmentPromptTemplateOptions {
  system: string
  userTemplate: string
}

/**
 * Rust `commands::supervisor::CreateSupervisorOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 所有字段可选，未提供者使用 Rust 端默认值。
 */
export interface RustCreateSupervisorOptions {
  /** 最大协调轮次（默认 5；阶段 2.1 仅执行 1 轮） */
  maxRounds?: number
  /** 是否汇总子 Agent 输出（默认 true） */
  requireSummary?: boolean
  /** 子 Agent 共享的 AgentLoop 配置 */
  agentLoopConfig?: RustAgentLoopConfigOptions
  /** 自定义任务分配提示词模板（None=用默认 LlmAssignmentStrategy 模板） */
  assignmentPromptTemplate?: RustAssignmentPromptTemplateOptions
}

/**
 * Rust `commands::supervisor::SupervisorRunResult` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 */
export interface RustSupervisorRunResult {
  /** 节点执行状态：continue / done / aborted / error */
  status: string
  /** 下一节点 ID（阶段 2.1 暂不使用，预留） */
  nextNodeId?: string
  /** 错误信息（status=error 时） */
  error?: string
  /** 摘要（如 "Supervisor: 任务已由子 Agent 'X' 处理（输出 N 字符）"） */
  summary?: string
}

/**
 * Rust `agent_runtime::types::OrchestratorState` 的前端镜像
 *
 * Rust 端未启用 `rename_all = "camelCase"`，字段保持 snake_case。
 * 仅镜像阶段 2.1 用到的字段（完整镜像留待后续扩展）。
 */
export interface RustOrchestratorState {
  /** 用户原始输入 */
  input: string
  /** 编排消息列表（含子 Agent 输出） */
  messages: RustOrchestratorMessage[]
  /** 扩展字段（节点自定义数据） */
  extra: Record<string, unknown>
}

/** Rust `OrchestratorMessage` 的前端镜像（snake_case 字段） */
export interface RustOrchestratorMessage {
  /** 角色 */
  role: 'user' | 'assistant' | 'tool_result' | 'system'
  /** 消息内容 */
  content: string
  /** 元数据（可选） */
  metadata?: Record<string, unknown>
}

// ─── Rust 端事件 Payload 镜像 ────────────────────────────────────────────

/**
 * Rust `commands::supervisor::SupervisorEventPayload` 的前端镜像
 *
 * **重要**：与 `RustAgentEvent` 不同，本类型字段为 **snake_case**！
 *
 * 原因：Rust 端 `SupervisorEventPayload` 只对变体名用 `rename_all = "snake_case"`
 * （生成 `supervisor_task_assigned` 等 tag），变体内部字段保持 snake_case
 * （`session_id` / `node_id` / `sub_agent_id` 等）。
 *
 * 此差异是有意保留的：Supervisor 事件是编排层级，与流式 message 无关，
 * 不需要与 `AgentEventPayload`（启用 camelCase）保持一致。
 */
export type RustSupervisorEventPayload =
  | {
      type: 'supervisor_task_assigned'
      session_id: string
      node_id: string
      sub_agent_id: string
      sub_agent_name: string
      task_description: string
      reasoning?: string
    }
  | {
      type: 'sub_agent_started'
      session_id: string
      node_id: string
      sub_agent_id: string
      sub_agent_name: string
      task_description: string
    }
  | {
      type: 'sub_agent_completed'
      session_id: string
      node_id: string
      sub_agent_id: string
      sub_agent_name: string
      output_chars: number
      duration_ms: number
    }
  | {
      type: 'sub_agent_error'
      session_id: string
      node_id: string
      sub_agent_id: string
      sub_agent_name: string
      error: string
    }
  | {
      type: 'supervisor_error'
      session_id: string
      node_id: string
      stage: string
      error: string
    }

// ─── TS 端事件类型（camelCase，UI 友好） ────────────────────────────────────────────

/**
 * TS 端 Supervisor 事件（camelCase，UI 友好）
 *
 * 由 `rustEventToTsEvent` 从 `RustSupervisorEventPayload` 转换而来，
 * 供 UI 组件订阅。事件名采用 camelCase 与 TS 项目惯例一致。
 */
export type SupervisorEvent =
  | {
      type: 'supervisorTaskAssigned'
      sessionId: string
      nodeId: string
      subAgentId: string
      subAgentName: string
      taskDescription: string
      reasoning?: string
    }
  | {
      type: 'subAgentStarted'
      sessionId: string
      nodeId: string
      subAgentId: string
      subAgentName: string
      taskDescription: string
    }
  | {
      type: 'subAgentCompleted'
      sessionId: string
      nodeId: string
      subAgentId: string
      subAgentName: string
      outputChars: number
      durationMs: number
    }
  | {
      type: 'subAgentError'
      sessionId: string
      nodeId: string
      subAgentId: string
      subAgentName: string
      error: string
    }
  | {
      type: 'supervisorError'
      sessionId: string
      nodeId: string
      stage: string
      error: string
    }

/** Rust payload → TS event 转换 */
function rustEventToTsEvent(payload: RustSupervisorEventPayload): SupervisorEvent {
  switch (payload.type) {
    case 'supervisor_task_assigned':
      return {
        type: 'supervisorTaskAssigned',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        subAgentId: payload.sub_agent_id,
        subAgentName: payload.sub_agent_name,
        taskDescription: payload.task_description,
        reasoning: payload.reasoning,
      }
    case 'sub_agent_started':
      return {
        type: 'subAgentStarted',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        subAgentId: payload.sub_agent_id,
        subAgentName: payload.sub_agent_name,
        taskDescription: payload.task_description,
      }
    case 'sub_agent_completed':
      return {
        type: 'subAgentCompleted',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        subAgentId: payload.sub_agent_id,
        subAgentName: payload.sub_agent_name,
        outputChars: payload.output_chars,
        durationMs: payload.duration_ms,
      }
    case 'sub_agent_error':
      return {
        type: 'subAgentError',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        subAgentId: payload.sub_agent_id,
        subAgentName: payload.sub_agent_name,
        error: payload.error,
      }
    case 'supervisor_error':
      return {
        type: 'supervisorError',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        stage: payload.stage,
        error: payload.error,
      }
  }
}

// ─── 会话级状态 ────────────────────────────────────────────

/**
 * 单个 Supervisor 会话的响应式状态
 *
 * 镜像 Rust 端 `OrchestratorState` 的关键信息 + 子 Agent 执行进度。
 * UI 组件通过 `supervisorSessions.get(sessionId)` 读取并渲染。
 */
export interface SupervisorSessionState {
  /** 会话 ID */
  sessionId: string
  /** 当前任务文本（最近一次 run 的 task） */
  currentTask: string
  /** 运行状态：idle / running / done / aborted / error */
  runStatus: 'idle' | 'running' | 'done' | 'aborted' | 'error'
  /** 最近一次 run 的结果（run 完成后填充） */
  lastResult: RustSupervisorRunResult | null
  /** 最近一次错误信息（runStatus=error 时） */
  lastError: string | null
  /** 已分配的子 Agent ID（任务分配完成后填充） */
  assignedSubAgentId: string | null
  /** 已分配的子 Agent 名称 */
  assignedSubAgentName: string | null
  /** 子 Agent 执行开始时间戳（ms；subAgentStarted 时填充） */
  subAgentStartedAt: number | null
  /** 子 Agent 执行结束时间戳（ms；subAgentCompleted/Error 时填充） */
  subAgentEndedAt: number | null
  /** 子 Agent 输出字符数（subAgentCompleted 时填充） */
  subAgentOutputChars: number | null
  /** 子 Agent 执行耗时（ms；subAgentCompleted 时填充） */
  subAgentDurationMs: number | null
  /** 事件历史（最多保留 100 条，按时间顺序） */
  events: SupervisorEvent[]
  /** Rust 端 OrchestratorState 快照（getState 时填充） */
  stateSnapshot: RustOrchestratorState | null
}

/** 创建初始会话状态 */
function createInitialSessionState(sessionId: string): SupervisorSessionState {
  return {
    sessionId,
    currentTask: '',
    runStatus: 'idle',
    lastResult: null,
    lastError: null,
    assignedSubAgentId: null,
    assignedSubAgentName: null,
    subAgentStartedAt: null,
    subAgentEndedAt: null,
    subAgentOutputChars: null,
    subAgentDurationMs: null,
    events: [],
    stateSnapshot: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 模块级单例状态（与 useAgentRust / useLongTaskRust 一致：模块级单例）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 所有活跃 Supervisor 会话的响应式状态映射
 *
 * key = sessionId，value = SupervisorSessionState（reactive）
 * UI 通过 `supervisorSessions.get(sessionId)` 读取状态。
 */
const supervisorSessions = shallowReactive<Map<string, SupervisorSessionState>>(new Map())

/** 事件监听器清理函数映射 */
const unlistenFns = new Map<string, UnlistenFn>()

/** 用户订阅者集合（每会话独立；subscribe 时注册，unsubscribe 或 destroy 时清理） */
type SessionEventListener = (event: SupervisorEvent) => void
const sessionListeners = new Map<string, Set<SessionEventListener>>()

/** 会话创建时间戳（用于 listSessions 排序） */
const sessionCreatedAt = new Map<string, number>()

// ─── 事件监听器设置 ────────────────────────────────────────────

/**
 * 为指定会话设置事件监听器
 *
 * 监听 `supervisor:event:{sessionId}` 事件，收到 Rust payload 后：
 * 1. 转换为 TS 事件（camelCase）
 * 2. 更新模块级响应式状态（supervisorSessions）
 * 3. 分发给所有订阅者
 *
 * 幂等：若已存在监听器，直接返回（避免重复监听）。
 */
async function setupEventListener(sessionId: string): Promise<void> {
  if (unlistenFns.has(sessionId)) return

  const eventName = `supervisor:event:${sessionId}`
  try {
    const unlisten = await listen<RustSupervisorEventPayload>(eventName, (e) => {
      const tsEvent = rustEventToTsEvent(e.payload)
      handleSessionEvent(sessionId, tsEvent)
    })
    unlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useSupervisorRust] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话的事件监听器 */
function teardownEventListener(sessionId: string): void {
  const unlisten = unlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    unlistenFns.delete(sessionId)
  }
}

/**
 * 处理转换后的 TS 事件
 *
 * 1. 更新 `supervisorSessions` 中的会话状态
 * 2. 限制 `events` 历史最多 100 条（FIFO）
 * 3. 分发给所有订阅者
 */
function handleSessionEvent(sessionId: string, event: SupervisorEvent): void {
  const session = supervisorSessions.get(sessionId)
  if (session) {
    // 更新会话状态
    switch (event.type) {
      case 'supervisorTaskAssigned':
        session.assignedSubAgentId = event.subAgentId
        session.assignedSubAgentName = event.subAgentName
        session.runStatus = 'running'
        session.lastError = null
        break
      case 'subAgentStarted':
        session.subAgentStartedAt = Date.now()
        session.subAgentEndedAt = null
        session.subAgentOutputChars = null
        session.subAgentDurationMs = null
        break
      case 'subAgentCompleted':
        session.subAgentEndedAt = Date.now()
        session.subAgentOutputChars = event.outputChars
        session.subAgentDurationMs = event.durationMs
        session.runStatus = 'done'
        break
      case 'subAgentError':
        session.subAgentEndedAt = Date.now()
        session.runStatus = 'error'
        session.lastError = event.error
        break
      case 'supervisorError':
        session.runStatus = 'error'
        session.lastError = `[${event.stage}] ${event.error}`
        break
    }

    // 追加事件历史（FIFO，上限 100）
    session.events.push(event)
    if (session.events.length > 100) {
      session.events.splice(0, session.events.length - 100)
    }
  }

  // 分发给订阅者
  const listeners = sessionListeners.get(sessionId)
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (err) {
        console.warn(`[useSupervisorRust] 会话 ${sessionId} 订阅者异常:`, err)
      }
    }
  }
}

// ─── Tauri 命令封装 ────────────────────────────────────────────

/**
 * 创建 Supervisor 实例并注册到 Rust 端 registry
 *
 * # 参数
 * - `sessionId`：会话 ID（前端生成，建议前缀 `sup_`）
 * - `providerConfig`：LLM Provider 配置（snake_case 字段，共享给所有子 Agent）
 * - `specs`：子 Agent 规格列表（snake_case 字段）
 * - `options`：可选 Supervisor 配置（camelCase 字段）
 *
 * # 行为
 * 1. 调用 `cmd_supervisor_create` 在 Rust 端创建 SupervisorNode
 * 2. 创建前端响应式会话状态并加入 `supervisorSessions`
 * 3. 设置事件监听器
 *
 * # 错误
 * 抛出 Rust 端返回的 `SupervisorRegistryError`（已序列化为 JS 对象）。
 */
async function create(
  sessionId: string,
  providerConfig: RustProviderConfig,
  specs: RustSubAgentSpec[],
  options?: RustCreateSupervisorOptions,
): Promise<void> {
  console.log(
    `[useSupervisorRust] 创建 supervisor session=${sessionId} specs=${specs.length} mode=${providerConfig.mode}`,
  )

  await invoke('cmd_supervisor_create', {
    sessionId,
    providerConfig,
    specs,
    options: options ?? null,
  })

  // 创建前端响应式状态
  const sessionState = reactive(createInitialSessionState(sessionId))
  supervisorSessions.set(sessionId, sessionState)
  sessionCreatedAt.set(sessionId, Date.now())

  // 设置事件监听器
  await setupEventListener(sessionId)
}

/**
 * 提交任务并执行 Supervisor 模式
 *
 * # 参数
 * - `sessionId`：会话 ID
 * - `task`：用户任务文本
 *
 * # 行为
 * 1. 更新前端状态：`currentTask = task`、`runStatus = 'running'`
 * 2. 调用 `cmd_supervisor_run`，Rust 端执行任务分配 + 子 Agent run
 * 3. 期间通过事件流推送 `supervisorTaskAssigned` / `subAgentStarted` / `subAgentCompleted` 等
 * 4. 返回 `RustSupervisorRunResult`（含 status / summary / error）
 *
 * # 注意
 * 此方法是阻塞式的（await Rust 端 execute 完成）。
 * 事件监听器在 await 期间持续接收并更新状态。
 * 调用方可以选择不 await，通过订阅事件获取进度。
 */
async function run(sessionId: string, task: string): Promise<RustSupervisorRunResult> {
  const session = supervisorSessions.get(sessionId)
  if (!session) {
    throw new Error(`[useSupervisorRust] 会话不存在: ${sessionId}`)
  }

  // 重置运行状态
  session.currentTask = task
  session.runStatus = 'running'
  session.lastError = null
  session.lastResult = null
  session.assignedSubAgentId = null
  session.assignedSubAgentName = null
  session.subAgentStartedAt = null
  session.subAgentEndedAt = null
  session.subAgentOutputChars = null
  session.subAgentDurationMs = null

  try {
    const result = await invoke<RustSupervisorRunResult>('cmd_supervisor_run', {
      sessionId,
      task,
    })
    session.lastResult = result
    // 若 Rust 端返回 error 状态但前端事件未触发，更新 lastError
    if (result.status === 'error' && !session.lastError) {
      session.lastError = result.error ?? '未知错误'
      session.runStatus = 'error'
    } else if (result.status === 'aborted') {
      session.runStatus = 'aborted'
    } else if (result.status === 'done' && session.runStatus === 'running') {
      // 兜底：若事件未触发 subAgentCompleted，根据 result 推断 done
      session.runStatus = 'done'
    }
    return result
  } catch (err) {
    session.runStatus = 'error'
    session.lastError = err instanceof Error ? err.message : String(err)
    throw err
  }
}

/**
 * 中断当前运行（协作式）
 *
 * 设置 Rust 端 `abort_flag = true`，SupervisorNode 在下次检查点命中并返回 `aborted`。
 * 中断是**协作式**的：依赖 SupervisorNode 主动检查 `ctx.is_aborted()`。
 * 若子 Agent 正在执行 `agent.run(...)`，需子 Agent 自身 abort 机制生效
 * （阶段 2.1 不向下传播 abort，子 Agent 会执行到自然结束）。
 */
async function abort(sessionId: string): Promise<void> {
  await invoke('cmd_supervisor_abort', { sessionId })
  const session = supervisorSessions.get(sessionId)
  if (session && session.runStatus === 'running') {
    session.runStatus = 'aborted'
  }
  console.log(`[useSupervisorRust] 中断 supervisor session=${sessionId}`)
}

/**
 * 销毁 Supervisor 实例
 *
 * 1. 调用 `cmd_supervisor_destroy`：Rust 端 abort_all tool_bridge + 移除注册
 * 2. 清理前端事件监听器
 * 3. 从 `supervisorSessions` 移除
 * 4. 清理订阅者集合
 */
async function destroy(sessionId: string): Promise<void> {
  try {
    await invoke('cmd_supervisor_destroy', { sessionId })
  } catch (err) {
    console.warn(`[useSupervisorRust] destroy 调用失败（继续清理前端状态）:`, err)
  }

  // 清理前端状态
  teardownEventListener(sessionId)
  supervisorSessions.delete(sessionId)
  sessionCreatedAt.delete(sessionId)
  sessionListeners.delete(sessionId)
  console.log(`[useSupervisorRust] 销毁 supervisor session=${sessionId}`)
}

/**
 * 获取共享 OrchestratorState 快照
 *
 * 返回 Rust 端 `Arc<RwLock<OrchestratorState>>` 的克隆并序列化。
 * 前端可用于展示当前任务进度、消息历史、子 Agent 输出。
 */
async function getState(sessionId: string): Promise<RustOrchestratorState> {
  const state = await invoke<RustOrchestratorState>('cmd_supervisor_get_state', { sessionId })
  // 缓存到会话状态
  const session = supervisorSessions.get(sessionId)
  if (session) {
    session.stateSnapshot = state
  }
  return state
}

/**
 * 写回 OrchestratorState（用于断点恢复）
 *
 * 覆盖整个 state，调用方需确保传入完整 state（不可部分更新）。
 * 持久化场景：get_state → 序列化保存 → 恢复时反序列化 → set_state。
 */
async function setState(sessionId: string, newState: RustOrchestratorState): Promise<void> {
  await invoke('cmd_supervisor_set_state', { sessionId, newState })
  const session = supervisorSessions.get(sessionId)
  if (session) {
    session.stateSnapshot = newState
  }
}

/**
 * 列出所有已注册的 Supervisor session_id
 *
 * 返回 Rust 端 `SupervisorRegistry::list()` 的结果。
 * 与前端 `supervisorSessions` 的 key 应保持一致（差异表明状态不同步）。
 */
async function listSessions(): Promise<string[]> {
  return await invoke<string[]>('cmd_supervisor_list_sessions')
}

/**
 * 清空子 Agent 实例池（reset 场景）
 *
 * 销毁所有缓存的子 AgentLoop 实例，下次 run 时重新创建。
 * 不影响 state 与消息历史。
 *
 * 使用场景：
 * - 切换 Provider 后（子 Agent 持有的 backend 已过期）
 * - 长时间运行后清理内存
 */
async function clearAgentPool(sessionId: string): Promise<void> {
  await invoke('cmd_supervisor_clear_agent_pool', { sessionId })
  console.log(`[useSupervisorRust] 清空子 Agent 池 session=${sessionId}`)
}

// ─── 事件订阅 ────────────────────────────────────────────

/**
 * 订阅指定会话的事件
 *
 * 注册一个监听器，每次 Rust 端推送 `supervisor:event:{sessionId}` 时调用。
 * 与 `useAgentRust.subscribe` 模式一致。
 *
 * @returns 取消订阅函数（调用后移除监听器）
 */
function subscribe(sessionId: string, listener: SessionEventListener): () => void {
  let listeners = sessionListeners.get(sessionId)
  if (!listeners) {
    listeners = new Set()
    sessionListeners.set(sessionId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
  }
}

// ─── 工具函数 ────────────────────────────────────────────

/**
 * 生成 Supervisor 会话 ID
 *
 * 格式：`sup_{timestamp}_{random}`，便于在日志与 UI 中识别。
 * 与 useAgentRust 的 sessionId 生成模式保持一致。
 */
function generateSessionId(): string {
  return `sup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue Composable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Supervisor Pattern 前端 composable
 *
 * 模块级单例，多次调用返回同一组状态与方法。
 *
 * # 使用示例
 * ```ts
 * const supervisor = useSupervisorRust()
 *
 * // 创建 Supervisor（含 2 个子 Agent：代码专家 + 文档专家）
 * const sessionId = supervisor.generateSessionId()
 * await supervisor.create(sessionId, providerConfig, [
 *   {
 *     id: 'coder',
 *     name: '代码专家',
 *     description: '处理代码编写、调试、重构任务',
 *     system_prompt: '你是一个专业的代码工程师',
 *   },
 *   {
 *     id: 'writer',
 *     name: '文档专家',
 *     description: '处理文档撰写、翻译、润色任务',
 *     system_prompt: '你是一个专业的技术文档工程师',
 *   },
 * ])
 *
 * // 订阅事件（UI 更新）
 * const unsub = supervisor.subscribe(sessionId, (event) => {
 *   if (event.type === 'subAgentCompleted') {
 *     console.log(`子 Agent ${event.subAgentName} 完成，输出 ${event.outputChars} 字符`)
 *   }
 * })
 *
 * // 提交任务
 * const result = await supervisor.run(sessionId, '写一个排序函数并附上文档')
 * console.log('Supervisor 执行完成:', result.summary)
 *
 * // 清理
 * unsub()
 * await supervisor.destroy(sessionId)
 * ```
 */
export function useSupervisorRust() {
  return {
    // ─── 响应式状态（只读） ───
    /** 所有活跃 Supervisor 会话的状态映射（key = sessionId） */
    sessions: readonly(supervisorSessions),
    /** 计算属性：当前活跃会话数 */
    activeSessionCount: computed(() => supervisorSessions.size),
    /** 计算属性：所有正在运行的会话 */
    runningSessions: computed(() =>
      Array.from(supervisorSessions.values()).filter((s) => s.runStatus === 'running'),
    ),

    // ─── 生命周期 ───
    create,
    run,
    abort,
    destroy,

    // ─── 状态访问 ───
    getState,
    setState,
    listSessions,
    clearAgentPool,

    // ─── 事件订阅 ───
    subscribe,

    // ─── 工具 ───
    generateSessionId,

    // ─── 内部状态访问（调试用） ───
    /** 获取指定会话的状态（只读视图；不存在返回 null） */
    getSessionState: (sessionId: string): SupervisorSessionState | null =>
      supervisorSessions.get(sessionId) ?? null,
  }
}
