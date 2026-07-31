/**
 * # useToTRust — Tree of Thoughts 的前端适配层
 *
 * 阶段 2.1（ToT Pattern 批次3）新增。本文件桥接前端 Vue 层与
 * Rust 端 `agent_runtime::tree_of_thoughts::ToTNode`，通过 Tauri `invoke` + `listen` 通信。
 *
 * ## 职责
 *   1. 通过 Tauri 命令管理 ToT 实例（create / run / abort / destroy / 等 8 个命令）
 *   2. 监听 `tot:event:{sessionId}` 事件流，分发到订阅者
 *   3. 维护多个 ToT 会话的响应式状态（思维树快照、最优思维、运行状态）
 *   4. 提供 Reactive 视图（bestThought / treeSnapshot / runStatus / events）供 UI 组件使用
 *
 * ## 与 useRouterRust / useSupervisorRust 的差异
 * - **纯探索节点**：ToT 不执行子 Agent，也不调用工具，只通过 LLM 生成/评分/目标检查
 * - **思维树状态查询**：新增 `getTree` 命令，返回完整思维树快照供前端可视化
 * - **无 tool_bus / agent_pool**：因此无 `clearAgentPool` 命令
 * - **事件种类**：6 个 ToT 专用事件（ThoughtNodeCreated / ThoughtNodeScored /
 *   ThoughtBranchExplored / ToTGoalReached / ToTTerminated / ToTError）
 * - **可插拔策略**：通过 explorationTemplate / scoringTemplate / goalCheckTemplate 自定义提示词
 *
 * ## Tauri 命令映射
 * | TS 函数            | Rust 命令                       |
 * |--------------------|---------------------------------|
 * | `create`           | `cmd_tot_create`                |
 * | `run`              | `cmd_tot_run`                   |
 * | `abort`            | `cmd_tot_abort`                 |
 * | `destroy`          | `cmd_tot_destroy`               |
 * | `getState`         | `cmd_tot_get_state`             |
 * | `setState`         | `cmd_tot_set_state`             |
 * | `listSessions`     | `cmd_tot_list_sessions`         |
 * | `getTree`          | `cmd_tot_get_tree`              |
 *
 * ## 事件命名约定
 * - 事件名：`tot:event:{sessionId}`（与 `agent:event:*` / `supervisor:event:*` / `router:event:*` 并列）
 * - Payload 字段：snake_case（Rust 端 `ToTEventPayload` 只对变体名用 `rename_all = "snake_case"`，
 *   变体内部字段保持 snake_case）
 *   - `session_id` / `node_id` / `thought_id` / `parent_id` / `depth` / `content_preview`
 *   - `score` / `reasoning` / `child_count` / `kept_count` / `content`
 *   - `reason` / `total_nodes` / `max_depth_reached` / `best_thought_id` / `best_score`
 *   - `stage` / `error`
 * - 变体 tag：snake_case（如 `thought_node_created` / `tot_goal_reached` / `tot_terminated`）
 *
 * ## ProviderConfig 字段命名
 * 与 `useAgentRust` / `useSupervisorRust` / `useRouterRust` 一致：Rust 端 `ProviderConfig`
 * 字段为 snake_case（`model_id` / `base_url` / `api_key` / `api_type` / `context_window` / `max_tokens`），
 * 因此前端传入时用 snake_case。
 *
 * ## 配置参数命名
 * Rust 端 `CreateToTOptions` / `ToTConfigOptions` / `*PromptTemplateOptions` 启用
 * `#[serde(rename_all = "camelCase")]`，前端用 camelCase。
 *
 * ## 多会话并发
 * 模块级 `totSessions` Map 支持多个 ToT 会话并发。
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
 * Rust `agent_runtime::tree_of_thoughts::ThoughtNodeStatus` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "snake_case")]` → 前端 lowercase 字符串字面量。
 */
export type RustThoughtNodeStatus = 'pending' | 'scored' | 'expanded' | 'pruned' | 'goal'

