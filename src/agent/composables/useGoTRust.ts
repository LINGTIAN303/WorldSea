/**
 * # useGoTRust — Graph of Thoughts 的前端适配层
 *
 * 阶段 2.2（GoT Pattern 批次3）新增。本文件桥接前端 Vue 层与
 * Rust 端 `agent_runtime::graph_of_thoughts::GoTNode`，通过 Tauri `invoke` + `listen` 通信。
 *
 * ## 职责
 *   1. 通过 Tauri 命令管理 GoT 实例（create / run / abort / destroy / 等 8 个命令）
 *   2. 监听 `got:event:{sessionId}` 事件流，分发到订阅者
 *   3. 维护多个 GoT 会话的响应式状态（思维图快照、最优思维、运行状态、聚合进度）
 *   4. 提供 Reactive 视图（bestThought / graphSnapshot / runStatus / events）供 UI 组件使用
 *
 * ## 与 useToTRust 的差异
 * - **图结构语义**：GoT 节点支持多 parent（`parents` 字段非空时为聚合节点），
 *   前端可据此渲染有向图（多 parent → 1 child 的聚合边）
 * - **聚合阶段**：每层扩展后增加聚合阶段，生成聚合节点（`ThoughtsAggregated` 事件）
 * - **配置参数扩展**：`GoTConfigOptions` 在 `ToTConfigOptions` 基础上增加 4 个聚合参数
 *   （aggregationEnabled / aggregationThreshold / maxAggregationSize / aggregationBranchFactor）
 * - **自定义模板扩展**：新增 `aggregationTemplate`（聚合提示词模板）
 * - **快照类型**：返回 `GoTGraphSnapshot`（与 `ToTTreeSnapshot` 形态一致但独立类型，
 *   用于前端区分 ToT/GoT 语义）
 * - **事件种类**：复用 ToT 的 6 个事件 + 新增 `ThoughtsAggregated`（共 7 个）
 * - **node_type 标识**：Rust 端 GoTNode 返回 `NodeType::Graph`（ToTNode 返回 `Thought`）
 *
 * ## Tauri 命令映射
 * | TS 函数            | Rust 命令                       |
 * |--------------------|---------------------------------|
 * | `create`           | `cmd_got_create`                |
 * | `run`              | `cmd_got_run`                   |
 * | `abort`            | `cmd_got_abort`                 |
 * | `destroy`          | `cmd_got_destroy`               |
 * | `getState`         | `cmd_got_get_state`             |
 * | `setState`         | `cmd_got_set_state`             |
 * | `listSessions`     | `cmd_got_list_sessions`         |
 * | `getTree`          | `cmd_got_get_tree`              |
 *
 * ## 事件命名约定
 * - 事件名：`got:event:{sessionId}`（与 `agent:event:*` / `supervisor:event:*` /
 *   `router:event:*` / `tot:event:*` 并列）
 * - Payload 字段：snake_case（Rust 端 `GoTEventPayload` 只对变体名用 `rename_all = "snake_case"`，
 *   变体内部字段保持 snake_case）
 *   - `session_id` / `node_id` / `thought_id` / `parent_id` / `depth` / `content_preview`
 *   - `score` / `reasoning` / `child_count` / `kept_count` / `content`
 *   - `reason` / `total_nodes` / `max_depth_reached` / `best_thought_id` / `best_score`
 *   - `stage` / `error`
 *   - `aggregated_thought_id` / `source_ids`（GoT 专用，ThoughtsAggregated 事件）
 * - 变体 tag：snake_case（如 `thought_node_created` / `thoughts_aggregated` / `tot_terminated`）
 *
 * ## ProviderConfig 字段命名
 * 与 `useAgentRust` / `useSupervisorRust` / `useRouterRust` / `useToTRust` 一致：
 * Rust 端 `ProviderConfig` 字段为 snake_case（`model_id` / `base_url` / `api_key` /
 * `api_type` / `context_window` / `max_tokens`），前端传入时用 snake_case。
 *
 * ## 配置参数命名
 * Rust 端 `CreateGoTOptions` / `GoTConfigOptions` / `*PromptTemplateOptions` 启用
 * `#[serde(rename_all = "camelCase")]`，前端用 camelCase。
 *
 * ## 多会话并发
 * 模块级 `gotSessions` Map 支持多个 GoT 会话并发。
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
 * 与 useToTRust 中的 `RustThoughtNodeStatus` 一致（复用同一枚举）。
 */
