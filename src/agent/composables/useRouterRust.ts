/**
 * # useRouterRust — Router Pattern 的前端适配层
 *
 * 阶段 2.5（Router Pattern 批次3）新增。本文件桥接前端 Vue 层与
 * Rust 端 `agent_runtime::router::RouterNode`，通过 Tauri `invoke` + `listen` 通信。
 *
 * ## 职责
 *   1. 通过 Tauri 命令管理 Router 实例（create / run / abort / destroy / 等 8 个命令）
 *   2. 监听 `router:event:{sessionId}` 事件流，分发到订阅者
 *   3. 维护多个 Router 会话的响应式状态（决策结果、目标、错误）
 *   4. 提供 Reactive 视图（decidedTarget / runStatus / events）供 UI 组件使用
 *
 * ## 与 useSupervisorRust 的差异
 * - **纯决策节点**：Router 不执行子 Agent，只输出 `nextNodeId` 让 Orchestrator 调度
 * - **无 tool_bus / agent_pool**：因此无 `clearAgentPool` 命令，但有 `getTargets` 命令
 * - **事件种类更少**：只有 `RouterDecisionMade` / `RouterNoMatch` / `RouterError` 三种
 * - **路由策略可选**：LLM 决策（默认）或关键词匹配，前端通过 `strategy` 字段选择
 *
 * ## Tauri 命令映射
 * | TS 函数            | Rust 命令                       |
 * |--------------------|---------------------------------|
 * | `create`           | `cmd_router_create`             |
 * | `run`              | `cmd_router_run`                |
 * | `abort`            | `cmd_router_abort`              |
 * | `destroy`          | `cmd_router_destroy`            |
 * | `getState`         | `cmd_router_get_state`          |
 * | `setState`         | `cmd_router_set_state`          |
 * | `listSessions`     | `cmd_router_list_sessions`      |
 * | `getTargets`       | `cmd_router_get_targets`        |
 *
 * ## 事件命名约定
 * - 事件名：`router:event:{sessionId}`（与 `agent:event:*` / `supervisor:event:*` 并列）
 * - Payload 字段：snake_case（Rust 端 `RouterEventPayload` 未启用 `rename_all = "camelCase"`）
 *   - `session_id` / `node_id` / `target_id` / `target_name` / `reason`
 *   - `is_fallback` / `input_sample` / `stage` / `error`
 * - 变体 tag：snake_case（如 `router_decision_made` / `router_no_match` / `router_error`）
 *
 * ## ProviderConfig 字段命名
 * 与 `useAgentRust` / `useSupervisorRust` 一致：Rust 端 `ProviderConfig` 字段为 snake_case
 * （`model_id` / `base_url` / `api_key` / `api_type` / `context_window` / `max_tokens`），
 * 因此前端传入时用 snake_case。
 *
 * ## 多会话并发
 * 模块级 `routerSessions` Map 支持多个 Router 会话并发。
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
 * Rust `agent_runtime::router::RouteTarget` 的前端镜像
 *
 * Rust 端 `RouteTarget` 未启用 `rename_all`，字段保持 snake_case。
 * 前端调用 `cmd_router_create` 时，`targets` 数组用此类型。
 */
export interface RustRouteTarget {
  /** 路由目标唯一 ID（对应 Orchestrator 图中下一节点的 id） */
  id: string
  /** 人类可读名称（用于日志/UI 展示） */
  name: string
  /** 能力描述（供 LLM 策略进行意图分类时参考） */
  description: string
  /** 关键词列表（供 KeywordRoutingStrategy 匹配；LLM 策略不使用此字段） */
  keywords?: string[]
}

/**
 * Rust `commands::router::StrategyKind` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "lowercase")]` → 前端 lowercase 字符串字面量。
 */
export type RustStrategyKind = 'llm' | 'keyword'

/**
 * Rust `commands::router::RoutingPromptTemplateOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 */
export interface RustRoutingPromptTemplateOptions {
  /** 系统提示词 */
  system: string
  /** 用户提示词模板（支持 `{input}` 和 `{targets}` 占位符） */
  userTemplate: string
}