/**
 * Rust `agent_runtime::tree_of_thoughts::ThoughtNode` 的前端镜像
 *
 * **重要**：字段为 **snake_case**！
 *
 * 原因：Rust 端 `ThoughtNode` 未启用 `rename_all`，字段保持 snake_case
 * （`parent_id` / `score_reasoning` 等）。
 * 前端在 UI 层使用时可通过 `toTsThoughtNode` 转换为 camelCase。
 */
export interface RustThoughtNode {
  /** 节点唯一 ID */
  id: string
  /** 思维内容（LLM 生成的思维文本） */
  content: string
  /** 父节点 ID（根节点为 None） */
  parent_id?: string | null
  /** 深度（根节点=0） */
  depth: number
  /** 评分（0-100，越高越好；未评分时不存在） */
  score?: number | null
  /** 评分理由（可选，LLM 评分策略会填充） */
  score_reasoning?: string | null
  /** 子节点 ID 列表 */
  children: string[]
  /** 节点状态 */
  status: RustThoughtNodeStatus
}

/**
 * Rust `commands::tot::ToTConfigOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 */
export interface RustToTConfigOptions {
  /** 最大深度（默认 5） */
  maxDepth: number
  /** 最大节点数（默认 50） */
  maxThoughts: number
  /** Beam 宽度 — 每层保留的 top-K 节点数（默认 3） */
  beamWidth: number
  /** 分支因子 — 每个节点生成的候选数（默认 3） */
  branchFactor: number
  /** 评分收敛阈值 — top-K 评分差距小于此值则收敛（默认 5） */
  scoreConvergenceThreshold: number
  /** 是否在最后汇总最优思维（默认 true） */
  requireSummary: boolean
  /** 是否在根节点就检查目标（默认 false） */
  checkGoalAtRoot: boolean
}

/**
 * Rust `commands::tot::ExplorationPromptTemplateOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 */
export interface RustExplorationPromptTemplateOptions {
  /** 系统提示词 */
  system: string
  /** 用户提示词模板（支持 `{context}` `{parent}` `{branch_factor}` 占位符） */
  userTemplate: string
}

/**
 * Rust `commands::tot::ScoringPromptTemplateOptions` 的前端镜像
 */
export interface RustScoringPromptTemplateOptions {
  /** 系统提示词 */
  system: string
  /** 用户提示词模板（支持 `{context}` `{content}` 占位符） */
  userTemplate: string
}

/**
 * Rust `commands::tot::GoalCheckPromptTemplateOptions` 的前端镜像
 */
export interface RustGoalCheckPromptTemplateOptions {
  /** 系统提示词 */
  system: string
  /** 用户提示词模板（支持 `{context}` `{content}` 占位符） */
  userTemplate: string
}

/**
 * Rust `commands::tot::CreateToTOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 所有字段可选，未提供者使用 Rust 端默认值。
 */
export interface RustCreateToTOptions {
  /** ToT 配置（不传则使用默认值） */
  config?: RustToTConfigOptions
  /** 自定义探索提示词模板（不传则使用默认 BeamSearchStrategy） */
  explorationTemplate?: RustExplorationPromptTemplateOptions
  /** 自定义评分提示词模板（不传则使用默认 LlmScoringStrategy） */
  scoringTemplate?: RustScoringPromptTemplateOptions
  /** 自定义目标检查提示词模板（不传则使用默认 LlmGoalCheckStrategy） */
  goalCheckTemplate?: RustGoalCheckPromptTemplateOptions
}

/**
 * Rust `commands::tot::ToTRunResult` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 */
export interface RustToTRunResult {
  /** 节点执行状态：continue / done / aborted / error */
  status: string
  /** 最优思维内容（执行完成后由 cmd_tot_run 从 state.messages 提取） */
  bestThought?: string | null
  /** 错误信息（status=error 时） */
  error?: string | null
  /** 摘要（如 "ToT: 已找到最优思维（深度 3，评分 92）"） */
  summary?: string | null
}