export type RustThoughtNodeStatus = 'pending' | 'scored' | 'expanded' | 'pruned' | 'goal'

/**
 * Rust `agent_runtime::tree_of_thoughts::ThoughtNode` 的前端镜像（GoT 版本）
 *
 * **重要**：字段为 **snake_case**！
 *
 * 原因：Rust 端 `ThoughtNode` 未启用 `rename_all`，字段保持 snake_case
 * （`parent_id` / `score_reasoning` / `parents` 等）。
 * 前端在 UI 层使用时可通过 `toTsThoughtNode` 转换为 camelCase。
 *
 * ## 与 useToTRust 中 RustThoughtNode 的差异
 * GoT 在 ToT 基础上新增 `parents` 字段（多父节点列表，聚合节点非空）：
 * - 普通节点：`parents` 为空数组（与 ToT 等价）
 * - 聚合节点：`parents` 含多个源节点 ID（图语义）
 * 前端可据此区分 ToT 树节点与 GoT 图节点，并渲染聚合边。
 */
export interface RustThoughtNode {
  /** 节点唯一 ID */
  id: string
  /** 思维内容（LLM 生成的思维文本，或聚合生成的新思维） */
  content: string
  /** 主父节点 ID（根节点为 None；聚合节点的 parent_id 为第一个源节点） */
  parent_id?: string | null
  /** 深度（根节点=0；聚合节点深度 = max(源节点深度) + 1） */
  depth: number
  /** 评分（0-100，越高越好；未评分时不存在） */
  score?: number | null
  /** 评分理由（可选，LLM 评分策略会填充） */
  score_reasoning?: string | null
  /** 子节点 ID 列表 */
  children: string[]
  /** 节点状态 */
  status: RustThoughtNodeStatus
  /**
   * 父节点 ID 列表（GoT 专用，ToT 中恒为空数组）
   *
   * - 普通节点：`parents` 为空数组（与 ToT 等价，仅 `parent_id` 单父节点）
   * - 聚合节点：`parents` 含多个源节点 ID（图语义，多 parent → 1 child）
   *
   * 前端可据此渲染聚合边：从每个 parent 到当前节点的有向边。
   */
  parents: string[]
}

/**
 * Rust `commands::got::GoTConfigOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 *
 * ## 与 RustToTConfigOptions 的差异
 * 在 ToT 配置基础上增加 4 个聚合参数：
 * - `aggregationEnabled`：是否启用聚合（默认 true）
 * - `aggregationThreshold`：聚合评分阈值（默认 70）
 * - `maxAggregationSize`：单次聚合节点数上限（默认 3）
 * - `aggregationBranchFactor`：每层聚合节点数（默认 1）
 */
export interface RustGoTConfigOptions {
  // ── 基础 ToT 配置（与 RustToTConfigOptions 一致）──
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

  // ── GoT 聚合参数（阶段 2.2 新增）──
  /** 是否启用聚合（默认 true） */
  aggregationEnabled: boolean
  /** 聚合评分阈值 — 只有评分≥此值的节点才参与聚合（默认 70） */
  aggregationThreshold: number
  /** 单次聚合的节点数上限（默认 3） */
  maxAggregationSize: number
  /** 每层生成的聚合节点数（默认 1） */
  aggregationBranchFactor: number
}

/**
 * Rust `commands::got::ExplorationPromptTemplateOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 与 RustExplorationPromptTemplateOptions 结构一致（GoT 复用 ToT 探索模板）。
 */
export interface RustExplorationPromptTemplateOptions {
  /** 系统提示词 */
  system: string
  /** 用户提示词模板（支持 `{context}` `{parent}` `{branch_factor}` 占位符） */
  userTemplate: string
}

/**
 * Rust `commands::got::ScoringPromptTemplateOptions` 的前端镜像
 */