/**
 * Rust `commands::router::CreateRouterOptions` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 * 所有字段可选，未提供者使用 Rust 端默认值。
 */
export interface RustCreateRouterOptions {
  /** 路由策略（默认 'llm'） */
  strategy?: RustStrategyKind
  /**
   * Fallback 目标 ID（无匹配时路由到此目标）
   * - 提供：无匹配时走 fallback，触发 `RouterDecisionMade { isFallback: true }`
   * - 不提供：无匹配时触发 `RouterNoMatch` 事件并返回错误
   */
  fallbackTargetId?: string
  /** 自定义 LLM 路由提示词模板（仅 strategy='llm' 时生效） */
  promptTemplate?: RustRoutingPromptTemplateOptions
}

/**
 * Rust `commands::router::RouterRunResult` 的前端镜像
 *
 * Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase。
 */
export interface RustRouterRunResult {
  /** 节点执行状态：continue / done / aborted / error */
  status: string
  /** 下一节点 ID（Router 决策结果，供 Orchestrator 调度下一节点） */
  nextNodeId?: string
  /** 错误信息（status=error 时） */
  error?: string
  /** 摘要（如 "Router: 已路由到 '代码专家' 分支"） */
  summary?: string
}

/**
 * Rust `agent_runtime::types::OrchestratorState` 的前端镜像
 *
 * Rust 端未启用 `rename_all = "camelCase"`，字段保持 snake_case。
 * 与 useSupervisorRust 中的 RustOrchestratorState 结构一致，
 * 但作为独立类型避免跨模块依赖。
 */
export interface RustRouterOrchestratorState {
  /** 用户原始输入 */
  input: string
  /** 编排消息列表 */
  messages: RustRouterOrchestratorMessage[]
  /** 扩展字段（节点自定义数据） */
  extra: Record<string, unknown>
}

/** Rust `OrchestratorMessage` 的前端镜像（snake_case 字段） */
export interface RustRouterOrchestratorMessage {
  /** 角色 */
  role: 'user' | 'assistant' | 'tool_result' | 'system'
  /** 消息内容 */
  content: string
  /** 元数据（可选） */
  metadata?: Record<string, unknown>
}

// ─── Rust 端事件 Payload 镜像 ────────────────────────────────────────────

/**
 * Rust `commands::router::RouterEventPayload` 的前端镜像
 *
 * **重要**：字段为 **snake_case**！
 *
 * 原因：Rust 端 `RouterEventPayload` 只对变体名用 `rename_all = "snake_case"`
 * （生成 `router_decision_made` 等 tag），变体内部字段保持 snake_case
 * （`session_id` / `node_id` / `target_id` 等）。
 *
 * 与 `RustSupervisorEventPayload` 命名约定一致：编排层级事件保持 snake_case，
 * 不与流式 message 事件（启用 camelCase）混淆。
 */
export type RustRouterEventPayload =
  | {
      type: 'router_decision_made'
      session_id: string
      node_id: string
      target_id: string
      target_name: string
      reason?: string
      /** 是否走了 fallback（true 表示无匹配后走了 fallback_target_id） */
      is_fallback: boolean
    }
  | {
      type: 'router_no_match'
      session_id: string
      node_id: string
      /** 输入摘要（前 100 字符） */
      input_sample: string
    }
  | {
      type: 'router_error'
      session_id: string
      node_id: string
      /** 错误阶段（"route" / "target_lookup" / "fallback_lookup"） */
      stage: string
      error: string
    }

// ─── TS 端事件类型（camelCase，UI 友好） ────────────────────────────────────────────

/**
 * TS 端 Router 事件（camelCase，UI 友好）
 *
 * 由 `rustEventToTsEvent` 从 `RustRouterEventPayload` 转换而来，
 * 供 UI 组件订阅。事件名采用 camelCase 与 TS 项目惯例一致。
 */