/**
 * Rust `agent_runtime::types::OrchestratorState` 的前端镜像
 *
 * Rust 端未启用 `rename_all = "camelCase"`，字段保持 snake_case。
 * 与 useRouterRust 中的 RustRouterOrchestratorState 结构一致，
 * 但作为独立类型避免跨模块依赖。
 */
export interface RustToTOrchestratorState {
  /** 用户原始输入 */
  input: string
  /** 编排消息列表 */
  messages: RustToTOrchestratorMessage[]
  /** 扩展字段（节点自定义数据） */
  extra: Record<string, unknown>
}

/** Rust `OrchestratorMessage` 的前端镜像（snake_case 字段） */
export interface RustToTOrchestratorMessage {
  /** 角色 */
  role: 'user' | 'assistant' | 'tool_result' | 'system'
  /** 消息内容 */
  content: string
  /** 元数据（可选） */
  metadata?: Record<string, unknown>
}

/**
 * Rust `agent_bridge::tot_registry::ToTTreeSnapshot` 的前端镜像
 *
 * **注意字段命名混合**：
 * - `ToTTreeSnapshot` 启用了 `#[serde(rename_all = "camelCase")]`
 *   → `bestNodeId` / `totalCount` / `maxDepthReached` 为 camelCase
 * - 但内部 `nodes: Vec<ThoughtNode>` 的 `ThoughtNode` 未启用 rename_all
 *   → `nodes` 数组元素的字段保持 snake_case（`parent_id` / `score_reasoning`）
 */
export interface RustToTTreeSnapshot {
  /** 所有思维节点（扁平列表，前端可按 parent_id 重建树结构） */
  nodes: RustThoughtNode[]
  /** 最优节点 ID（执行完成后更新；执行中为 null） */
  bestNodeId?: string | null
  /** 节点总数 */
  totalCount: number
  /** 当前最大深度 */
  maxDepthReached: number
}

// ─── Rust 端事件 Payload 镜像 ────────────────────────────────────────────

/**
 * Rust `commands::tot::ToTEventPayload` 的前端镜像
 *
 * **重要**：字段为 **snake_case**！
 *
 * 原因：Rust 端 `ToTEventPayload` 只对变体名用 `rename_all = "snake_case"`
 * （生成 `thought_node_created` 等 tag），变体内部字段保持 snake_case
 * （`session_id` / `node_id` / `thought_id` 等）。
 *
 * 与 `RustSupervisorEventPayload` / `RustRouterEventPayload` 命名约定一致：
 * 编排层级事件保持 snake_case，不与流式 message 事件（启用 camelCase）混淆。
 */
export type RustToTEventPayload =
  | {
      type: 'thought_node_created'
      session_id: string
      node_id: string
      thought_id: string
      parent_id?: string | null
      depth: number
      content_preview: string
    }
  | {
      type: 'thought_node_scored'
      session_id: string
      node_id: string
      thought_id: string
      score: number
      reasoning?: string | null
    }
  | {
      type: 'thought_branch_explored'
      session_id: string
      node_id: string
      parent_id: string
      child_count: number
      depth: number
      kept_count: number
    }
  | {
      type: 'tot_goal_reached'
      session_id: string
      node_id: string
      thought_id: string
      depth: number
      content: string
      score: number
    }
  | {
      type: 'tot_terminated'
      session_id: string
      node_id: string
      reason: string
      total_nodes: number
      max_depth_reached: number
      best_thought_id?: string | null
      best_score?: number | null
    }
  | {
      type: 'tot_error'
      session_id: string
      node_id: string
      /** 错误阶段（"init" / "expand" / "score" / "goal_check"） */
      stage: string
      error: string
    }

// ─── TS 端事件类型（camelCase，UI 友好） ────────────────────────────────────────────

/**
 * TS 端 ToT 事件（camelCase，UI 友好）
 *
 * 由 `rustEventToTsEvent` 从 `RustToTEventPayload` 转换而来，
 * 供 UI 组件订阅。事件名采用 camelCase 与 TS 项目惯例一致。
 */