export interface RustScoringPromptTemplateOptions {
  /** 系统提示词 */
  system: string
  /** 用户提示词模板（支持 `{context}` `{content}` 占位符） */
  userTemplate: string
}

/**
 * Rust `commands::got::GoalCheckPromptTemplateOptions` 的前端镜像
 */
export interface RustGoalCheckPromptTemplateOptions {
  /** 系统提示词 */
  system: string
  /** 用户提示词模板（支持 `{context}` `{content}` 占位符） */
  userTemplate: string
}

/**
 * Rust `commands::got::AggregationPromptTemplateOptions` 的前端镜像
 *
 * GoT 专用参数（ToT 无此模板）。
 *
 * 支持占位符：
 * - `{context}`：用户原始输入
 * - `{thoughts}`：参与聚合的思维列表（JSON 数组，含 content + score）
 */
export interface RustAggregationPromptTemplateOptions {
  /** 系统提示词 */
  system: string
  /** 用户提示词模板（支持 `{context}` `{thoughts}` 占位符） */
  userTemplate: string
}

/**
 * Rust `commands::got::CreateGoTOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 所有字段可选，未提供者使用 Rust 端默认值。
 *
 * ## 与 RustCreateToTOptions 的差异
 * 新增 `aggregationTemplate` 字段（GoT 专用聚合提示词模板）。
 */
export interface RustCreateGoTOptions {
  /** GoT 配置（不传则使用默认值） */
  config?: RustGoTConfigOptions
  /** 自定义探索提示词模板（不传则使用默认 BeamSearchStrategy） */
  explorationTemplate?: RustExplorationPromptTemplateOptions
  /** 自定义评分提示词模板（不传则使用默认 LlmScoringStrategy） */
  scoringTemplate?: RustScoringPromptTemplateOptions
  /** 自定义目标检查提示词模板（不传则使用默认 LlmGoalCheckStrategy） */
  goalCheckTemplate?: RustGoalCheckPromptTemplateOptions
  /**
   * 自定义聚合提示词模板（不传则使用默认 LlmAggregationStrategy）
   *
   * GoT 专用参数（ToT 无此模板）。
   */
  aggregationTemplate?: RustAggregationPromptTemplateOptions
}

/**
 * Rust `commands::got::GoTRunResult` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 与 `RustToTRunResult` 结构一致（GoT 复用 ToT 的 run result 结构）。
 */
export interface RustGoTRunResult {
  /** 节点执行状态：continue / done / aborted / error */
  status: string
  /** 最优思维内容（执行完成后由 cmd_got_run 从 state.messages 提取） */
  bestThought?: string | null
  /** 错误信息（status=error 时） */
  error?: string | null
  /** 摘要（如 "GoT: 已找到最优思维（深度 3，评分 92，含 2 次聚合）"） */
  summary?: string | null
}

/**
 * Rust `agent_runtime::types::OrchestratorState` 的前端镜像
 *
 * Rust 端未启用 `rename_all = "camelCase"`，字段保持 snake_case。
 * 与 useToTRust 中的 `RustToTOrchestratorState` 结构一致，
 * 但作为独立类型避免跨模块依赖。
 */
export interface RustGoTOrchestratorState {
  /** 用户原始输入 */
  input: string
  /** 编排消息列表 */
  messages: RustGoTOrchestratorMessage[]
  /** 扩展字段（节点自定义数据） */
  extra: Record<string, unknown>
}

/** Rust `OrchestratorMessage` 的前端镜像（snake_case 字段） */
export interface RustGoTOrchestratorMessage {
  /** 角色 */
  role: 'user' | 'assistant' | 'tool_result' | 'system'
  /** 消息内容 */
  content: string
  /** 元数据（可选） */
  metadata?: Record<string, unknown>
}

