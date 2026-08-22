/** useMultiAgentRust：Multi-Agent 协作编排 Tauri 适配器（Rust-only，真实现），详细见 docs/details/注释/tauri/useMultiAgentRust.md
 *
 * 取代旧 Web stub：封装 `orchestrator_run_multi` 命令 + 监听 `agent:event:orch_multi:{session_id}` 实时事件。
 * 模块级单例维护 sessions Map（按会话隔离），MultiAgentStatusBar / MultiAgentPanel 只读消费。
 *
 * 事件通道 `orch_multi` 的 kind（snake_case：round_started / message_sent / blackboard_updated /
 * round_completed / converged）在此归一为 StatusBar 期望的 camelCase MultiAgentEvent type。
 */

import { ref } from 'vue'
import { listen, type UnlistenFn, invoke } from './transport'
import { useSessionViewState } from './useSessionViewState'

// ─── 类型（与后端 AgentSpec / SharedBlackboard / MultiAgentEvent 对齐）────────

/** Agent 角色（agent-runtime::AgentRole snake_case） */
export type RustAgentRole = 'coordinator' | 'worker' | 'critic' | 'researcher' | 'creative' | 'custom' | string

/** 协作 Agent 规格（对应 agent-runtime::multi_agent::AgentSpec，snake_case） */
export interface RustAgentSpec {
  /** Agent 唯一 ID（消息路由引用） */
  id: string
  /** 人类可读名称 */
  name: string
  /** 角色标签 */
  role: RustAgentRole
  /** 能力描述 */
  description: string
  /** 系统提示词（定义专长与行为边界） */
  system_prompt: string
  /** 工具白名单（None=继承全部工具） */
  tools_whitelist?: string[] | null
  /** 最大迭代次数（None=默认） */
  max_iterations?: number | null
  /** 初始消息（建议首个 Agent 配置以启动协作） */
  initial_message?: string | null
}

/** 拓扑结构（agent-runtime::Topology，tagged enum） */
export type RustTopology =
  | { kind: 'mesh' }
  | { kind: 'ring' }
  | { kind: 'star'; hubId: string }
  | { kind: 'pipeline' }
  | { kind: 'custom'; peers: Record<string, string[]> }

/** Multi-Agent 运行选项（对应 agent-commands::MultiAgentExecuteOptions，camelCase） */
export interface MultiAgentRunOptions {
  specs: RustAgentSpec[]
  maxRounds?: number
  topology?: RustTopology
  blackboardEnabled?: boolean
  requireSynthesis?: boolean
}

/** 共享黑板快照（agent-runtime::SharedBlackboard） */
export interface RustSharedBlackboard {
  task: string
  shared_context: Record<string, string>
  agent_outputs: Record<string, string[]>
  final_result?: string | null
  rounds_completed: number
}

/** Multi-Agent 实时事件（归一后；type 为 camelCase，与 MultiAgentStatusBar 期望一致） */
export interface MultiAgentEvent {
  type: string
  [key: string]: any
}

/** 单会话 Multi-Agent 状态 */
export interface MultiAgentSessionState {
  runStatus: 'idle' | 'running' | 'done' | 'aborted' | 'error'
  blackboardSnapshot: RustSharedBlackboard | null
  events: MultiAgentEvent[]
  /** 已完成轮次数 */
  roundsCompleted: number
  /** 当前轮次 */
  currentRound: number
  /** 本轮 Agent 数 */
  currentAgentCount: number
  messagesSent: number
  blackboardUpdates: number
  currentTask: string
  finalResult: string | null
  convergenceReason: string | null
  lastError: string | null
  errorAgentId: string | null
}

/** orch_multi 事件 payload（与 commands.rs emit_orch_multi 的 `{ kind, payload }` 对齐） */
interface MultiPayload {
  kind: string
  payload: {
    round?: number
    agentCount?: number
    from?: string
    to?: string
    messageType?: string
    contentPreview?: string
    key?: string
    by?: string
    outputs?: string[]
    reason?: string
    finalResult?: string
  }
}