export type ToTEvent =
  | {
      type: 'thoughtNodeCreated'
      sessionId: string
      nodeId: string
      thoughtId: string
      parentId?: string | null
      depth: number
      contentPreview: string
    }
  | {
      type: 'thoughtNodeScored'
      sessionId: string
      nodeId: string
      thoughtId: string
      score: number
      reasoning?: string | null
    }
  | {
      type: 'thoughtBranchExplored'
      sessionId: string
      nodeId: string
      parentId: string
      childCount: number
      depth: number
      keptCount: number
    }
  | {
      type: 'totGoalReached'
      sessionId: string
      nodeId: string
      thoughtId: string
      depth: number
      content: string
      score: number
    }
  | {
      type: 'totTerminated'
      sessionId: string
      nodeId: string
      reason: string
      totalNodes: number
      maxDepthReached: number
      bestThoughtId?: string | null
      bestScore?: number | null
    }
  | {
      type: 'totError'
      sessionId: string
      nodeId: string
      /** 错误阶段（"init" / "expand" / "score" / "goal_check"） */
      stage: string
      error: string
    }

/** Rust payload → TS event 转换 */
function rustEventToTsEvent(payload: RustToTEventPayload): ToTEvent {
  switch (payload.type) {
    case 'thought_node_created':
      return {
        type: 'thoughtNodeCreated',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        thoughtId: payload.thought_id,
        parentId: payload.parent_id,
        depth: payload.depth,
        contentPreview: payload.content_preview,
      }
    case 'thought_node_scored':
      return {
        type: 'thoughtNodeScored',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        thoughtId: payload.thought_id,
        score: payload.score,
        reasoning: payload.reasoning,
      }
    case 'thought_branch_explored':
      return {
        type: 'thoughtBranchExplored',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        parentId: payload.parent_id,
        childCount: payload.child_count,
        depth: payload.depth,
        keptCount: payload.kept_count,
      }
    case 'tot_goal_reached':
      return {
        type: 'totGoalReached',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        thoughtId: payload.thought_id,
        depth: payload.depth,
        content: payload.content,
        score: payload.score,
      }
    case 'tot_terminated':
      return {
        type: 'totTerminated',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        reason: payload.reason,
        totalNodes: payload.total_nodes,
        maxDepthReached: payload.max_depth_reached,
        bestThoughtId: payload.best_thought_id,
        bestScore: payload.best_score,
      }
    case 'tot_error':
      return {
        type: 'totError',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        stage: payload.stage,
        error: payload.error,
      }
  }
}

// ─── 会话级状态 ────────────────────────────────────────────

/**
 * 单个 ToT 会话的响应式状态
 *
 * 镜像 Rust 端 `OrchestratorState` 的关键信息 + 思维树探索进度。
 * UI 组件通过 `totSessions.get(sessionId)` 读取并渲染。
 */
export interface ToTSessionState {
  /** 会话 ID */
  sessionId: string
  /** 当前输入文本（最近一次 run 的 task） */
  currentTask: string
  /** 运行状态：idle / running / done / aborted / error */
  runStatus: 'idle' | 'running' | 'done' | 'aborted' | 'error'
  /** 最近一次 run 的结果（run 完成后填充） */
  lastResult: RustToTRunResult | null
  /** 最近一次错误信息（runStatus=error 时） */
  lastError: string | null
  /** 错误阶段（totError 时填充，如 "init" / "expand" / "score" / "goal_check"） */
  errorStage: string | null

  // ── 探索进度（事件驱动）──
  /** 已生成的思维节点数（thoughtNodeCreated 事件累加） */
  nodesCreated: number
  /** 已评分的思维节点数（thoughtNodeScored 事件累加） */
  nodesScored: number
  /** 已完成的扩展层数（thoughtBranchExplored 事件累加） */
  branchesExplored: number
  /** 当前最大深度（thoughtBranchExplored / totTerminated 事件更新） */
  currentMaxDepth: number