/**
 * Rust `agent_bridge::got_registry::GoTGraphSnapshot` 的前端镜像
 *
 * **注意字段命名混合**：
 * - `GoTGraphSnapshot` 启用了 `#[serde(rename_all = "camelCase")]`
 *   → `bestNodeId` / `totalCount` / `maxDepthReached` 为 camelCase
 * - 但内部 `nodes: Vec<ThoughtNode>` 的 `ThoughtNode` 未启用 rename_all
 *   → `nodes` 数组元素的字段保持 snake_case（`parent_id` / `score_reasoning` / `parents`）
 *
 * ## 与 RustToTTreeSnapshot 的差异
 * 形态一致但独立类型，用于前端区分 ToT/GoT 语义：
 * - GoT 节点的 `parents` 字段在聚合节点上非空（多个源节点 ID）
 * - 前端可据此渲染图的聚合边（多 parent → 1 child）
 */
export interface RustGoTGraphSnapshot {
  /** 所有思维节点（扁平列表，前端可按 parent_id / parents 重建图结构） */
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
 * Rust `commands::got::GoTEventPayload` 的前端镜像
 *
 * **重要**：字段为 **snake_case**！
 *
 * 原因：Rust 端 `GoTEventPayload` 只对变体名用 `rename_all = "snake_case"`
 * （生成 `thought_node_created` / `thoughts_aggregated` 等 tag），
 * 变体内部字段保持 snake_case（`session_id` / `node_id` / `aggregated_thought_id` 等）。
 *
 * 与 `RustToTEventPayload` 命名约定一致：编排层级事件保持 snake_case，
 * 不与流式 message 事件（启用 camelCase）混淆。
 *
 * ## 与 RustToTEventPayload 的差异
 * 复用 6 个 ToT 事件 + 新增 `thoughts_aggregated`（GoT 专用聚合事件）。
 */
export type RustGoTEventPayload =
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
      /** 错误阶段（"init" / "expand" / "score" / "goal_check" / "aggregate"） */
      stage: string
      error: string
    }
  | {
      /** 思维节点已聚合（GoT 专用，ToT 无此事件） */
      type: 'thoughts_aggregated'
      session_id: string
      node_id: string
      /** 聚合生成的新思维节点 ID */
      aggregated_thought_id: string
      /** 源节点 ID 列表（参与聚合的多个父节点） */
      source_ids: string[]
      /** 聚合节点深度（= max(源节点深度) + 1） */
      depth: number
      /** 聚合内容预览（截断后的字符串，便于 UI 展示） */
      content_preview: string
    }

// ─── TS 端事件类型（camelCase，UI 友好） ────────────────────────────────────────────

/**
 * TS 端 GoT 事件（camelCase，UI 友好）
 *
 * 由 `rustEventToTsEvent` 从 `RustGoTEventPayload` 转换而来，
 * 供 UI 组件订阅。事件名采用 camelCase 与 TS 项目惯例一致。
 *
 * ## 与 ToTEvent 的差异
 * 复用 6 个 ToT 事件 + 新增 `thoughtsAggregated`（GoT 专用聚合事件）。
 */
export type GoTEvent =
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
      /** 错误阶段（"init" / "expand" / "score" / "goal_check" / "aggregate"） */
      stage: string
      error: string
    }
  | {
      /** 思维节点已聚合（GoT 专用，ToT 无此事件） */
      type: 'thoughtsAggregated'
      sessionId: string
      nodeId: string
      /** 聚合生成的新思维节点 ID */
      aggregatedThoughtId: string
      /** 源节点 ID 列表（参与聚合的多个父节点） */
      sourceIds: string[]
      /** 聚合节点深度（= max(源节点深度) + 1） */
      depth: number
      /** 聚合内容预览（截断后的字符串，便于 UI 展示） */
      contentPreview: string
    }

/** Rust payload → TS event 转换 */
function rustEventToTsEvent(payload: RustGoTEventPayload): GoTEvent {
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
    case 'thoughts_aggregated':
      return {
        type: 'thoughtsAggregated',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        aggregatedThoughtId: payload.aggregated_thought_id,
        sourceIds: payload.source_ids,
        depth: payload.depth,
        contentPreview: payload.content_preview,
      }
  }
}

// ─── 会话级状态 ────────────────────────────────────────────