// ─── 单例状态 ───────────────────────────────────────────────

const sessions = ref(new Map<string, MultiAgentSessionState>())
/** 监听器清理函数（按 sessionId 索引） */
const unlistenFns = new Map<string, UnlistenFn>()
/** 会话订阅回调（StatusBar 的 refreshTick 驱动；按 sessionId → Set<cb>） */
const subscribers = new Map<string, Set<() => void>>()

// ─── 事件处理（snake_case kind → camelCase MultiAgentEvent） ───

function newSessionState(task: string): MultiAgentSessionState {
  return {
    runStatus: 'running',
    blackboardSnapshot: null,
    events: [],
    roundsCompleted: 0,
    currentRound: 0,
    currentAgentCount: 0,
    messagesSent: 0,
    blackboardUpdates: 0,
    currentTask: task,
    finalResult: null,
    convergenceReason: null,
    lastError: null,
    errorAgentId: null,
  }
}

/** 归一 orch_multi 事件 kind → camelCase MultiAgentEvent type（并回写状态计数） */
function applyMultiEvent(sid: string, e: MultiPayload): void {
  const s = sessions.value.get(sid)
  if (!s) return
  const p = e.payload
  let evt: MultiAgentEvent
  switch (e.kind) {
    case 'round_started':
      s.currentRound = p.round ?? s.currentRound
      s.currentAgentCount = p.agentCount ?? s.currentAgentCount
      evt = { type: 'multiAgentRoundStarted', round: p.round, agentCount: p.agentCount }
      break
    case 'message_sent':
      s.messagesSent += 1
      evt = { type: 'multiAgentMessageSent', from: p.from, to: p.to, messageType: p.messageType, contentPreview: p.contentPreview }
      break
    case 'blackboard_updated':
      s.blackboardUpdates += 1
      evt = { type: 'multiAgentBlackboardUpdated', key: p.key, by: p.by }
      break
    case 'round_completed':
      s.roundsCompleted = p.round ?? s.roundsCompleted
      evt = { type: 'multiAgentRoundCompleted', round: p.round, outputs: p.outputs ?? [] }
      break
    case 'converged':
      s.finalResult = p.finalResult ?? null
      s.convergenceReason = p.reason ?? null
      s.runStatus = 'done'
      evt = { type: 'multiAgentConverged', reason: p.reason, finalResult: p.finalResult }
      break
    default:
      evt = { type: e.kind }
  }
  s.events.push(evt)
  // 通知该会话的订阅者（StatusBar refreshTick）
  subscribers.get(sid)?.forEach((cb) => cb())
  // 镜像精简摘要到会话视图状态（跨重启恢复徽标/轮次；完整事件流不持久化）
  syncSummary(sid)
}

/** 把该会话 Multi-Agent 摘要镜像到 useSessionViewState（防膨胀：仅轮次/收敛/消息数） */
function syncSummary(sid: string): void {
  const s = sessions.value.get(sid)
  if (!s) return
  useSessionViewState().setMultiSummary(sid, {
    rounds: s.roundsCompleted,
    converged: s.runStatus === 'done',
    messageCount: s.messagesSent,
  })
}