export type RouterEvent =
  | {
      type: 'routerDecisionMade'
      sessionId: string
      nodeId: string
      targetId: string
      targetName: string
      reason?: string
      /** 是否走了 fallback */
      isFallback: boolean
    }
  | {
      type: 'routerNoMatch'
      sessionId: string
      nodeId: string
      /** 输入摘要（前 100 字符） */
      inputSample: string
    }
  | {
      type: 'routerError'
      sessionId: string
      nodeId: string
      /** 错误阶段（"route" / "target_lookup" / "fallback_lookup"） */
      stage: string
      error: string
    }

/** Rust payload → TS event 转换 */
function rustEventToTsEvent(payload: RustRouterEventPayload): RouterEvent {
  switch (payload.type) {
    case 'router_decision_made':
      return {
        type: 'routerDecisionMade',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        targetId: payload.target_id,
        targetName: payload.target_name,
        reason: payload.reason,
        isFallback: payload.is_fallback,
      }
    case 'router_no_match':
      return {
        type: 'routerNoMatch',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        inputSample: payload.input_sample,
      }
    case 'router_error':
      return {
        type: 'routerError',
        sessionId: payload.session_id,
        nodeId: payload.node_id,
        stage: payload.stage,
        error: payload.error,
      }
  }
}

// ─── 会话级状态 ────────────────────────────────────────────

/**
 * 单个 Router 会话的响应式状态
 *
 * 镜像 Rust 端 `OrchestratorState` 的关键信息 + 路由决策进度。
 * UI 组件通过 `routerSessions.get(sessionId)` 读取并渲染。
 */
export interface RouterSessionState {
  /** 会话 ID */
  sessionId: string
  /** 当前输入文本（最近一次 run 的 task） */
  currentTask: string
  /** 运行状态：idle / running / done / aborted / error */
  runStatus: 'idle' | 'running' | 'done' | 'aborted' | 'error'
  /** 最近一次 run 的结果（run 完成后填充） */
  lastResult: RustRouterRunResult | null
  /** 最近一次错误信息（runStatus=error 时） */
  lastError: string | null
  /** 路由决策完成：选中的目标 ID（routerDecisionMade 时填充） */
  decidedTargetId: string | null
  /** 路由决策完成：选中的目标名称 */
  decidedTargetName: string | null
  /** 路由决策理由（LLM 策略可能填充） */
  decisionReason: string | null
  /** 是否走了 fallback（true 表示无匹配后走了 fallbackTargetId） */
  isFallback: boolean
  /** 无匹配输入摘要（routerNoMatch 时填充） */
  noMatchInputSample: string | null
  /** 错误阶段（routerError 时填充，如 "route" / "target_lookup" / "fallback_lookup"） */
  errorStage: string | null
  /** 事件历史（最多保留 100 条，按时间顺序） */
  events: RouterEvent[]
  /** Rust 端 OrchestratorState 快照（getState 时填充） */
  stateSnapshot: RustRouterOrchestratorState | null
  /** 路由目标列表快照（getTargets 时填充，便于 UI 展示分支配置） */
  targetsSnapshot: RustRouteTarget[] | null
}