/**
 * 单个 GoT 会话的响应式状态
 *
 * 镜像 Rust 端 `OrchestratorState` 的关键信息 + 思维图探索进度 + 聚合进度。
 * UI 组件通过 `gotSessions.get(sessionId)` 读取并渲染。
 *
 * ## 与 ToTSessionState 的差异
 * 新增 `aggregationsPerformed` 字段（thoughtsAggregated 事件累加），
 * 用于 UI 展示聚合进度。
 */
export interface GoTSessionState {
  /** 会话 ID */
  sessionId: string
  /** 当前输入文本（最近一次 run 的 task） */
  currentTask: string
  /** 运行状态：idle / running / done / aborted / error */
  runStatus: 'idle' | 'running' | 'done' | 'aborted' | 'error'
  /** 最近一次 run 的结果（run 完成后填充） */
  lastResult: RustGoTRunResult | null
  /** 最近一次错误信息（runStatus=error 时） */
  lastError: string | null
  /** 错误阶段（totError 时填充，如 "init" / "expand" / "score" / "goal_check" / "aggregate"） */
  errorStage: string | null

  // ── 探索进度（事件驱动）──
  /** 已生成的思维节点数（thoughtNodeCreated 事件累加） */
  nodesCreated: number
  /** 已评分的思维节点数（thoughtNodeScored 事件累加） */
  nodesScored: number
  /** 已完成的扩展层数（thoughtBranchExplored 事件累加） */
  branchesExplored: number
  /** 当前最大深度（thoughtBranchExplored / thoughtsAggregated / totTerminated 事件更新） */
  currentMaxDepth: number

  // ── 聚合进度（GoT 专用，ToT 无此字段）──
  /** 已执行的聚合次数（thoughtsAggregated 事件累加） */
  aggregationsPerformed: number

  // ── 最优思维（执行完成后填充）──
  /** 最优思维 ID（totGoalReached / totTerminated 时填充） */
  bestThoughtId: string | null
  /** 最优思维内容（totGoalReached 时填充；totTerminated 时由前端从 graphSnapshot 查找） */
  bestThoughtContent: string | null
  /** 最优思维评分（0-100） */
  bestScore: number | null
  /** 终止原因（totTerminated 时填充，如 "goal_reached" / "max_depth_exceeded"） */
  terminationReason: string | null

  // ── 快照 ──
  /** 事件历史（最多保留 200 条，按时间顺序） */
  events: GoTEvent[]
  /** Rust 端 OrchestratorState 快照（getState 时填充） */
  stateSnapshot: RustGoTOrchestratorState | null
  /** 思维图快照（getTree 时填充，含完整 nodes 列表与多 parent 关系） */
  graphSnapshot: RustGoTGraphSnapshot | null
}

