/**
 * # useMultiAgentRust — Multi-Agent 协作模式的前端适配层
 *
 * 阶段 2.3（Multi-Agent Pattern 批次3）新增。本文件桥接前端 Vue 层与
 * Rust 端 `agent_runtime::multi_agent::MultiAgentNode`，通过 Tauri `invoke` + `listen` 通信。
 *
 * ## 职责
 *   1. 通过 Tauri 命令管理 Multi-Agent 实例（create / run / abort / destroy / 等 8 个命令）
 *   2. 监听 `multi_agent:event:{sessionId}` 事件流，分发到订阅者
 *   3. 维护多个 Multi-Agent 会话的响应式状态（轮次进度、消息传递、黑板更新、收敛结果）
 *   4. 提供 Reactive 视图（finalResult / blackboardSnapshot / runStatus / events）供 UI 组件使用
 *
 * ## 与 useGoTRust / useToTRust / useSupervisorRust 的差异
 * - **去中心化协作**：N 个 Agent 对等通信（mpsc 通道 + SharedBlackboard），
 *   无中心调度者（Supervisor 是中心化；ToT/GoT 是单线程探索）
 * - **Agent 规格列表**：`create` 时需传入 `specs: RustAgentSpec[]`，
 *   定义每个 Agent 的角色、系统提示词、初始消息等
 * - **拓扑结构**：支持 Mesh/Ring/Star/Pipeline/Custom 多种通信拓扑
 * - **共享黑板**：Agent 间通过 SharedBlackboard 共享全局状态，
 *   可通过 `getBlackboard` 读取快照（含 task / shared_context / agent_outputs / final_result）
 * - **收敛策略**：MaxRounds/GoalReached/AllAgentsIdle/Hybrid（GoT 仅 max_depth + max_thoughts）
 * - **事件种类**：6 个 Multi-Agent 专用事件（round_started / message_sent /
 *   blackboard_updated / round_completed / converged / error）
 * - **node_type 标识**：Rust 端 MultiAgentNode 返回 `NodeType::MultiAgent`
 *
 * ## Tauri 命令映射
 * | TS 函数            | Rust 命令                          |
 * |--------------------|------------------------------------|
 * | `create`           | `cmd_multi_agent_create`           |
 * | `run`              | `cmd_multi_agent_run`              |
 * | `abort`            | `cmd_multi_agent_abort`            |
 * | `destroy`          | `cmd_multi_agent_destroy`          |
 * | `getState`         | `cmd_multi_agent_get_state`        |
 * | `setState`         | `cmd_multi_agent_set_state`        |
 * | `listSessions`     | `cmd_multi_agent_list_sessions`    |
 * | `getBlackboard`    | `cmd_multi_agent_get_blackboard`   |
 *
 * ## 事件命名约定
 * - 事件名：`multi_agent:event:{sessionId}`（与 `agent:event:*` / `supervisor:event:*` /
 *   `router:event:*` / `tot:event:*` / `got:event:*` 并列）
 * - Payload 字段：snake_case（Rust 端 `MultiAgentEventPayload` 只对变体名用
 *   `rename_all = "snake_case"`，变体内部字段保持 snake_case）
 *   - `session_id` / `node_id` / `round` / `agent_count`
 *   - `from` / `to` / `message_type` / `content_preview`
 *   - `key` / `by`（黑板更新事件）
 *   - `outputs`（轮次完成事件，字符串数组）
 *   - `reason` / `final_result`（收敛事件）
 *   - `agent_id` / `error`（错误事件）
 * - 变体 tag：snake_case（如 `multi_agent_round_started` / `multi_agent_converged`）
 *
 * ## ProviderConfig 字段命名
 * 与 `useAgentRust` / `useSupervisorRust` / `useRouterRust` / `useToTRust` / `useGoTRust` 一致：
 * Rust 端 `ProviderConfig` 字段为 snake_case（`model_id` / `base_url` / `api_key` /
 * `api_type` / `context_window` / `max_tokens`），前端传入时用 snake_case。
 *
 * ## 配置参数命名
 * Rust 端 `CreateMultiAgentOptions` / `AgentLoopConfigOptions` / `PromptTemplateOptions`
 * 启用 `#[serde(rename_all = "camelCase")]`，前端用 camelCase。
 *
 * ## Topology / ConvergenceStrategy 序列化
 * 这两个枚举在 Rust 端使用 `#[serde(tag = "kind", rename_all = "snake_case")]` 内部标签模式：
 * - `{"kind":"mesh"}`
 * - `{"kind":"ring"}`
 * - `{"kind":"star","hub_id":"agent1"}`
 * - `{"kind":"pipeline"}`
 * - `{"kind":"custom","peers":{"agent1":["agent2"],"agent2":["agent1"]}}`
 * - `{"kind":"max_rounds"}`
 * - `{"kind":"goal_reached"}`
 * - `{"kind":"all_agents_idle"}`
 * - `{"kind":"hybrid","goal_check":true,"max_rounds":10}`
 *
 * 注意：`Topology::Star` 和 `Custom` 的内部字段（`hub_id` / `peers`）保持 snake_case
 * （Rust 端未对内部字段启用 rename_all），前端构造时需用 snake_case。
 *
 * ## SharedBlackboard 字段命名
 * Rust 端 `SharedBlackboard` 未启用 `rename_all = "camelCase"`，字段保持 snake_case：
 * - `task` / `shared_context` / `agent_outputs` / `final_result` / `rounds_completed`
 * 前端直接以 snake_case 访问，UI 层如需 camelCase 可自行转换。
 *
 * ## 多会话并发
 * 模块级 `maSessions` Map 支持多个 Multi-Agent 会话并发。
 * 每个会话独立的事件监听器、状态、订阅者集合。
 * UI 通常只激活一个会话，但底层支持多会话切换。
 */