/** 创建初始会话状态 */
function createInitialSessionState(sessionId: string): RouterSessionState {
  return {
    sessionId,
    currentTask: '',
    runStatus: 'idle',
    lastResult: null,
    lastError: null,
    decidedTargetId: null,
    decidedTargetName: null,
    decisionReason: null,
    isFallback: false,
    noMatchInputSample: null,
    errorStage: null,
    events: [],
    stateSnapshot: null,
    targetsSnapshot: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 模块级单例状态（与 useAgentRust / useSupervisorRust 一致：模块级单例）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 所有活跃 Router 会话的响应式状态映射
 *
 * key = sessionId，value = RouterSessionState（reactive）
 * UI 通过 `routerSessions.get(sessionId)` 读取状态。
 */
const routerSessions = shallowReactive<Map<string, RouterSessionState>>(new Map())

/** 事件监听器清理函数映射 */
const unlistenFns = new Map<string, UnlistenFn>()

/** 用户订阅者集合（每会话独立；subscribe 时注册，unsubscribe 或 destroy 时清理） */
type SessionEventListener = (event: RouterEvent) => void
const sessionListeners = new Map<string, Set<SessionEventListener>>()

/** 会话创建时间戳（用于 listSessions 排序） */
const sessionCreatedAt = new Map<string, number>()

// ─── 事件监听器设置 ────────────────────────────────────────────

/**
 * 为指定会话设置事件监听器
 *
 * 监听 `router:event:{sessionId}` 事件，收到 Rust payload 后：
 * 1. 转换为 TS 事件（camelCase）
 * 2. 更新模块级响应式状态（routerSessions）
 * 3. 分发给所有订阅者
 *
 * 幂等：若已存在监听器，直接返回（避免重复监听）。
 */
async function setupEventListener(sessionId: string): Promise<void> {
  if (unlistenFns.has(sessionId)) return

  const eventName = `router:event:${sessionId}`
  try {
    const unlisten = await listen<RustRouterEventPayload>(eventName, (e) => {
      const tsEvent = rustEventToTsEvent(e.payload)
      handleSessionEvent(sessionId, tsEvent)
    })
    unlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useRouterRust] listen ${eventName} 失败:`, err)
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
 * 1. 更新 `routerSessions` 中的会话状态
 * 2. 限制 `events` 历史最多 100 条（FIFO）
 * 3. 分发给所有订阅者
 */
function handleSessionEvent(sessionId: string, event: RouterEvent): void {
  const session = routerSessions.get(sessionId)
  if (session) {
    // 更新会话状态
    switch (event.type) {
      case 'routerDecisionMade':
        session.decidedTargetId = event.targetId
        session.decidedTargetName = event.targetName
        session.decisionReason = event.reason ?? null
        session.isFallback = event.isFallback
        session.runStatus = 'done'
        session.lastError = null
        session.noMatchInputSample = null
        session.errorStage = null
        break
      case 'routerNoMatch':
        session.noMatchInputSample = event.inputSample
        session.runStatus = 'error'
        session.lastError = `无匹配路由（输入: ${event.inputSample}）`
        session.decidedTargetId = null
        session.decidedTargetName = null
        session.decisionReason = null
        session.isFallback = false
        break
      case 'routerError':
        session.runStatus = 'error'
        session.lastError = `[${event.stage}] ${event.error}`
        session.errorStage = event.stage
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
        console.warn(`[useRouterRust] 会话 ${sessionId} 订阅者异常:`, err)
      }
    }
  }
}

// ─── Tauri 命令封装 ────────────────────────────────────────────

/**
 * 创建 Router 实例并注册到 Rust 端 registry
 *
 * # 参数
 * - `sessionId`：会话 ID（前端生成，建议前缀 `router_`）
 * - `providerConfig`：LLM Provider 配置（snake_case 字段，用于 LLM 路由决策）
 * - `targets`：路由目标列表（snake_case 字段）
 * - `options`：可选 Router 配置（camelCase 字段）
 *
 * # 行为
 * 1. 调用 `cmd_router_create` 在 Rust 端创建 RouterNode
 * 2. 创建前端响应式会话状态并加入 `routerSessions`
 * 3. 设置事件监听器
 *
 * # 错误
 * 抛出 Rust 端返回的 `RouterRegistryError`（已序列化为 JS 对象）。
 */
async function create(
  sessionId: string,
  providerConfig: RustProviderConfig,
  targets: RustRouteTarget[],
  options?: RustCreateRouterOptions,
): Promise<void> {
  console.log(
    `[useRouterRust] 创建 router session=${sessionId} targets=${targets.length} strategy=${options?.strategy ?? 'llm'}`,
  )

  await invoke('cmd_router_create', {
    sessionId,
    providerConfig,
    targets,
    options: options ?? null,
  })

  // 创建前端响应式状态
  const sessionState = reactive(createInitialSessionState(sessionId))
  // 缓存路由目标列表（前端已知，无需再调 getTargets）
  sessionState.targetsSnapshot = targets
  routerSessions.set(sessionId, sessionState)
  sessionCreatedAt.set(sessionId, Date.now())

  // 设置事件监听器
  await setupEventListener(sessionId)
}

/**
 * 提交输入并执行路由决策
 *
 * # 参数
 * - `sessionId`：会话 ID
 * - `task`：用户输入文本（路由决策的依据）
 *
 * # 行为
 * 1. 更新前端状态：`currentTask = task`、`runStatus = 'running'`
 * 2. 调用 `cmd_router_run`，Rust 端执行路由策略（LLM 决策或关键词匹配）
 * 3. 期间通过事件流推送 `routerDecisionMade` / `routerNoMatch` / `routerError`
 * 4. 返回 `RustRouterRunResult`（含 status / nextNodeId / summary / error）
 *
 * # 注意
 * 此方法是阻塞式的（await Rust 端 execute 完成）。
 * 事件监听器在 await 期间持续接收并更新状态。
 * 调用方可以选择不 await，通过订阅事件获取进度。
 */
async function run(sessionId: string, task: string): Promise<RustRouterRunResult> {
  const session = routerSessions.get(sessionId)
  if (!session) {
    throw new Error(`[useRouterRust] 会话不存在: ${sessionId}`)
  }

  // 重置运行状态
  session.currentTask = task
  session.runStatus = 'running'
  session.lastError = null
  session.lastResult = null
  session.decidedTargetId = null
  session.decidedTargetName = null
  session.decisionReason = null
  session.isFallback = false
  session.noMatchInputSample = null
  session.errorStage = null

  try {
    const result = await invoke<RustRouterRunResult>('cmd_router_run', {
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
    } else if (result.status === 'continue' && session.runStatus === 'running') {
      // 兜底：若 routerDecisionMade 事件未触发，根据 result.status=continue 推断 done
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
 * 设置 Rust 端 `abort_flag = true`，RouterNode 在中断检查点命中并返回 `aborted`。
 * 中断是**协作式**的：依赖 RouterNode 主动检查 `ctx.is_aborted()`。
 * RouterNode 仅在路由决策前检查一次，若已开始 LLM 调用，需等 LLM 返回后才能命中。
 */
async function abort(sessionId: string): Promise<void> {
  await invoke('cmd_router_abort', { sessionId })
  const session = routerSessions.get(sessionId)
  if (session && session.runStatus === 'running') {
    session.runStatus = 'aborted'
  }
  console.log(`[useRouterRust] 中断 router session=${sessionId}`)
}

/**
 * 销毁 Router 实例
 *
 * 1. 调用 `cmd_router_destroy`：Rust 端移除注册
 * 2. 清理前端事件监听器
 * 3. 从 `routerSessions` 移除
 * 4. 清理订阅者集合
 */
async function destroy(sessionId: string): Promise<void> {
  try {
    await invoke('cmd_router_destroy', { sessionId })
  } catch (err) {
    console.warn(`[useRouterRust] destroy 调用失败（继续清理前端状态）:`, err)
  }

  // 清理前端状态
  teardownEventListener(sessionId)
  routerSessions.delete(sessionId)
  sessionCreatedAt.delete(sessionId)
  sessionListeners.delete(sessionId)
  console.log(`[useRouterRust] 销毁 router session=${sessionId}`)
}

/**
 * 获取共享 OrchestratorState 快照
 *
 * 返回 Rust 端 `Arc<RwLock<OrchestratorState>>` 的克隆并序列化。
 * 前端可用于展示当前输入、消息历史。
 */
async function getState(sessionId: string): Promise<RustRouterOrchestratorState> {
  const state = await invoke<RustRouterOrchestratorState>('cmd_router_get_state', { sessionId })
  // 缓存到会话状态
  const session = routerSessions.get(sessionId)
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
async function setState(sessionId: string, newState: RustRouterOrchestratorState): Promise<void> {
  await invoke('cmd_router_set_state', { sessionId, newState })
  const session = routerSessions.get(sessionId)
  if (session) {
    session.stateSnapshot = newState
  }
}

/**
 * 列出所有已注册的 Router session_id
 *
 * 返回 Rust 端 `RouterRegistry::list()` 的结果。
 * 与前端 `routerSessions` 的 key 应保持一致（差异表明状态不同步）。
 */
async function listSessions(): Promise<string[]> {
  return await invoke<string[]>('cmd_router_list_sessions')
}

/**
 * 获取路由目标列表（前端展示用）
 *
 * 返回 RouterNode 配置的所有路由目标，前端可用于：
 * - 展示当前 Router 的分支配置
 * - 验证 target_id 是否在候选列表中
 * - 在 Orchestrator 图中绘制 Router → 各分支节点的连线
 *
 * 通常 `create` 时已缓存 `targetsSnapshot`，此命令用于：
 * - 创建后目标列表被 Rust 端修改（理论上不会发生）
 * - 缓存丢失（如页面刷新后仅重建了监听器）
 */
async function getTargets(sessionId: string): Promise<RustRouteTarget[]> {
  const targets = await invoke<RustRouteTarget[]>('cmd_router_get_targets', { sessionId })
  const session = routerSessions.get(sessionId)
  if (session) {
    session.targetsSnapshot = targets
  }
  return targets
}

// ─── 事件订阅 ────────────────────────────────────────────

/**
 * 订阅指定会话的事件
 *
 * 注册一个监听器，每次 Rust 端推送 `router:event:{sessionId}` 时调用。
 * 与 `useAgentRust.subscribe` / `useSupervisorRust.subscribe` 模式一致。
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
 * 生成 Router 会话 ID
 *
 * 格式：`router_{timestamp}_{random}`，便于在日志与 UI 中识别。
 * 与 useAgentRust / useSupervisorRust 的 sessionId 生成模式保持一致。
 */
function generateSessionId(): string {
  return `router_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue Composable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Router Pattern 前端 composable
 *
 * 模块级单例，多次调用返回同一组状态与方法。
 *
 * # 使用示例
 * ```ts
 * const router = useRouterRust()
 *
 * // 创建 Router（含 2 个分支：代码专家 + 文档专家）
 * const sessionId = router.generateSessionId()
 * await router.create(sessionId, providerConfig, [
 *   {
 *     id: 'coder',
 *     name: '代码专家',
 *     description: '处理代码编写、调试、重构任务',
 *     keywords: ['代码', '函数', 'bug', '重构'],
 *   },
 *   {
 *     id: 'writer',
 *     name: '文档专家',
 *     description: '处理文档撰写、翻译、润色任务',
 *     keywords: ['文档', '翻译', '润色'],
 *   },
 * ], {
 *   strategy: 'llm', // 默认 LLM 决策，可选 'keyword' 关键词匹配
 *   fallbackTargetId: 'writer', // 无匹配时走文档专家
 * })
 *
 * // 订阅事件（UI 更新）
 * const unsub = router.subscribe(sessionId, (event) => {
 *   if (event.type === 'routerDecisionMade') {
 *     console.log(`路由到 ${event.targetName}（fallback=${event.isFallback}）`)
 *   } else if (event.type === 'routerNoMatch') {
 *     console.warn('无匹配路由，输入:', event.inputSample)
 *   }
 * })
 *
 * // 提交输入，获取路由决策
 * const result = await router.run(sessionId, '帮我写一个排序函数')
 * console.log('路由结果:', result.nextNodeId) // 'coder'
 * console.log('摘要:', result.summary)
 *
 * // 清理
 * unsub()
 * await router.destroy(sessionId)
 * ```
 */
export function useRouterRust() {
  return {
    // ─── 响应式状态（只读） ───
    /** 所有活跃 Router 会话的状态映射（key = sessionId） */
    sessions: readonly(routerSessions),
    /** 计算属性：当前活跃会话数 */
    activeSessionCount: computed(() => routerSessions.size),
    /** 计算属性：所有正在运行的会话 */
    runningSessions: computed(() =>
      Array.from(routerSessions.values()).filter((s) => s.runStatus === 'running'),
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
    getTargets,

    // ─── 事件订阅 ───
    subscribe,

    // ─── 工具 ───
    generateSessionId,

    // ─── 内部状态访问（调试用） ───
    /** 获取指定会话的状态（只读视图；不存在返回 null） */
    getSessionState: (sessionId: string): RouterSessionState | null =>
      routerSessions.get(sessionId) ?? null,
  }
}