/** 为指定会话设置 orch_multi 事件监听（幂等） */
async function setupListener(sid: string): Promise<void> {
  if (!sid || unlistenFns.has(sid)) return
  const eventName = `agent:event:orch_multi:${sid}`
  try {
    const unlisten = await listen<MultiPayload>(eventName, (e) => {
      applyMultiEvent(sid, e.payload)
    })
    unlistenFns.set(sid, unlisten)
  } catch (err) {
    console.error(`[useMultiAgentRust] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话监听 */
function teardownListener(sid: string): void {
  const unlisten = unlistenFns.get(sid)
  if (unlisten) {
    unlisten()
    unlistenFns.delete(sid)
  }
}

// ─── 方法 ───────────────────────────────────────────────────

/** 生成 Multi-Agent 会话 ID（ma_{ts}_{rand}） */
function generateSessionId(): string {
  return `ma_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 创建会话状态（由父组件管理生命周期；先建状态 + 监听，再执行 run） */
async function create(
  sessionId: string,
  _specs: RustAgentSpec[],
  task: string,
): Promise<void> {
  sessions.value.set(sessionId, newSessionState(task))
  useSessionViewState().setMultiSummary(sessionId, null)
  await setupListener(sessionId)
}

/** 运行 Multi-Agent 协作编排（阻塞至收敛/完成；事件经 orch_multi 实时回传） */
async function run(
  sessionId: string,
  input: string,
  options: MultiAgentRunOptions,
): Promise<unknown> {
  const s = sessions.value.get(sessionId)
  if (!s) {
    sessions.value.set(sessionId, newSessionState(input))
    useSessionViewState().setMultiSummary(sessionId, null)
  }
  await setupListener(sessionId)
  try {
    const res = await invoke<{ finalMessage: string | null; error: string | null; finalState: Record<string, unknown> }>(
      'orchestrator_run_multi',
      { sessionId, input, options },
    )
    const st = sessions.value.get(sessionId)
    if (st) {
      // 已完成但未收到 converged 事件（事件通道竞态）：以结果回填终态
      if (res.error) {
        st.runStatus = 'error'
        st.lastError = res.error
      } else if (st.runStatus === 'running') {
        st.runStatus = 'done'
        st.finalResult = res.finalMessage
      }
    }
    return res
  } catch (err) {
    const st = sessions.value.get(sessionId)
    if (st) {
      st.runStatus = 'error'
      st.lastError = err instanceof Error ? err.message : String(err)
    }
    throw err
  }
}

/** 中断 Multi-Agent 协作（协作式：复用主 AgentLoop abort，节点内 is_aborted 检查生效） */
async function abort(sessionId: string): Promise<void> {
  await invoke('abort', { sessionId })
  const st = sessions.value.get(sessionId)
  if (st) {
    st.runStatus = 'aborted'
    st.events.push({ type: 'multiAgentAborted', sessionId })
  }
}

/** 黑板快照（事件流已含 blackboard_updated/round_completed.outputs；此处返回累积的黑板视角） */
async function getBlackboard(sessionId: string): Promise<RustSharedBlackboard> {
  const st = sessions.value.get(sessionId)
  return (
    st?.blackboardSnapshot ?? {
      task: st?.currentTask ?? '',
      shared_context: {},
      agent_outputs: {},
      rounds_completed: st?.roundsCompleted ?? 0,
    }
  )
}

/** 订阅会话事件（返回取消函数；事件到达时触发 cb 驱动 StatusBar computed 刷新） */
function subscribe(sessionId: string, cb: () => void): () => void {
  let set = subscribers.get(sessionId)
  if (!set) {
    set = new Set()
    subscribers.set(sessionId, set)
  }
  set.add(cb)
  return () => {
    set!.delete(cb)
    if (set!.size === 0) subscribers.delete(sessionId)
  }
}

/** 销毁会话状态 + 清理监听 */
async function destroy(sessionId: string): Promise<void> {
  teardownListener(sessionId)
  sessions.value.delete(sessionId)
  subscribers.delete(sessionId)
}

/** 清空所有会话（应用卸载时） */
function clearAll(): void {
  for (const sid of [...unlistenFns.keys()]) teardownListener(sid)
  sessions.value.clear()
  subscribers.clear()
}

// ─── 导出 ───────────────────────────────────────────────────

export function useMultiAgentRust() {
  return {
    sessions,
    create,
    run,
    destroy,
    generateSessionId,
    abort,
    getBlackboard,
    subscribe,
    clearAll,
  }
}