import { reactive, readonly, computed, shallowReactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
// 复用 useAgentRust 的 RustProviderConfig 类型定义，避免重复维护
import type { RustProviderConfig } from './useAgentRust'

// Re-export：保持与其他 *Rust composable 一致的导入体验
export type { RustProviderConfig }

// ─── Rust 端类型镜像 ────────────────────────────────────────────

/**
 * Rust `agent_runtime::multi_agent::AgentRole` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "snake_case")]` → 前端 lowercase 字符串字面量。
 * 角色仅作为元数据标签，不强制约束 Agent 行为（行为由 system_prompt 决定）。
 */
export type RustAgentRole =
  | 'coordinator'
  | 'worker'
  | 'critic'
  | 'researcher'
  | 'creative'
  | 'custom'

/**
 * Rust `agent_runtime::multi_agent::AgentSpec` 的前端镜像
 *
 * **重要**：字段为 **snake_case**！
 *
 * 原因：Rust 端 `AgentSpec` 未启用 `rename_all = "camelCase"`，字段保持 snake_case
 * （`system_prompt` / `tools_whitelist` / `max_iterations` / `initial_message`）。
 * 前端在 UI 层使用时可通过 `toTsAgentSpec` 转换为 camelCase。
 *
 * 用于定义参与协作的 Agent 角色、能力与配置。
 */
export interface RustAgentSpec {
  /** Agent 唯一 ID（用于消息路由 `AgentMessage.from/to` 引用） */
  id: string
  /** 人类可读名称 */
  name: string
  /** 角色（语义标签，影响默认行为与 UI 展示） */
  role?: RustAgentRole
  /** 能力描述（供其他 Agent 了解其专长，写入 Blackboard 的 agents 索引） */
  description: string
  /** 系统提示词（定义 Agent 的专长与行为边界） */
  system_prompt: string
  /** 工具白名单（None=继承 ToolBus 中所有工具） */
  tools_whitelist?: string[] | null
  /** Agent 最大迭代次数（None=用 `AgentLoopConfig` 默认值） */
  max_iterations?: number | null
  /**
   * 初始消息（None=不主动启动，等待其他 Agent 发消息）
   *
   * 配置后会作为该 Agent 的首轮输入，用于启动协作链。
   * 典型用法：Coordinator 配置 initial_message = 用户任务，其他 Agent 留空。
   */
  initial_message?: string | null
}

/**
 * Rust `agent_runtime::multi_agent::Topology` 的前端镜像
 *
 * Rust 端 `#[serde(tag = "kind", rename_all = "snake_case")]` → 内部标签模式。
 *
 * **注意**：`Star` 和 `Custom` 变体的内部字段（`hub_id` / `peers`）保持 snake_case
 * （Rust 端未对变体内部字段启用 rename_all），前端构造时需用 snake_case。
 */
export type RustTopology =
  | { kind: 'mesh' }
  | { kind: 'ring' }
  | { kind: 'star'; hub_id: string }
  | { kind: 'pipeline' }
  | { kind: 'custom'; peers: Record<string, string[]> }

/**
 * Rust `agent_runtime::multi_agent::ConvergenceStrategy` 的前端镜像
 *
 * Rust 端 `#[serde(tag = "kind", rename_all = "snake_case")]` → 内部标签模式。
 *
 * `Hybrid` 变体的内部字段（`goal_check` / `max_rounds`）保持 snake_case
 * （与 `Topology` 一致，未对变体内部字段启用 rename_all）。
 */
export type RustConvergenceStrategy =
  | { kind: 'max_rounds' }
  | { kind: 'goal_reached' }
  | { kind: 'all_agents_idle' }
  | { kind: 'hybrid'; goal_check: boolean; max_rounds: number }

/**
 * Rust `agent_runtime::multi_agent::SharedBlackboard` 的前端镜像
 *
 * **重要**：字段为 **snake_case**！
 *
 * 原因：Rust 端 `SharedBlackboard` 未启用 `rename_all = "camelCase"`，
 * 字段保持 snake_case（`shared_context` / `agent_outputs` / `final_result` /
 * `rounds_completed`）。
 * 前端直接以 snake_case 访问，UI 层如需 camelCase 可自行转换。
 *
 * 所有 Agent 通过 `Arc<RwLock<SharedBlackboard>>` 并发读写。
 * 设计为简单 KV 存储，避免与具体业务耦合。
 */
export interface RustSharedBlackboard {
  /** 原始任务（用户输入） */
  task: string
  /** 共享上下文 KV（Agent 可写入中间产物、配置等） */
  shared_context: Record<string, string>
  /** 每个 Agent 的输出历史（agent_id → [outputs]） */
  agent_outputs: Record<string, string[]>
  /** 最终结果（任一 Agent 写入即视为达成目标；未完成时为 null/undefined） */
  final_result?: string | null
  /** 已完成的轮次数 */
  rounds_completed: number
}

/**
 * Rust `commands::multi_agent::AgentLoopConfigOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 与 `useSupervisorRust` / `useGoTRust` 中的 `RustAgentLoopConfigOptions` 字段对齐，
 * 但作为独立类型避免跨模块依赖。
 *
 * 未提供者使用 `AgentLoopConfig::default()` 保守策略。
 */
export interface RustMultiAgentLoopConfigOptions {
  /** 系统提示词 */
  systemPrompt?: string
  /** 最大迭代次数（默认 25） */
  maxIterations?: number
  /** 温度 */
  temperature?: number
  /** 最大输出 token */
  maxTokens?: number
  /** 是否并行执行工具调用 */
  parallelToolCalls?: boolean
  /** 思考级别 */
  thinkingLevel?: 'low' | 'medium' | 'high'
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
 * Rust `commands::multi_agent::PromptTemplateOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 综合策略与目标检查策略共用此类型。
 */
export interface RustMultiAgentPromptTemplateOptions {
  /** 系统提示词 */
  system: string
  /** 用户提示词模板（支持 `{task}` / `{outputs}` 等占位符） */
  userTemplate: string
}

/**
 * Rust `commands::multi_agent::CreateMultiAgentOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 所有字段可选，未提供者使用 Rust 端默认值。
 *
 * 默认值（`MultiAgentConfig::default()`）：
 * - `maxRounds = 10`
 * - `maxConcurrency = 5`
 * - `topology = Mesh`
 * - `blackboardEnabled = true`
 * - `messagePassingEnabled = true`
 * - `convergenceStrategy = Hybrid { goal_check: true, max_rounds: 10 }`
 * - `channelCapacity = 32`
 * - `requireSynthesis = true`
 */
export interface RustCreateMultiAgentOptions {
  /** 最大协作轮次（默认 10） */
  maxRounds?: number
  /** 单轮最大并发 Agent 数（默认 5） */
  maxConcurrency?: number
  /**
   * 拓扑结构（默认 Mesh）
   *
   * 前端传递格式（serde tag = "kind"）：
   * - `{kind:'mesh'}`
   * - `{kind:'ring'}`
   * - `{kind:'star', hub_id:'agent1'}`
   * - `{kind:'pipeline'}`
   * - `{kind:'custom', peers:{agent1:['agent2'], agent2:['agent1']}}`
   */
  topology?: RustTopology
  /** 是否启用共享黑板（默认 true） */
  blackboardEnabled?: boolean
  /** 是否启用消息传递（默认 true） */
  messagePassingEnabled?: boolean
  /**
   * 收敛策略（默认 Hybrid: goal_check + max_rounds=10）
   *
   * 前端传递格式（serde tag = "kind"）：
   * - `{kind:'max_rounds'}`
   * - `{kind:'goal_reached'}`
   * - `{kind:'all_agents_idle'}`
   * - `{kind:'hybrid', goal_check:true, max_rounds:10}`
   */
  convergenceStrategy?: RustConvergenceStrategy
  /** mpsc 通道容量（默认 32） */
  channelCapacity?: number
  /** 子 Agent 共享的 AgentLoop 配置 */
  agentLoopConfig?: RustMultiAgentLoopConfigOptions
  /** 是否在最后综合所有 Agent 输出（默认 true） */
  requireSynthesis?: boolean
  /** 自定义综合提示词模板（None=用默认 LlmSynthesisStrategy 模板） */
  synthesisPromptTemplate?: RustMultiAgentPromptTemplateOptions
  /** 自定义目标检查提示词模板（None=用默认 LlmGoalCheckStrategyMA 模板） */
  goalCheckPromptTemplate?: RustMultiAgentPromptTemplateOptions
}

/**
 * Rust `commands::multi_agent::MultiAgentRunResult` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 *
 * 与 `RustGoTRunResult` / `RustToTRunResult` 结构相似但独立类型，
 * 用于前端区分编排模式语义。
 */
export interface RustMultiAgentRunResult {
  /** 节点执行状态：continue / done / aborted / error */
  status: string
  /** 下一节点 ID（阶段 2.3 暂不使用，预留） */
  nextNodeId?: string | null
  /** 错误信息（status=error 时） */
  error?: string | null
  /** 摘要（如 "Multi-Agent: 3 个 Agent 协作 5 轮完成"） */
  summary?: string | null
}

/**
 * Rust `agent_runtime::types::OrchestratorState` 的前端镜像
 *
 * Rust 端未启用 `rename_all = "camelCase"`，字段保持 snake_case。
 * 与 `useGoTRust` 中的 `RustGoTOrchestratorState` 结构一致，
 * 但作为独立类型避免跨模块依赖。
 */
export interface RustMultiAgentOrchestratorState {
  /** 用户原始输入 */
  input: string
  /** 编排消息列表 */
  messages: RustMultiAgentOrchestratorMessage[]
  /** 扩展字段（节点自定义数据） */
  extra: Record<string, unknown>
}

/** Rust `OrchestratorMessage` 的前端镜像（snake_case 字段） */
export interface RustMultiAgentOrchestratorMessage {
  /** 角色 */
  role: 'user' | 'assistant' | 'tool_result' | 'system'
  /** 消息内容 */
  content: string
  /** 元数据（可选） */
  metadata?: Record<string, unknown>
}

// ─── Rust 端事件 Payload 镜像 ────────────────────────────────────────────

/**
 * Rust `commands::multi_agent::MultiAgentEventPayload` 的前端镜像
 *
 * **重要**：字段为 **snake_case**！
 *
 * 原因：Rust 端 `MultiAgentEventPayload` 只对变体名用 `rename_all = "snake_case"`
 * （生成 `multi_agent_round_started` / `multi_agent_converged` 等 tag），
 * 变体内部字段保持 snake_case（`session_id` / `node_id` / `from` / `to` /
 * `message_type` / `content_preview` / `final_result` / `agent_id` 等）。
 *
 * 与 `RustGoTEventPayload` / `RustToTEventPayload` 命名约定一致：
 * 编排层级事件保持 snake_case，不与流式 message 事件（启用 camelCase）混淆。
 *
 * ## 与其他编排模式事件的差异
 * Multi-Agent 事件聚焦于"协作过程"：轮次进度 / Agent 间消息 / 黑板更新 /
 * 收敛结果，而非思维节点（ToT/GoT）或子任务分配（Supervisor）。
 */
export type RustMultiAgentEventPayload =
  | {
      type: 'multi_agent_round_started'
      session_id: string
      node_id: string
      round: number
      agent_count: number
    }
  | {
      type: 'multi_agent_message_sent'
      session_id: string
      node_id: string
      from: string
      to: string
      message_type: string
      content_preview: string
    }
  | {
      type: 'multi_agent_blackboard_updated'
      session_id: string
      node_id: string
      key: string
      by: string
    }
  | {
      type: 'multi_agent_round_completed'
      session_id: string
      node_id: string
      round: number
      outputs: string[]
    }
  | {
      type: 'multi_agent_converged'
      session_id: string
      node_id: string
      reason: string
      final_result: string
    }
  | {
      type: 'multi_agent_error'
      session_id: string
      node_id: string
      agent_id: string
      error: string
    }

// ─── TS 端事件类型（camelCase，UI 友好） ────────────────────────────────────────────

/**
 * TS 端 Multi-Agent 事件（camelCase，UI 友好）
 *
 * 由 `rustEventToTsEvent` 从 `RustMultiAgentEventPayload` 转换而来，
 * 供 UI 组件订阅。事件名采用 camelCase 与 TS 项目惯例一致。
 */
export type MultiAgentEvent =
  | {
      type: 'multiAgentRoundStarted'
      sessionId: string
      nodeId: string
      round: number
      agentCount: number
    }
  | {
      type: 'multiAgentMessageSent'
      sessionId: string
      nodeId: string
      from: string
      to: string
      messageType: string
      contentPreview: string
    }
  | {
      type: 'multiAgentBlackboardUpdated'
      sessionId: string
      nodeId: string
      key: string
      by: string
    }
  | {
      type: 'multiAgentRoundCompleted'
      sessionId: string
      nodeId: string
      round: number
      outputs: string[]
    }
  | {
      type: 'multiAgentConverged'
      sessionId: string
      nodeId: string
      reason: string
      finalResult: string
    }
  | {
      type: 'multiAgentError'
      sessionId: string
      nodeId: string
      agentId: string
      error: string
    }

/** Rust payload → TS event 转换 */
function rustEventToTsEvent(payload: RustMultiAgentEventPayload): MultiAgentEvent {
  switch (payload.type) {
    case 'multi_agent_round_started':
      return {
        type: 'multiAgentRoundStarted',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        round: payload.round,
        agentCount: payload.agent_count,
      }
    case 'multi_agent_message_sent':
      return {
        type: 'multiAgentMessageSent',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        from: payload.from,
        to: payload.to,
        messageType: payload.message_type,
        contentPreview: payload.content_preview,
      }
    case 'multi_agent_blackboard_updated':
      return {
        type: 'multiAgentBlackboardUpdated',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        key: payload.key,
        by: payload.by,
      }
    case 'multi_agent_round_completed':
      return {
        type: 'multiAgentRoundCompleted',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        round: payload.round,
        outputs: payload.outputs,
      }
    case 'multi_agent_converged':
      return {
        type: 'multiAgentConverged',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        reason: payload.reason,
        finalResult: payload.final_result,
      }
    case 'multi_agent_error':
      return {
        type: 'multiAgentError',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        agentId: payload.agent_id,
        error: payload.error,
      }
  }
}

// ─── 会话级状态 ────────────────────────────────────────────

/**
 * 单个 Multi-Agent 会话的响应式状态
 *
 * 镜像 Rust 端协作进度 + 黑板快照 + 运行状态。
 * UI 组件通过 `maSessions.get(sessionId)` 读取并渲染。
 *
 * ## 与 GoTSessionState 的差异
 * - 探索进度字段不同：`roundsCompleted` / `messagesSent` / `blackboardUpdates`
 *   （GoT 是 `nodesCreated` / `nodesScored` / `branchesExplored` / `aggregationsPerformed`）
 * - 结果字段不同：`finalResult` / `convergenceReason`
 *   （GoT 是 `bestThoughtId` / `bestThoughtContent` / `bestScore` / `terminationReason`）
 * - 快照字段不同：`blackboardSnapshot`（GoT 是 `graphSnapshot`）
 */
export interface MultiAgentSessionState {
  /** 会话 ID */
  sessionId: string
  /** 当前输入文本（最近一次 run 的 task） */
  currentTask: string
  /** 运行状态：idle / running / done / aborted / error */
  runStatus: 'idle' | 'running' | 'done' | 'aborted' | 'error'
  /** 最近一次 run 的结果（run 完成后填充） */
  lastResult: RustMultiAgentRunResult | null
  /** 最近一次错误信息（runStatus=error 时） */
  lastError: string | null
  /** 错误来源 Agent ID（multiAgentError 时填充；"system" 表示系统级错误） */
  errorAgentId: string | null

  // ── 协作进度（事件驱动）──
  /** 已完成的协作轮次（multiAgentRoundCompleted 事件累加） */
  roundsCompleted: number
  /** 当前轮次编号（multiAgentRoundStarted 事件更新；从 1 开始） */
  currentRound: number
  /** 本轮参与的 Agent 数量（multiAgentRoundStarted 事件更新） */
  currentAgentCount: number
  /** Agent 间消息传递次数（multiAgentMessageSent 事件累加） */
  messagesSent: number
  /** 黑板更新次数（multiAgentBlackboardUpdated 事件累加） */
  blackboardUpdates: number

  // ── 收敛结果（执行完成后填充）──
  /** 收敛原因（multiAgentConverged 时填充，如 "GoalReached" / "MaxRoundsReached" / "AllAgentsIdle" / "Aborted"） */
  convergenceReason: string | null
  /** 最终协作结果（multiAgentConverged 时填充；可能为综合后的 final_result） */
  finalResult: string | null

  // ── 快照 ──
  /** 事件历史（最多保留 200 条，按时间顺序） */
  events: MultiAgentEvent[]
  /** Rust 端 OrchestratorState 快照（getState 时填充） */
  stateSnapshot: RustMultiAgentOrchestratorState | null
  /** 共享黑板快照（getBlackboard 时填充，含完整 task / shared_context / agent_outputs / final_result） */
  blackboardSnapshot: RustSharedBlackboard | null
}

/** 创建初始会话状态 */
function createInitialSessionState(sessionId: string): MultiAgentSessionState {
  return {
    sessionId,
    currentTask: '',
    runStatus: 'idle',
    lastResult: null,
    lastError: null,
    errorAgentId: null,
    roundsCompleted: 0,
    currentRound: 0,
    currentAgentCount: 0,
    messagesSent: 0,
    blackboardUpdates: 0,
    convergenceReason: null,
    finalResult: null,
    events: [],
    stateSnapshot: null,
    blackboardSnapshot: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 模块级单例状态（与 useAgentRust / useSupervisorRust / useRouterRust / useToTRust /
//                useGoTRust 一致：模块级单例）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 所有活跃 Multi-Agent 会话的响应式状态映射
 *
 * key = sessionId，value = MultiAgentSessionState（reactive）
 * UI 通过 `maSessions.get(sessionId)` 读取状态。
 */
const maSessions = shallowReactive<Map<string, MultiAgentSessionState>>(new Map())

/** 事件监听器清理函数映射 */
const unlistenFns = new Map<string, UnlistenFn>()

/** 用户订阅者集合（每会话独立；subscribe 时注册，unsubscribe 或 destroy 时清理） */
type SessionEventListener = (event: MultiAgentEvent) => void
const sessionListeners = new Map<string, Set<SessionEventListener>>()

/** 会话创建时间戳（用于 listSessions 排序） */
const sessionCreatedAt = new Map<string, number>()

// ─── 事件监听器设置 ────────────────────────────────────────────

/**
 * 为指定会话设置事件监听器
 *
 * 监听 `multi_agent:event:{sessionId}` 事件，收到 Rust payload 后：
 * 1. 转换为 TS 事件（camelCase）
 * 2. 更新模块级响应式状态（maSessions）
 * 3. 分发给所有订阅者
 *
 * 幂等：若已存在监听器，直接返回（避免重复监听）。
 */
async function setupEventListener(sessionId: string): Promise<void> {
  if (unlistenFns.has(sessionId)) return

  const eventName = `multi_agent:event:${sessionId}`
  try {
    const unlisten = await listen<RustMultiAgentEventPayload>(eventName, (e) => {
      const tsEvent = rustEventToTsEvent(e.payload)
      handleSessionEvent(sessionId, tsEvent)
    })
    unlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useMultiAgentRust] listen ${eventName} 失败:`, err)
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
 * 1. 更新 `maSessions` 中的会话状态
 * 2. 限制 `events` 历史最多 200 条（FIFO）
 * 3. 分发给所有订阅者
 */
function handleSessionEvent(sessionId: string, event: MultiAgentEvent): void {
  const session = maSessions.get(sessionId)
  if (session) {
    // 更新会话状态
    switch (event.type) {
      case 'multiAgentRoundStarted':
        // 协作轮次开始
        session.currentRound = event.round
        session.currentAgentCount = event.agentCount
        break
      case 'multiAgentMessageSent':
        // Agent 间消息已发送
        session.messagesSent += 1
        break
      case 'multiAgentBlackboardUpdated':
        // 共享黑板已更新
        session.blackboardUpdates += 1
        break
      case 'multiAgentRoundCompleted':
        // 协作轮次完成
        session.roundsCompleted += 1
        break
      case 'multiAgentConverged':
        // 协作收敛：协作完成
        session.convergenceReason = event.reason
        session.finalResult = event.finalResult
        session.runStatus = 'done'
        session.lastError = null
        session.errorAgentId = null
        break
      case 'multiAgentError':
        // 执行失败
        session.runStatus = 'error'
        session.lastError = `[${event.agentId}] ${event.error}`
        session.errorAgentId = event.agentId
        break
    }

    // 追加事件历史（FIFO，上限 200）
    session.events.push(event)
    if (session.events.length > 200) {
      session.events.splice(0, session.events.length - 200)
    }
  }

  // 分发给订阅者
  const listeners = sessionListeners.get(sessionId)
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (err) {
        console.warn(`[useMultiAgentRust] 会话 ${sessionId} 订阅者异常:`, err)
      }
    }
  }
}

// ─── Tauri 命令封装 ────────────────────────────────────────────

/**
 * 创建 Multi-Agent 实例并注册到 Rust 端 registry
 *
 * # 参数
 * - `sessionId`：会话 ID（前端生成，建议前缀 `ma_`）
 * - `providerConfig`：LLM Provider 配置（snake_case 字段，共享给所有子 Agent）
 * - `specs`：Agent 规格列表（定义参与协作的 Agent 角色、提示词等；至少 1 个）
 * - `options`：可选 Multi-Agent 配置（含 maxRounds / topology / convergenceStrategy /
 *   agentLoopConfig / 自定义提示词模板，camelCase 字段）
 *
 * # 行为
 * 1. 调用 `cmd_multi_agent_create` 在 Rust 端创建 MultiAgentNode
 * 2. 创建前端响应式会话状态并加入 `maSessions`
 * 3. 设置事件监听器
 *
 * # 错误
 * 抛出 Rust 端返回的 `MultiAgentRegistryError`（已序列化为 JS 对象）：
 * - `AlreadyExists`：session_id 已存在
 * - `MultiAgentError`：specs 为空或其他配置错误
 */
async function create(
  sessionId: string,
  providerConfig: RustProviderConfig,
  specs: RustAgentSpec[],
  options?: RustCreateMultiAgentOptions,
): Promise<void> {
  console.log(
    `[useMultiAgentRust] 创建 ma session=${sessionId} specsCount=${specs.length} hasCustomTemplates=${!!(
      options?.synthesisPromptTemplate || options?.goalCheckPromptTemplate
    )}`,
  )

  await invoke('cmd_multi_agent_create', {
    sessionId,
    providerConfig,
    specs,
    options: options ?? null,
  })

  // 创建前端响应式状态
  const sessionState = reactive(createInitialSessionState(sessionId))
  maSessions.set(sessionId, sessionState)
  sessionCreatedAt.set(sessionId, Date.now())

  // 设置事件监听器
  await setupEventListener(sessionId)
}

/**
 * 提交任务并执行 Multi-Agent 协作
 *
 * # 参数
 * - `sessionId`：会话 ID
 * - `task`：用户任务文本（作为协作启动输入，通常由 Coordinator Agent 接收）
 *
 * # 行为
 * 1. 更新前端状态：`currentTask = task`、`runStatus = 'running'`
 * 2. 调用 `cmd_multi_agent_run`，Rust 端执行多轮协作
 *    （JoinSet 并发 Agent 执行 + 消息传递 + 黑板共享 + 收敛检查 + 最终综合）
 * 3. 期间通过事件流推送 `multiAgentRoundStarted` / `multiAgentMessageSent` /
 *    `multiAgentBlackboardUpdated` / `multiAgentRoundCompleted` /
 *    `multiAgentConverged` / `multiAgentError`
 * 4. 返回 `RustMultiAgentRunResult`（含 status / summary / error）
 *
 * # 注意
 * 此方法是阻塞式的（await Rust 端 execute 完成）。
 * 事件监听器在 await 期间持续接收并更新状态。
 * 调用方可以选择不 await，通过订阅事件获取进度。
 */
async function run(sessionId: string, task: string): Promise<RustMultiAgentRunResult> {
  const session = maSessions.get(sessionId)
  if (!session) {
    throw new Error(`[useMultiAgentRust] 会话不存在: ${sessionId}`)
  }

  // 重置运行状态（保留 blackboardSnapshot 与 events 供历史参考；如需清空请显式 destroy + create）
  session.currentTask = task
  session.runStatus = 'running'
  session.lastError = null
  session.lastResult = null
  session.errorAgentId = null
  session.roundsCompleted = 0
  session.currentRound = 0
  session.currentAgentCount = 0
  session.messagesSent = 0
  session.blackboardUpdates = 0
  session.convergenceReason = null
  session.finalResult = null

  try {
    const result = await invoke<RustMultiAgentRunResult>('cmd_multi_agent_run', {
      sessionId,
      task,
    })
    session.lastResult = result
    // 兜底：若 Rust 端返回 error/aborted 但事件未触发，根据 result 推断状态
    if (result.status === 'error' && !session.lastError) {
      session.lastError = result.error ?? '未知错误'
      session.runStatus = 'error'
    } else if (result.status === 'aborted') {
      session.runStatus = 'aborted'
    } else if (result.status === 'done' && session.runStatus === 'running') {
      // 兜底：若 multiAgentConverged 事件未触发，根据 result.status=done 推断
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
 * 设置 Rust 端 `abort_flag = true`，MultiAgentNode 在下次中断检查点
 * （每轮开始 / 收敛检查）命中并返回 `aborted`。
 *
 * 中断是**协作式**的：依赖 MultiAgentNode 主动检查 `ctx.is_aborted()`。
 * 若子 Agent 正在执行 `agent.run(...)`，需子 Agent 自身的 abort 机制生效
 * （阶段 2.3 不向下传播 abort，子 Agent 会执行到自然结束）。
 */
async function abort(sessionId: string): Promise<void> {
  await invoke('cmd_multi_agent_abort', { sessionId })
  const session = maSessions.get(sessionId)
  if (session && session.runStatus === 'running') {
    session.runStatus = 'aborted'
  }
  console.log(`[useMultiAgentRust] 中断 ma session=${sessionId}`)
}

/**
 * 销毁 Multi-Agent 实例
 *
 * 1. 调用 `cmd_multi_agent_destroy`：Rust 端 abort_all tool_bridge + 移除注册
 * 2. 清理前端事件监听器
 * 3. 从 `maSessions` 移除
 * 4. 清理订阅者集合
 */
async function destroy(sessionId: string): Promise<void> {
  try {
    await invoke('cmd_multi_agent_destroy', { sessionId })
  } catch (err) {
    console.warn(`[useMultiAgentRust] destroy 调用失败（继续清理前端状态）:`, err)
  }

  // 清理前端状态
  teardownEventListener(sessionId)
  maSessions.delete(sessionId)
  sessionCreatedAt.delete(sessionId)
  sessionListeners.delete(sessionId)
  console.log(`[useMultiAgentRust] 销毁 ma session=${sessionId}`)
}

/**
 * 获取共享 OrchestratorState 快照
 *
 * 返回 Rust 端 `Arc<RwLock<OrchestratorState>>` 的克隆并序列化。
 * 前端可用于展示当前任务、消息历史（含协作过程的 assistant 消息）。
 */
async function getState(sessionId: string): Promise<RustMultiAgentOrchestratorState> {
  const state = await invoke<RustMultiAgentOrchestratorState>('cmd_multi_agent_get_state', {
    sessionId,
  })
  // 缓存到会话状态
  const session = maSessions.get(sessionId)
  if (session) {
    session.stateSnapshot = state
  }
  return state
}

/**
 * 写回 OrchestratorState（用于断点恢复）
 *
 * 覆盖整个 state，调用方需确保传入完整 state（不可部分更新）。
 * 持久化场景：getState → 序列化保存 → 恢复时反序列化 → setState。
 */
async function setState(
  sessionId: string,
  newState: RustMultiAgentOrchestratorState,
): Promise<void> {
  await invoke('cmd_multi_agent_set_state', { sessionId, newState })
  const session = maSessions.get(sessionId)
  if (session) {
    session.stateSnapshot = newState
  }
}

/**
 * 列出所有已注册的 Multi-Agent session_id
 *
 * 返回 Rust 端 `MultiAgentRegistry::list()` 的结果。
 * 与前端 `maSessions` 的 key 应保持一致（差异表明状态不同步）。
 */
async function listSessions(): Promise<string[]> {
  return await invoke<string[]>('cmd_multi_agent_list_sessions')
}

/**
 * 获取最后一次 execute 的黑板快照
 *
 * 返回 `RustSharedBlackboard | null`：
 * - 非空：已执行过 execute，返回最后一次的黑板快照
 * - null：尚未执行 execute
 *
 * # 用途
 * - 执行中：展示当前协作进度（轮次、消息、共享上下文）
 * - 执行后：查看各 Agent 输出历史与最终综合结果
 * - 调试：检查 Multi-Agent 是否按预期协作与收敛
 *
 * # 字段命名
 * Rust 端 `SharedBlackboard` 未启用 `rename_all = "camelCase"`，
 * 字段保持 snake_case（`shared_context` / `agent_outputs` / `final_result` /
 * `rounds_completed`），前端直接以 snake_case 访问。
 */
async function getBlackboard(sessionId: string): Promise<RustSharedBlackboard | null> {
  const snapshot = await invoke<RustSharedBlackboard | null>('cmd_multi_agent_get_blackboard', {
    sessionId,
  })
  const session = maSessions.get(sessionId)
  if (session && snapshot) {
    session.blackboardSnapshot = snapshot
    // 兜底：若 multiAgentConverged 事件未触发但 blackboard.final_result 已存在，填充 finalResult
    if (!session.finalResult && snapshot.final_result) {
      session.finalResult = snapshot.final_result
    }
    // 同步 roundsCompleted（若事件未触发）
    if (snapshot.rounds_completed > session.roundsCompleted) {
      session.roundsCompleted = snapshot.rounds_completed
    }
  }
  return snapshot
}

// ─── 事件订阅 ────────────────────────────────────────────

/**
 * 订阅指定会话的事件
 *
 * 注册一个监听器，每次 Rust 端推送 `multi_agent:event:{sessionId}` 时调用。
 * 与 `useAgentRust.subscribe` / `useSupervisorRust.subscribe` /
 * `useRouterRust.subscribe` / `useToTRust.subscribe` / `useGoTRust.subscribe` 模式一致。
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
 * 生成 Multi-Agent 会话 ID
 *
 * 格式：`ma_{timestamp}_{random}`，便于在日志与 UI 中识别。
 * 与 useAgentRust / useSupervisorRust / useRouterRust / useToTRust / useGoTRust 的
 * sessionId 生成模式保持一致。
 */
function generateSessionId(): string {
  return `ma_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue Composable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Multi-Agent 协作模式前端 composable
 *
 * 模块级单例，多次调用返回同一组状态与方法。
 *
 * # 使用示例
 * ```ts
 * const ma = useMultiAgentRust()
 *
 * // 创建 Multi-Agent（3 个 Agent 对等协作，Mesh 拓扑，Hybrid 收敛）
 * const sessionId = ma.generateSessionId()
 * await ma.create(
 *   sessionId,
 *   providerConfig,
 *   [
 *     {
 *       id: 'coordinator',
 *       name: '协调者',
 *       role: 'coordinator',
 *       description: '负责分解任务与综合结果',
 *       system_prompt: '你是一个任务协调者...',
 *       initial_message: null, // 等待用户任务通过 run 注入
 *     },
 *     {
 *       id: 'researcher',
 *       name: '研究员',
 *       role: 'researcher',
 *       description: '负责信息检索与分析',
 *       system_prompt: '你是一个研究专家...',
 *     },
 *     {
 *       id: 'critic',
 *       name: '评审员',
 *       role: 'critic',
 *       description: '负责评审其他 Agent 的输出',
 *       system_prompt: '你是一个严谨的评审者...',
 *     },
 *   ],
 *   {
 *     maxRounds: 10,
 *     topology: { kind: 'mesh' },
 *     convergenceStrategy: { kind: 'hybrid', goal_check: true, max_rounds: 10 },
 *   },
 * )
 *
 * // 订阅事件（UI 更新）
 * const unsub = ma.subscribe(sessionId, (event) => {
 *   if (event.type === 'multiAgentRoundStarted') {
 *     console.log(`轮次 ${event.round} 开始，参与 Agent 数: ${event.agentCount}`)
 *   } else if (event.type === 'multiAgentMessageSent') {
 *     console.log(`[${event.from} → ${event.to}] ${event.messageType}: ${event.contentPreview}`)
 *   } else if (event.type === 'multiAgentBlackboardUpdated') {
 *     console.log(`黑板更新: ${event.key} (by ${event.by})`)
 *   } else if (event.type === 'multiAgentRoundCompleted') {
 *     console.log(`轮次 ${event.round} 完成，产出 ${event.outputs.length} 条输出`)
 *   } else if (event.type === 'multiAgentConverged') {
 *     console.log(`协作收敛: ${event.reason}`)
 *     console.log(`最终结果: ${event.finalResult}`)
 *   } else if (event.type === 'multiAgentError') {
 *     console.error(`错误 [${event.agentId}]: ${event.error}`)
 *   }
 * })
 *
 * // 提交任务，触发协作
 * const result = await ma.run(sessionId, '分析 2026 年 AI Agent 发展趋势')
 * console.log('状态:', result.status)
 * console.log('摘要:', result.summary)
 *
 * // 获取黑板快照（查看各 Agent 输出历史与最终结果）
 * const blackboard = await ma.getBlackboard(sessionId)
 * if (blackboard) {
 *   console.log(`已完成 ${blackboard.rounds_completed} 轮`)
 *   console.log(`共享上下文 KV:`, blackboard.shared_context)
 *   console.log(`各 Agent 输出:`)
 *   for (const [agentId, outputs] of Object.entries(blackboard.agent_outputs)) {
 *     console.log(`  ${agentId}: ${outputs.length} 条输出`)
 *   }
 *   console.log(`最终结果:`, blackboard.final_result)
 * }
 *
 * // 清理
 * unsub()
 * await ma.destroy(sessionId)
 * ```
 */
export function useMultiAgentRust() {
  return {
    // ─── 响应式状态（只读） ───
    /** 所有活跃 Multi-Agent 会话的状态映射（key = sessionId） */
    sessions: readonly(maSessions),
    /** 计算属性：当前活跃会话数 */
    activeSessionCount: computed(() => maSessions.size),
    /** 计算属性：所有正在运行的会话 */
    runningSessions: computed(() =>
      Array.from(maSessions.values()).filter((s) => s.runStatus === 'running'),
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
    getBlackboard,

    // ─── 事件订阅 ───
    subscribe,

    // ─── 工具 ───
    generateSessionId,

    // ─── 内部状态访问（调试用） ───
    /** 获取指定会话的状态（只读视图；不存在返回 null） */
    getSessionState: (sessionId: string): MultiAgentSessionState | null =>
      maSessions.get(sessionId) ?? null,
  }
}