  // ── 最优思维（执行完成后填充）──
  /** 最优思维 ID（totGoalReached / totTerminated 时填充） */
  bestThoughtId: string | null
  /** 最优思维内容（totGoalReached 时填充；totTerminated 时由前端从 treeSnapshot 查找） */
  bestThoughtContent: string | null
  /** 最优思维评分（0-100） */
  bestScore: number | null
  /** 终止原因（totTerminated 时填充，如 "goal_reached" / "max_depth_exceeded"） */
  terminationReason: string | null

  // ── 快照 ──
  /** 事件历史（最多保留 200 条，按时间顺序） */
  events: ToTEvent[]
  /** Rust 端 OrchestratorState 快照（getState 时填充） */
  stateSnapshot: RustToTOrchestratorState | null
  /** 思维树快照（getTree 时填充，含完整 nodes 列表） */
  treeSnapshot: RustToTTreeSnapshot | null
}

/** 创建初始会话状态 */
function createInitialSessionState(sessionId: string): ToTSessionState {
  return {
    sessionId,
    currentTask: '',
    runStatus: 'idle',
    lastResult: null,
    lastError: null,
    errorStage: null,
    nodesCreated: 0,
    nodesScored: 0,
    branchesExplored: 0,
    currentMaxDepth: 0,
    bestThoughtId: null,
    bestThoughtContent: null,
    bestScore: null,
    terminationReason: null,
    events: [],
    stateSnapshot: null,
    treeSnapshot: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 模块级单例状态（与 useAgentRust / useSupervisorRust / useRouterRust 一致：模块级单例）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 所有活跃 ToT 会话的响应式状态映射
 *
 * key = sessionId，value = ToTSessionState（reactive）
 * UI 通过 `totSessions.get(sessionId)` 读取状态。
 */
const totSessions = shallowReactive<Map<string, ToTSessionState>>(new Map())

/** 事件监听器清理函数映射 */
const unlistenFns = new Map<string, UnlistenFn>()

/** 用户订阅者集合（每会话独立；subscribe 时注册，unsubscribe 或 destroy 时清理） */
type SessionEventListener = (event: ToTEvent) => void
const sessionListeners = new Map<string, Set<SessionEventListener>>()

/** 会话创建时间戳（用于 listSessions 排序） */
const sessionCreatedAt = new Map<string, number>()

// ─── 事件监听器设置 ────────────────────────────────────────────

/**
 * 为指定会话设置事件监听器
 *
 * 监听 `tot:event:{sessionId}` 事件，收到 Rust payload 后：
 * 1. 转换为 TS 事件（camelCase）
 * 2. 更新模块级响应式状态（totSessions）
 * 3. 分发给所有订阅者
 *
 * 幂等：若已存在监听器，直接返回（避免重复监听）。
 */
async function setupEventListener(sessionId: string): Promise<void> {
  if (unlistenFns.has(sessionId)) return

  const eventName = `tot:event:${sessionId}`
  try {
    const unlisten = await listen<RustToTEventPayload>(eventName, (e) => {
      const tsEvent = rustEventToTsEvent(e.payload)
      handleSessionEvent(sessionId, tsEvent)
    })
    unlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useToTRust] listen ${eventName} 失败:`, err)
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
 * 1. 更新 `totSessions` 中的会话状态
 * 2. 限制 `events` 历史最多 200 条（FIFO）
 * 3. 分发给所有订阅者
 */
function handleSessionEvent(sessionId: string, event: ToTEvent): void {
  const session = totSessions.get(sessionId)
  if (session) {
    // 更新会话状态
    switch (event.type) {
      case 'thoughtNodeCreated':
        session.nodesCreated += 1
        break
      case 'thoughtNodeScored':
        session.nodesScored += 1
        break
      case 'thoughtBranchExplored':
        session.branchesExplored += 1
        if (event.depth > session.currentMaxDepth) {
          session.currentMaxDepth = event.depth
        }
        break
      case 'totGoalReached':
        // 目标达成：最优思维已确定
        session.bestThoughtId = event.thoughtId
        session.bestThoughtContent = event.content
        session.bestScore = event.score
        session.terminationReason = 'goal_reached'
        session.runStatus = 'done'
        session.lastError = null
        session.errorStage = null
        break
      case 'totTerminated':
        // 终止（非目标达成）：可能因 max_depth / max_thoughts / 收敛 / 无候选 / 中断
        // Rust 端 `Option<String>`/`Option<u8>` 序列化为 undefined，用 `?? null` 转 null 以匹配 session 类型
        session.terminationReason = event.reason
        session.bestThoughtId = event.bestThoughtId ?? null
        session.bestScore = event.bestScore ?? null
        session.currentMaxDepth = Math.max(session.currentMaxDepth, event.maxDepthReached)
        // 根据 reason 推断 runStatus
        if (event.reason === 'aborted') {
          session.runStatus = 'aborted'
        } else {
          // goal_reached 不应走这里（已被 totGoalReached 处理），
          // 其他 reason 视为正常结束
          session.runStatus = 'done'
        }
        break
      case 'totError':
        session.runStatus = 'error'
        session.lastError = `[${event.stage}] ${event.error}`
        session.errorStage = event.stage
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
        console.warn(`[useToTRust] 会话 ${sessionId} 订阅者异常:`, err)
      }
    }
  }
}

// ─── Tauri 命令封装 ────────────────────────────────────────────

/**
 * 创建 ToT 实例并注册到 Rust 端 registry
 *
 * # 参数
 * - `sessionId`：会话 ID（前端生成，建议前缀 `tot_`）
 * - `providerConfig`：LLM Provider 配置（snake_case 字段，用于 LLM 思维生成/评分/目标检查）
 * - `options`：可选 ToT 配置（含 config / 自定义提示词模板，camelCase 字段）
 *
 * # 行为
 * 1. 调用 `cmd_tot_create` 在 Rust 端创建 ToTNode
 * 2. 创建前端响应式会话状态并加入 `totSessions`
 * 3. 设置事件监听器
 *
 * # 错误
 * 抛出 Rust 端返回的 `ToTRegistryError`（已序列化为 JS 对象）。
 */
async function create(
  sessionId: string,
  providerConfig: RustProviderConfig,
  options?: RustCreateToTOptions,
): Promise<void> {
  console.log(
    `[useToTRust] 创建 tot session=${sessionId} hasCustomTemplates=${!!(
      options?.explorationTemplate || options?.scoringTemplate || options?.goalCheckTemplate
    )}`,
  )

  await invoke('cmd_tot_create', {
    sessionId,
    providerConfig,
    options: options ?? null,
  })

  // 创建前端响应式状态
  const sessionState = reactive(createInitialSessionState(sessionId))
  totSessions.set(sessionId, sessionState)
  sessionCreatedAt.set(sessionId, Date.now())

  // 设置事件监听器
  await setupEventListener(sessionId)
}

/**
 * 提交问题并执行思维树探索
 *
 * # 参数
 * - `sessionId`：会话 ID
 * - `task`：用户输入问题/任务（作为思维树根节点 content）
 *
 * # 行为
 * 1. 更新前端状态：`currentTask = task`、`runStatus = 'running'`
 * 2. 调用 `cmd_tot_run`，Rust 端执行思维树探索（Beam Search + LLM 评分）
 * 3. 期间通过事件流推送 `thoughtNodeCreated` / `thoughtNodeScored` /
 *    `thoughtBranchExplored` / `totGoalReached` / `totTerminated` / `totError`
 * 4. 返回 `RustToTRunResult`（含 status / bestThought / summary / error）
 *
 * # 注意
 * 此方法是阻塞式的（await Rust 端 execute 完成）。
 * 事件监听器在 await 期间持续接收并更新状态。
 * 调用方可以选择不 await，通过订阅事件获取进度。
 */
async function run(sessionId: string, task: string): Promise<RustToTRunResult> {
  const session = totSessions.get(sessionId)
  if (!session) {
    throw new Error(`[useToTRust] 会话不存在: ${sessionId}`)
  }

  // 重置运行状态（保留 treeSnapshot 与 events 供历史参考；如需清空请显式 destroy + create）
  session.currentTask = task
  session.runStatus = 'running'
  session.lastError = null
  session.lastResult = null
  session.errorStage = null
  session.nodesCreated = 0
  session.nodesScored = 0
  session.branchesExplored = 0
  session.currentMaxDepth = 0
  session.bestThoughtId = null
  session.bestThoughtContent = null
  session.bestScore = null
  session.terminationReason = null

  try {
    const result = await invoke<RustToTRunResult>('cmd_tot_run', {
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
      // 兜底：若 totGoalReached / totTerminated 事件未触发，根据 result.status=done 推断
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
 * 设置 Rust 端 `abort_flag = true`，ToTNode 在中断检查点命中并返回 `aborted`。
 * 中断是**协作式**的：依赖 ToTNode 主动检查 `ctx.is_aborted()`。
 * ToTNode 在每层扩展前检查一次，所以若已开始 LLM 调用，
 * 需等当前层所有 LLM 调用返回后才能命中中断。
 */
async function abort(sessionId: string): Promise<void> {
  await invoke('cmd_tot_abort', { sessionId })
  const session = totSessions.get(sessionId)
  if (session && session.runStatus === 'running') {
    session.runStatus = 'aborted'
  }
  console.log(`[useToTRust] 中断 tot session=${sessionId}`)
}

/**
 * 销毁 ToT 实例
 *
 * 1. 调用 `cmd_tot_destroy`：Rust 端移除注册
 * 2. 清理前端事件监听器
 * 3. 从 `totSessions` 移除
 * 4. 清理订阅者集合
 */
async function destroy(sessionId: string): Promise<void> {
  try {
    await invoke('cmd_tot_destroy', { sessionId })
  } catch (err) {
    console.warn(`[useToTRust] destroy 调用失败（继续清理前端状态）:`, err)
  }

  // 清理前端状态
  teardownEventListener(sessionId)
  totSessions.delete(sessionId)
  sessionCreatedAt.delete(sessionId)
  sessionListeners.delete(sessionId)
  console.log(`[useToTRust] 销毁 tot session=${sessionId}`)
}

/**
 * 获取共享 OrchestratorState 快照
 *
 * 返回 Rust 端 `Arc<RwLock<OrchestratorState>>` 的克隆并序列化。
 * 前端可用于展示当前输入、消息历史（含最优思维 assistant 消息）。
 */
async function getState(sessionId: string): Promise<RustToTOrchestratorState> {
  const state = await invoke<RustToTOrchestratorState>('cmd_tot_get_state', { sessionId })
  // 缓存到会话状态
  const session = totSessions.get(sessionId)
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
async function setState(sessionId: string, newState: RustToTOrchestratorState): Promise<void> {
  await invoke('cmd_tot_set_state', { sessionId, newState })
  const session = totSessions.get(sessionId)
  if (session) {
    session.stateSnapshot = newState
  }
}

/**
 * 列出所有已注册的 ToT session_id
 *
 * 返回 Rust 端 `ToTRegistry::list()` 的结果。
 * 与前端 `totSessions` 的 key 应保持一致（差异表明状态不同步）。
 */
async function listSessions(): Promise<string[]> {
  return await invoke<string[]>('cmd_tot_list_sessions')
}

/**
 * 获取思维树快照（前端展示用）
 *
 * 返回完整思维树（节点列表）与最优节点 ID，
 * 前端可据此渲染树形探索过程与高亮最优路径。
 *
 * # 用途
 * - 执行中：展示当前探索进度（已生成多少节点、最大深度）
 * - 执行后：高亮最优路径（从根节点到 bestNodeId 的路径）
 * - 调试：检查 ToT 是否按预期探索（剪枝是否过激、收敛是否过早）
 *
 * # 注意
 * `nodes` 数组元素字段为 snake_case（`parent_id` / `score_reasoning`），
 * 因为 Rust 端 `ThoughtNode` 未启用 `rename_all`。
 * UI 层使用时需通过 `toTsThoughtNode` 转换或直接访问 snake_case 字段。
 */
async function getTree(sessionId: string): Promise<RustToTTreeSnapshot> {
  const snapshot = await invoke<RustToTTreeSnapshot>('cmd_tot_get_tree', { sessionId })
  const session = totSessions.get(sessionId)
  if (session) {
    session.treeSnapshot = snapshot
    // 若 totTerminated 事件已触发但 bestThoughtContent 未填充，从 nodes 中查找
    if (session.bestThoughtId && !session.bestThoughtContent) {
      const bestNode = snapshot.nodes.find((n) => n.id === session.bestThoughtId)
      if (bestNode) {
        session.bestThoughtContent = bestNode.content
      }
    }
  }
  return snapshot
}

// ─── 事件订阅 ────────────────────────────────────────────

/**
 * 订阅指定会话的事件
 *
 * 注册一个监听器，每次 Rust 端推送 `tot:event:{sessionId}` 时调用。
 * 与 `useAgentRust.subscribe` / `useSupervisorRust.subscribe` / `useRouterRust.subscribe` 模式一致。
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
 * 生成 ToT 会话 ID
 *
 * 格式：`tot_{timestamp}_{random}`，便于在日志与 UI 中识别。
 * 与 useAgentRust / useSupervisorRust / useRouterRust 的 sessionId 生成模式保持一致。
 */
function generateSessionId(): string {
  return `tot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue Composable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tree of Thoughts 前端 composable
 *
 * 模块级单例，多次调用返回同一组状态与方法。
 *
 * # 使用示例
 * ```ts
 * const tot = useToTRust()
 *
 * // 创建 ToT（默认 Beam Search + LLM 评分 + LLM 目标检查）
 * const sessionId = tot.generateSessionId()
 * await tot.create(sessionId, providerConfig, {
 *   config: {
 *     maxDepth: 5,
 *     maxThoughts: 50,
 *     beamWidth: 3,
 *     branchFactor: 3,
 *     scoreConvergenceThreshold: 5,
 *     requireSummary: true,
 *     checkGoalAtRoot: false,
 *   },
 * })
 *
 * // 订阅事件（UI 更新）
 * const unsub = tot.subscribe(sessionId, (event) => {
 *   if (event.type === 'thoughtNodeCreated') {
 *     console.log(`新思维 [depth=${event.depth}]: ${event.contentPreview}`)
 *   } else if (event.type === 'totGoalReached') {
 *     console.log(`目标达成！score=${event.score}`)
 *   } else if (event.type === 'totTerminated') {
 *     console.log(`终止: ${event.reason}, 共 ${event.totalNodes} 节点`)
 *   }
 * })
 *
 * // 提交问题，触发思维树探索
 * const result = await tot.run(sessionId, '如何降低碳排放？')
 * console.log('最优思维:', result.bestThought)
 * console.log('摘要:', result.summary)
 *
 * // 获取思维树快照（前端可视化用）
 * const tree = await tot.getTree(sessionId)
 * console.log(`共 ${tree.totalCount} 节点，最大深度 ${tree.maxDepthReached}`)
 *
 * // 清理
 * unsub()
 * await tot.destroy(sessionId)
 * ```
 */
export function useToTRust() {
  return {
    // ─── 响应式状态（只读） ───
    /** 所有活跃 ToT 会话的状态映射（key = sessionId） */
    sessions: readonly(totSessions),
    /** 计算属性：当前活跃会话数 */
    activeSessionCount: computed(() => totSessions.size),
    /** 计算属性：所有正在运行的会话 */
    runningSessions: computed(() =>
      Array.from(totSessions.values()).filter((s) => s.runStatus === 'running'),
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
    getTree,

    // ─── 事件订阅 ───
    subscribe,

    // ─── 工具 ───
    generateSessionId,

    // ─── 内部状态访问（调试用） ───
    /** 获取指定会话的状态（只读视图；不存在返回 null） */
    getSessionState: (sessionId: string): ToTSessionState | null =>
      totSessions.get(sessionId) ?? null,
  }
}