/** 创建初始会话状态 */
function createInitialSessionState(sessionId: string): GoTSessionState {
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
    aggregationsPerformed: 0,
    bestThoughtId: null,
    bestThoughtContent: null,
    bestScore: null,
    terminationReason: null,
    events: [],
    stateSnapshot: null,
    graphSnapshot: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 模块级单例状态（与 useAgentRust / useSupervisorRust / useRouterRust / useToTRust 一致：模块级单例）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 所有活跃 GoT 会话的响应式状态映射
 *
 * key = sessionId，value = GoTSessionState（reactive）
 * UI 通过 `gotSessions.get(sessionId)` 读取状态。
 */
const gotSessions = shallowReactive<Map<string, GoTSessionState>>(new Map())

/** 事件监听器清理函数映射 */
const unlistenFns = new Map<string, UnlistenFn>()

/** 用户订阅者集合（每会话独立；subscribe 时注册，unsubscribe 或 destroy 时清理） */
type SessionEventListener = (event: GoTEvent) => void
const sessionListeners = new Map<string, Set<SessionEventListener>>()

/** 会话创建时间戳（用于 listSessions 排序） */
const sessionCreatedAt = new Map<string, number>()

// ─── 事件监听器设置 ────────────────────────────────────────────

/**
 * 为指定会话设置事件监听器
 *
 * 监听 `got:event:{sessionId}` 事件，收到 Rust payload 后：
 * 1. 转换为 TS 事件（camelCase）
 * 2. 更新模块级响应式状态（gotSessions）
 * 3. 分发给所有订阅者
 *
 * 幂等：若已存在监听器，直接返回（避免重复监听）。
 */
async function setupEventListener(sessionId: string): Promise<void> {
  if (unlistenFns.has(sessionId)) return

  const eventName = `got:event:${sessionId}`
  try {
    const unlisten = await listen<RustGoTEventPayload>(eventName, (e) => {
      const tsEvent = rustEventToTsEvent(e.payload)
      handleSessionEvent(sessionId, tsEvent)
    })
    unlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useGoTRust] listen ${eventName} 失败:`, err)
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
 * 1. 更新 `gotSessions` 中的会话状态
 * 2. 限制 `events` 历史最多 200 条（FIFO）
 * 3. 分发给所有订阅者
 */
function handleSessionEvent(sessionId: string, event: GoTEvent): void {
  const session = gotSessions.get(sessionId)
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
      case 'thoughtsAggregated':
        // GoT 专用：聚合事件
        session.aggregationsPerformed += 1
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
        console.warn(`[useGoTRust] 会话 ${sessionId} 订阅者异常:`, err)
      }
    }
  }
}

// ─── Tauri 命令封装 ────────────────────────────────────────────

/**
 * 创建 GoT 实例并注册到 Rust 端 registry
 *
 * # 参数
 * - `sessionId`：会话 ID（前端生成，建议前缀 `got_`）
 * - `providerConfig`：LLM Provider 配置（snake_case 字段，用于 LLM 思维生成/评分/目标检查/聚合）
 * - `options`：可选 GoT 配置（含 config / 自定义提示词模板，camelCase 字段）
 *
 * # 行为
 * 1. 调用 `cmd_got_create` 在 Rust 端创建 GoTNode
 * 2. 创建前端响应式会话状态并加入 `gotSessions`
 * 3. 设置事件监听器
 *
 * # 错误
 * 抛出 Rust 端返回的 `GoTRegistryError`（已序列化为 JS 对象）。
 */
async function create(
  sessionId: string,
  providerConfig: RustProviderConfig,
  options?: RustCreateGoTOptions,
): Promise<void> {
  console.log(
    `[useGoTRust] 创建 got session=${sessionId} hasCustomTemplates=${!!(
      options?.explorationTemplate ||
      options?.scoringTemplate ||
      options?.goalCheckTemplate ||
      options?.aggregationTemplate
    )}`,
  )

  await invoke('cmd_got_create', {
    sessionId,
    providerConfig,
    options: options ?? null,
  })

  // 创建前端响应式状态
  const sessionState = reactive(createInitialSessionState(sessionId))
  gotSessions.set(sessionId, sessionState)
  sessionCreatedAt.set(sessionId, Date.now())

  // 设置事件监听器
  await setupEventListener(sessionId)
}

/**
 * 提交问题并执行思维图探索
 *
 * # 参数
 * - `sessionId`：会话 ID
 * - `task`：用户输入问题/任务（作为思维图根节点 content）
 *
 * # 行为
 * 1. 更新前端状态：`currentTask = task`、`runStatus = 'running'`
 * 2. 调用 `cmd_got_run`，Rust 端执行思维图探索（Beam Search + LLM 评分 + 跨层聚合）
 * 3. 期间通过事件流推送 `thoughtNodeCreated` / `thoughtNodeScored` /
 *    `thoughtBranchExplored` / `thoughtsAggregated` / `totGoalReached` /
 *    `totTerminated` / `totError`
 * 4. 返回 `RustGoTRunResult`（含 status / bestThought / summary / error）
 *
 * # 注意
 * 此方法是阻塞式的（await Rust 端 execute 完成）。
 * 事件监听器在 await 期间持续接收并更新状态。
 * 调用方可以选择不 await，通过订阅事件获取进度。
 */
async function run(sessionId: string, task: string): Promise<RustGoTRunResult> {
  const session = gotSessions.get(sessionId)
  if (!session) {
    throw new Error(`[useGoTRust] 会话不存在: ${sessionId}`)
  }

  // 重置运行状态（保留 graphSnapshot 与 events 供历史参考；如需清空请显式 destroy + create）
  session.currentTask = task
  session.runStatus = 'running'
  session.lastError = null
  session.lastResult = null
  session.errorStage = null
  session.nodesCreated = 0
  session.nodesScored = 0
  session.branchesExplored = 0
  session.currentMaxDepth = 0
  session.aggregationsPerformed = 0
  session.bestThoughtId = null
  session.bestThoughtContent = null
  session.bestScore = null
  session.terminationReason = null

  try {
    const result = await invoke<RustGoTRunResult>('cmd_got_run', {
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
 * 设置 Rust 端 `abort_flag = true`，GoTNode 在中断检查点命中并返回 `aborted`。
 * 中断是**协作式**的：依赖 GoTNode 主动检查 `ctx.is_aborted()`。
 * GoTNode 在每层扩展前检查一次，所以若已开始 LLM 调用，
 * 需等当前层所有 LLM 调用返回后才能命中中断。
 */
async function abort(sessionId: string): Promise<void> {
  await invoke('cmd_got_abort', { sessionId })
  const session = gotSessions.get(sessionId)
  if (session && session.runStatus === 'running') {
    session.runStatus = 'aborted'
  }
  console.log(`[useGoTRust] 中断 got session=${sessionId}`)
}

/**
 * 销毁 GoT 实例
 *
 * 1. 调用 `cmd_got_destroy`：Rust 端移除注册
 * 2. 清理前端事件监听器
 * 3. 从 `gotSessions` 移除
 * 4. 清理订阅者集合
 */
async function destroy(sessionId: string): Promise<void> {
  try {
    await invoke('cmd_got_destroy', { sessionId })
  } catch (err) {
    console.warn(`[useGoTRust] destroy 调用失败（继续清理前端状态）:`, err)
  }

  // 清理前端状态
  teardownEventListener(sessionId)
  gotSessions.delete(sessionId)
  sessionCreatedAt.delete(sessionId)
  sessionListeners.delete(sessionId)
  console.log(`[useGoTRust] 销毁 got session=${sessionId}`)
}

/**
 * 获取共享 OrchestratorState 快照
 *
 * 返回 Rust 端 `Arc<RwLock<OrchestratorState>>` 的克隆并序列化。
 * 前端可用于展示当前输入、消息历史（含最优思维 assistant 消息）。
 */
async function getState(sessionId: string): Promise<RustGoTOrchestratorState> {
  const state = await invoke<RustGoTOrchestratorState>('cmd_got_get_state', { sessionId })
  // 缓存到会话状态
  const session = gotSessions.get(sessionId)
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
async function setState(sessionId: string, newState: RustGoTOrchestratorState): Promise<void> {
  await invoke('cmd_got_set_state', { sessionId, newState })
  const session = gotSessions.get(sessionId)
  if (session) {
    session.stateSnapshot = newState
  }
}

/**
 * 列出所有已注册的 GoT session_id
 *
 * 返回 Rust 端 `GoTRegistry::list()` 的结果。
 * 与前端 `gotSessions` 的 key 应保持一致（差异表明状态不同步）。
 */
async function listSessions(): Promise<string[]> {
  return await invoke<string[]>('cmd_got_list_sessions')
}

/**
 * 获取思维图快照（前端展示用）
 *
 * 返回完整思维图（节点列表）与最优节点 ID，
 * 前端可据此渲染图探索过程与高亮最优路径（含聚合边）。
 *
 * # 用途
 * - 执行中：展示当前探索进度（已生成多少节点、最大深度、聚合节点数）
 * - 执行后：高亮最优路径（从根节点到 bestNodeId 的路径，含聚合边）
 * - 调试：检查 GoT 是否按预期探索与聚合
 *
 * # 与 ToT getTree 的差异
 * `nodes` 数组元素的 `parents` 字段在聚合节点上非空（多个源节点 ID），
 * 前端可据此渲染图的聚合边（多 parent → 1 child）。
 *
 * # 注意
 * `nodes` 数组元素字段为 snake_case（`parent_id` / `score_reasoning` / `parents`），
 * 因为 Rust 端 `ThoughtNode` 未启用 `rename_all`。
 * UI 层使用时需通过 `toTsThoughtNode` 转换或直接访问 snake_case 字段。
 */
async function getTree(sessionId: string): Promise<RustGoTGraphSnapshot> {
  const snapshot = await invoke<RustGoTGraphSnapshot>('cmd_got_get_tree', { sessionId })
  const session = gotSessions.get(sessionId)
  if (session) {
    session.graphSnapshot = snapshot
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
 * 注册一个监听器，每次 Rust 端推送 `got:event:{sessionId}` 时调用。
 * 与 `useAgentRust.subscribe` / `useSupervisorRust.subscribe` /
 * `useRouterRust.subscribe` / `useToTRust.subscribe` 模式一致。
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
 * 生成 GoT 会话 ID
 *
 * 格式：`got_{timestamp}_{random}`，便于在日志与 UI 中识别。
 * 与 useAgentRust / useSupervisorRust / useRouterRust / useToTRust 的
 * sessionId 生成模式保持一致。
 */
function generateSessionId(): string {
  return `got_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue Composable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Graph of Thoughts 前端 composable
 *
 * 模块级单例，多次调用返回同一组状态与方法。
 *
 * # 使用示例
 * ```ts
 * const got = useGoTRust()
 *
 * // 创建 GoT（默认 Beam Search + LLM 评分 + LLM 目标检查 + LLM 聚合）
 * const sessionId = got.generateSessionId()
 * await got.create(sessionId, providerConfig, {
 *   config: {
 *     maxDepth: 5,
 *     maxThoughts: 50,
 *     beamWidth: 3,
 *     branchFactor: 3,
 *     scoreConvergenceThreshold: 5,
 *     requireSummary: true,
 *     checkGoalAtRoot: false,
 *     // GoT 聚合参数
 *     aggregationEnabled: true,
 *     aggregationThreshold: 70,
 *     maxAggregationSize: 3,
 *     aggregationBranchFactor: 1,
 *   },
 * })
 *
 * // 订阅事件（UI 更新）
 * const unsub = got.subscribe(sessionId, (event) => {
 *   if (event.type === 'thoughtNodeCreated') {
 *     console.log(`新思维 [depth=${event.depth}]: ${event.contentPreview}`)
 *   } else if (event.type === 'thoughtsAggregated') {
 *     console.log(`聚合 [depth=${event.depth}]: ${event.contentPreview}（源: ${event.sourceIds.join(',')}）`)
 *   } else if (event.type === 'totGoalReached') {
 *     console.log(`目标达成！score=${event.score}`)
 *   } else if (event.type === 'totTerminated') {
 *     console.log(`终止: ${event.reason}, 共 ${event.totalNodes} 节点`)
 *   }
 * })
 *
 * // 提交问题，触发思维图探索
 * const result = await got.run(sessionId, '如何降低碳排放？')
 * console.log('最优思维:', result.bestThought)
 * console.log('摘要:', result.summary)
 *
 * // 获取思维图快照（前端可视化用，含多 parent 关系）
 * const graph = await got.getTree(sessionId)
 * console.log(`共 ${graph.totalCount} 节点，最大深度 ${graph.maxDepthReached}`)
 * // 找出所有聚合节点（parents 非空）
 * const aggregationNodes = graph.nodes.filter((n) => n.parents.length > 0)
 * console.log(`聚合节点数: ${aggregationNodes.length}`)
 *
 * // 清理
 * unsub()
 * await got.destroy(sessionId)
 * ```
 */
export function useGoTRust() {
  return {
    // ─── 响应式状态（只读） ───
    /** 所有活跃 GoT 会话的状态映射（key = sessionId） */
    sessions: readonly(gotSessions),
    /** 计算属性：当前活跃会话数 */
    activeSessionCount: computed(() => gotSessions.size),
    /** 计算属性：所有正在运行的会话 */
    runningSessions: computed(() =>
      Array.from(gotSessions.values()).filter((s) => s.runStatus === 'running'),
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
    getSessionState: (sessionId: string): GoTSessionState | null =>
      gotSessions.get(sessionId) ?? null,
  }
}
