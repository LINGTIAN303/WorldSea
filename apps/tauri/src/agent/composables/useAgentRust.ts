/** useAgentRust：Tauri 端 Agent Backend 适配器（Rust IPC + 事件转发），详细见 docs/details/注释/tauri/useAgentRust.md */

// re-export 共享类型（与 Web 端 useAgent 一致，供依赖这些类型的组件使用）
export type {
  ChatMode,
  InteractiveToolType,
  ToolCallView,
  PhaseOutput,
  DeepSegment,
  AgentStreamItem,
} from '@worldsmith/shared-composables/agent/useAgent'

// re-export 注入工具（供需要 provide/inject 的组件使用）
export {
  provideAgentBackend,
  useAgentOptional,
  AGENT_BACKEND_INJECTION_KEY,
} from '@worldsmith/shared-composables/agent/useAgent'

import { ref, computed, readonly } from 'vue'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn, isHttpBackend, invokeRpc } from './transport'
import { useConfirm } from '@worldsmith/ui-kit'
import { useOrchEvents } from './useOrchEvents'
import { ALL_TOOLS_MAP, loadApiKey, type IToolContext } from '@agent/index'
// H3 Skills 点火（P1，2026-08-30）：技能索引注入 + 已安装技能扫描合并
import { buildSkillIndexPrompt, initSkillRegistry } from '@agent/skills/registry'
import { useEntityStore, useRelationStore, useFileStore } from '@worldsmith/entity-core'
import { useSettingsStore } from '@/stores/settingsStore'
import type {
  AgentMessage,
  AgentEvent,
  AgentEventListener,
  ImageAttachment,
  FileAttachment,
  ThinkingLevel,
  ChatMode,
  PromptOptions,
  A2UIMessage,
  MCPConnectionConfig,
  MCPConnectionState,
} from '@agent/index'
import type { DeepSegment, AgentStreamItem } from '@worldsmith/shared-composables/agent/useAgent'
import { usePlanStore } from '@worldsmith/shared-composables/agent/usePlanStore'
// 轮次模型：回源重建与实时流共用同一套归约规则
import {
  rebuildFromMessages,
  flattenTurn,
  reduceEvent,
  parseToolResult,
  type FlatRow,
  type Turn,
  type TurnEvent,
} from '@worldsmith/shared-composables/agent/turnModel'
import { useActivityLog, type ActivityLogEntry } from './useActivityLog'
import { useSessionViewState, LAST_SESSION_KEY } from './useSessionViewState'
import { useOrchestrationTrace } from './useOrchestrationTrace'
import { resolveWorkspaceDir, ensureWorkspaceDir } from '@/space/workspace'

// ToT/GoT/Supervisor 实时事件监听：模块级单例解构（供会话生命周期注册/清理）
const { setupOrchListener, teardownOrchListener, setupOrchSupervisorListener, teardownOrchSupervisorListener } = useOrchEvents()
// M2 编排迹线（NIT-3 双轨收口）：监听并入 useAgentRust 会话生命周期统一管理，
// 组件仅消费状态（单一状态源），不再各自实例化监听。
const { activeRun, finishedRuns, resetOrchestrationTrace, setupOrchestrationTraceListener, teardownOrchestrationTraceListener } = useOrchestrationTrace()

// ── 浏览器 preview 兼容：非 Tauri 环境（window.__TAURI_INTERNALS__ 缺失）下
//    @tauri-apps/api/core 的 invoke 为 undefined。这里用 safeInvoke 兜底，
//    使纯浏览器（vite dev）能展示 UI（如场景下拉），真实功能需 Tauri 桌面运行。
const isTauriRuntime = (): boolean =>
  !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__

/** 浏览器 preview 的命令 mock（仅非 Tauri 环境生效） */
function mockInvoke(cmd: string): unknown {
  switch (cmd) {
    case 'list_scenarios':
      return [{ id: 'worldbuilding', display_name: '世界构建' }]
    case 'new_session':
      return { id: `mock-session-${Date.now()}` }
    case 'list_sessions':
      return []
    case 'cmd_agent_generate_title':
      // 浏览器 preview：生成标题命令返回占位「新会话」，不触发真实 LLM
      return '新会话'
    default:
      // 无法桥接 Rust 的命令返回空对象，避免调用方因 undefined 崩溃
      return {}
  }
}

/** 安全 invoke：Tauri 环境走真实 IPC；浏览器 preview 走 mock；配置了 HTTP 后端时走 RPC（[HTTP-BRIDGE]） */
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // [HTTP-BRIDGE] 临时：浏览器直连真实后端
  if (isHttpBackend()) return invokeRpc<T>(cmd, args)
  if (!isTauriRuntime()) {
    return Promise.resolve(mockInvoke(cmd) as unknown as T)
  }
  return tauriInvoke<T>(cmd, args)
}

// ─── Rust DeepPhaseChanged 事件 Payload ──────────────────────────────
interface RustDeepPhaseChangedPayload {
  phaseLabel: string
  phaseIndex: number
  triggerTool: string
  /** 触发工具执行状态（running/completed/failed），自 Rust ToolStatus 序列化 */
  toolStatus: 'running' | 'completed' | 'failed'
  /** 阶段完成标记（true=已完成，false=进行中） */
  phaseCompleted: boolean
}

// ─── Rust 子 Agent 委派事件 Payload ──────────────────────────────
// 子 Agent 委派事件协议说明（通道/事件类型），详细见 docs/details/注释/tauri/useAgentRust.md

/** 子 Agent 委派开始事件 */
interface RustSubAgentStartedPayload {
  type: 'start'
  subAgentId: string
  subAgentName: string
  taskDescription: string
}

/** 子 Agent 委派完成事件 */
interface RustSubAgentCompletedPayload {
  type: 'completed'
  subAgentId: string
  subAgentName: string
  outputChars: number
  durationMs: number
}

/** 子 Agent 委派失败 / 超时事件 */
interface RustSubAgentErrorPayload {
  type: 'error'
  subAgentId: string
  subAgentName: string
  error: string
}

/** 子 Agent 委派事件 payload 联合类型 */
type RustSubAgentPayload =
  | RustSubAgentStartedPayload
  | RustSubAgentCompletedPayload
  | RustSubAgentErrorPayload

// ─── Rust 流式响应事件 Payload ──────────────────────────────
// 流式事件协议说明（通道/事件类型），详细见 docs/details/注释/tauri/useAgentRust.md

/** Rust 流式响应事件 payload 联合类型 */
type RustStreamPayload =
  | { type: 'start'; model: string }
  | { type: 'delta'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'end'; fullText: string }
  | { type: 'tool_call_start'; toolCallId: string; name: string; args: unknown }
  | {
      type: 'tool_call_end'
      toolCallId: string
      result: unknown
      /** H7 P0.5：顶层权威成败（"success"/"failed"）；缺失时回退 parseToolResult 推断 */
      status?: string
      /** H7 P0.5：执行耗时（毫秒） */
      durationMs?: number
      /** H7 P0.5：失败错误摘要 */
      error?: string
    }
  | { type: 'error'; message: string }
  | { type: 'agent_end' }

// ─── Rust 端类型镜像（snake_case，与 agent-runtime 序列化一致）──────────────

/** Rust `agent_commands::SessionInfo` 镜像 */
interface RustSessionInfo {
  id: string
  created_at: number
  message_count: number
  title: string
  pinned: boolean
  /** 会话绑定的工作区根目录（Phase 4 接入本地文件系统；None=不限定） */
  workdir?: string
  /** 会话归属项目 id（任务29/D1 锚点；null=旧数据/未归属） */
  project_id?: string | null
}

/** Rust `agent_commands::WorkdirRecord` 镜像（目录实体，camelCase；Phase 3 会话树分组用） */
export interface RustWorkdirRecord {
  id: string
  path: string
  label: string
  createdAt: number
}

/** Rust `agent_runtime::types::OrchestratorMessage` 镜像 */
interface RustMessage {
  // R14：实际序列化值为 serde lowercase "toolresult"（非 snake_case）
  role: 'user' | 'assistant' | 'tool_result' | 'toolresult' | 'system'
  content: string
  tool_calls?: Array<{ id: string; name: string; args: unknown }>
  tool_call_id?: string
  meta?: Record<string, unknown>
}

/** Rust `agent_runtime::agent::AgentStateSnapshot` 镜像 */
interface RustStateSnapshot {
  current_iteration: number
  aborted: boolean
  paused: boolean
  is_streaming: boolean
  messages: RustMessage[]
  model: string
  thinking_level: string | null
  /** A4 Plan-Exec：当前任务计划（null=无计划） */
  plan: RustPlanItem[] | null
}

/** Rust `PlanItem` 镜像（snake_case 字段，与 plan_commands/PlanCreated 一致） */
interface RustPlanItem {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
  description?: string | null
  order: number
  output?: string | null
}

/** Rust `agent_commands::SendMessageResult` 镜像 */
interface RustSendMessageResult {
  session_id: string
  reply: string
  state: RustStateSnapshot
  usage?: { input_tokens: number; output_tokens: number }
}

/** Rust `agent_commands::ProviderConfig` 镜像 */
interface RustProviderConfig {
  provider: string
  model: string
  base_url: string | null
}

/** Rust `agent_runtime::llm::config::LocalApiType` 镜像（kebab-case） */
type RustLocalApiType = 'ollama' | 'lm-studio' | 'vllm' | 'llama-cpp'

/** Rust `agent_runtime::llm::config::CustomApiType` 镜像（kebab-case） */
type RustCustomApiType = 'openai-compatible' | 'anthropic-compatible'

/** Rust ProviderConfig 镜像（tagged enum：cloud/local/custom 三模式），详细见 docs/details/注释/tauri/useAgentRust.md */
interface RustProviderConfigFull {
  mode: 'cloud' | 'local' | 'custom'
  /** cloud：供应商 ID（如 "deepseek"） */
  provider?: string
  /** cloud/custom：模型 ID */
  model_id?: string
  /** cloud/custom：API Key（运行时注入，反序列化必需） */
  api_key?: string
  /** local：端点 URL（如 "http://localhost:11434"） */
  endpoint?: string
  /** local/custom：API 类型 */
  api_type?: RustLocalApiType | RustCustomApiType
  /** custom：Base URL */
  base_url?: string
  /** custom：上下文窗口大小（默认 1048576） */
  context_window?: number
  /** custom：最大输出 token（默认 65536） */
  max_tokens?: number
}

/** Rust `agent_runtime::long_task::HeartbeatStatus` 镜像 */
type RustHeartbeatStatus = 'alive' | 'stale' | 'dead'

/**
 * Rust `OrchestratorMessage` → TS `AgentMessage`
 *
 * 字段映射：
 * - role：`tool_result`/`toolresult` → `toolResult`（TS 约定；R14 补 serde lowercase 实际值）
 * - 补充 `id` / `timestamp`（Rust 端无此字段，前端生成）
 * - tool_calls → toolCalls（camelCase）
 */
function rustMsgToTsMsg(r: RustMessage, index: number): AgentMessage {
  return {
    id: `rust-${Date.now()}-${index}`,
    role: r.role === 'tool_result' || r.role === 'toolresult' ? 'toolResult' : r.role,
    content: r.content,
    timestamp: Date.now(),
    toolCalls: r.tool_calls?.map((tc, i) => ({
      id: tc.id || `tc-${index}-${i}`,
      name: tc.name,
      args: tc.args as Record<string, unknown>,
      status: 'completed',
      startedAt: Date.now(),
    })),
    metadata: r.meta,
  }
}

// ─── 模块级单例状态（与 useLongTaskRust 一致）──────────────────────────────

/** 全局单调计数器：保证 `${prefix}-{ts}-{seq}` 唯一，避免同毫秒内相邻消息 id 碰撞触发 Vue 重复 key 警告 */
let msgIdSeq = 0

/** 生成全局唯一消息 id（前缀 + 时间戳 + 单调序号，杜绝同毫秒碰撞） */
function nextMsgId(prefix: string): string {
  msgIdSeq += 1
  return `${prefix}-${Date.now()}-${msgIdSeq}`
}

/** 生成助手消息 id（沿用事件流 id 语义，片段真实唯一） */
function nextAssistantId(): string {
  return nextMsgId('assistant')
}

/** 当前会话 ID（null=尚未创建会话） */
const currentSessionId = ref<string | null>(null)
/** L3 懒创建：草稿态标志——点「+ 会话」进入（currentSessionId=null），
 *  首条消息 newSession 或切换会话时清除。供自动恢复逻辑（restoreLastSession /
 *  SessionSidebar.refresh）识别草稿态并跳过「无会话自动切回」，否则 draft 被瞬间覆盖。 */
const draftSessionActive = ref(false)
/** 当前会话绑定的工作区根目录（Phase 4 接入本地文件系统；供 WorkspacePanel 展示） */
const currentWorkdir = ref<string | null>(null)
/** 当前会话消息列表 */
const messages = ref<AgentMessage[]>([])
/** 是否正在流式输出 */
const isStreaming = ref(false)
/** 会话列表（listSessions 结果） */
const sessionList = ref<RustSessionInfo[]>([])
/** 待激活会话 id（Phase 5：newSession 后延迟展示，首条消息发送成功后才移除并展示条目） */
const pendingSessionIds = ref<string[]>([])
/** 首条消息后、LLM 标题生成完成前置 true（消息区展示等候动画；标题事件落地后清除对应会话）。
 *  按会话隔离（key=sessionId）：避免切会话后动画串扰到其他会话。 */
const sessionTitlePending = ref<Record<string, boolean>>({})
/** 目录实体列表（cmd_list_workdirs 结果；Phase 3 会话树分组标签来源） */
const workdirs = ref<RustWorkdirRecord[]>([])
/** 是否已初始化（Tauri 端无需异步初始化，直接置 true） */
const isInitialized = ref(true)

/** 当前思考级别（深度模式：off/minimal/low/medium/high/xhigh），供对话页头部选择器展示 */
const thinkingLevel = ref<ThinkingLevel>('off')

/** 会话累计用量（由 send_message 响应 usage 累加，供用量面板） */
interface UsageAggregate {
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalCost: number
  savedByCache: number
}

const totalUsage = ref<UsageAggregate>({
  requestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  savedByCache: 0,
})

/** 事件订阅者集合（subscribe 注册，dispose / 触发时分发） */
const listeners = new Set<AgentEventListener>()

/** 会话消息缓存（按 sessionId），切换会话时优先从缓存恢复，缺失再回源 get_messages */
const sessionMessagesCache = new Map<string, AgentMessage[]>()

/** 轮次树（渲染层唯一事实源）：实时流与回源重建共用同一归约器 */
const turns = ref<Turn[]>([])
/** 轮次树会话缓存（按 sessionId），切换会话时恢复/回源重建 */
const sessionTurnsCache = new Map<string, Turn[]>()
/** 展平缓存条目：记录产生该结果的轮次引用，用于判定是否可复用 */
interface FlatCacheEntry {
  turn: Turn
  rows: FlatRow[]
}
/** 行映射缓存条目：记录产生该 item 的行引用，用于判定是否可复用 */
interface ItemCacheEntry {
  row: FlatRow
  item: AgentStreamItem
}

/** 轮次展平缓存：turnId → { turn 引用, rows }；turn 引用未变则整轮复用 */
const flatRowCache = new Map<string, FlatCacheEntry>()
/** 行映射缓存：rowId → { row 引用, item }；row 引用未变则复用同一个 item 对象 */
const streamItemCache = new Map<string, ItemCacheEntry>()
/**
 * 清空展平/映射缓存（切会话时调用）
 *
 * 缓存按行 id 索引，而回源行 id 形如 `msg-${i}`——**跨会话必然重复**，不清理会随切换次数累积。
 * 但**会话内绝不能清理**：否则超长会话会退化为每 delta 清空重建，比不缓存还慢。
 */
function resetStreamCaches(): void {
  flatRowCache.clear()
  streamItemCache.clear()
}

/**
 * 事件流（派生视图）：由轮次树展平，保持 AgentStreamItem 契约供窗口化与行组件消费
 *
 * 两级缓存避免每个 delta 都全量重算（原实现：flattenTurns + map 两次 O(总行数)）：
 * 1. **轮次级**：turn 对象引用未变（本次事件没触及该轮次）→ 整轮 FlatRow[] 复用；
 * 2. **行级**：FlatRow 引用未变 → 复用同一个 AgentStreamItem 对象。
 *
 * 第 2 级是关键：Vue 的 v-for 按 key 比对时 props 引用相同会跳过子组件 patch，
 * 于是流式输出时**只有当前正在增长的那一段真正重建**，其余行零开销。
 *
 * 复用判据一律用引用相等（===）——归约器是不可变的，未被触及的部分天然保持同一引用。
 */
const agentStream = computed<AgentStreamItem[]>(() => {
  const abortedText = '已由用户停止'

  // ① 展平：只重算引用变化的轮次
  const rows: FlatRow[] = []
  for (const t of turns.value) {
    const hit = flatRowCache.get(t.id)
    if (hit && hit.turn === t) {
      for (const r of hit.rows) rows.push(r)
      continue
    }
    const next = flattenTurn(t, { abortedText })
    flatRowCache.set(t.id, { turn: t, rows: next })
    for (const r of next) rows.push(r)
  }

  // ② 映射：只重建引用变化的行
  const items: AgentStreamItem[] = new Array(rows.length)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const hit = streamItemCache.get(row.id)
    if (hit && hit.row === row) {
      items[i] = hit.item
      continue
    }
    const item = flatRowToStreamItem(row)
    streamItemCache.set(row.id, { row, item })
    items[i] = item
  }
  return items
})

/**
 * 设置某轮次的过程层折叠态（用户点击摘要行展开，或手动收起）
 *
 * 折叠态存在 Turn 上而非行组件内部 state：
 * - 切会话回源重建后仍与用户操作一致（组件 state 会随卸载丢失）；
 * - 后续自动折叠控制器与此函数写同一个字段，不会产生两套互相打架的状态。
 */
function setProcessCollapsed(turnId: string, collapsed: boolean): void {
  const idx = turns.value.findIndex((t) => t.id === turnId)
  if (idx < 0 || turns.value[idx].processCollapsed === collapsed) return
  const next = [...turns.value]
  // processPeeked：从折叠态手动展开 → 常驻折叠头行；手动收起 → 清除标记
  next[idx] = { ...next[idx], processCollapsed: collapsed, processPeeked: !collapsed }
  turns.value = next
  // 同步会话缓存：切走再切回时保持用户已展开/收起的状态
  const sid = currentSessionId.value
  if (sid && sessionTurnsCache.has(sid)) sessionTurnsCache.set(sid, next)
}

/**
 * 标记用户展开过该轮次的某个行段（latch：置 userEverExpanded）
 *
 * 折叠三条件靠它分派：未展开过 → 立即折叠；展开过 → 需等空闲 5s 或离开视口。
 * latch 语义：展开了又收起仍为 true（用户表达过关注，不该被立即折叠）。
 */
function markTurnExpanded(turnId: string): void {
  applyTurnEvent(currentSessionId.value ?? '', { type: 'turn_expanded', turnId })
}

/**
 * 自动折叠执行（由折叠控制器调用）
 *
 * 走归约器的 auto_collapse 事件而非直接改 processCollapsed：
 * 同时置 hasAutoCollapsed latch，保证「每个轮次只自动折叠一次」。
 */
function autoCollapseProcess(turnId: string): void {
  applyTurnEvent(currentSessionId.value ?? '', { type: 'auto_collapse', turnId })
}

/** 当前进行中的轮次 id（流式事件归属用；null=无进行中轮次） */
const currentTurnId = ref<string | null>(null)

/** 深度模式段（thinking | phase），由 Rust DeepPhaseChanged 事件驱动构建 */
const deepSegments = ref<DeepSegment[]>([])

/** 工具确认（占位：Rust 端工具调用自动执行，无需前端确认） */
function resolveToolConfirmation(): void {}

/** 深度阶段事件监听器清理函数（按 sessionId 索引，切换/删除会话时清理） */
const deepPhaseUnlistenFns = new Map<string, UnlistenFn>()

// ─── A2UI 状态 ────────────────────────────────────────────

/** A2UI 画布（surfaceId → 画布状态），由 Rust A2UIEvent 驱动构建 */
interface A2UISurface {
  surfaceId: string
  catalogId: string
  theme?: Record<string, unknown>
  components: Record<string, any>
  rootIds: string[]
  dataModel: Record<string, unknown>
}

const a2uiSurfaces = ref<Record<string, A2UISurface>>({})

/** A2UI 事件监听器清理函数（按 sessionId 索引，切换/删除会话时清理） */
const a2uiUnlistenFns = new Map<string, UnlistenFn>()

// ─── 子 Agent 委派状态 ────────────────────────────────────────

/** 单次子 Agent 委派的运行状态（前端由 Rust SubAgent 事件驱动维护） */
export interface SubAgentState {
  /** 唯一委派序号（同一子 Agent 可被多次委派，用时间戳区分） */
  id: string
  /** 子 Agent ID */
  subAgentId: string
  /** 子 Agent 名称（人类可读） */
  subAgentName: string
  /** 委派的子任务描述 */
  taskDescription: string
  /** 运行状态：running=执行中 / completed=完成 / error=失败或超时 */
  status: 'running' | 'completed' | 'error'
  /** 输出字符数（completed 时填充） */
  outputChars?: number
  /** 执行耗时（毫秒，completed 时填充） */
  durationMs?: number
  /** 错误信息（error 时填充） */
  error?: string
  /** 委派开始时间戳 */
  startedAt: number
}

/** 子 Agent 委派状态列表（前端由 Rust SubAgent 事件驱动维护） */
const subAgents = ref<SubAgentState[]>([])

/** 子 Agent 委派事件监听器清理函数（按 sessionId 索引） */
const subAgentUnlistenFns = new Map<string, UnlistenFn>()

// ─── 流式响应状态 ────────────────────────────────────────

/** 正在流式生成的助手消息（打字机效果：随 delta 增量更新） */
const streamingAssistant = ref<AgentMessage | null>(null)

/** 最近一次流式创建的助手消息（用于 send_message 返回后与之去重，避免重复追加） */
const lastStreamedMsg = ref<AgentMessage | null>(null)

/** 流式事件监听器清理函数（按 sessionId 索引） */
const streamUnlistenFns = new Map<string, UnlistenFn>()

// ─── 事件分发 ────────────────────────────────────────────
function emit(event: AgentEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      console.warn('[useAgentRust] 事件订阅者异常:', err)
    }
  }
}

// ─── 事件流辅助函数 ────────────────────────────────────────

/**
 * 派发一条轮次事件（轮次树的唯一写入口），并同步会话缓存
 *
 * 归约器是纯函数：幂等与去重（动作段按 id、文本段按候选游标）都在 turnModel 内部保证，
 * 这里不再需要旧实现的线性扫描 + 全数组复制（`streamAppend` / `streamReplace` 的 O(n) 开销）。
 */
function applyTurnEvent(sessionId: string, event: TurnEvent): void {
  const next = reduceEvent(turns.value, event)
  if (next === turns.value) return // 未命中（如事件归属的轮次不存在）→ 不触发响应式
  turns.value = next
  // 会话缓存指向同一棵树（引用共享，无需深拷贝）
  if (sessionTurnsCache.has(sessionId)) {
    sessionTurnsCache.set(sessionId, next)
  }
}

/**
 * 回源重建：把持久化消息交给 turnModel 归约，再展平为事件行
 *
 * 与实时流共用同一套归约规则（rebuildFromMessages → 同一 reduceEvent），
 * 保证刷新前后产出结构一致，消除"两套 DOM"。
 * 入参用 Rust 原始消息而非 rustMsgToTsMsg 的映射结果——
 * `tool_call_id` 与 `meta.thinking` 只存在于原始形态（映射函数两者都不带）。
 */
function rebuildTurnsFromMessages(msgs: RustMessage[]): Turn[] {
  // Rust 端消息无 id 字段，按序补稳定 id，使文本段 id 确定性可复现
  const withIds = msgs.map((m, i) => ({ ...m, id: `msg-${i}` }))
  return rebuildFromMessages(withIds)
}

/** 渲染行 → 事件行（保持 AgentStreamItem 契约，供窗口化与行组件消费） */
function flatRowToStreamItem(row: FlatRow): AgentStreamItem {
  switch (row.type) {
    case 'user':
      return {
        type: 'user',
        msg: {
          id: row.msg.id,
          role: 'user',
          content: row.msg.text,
          timestamp: row.msg.timestamp,
          images: row.msg.images,
          files: row.msg.files,
        },
        id: row.msg.id,
        timestamp: row.msg.timestamp,
        turnId: row.turnId,
      }
    case 'think':
      return { type: 'think', id: row.id, text: row.text, status: row.status, timestamp: row.timestamp }
    case 'action':
      return {
        type: 'tool',
        id: row.id,
        tc: {
          id: row.id,
          name: row.label,
          // 行段模型 v2：rowKind 随 FlatRow 透传（实时与回源同源于 turns → 单点透传）
          rowKind: row.rowKind,
          args: row.args ?? {},
          status: row.status === 'running' ? 'running' : row.status === 'failed' ? 'failed' : 'completed',
          startedAt: row.timestamp,
          endedAt: row.status === 'running' ? undefined : row.timestamp,
          // H7 P0.5：执行耗时随 FlatRow 透传（回源旧消息无此字段则不显示）
          durationMs: row.durationMs,
          // ToolRow 期望字符串结果；回源携带的是原始结果文本，原样透传
          result: typeof row.result === 'string' ? row.result : undefined,
        },
        timestamp: row.timestamp,
      }
    case 'text':
      // id 沿用文本段 id（与实时路径同构，延续 N1 修复语义）
      return {
        type: 'assistant',
        msg: { id: row.id, role: 'assistant', content: row.text, timestamp: row.timestamp },
        id: row.id,
        timestamp: row.timestamp,
        isResult: row.isResult,
      }
    case 'divider':
      return { type: 'divider', id: row.id, dividerText: row.text, timestamp: row.timestamp }
    case 'process_summary':
      return {
        type: 'process_summary',
        id: row.id,
        turnId: row.turnId,
        thinkCount: row.thinkCount,
        actionCount: row.actionCount,
        expanded: row.expanded,
        timestamp: row.timestamp,
      }
  }
}

// ─── 深度阶段事件监听（DeepPhaseChanged）────────────────────────────

/** 设置 DeepPhaseChanged 事件监听（双写：驱动 tool 事件行 + 维护 deepSegments 供右侧阶段轨迹），详细见 docs/details/注释/tauri/useAgentRust.md */
async function setupDeepPhaseListener(sessionId: string): Promise<void> {
  if (deepPhaseUnlistenFns.has(sessionId)) return

  const eventName = `agent:event:deep_phase_changed:${sessionId}`
  try {
    const unlisten = await listen<RustDeepPhaseChangedPayload>(eventName, (e) => {
      const payload = e.payload
      const now = Date.now()
      // 命令段不再由此驱动：DeepPhaseChanged 是「阶段切换」的副产物，同阶段内连续调用不发事件，
      // 用它当命令段源会导致段缺失。权威命令段已接通 ToolCallStart/End（tools.rs 真实执行前后广播），
      // 由 handleStreamEvent 消费并按 toolCallId 幂等收敛。此处仅维护右侧阶段轨迹。

      // ── 右侧阶段轨迹（PhaseSection/TracePanel 消费）：维护 deepSegments phase 段 ──
      // 去重：同一 phaseIndex 已存在则更新其工具/状态，不重复追加
      const existingSeg = deepSegments.value.find((s) => s.type === 'phase' && s.index === payload.phaseIndex)
      if (existingSeg && existingSeg.type === 'phase') {
        // 阶段完成事件：仅更新已存在工具的状态并标记完成，不把下一阶段的新工具塞入旧阶段
        if (payload.phaseCompleted) {
          const ti = existingSeg.tools.findIndex((t) => t.name === payload.triggerTool)
          if (ti >= 0) {
            existingSeg.tools[ti].status = payload.toolStatus
            if (payload.toolStatus !== 'running') existingSeg.tools[ti].endedAt = now
          }
          existingSeg.status = 'done'
        } else {
          // 同阶段内工具状态更新：更新/新增触发工具
          const ti = existingSeg.tools.findIndex((t) => t.name === payload.triggerTool)
          if (ti >= 0) {
            existingSeg.tools[ti].status = payload.toolStatus
            if (payload.toolStatus !== 'running') existingSeg.tools[ti].endedAt = now
          } else {
            existingSeg.tools.push({
              id: `phase-tool-${now}`,
              name: payload.triggerTool,
              args: {},
              status: payload.toolStatus,
              startedAt: now,
              endedAt: payload.toolStatus !== 'running' ? now : undefined,
            })
          }
        }
        return
      }
      // 新阶段：先把之前所有 active 阶段标记为 done，再追加新 phase 段
      for (const seg of deepSegments.value) {
        if (seg.type === 'phase' && seg.status === 'active') seg.status = 'done'
      }
      deepSegments.value.push({
        id: `phase-${payload.phaseIndex}-${now}`,
        type: 'phase',
        label: payload.phaseLabel,
        index: payload.phaseIndex,
        timestamp: now,
        tools: [{
          id: `phase-${payload.phaseIndex}-tool-${now}`,
          name: payload.triggerTool,
          args: {},
          status: payload.toolStatus,
          startedAt: now,
          endedAt: payload.toolStatus !== 'running' ? now : undefined,
        }],
        outputs: [],
        status: payload.phaseCompleted ? 'done' : 'active',
      })
    })
    deepPhaseUnlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useAgentRust] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话的深度阶段事件监听 */
function teardownDeepPhaseListener(sessionId: string): void {
  const unlisten = deepPhaseUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    deepPhaseUnlistenFns.delete(sessionId)
  }
}

// ─── A2UI 事件监听（A2UIEvent）────────────────────────────

/**
 * 计算组件树根节点 ID 列表
 *
 * 若存在 `root` 组件则直接返回，否则动态计算所有未被任何组件
 * `children` 引用的组件 ID（即无入边的节点）。
 */
function findRootIds(components: Record<string, any>): string[] {
  if (components['root']) return ['root']
  const childIds = new Set<string>()
  for (const comp of Object.values(components)) {
    const ch = comp.children
    if (Array.isArray(ch)) {
      for (const id of ch) childIds.add(id)
    }
  }
  const roots: string[] = []
  for (const id of Object.keys(components)) {
    if (!childIds.has(id)) roots.push(id)
  }
  return roots
}

/** 按 `/path/to` 形式写入嵌套值（路径段以 `/` 分隔） */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) {
    if (typeof value === 'object' && value !== null) Object.assign(obj, value as Record<string, unknown>)
    return
  }
  let current: any = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) current[parts[i]] = {}
    current = current[parts[i]]
  }
  current[parts[parts.length - 1]] = value
}

/**
 * 处理一条 A2UI 消息（camelCase 变体，`createSurface` / `updateComponents` /
 * `updateDataModel` / `deleteSurface`），增量更新 `a2uiSurfaces`。
 */
function handleA2UIEvent(surfaceId: string, message: A2UIMessage): void {
  if ('createSurface' in message) {
    a2uiSurfaces.value = {
      ...a2uiSurfaces.value,
      [surfaceId]: {
        surfaceId,
        catalogId: message.createSurface.catalogId,
        theme: message.createSurface.theme,
        components: {},
        rootIds: [],
        dataModel: {},
      },
    }
  } else if ('updateComponents' in message) {
    const surface = a2uiSurfaces.value[surfaceId]
    if (!surface) return
    const newComponents = { ...surface.components }
    for (const comp of message.updateComponents.components) {
      newComponents[comp.id] = { ...comp }
    }
    const newRootIds = findRootIds(newComponents)
    a2uiSurfaces.value = {
      ...a2uiSurfaces.value,
      [surfaceId]: { ...surface, components: newComponents, rootIds: newRootIds },
    }
  } else if ('updateDataModel' in message) {
    const surface = a2uiSurfaces.value[surfaceId]
    if (!surface) return
    const newDataModel = JSON.parse(JSON.stringify(surface.dataModel))
    setNestedValue(newDataModel, message.updateDataModel.path, message.updateDataModel.value)
    a2uiSurfaces.value = {
      ...a2uiSurfaces.value,
      [surfaceId]: { ...surface, dataModel: newDataModel },
    }
  } else if ('deleteSurface' in message) {
    const newSurfaces = { ...a2uiSurfaces.value }
    delete newSurfaces[surfaceId]
    a2uiSurfaces.value = newSurfaces
  }
}

/**
 * 解析数据绑定表达式（`{ path: '/a/b' }`）为 dataModel 中的实际值
 *
 * 供 A2UIRenderer 的 `resolve-binding` prop 使用；非绑定表达式原样返回。
 */
function resolveDataBinding(binding: any, dataModel: Record<string, unknown>): any {
  if (binding && typeof binding === 'object' && 'path' in binding) {
    const parts = (binding.path as string).split('/').filter(Boolean)
    let current: any = dataModel
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined
      current = current[part]
    }
    return current
  }
  return binding
}

/**
 * 为指定会话设置 A2UI 事件监听
 *
 * 监听 `agent:event:a2ui:{session_id}`，收到 Rust payload 后转发给
 * `handleA2UIEvent` 增量更新画布状态。幂等：已存在监听器则直接返回。
 */
async function setupA2UIListener(sessionId: string): Promise<void> {
  if (a2uiUnlistenFns.has(sessionId)) return

  const eventName = `agent:event:a2ui:${sessionId}`
  try {
    const unlisten = await listen<{ surfaceId: string; message: A2UIMessage }>(eventName, (e) => {
      handleA2UIEvent(e.payload.surfaceId, e.payload.message)
    })
    a2uiUnlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useAgentRust] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话的 A2UI 事件监听 */
function teardownA2UIListener(sessionId: string): void {
  const unlisten = a2uiUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    a2uiUnlistenFns.delete(sessionId)
  }
}

// ─── 子 Agent 委派事件监听（SubAgentStarted/Completed/Error）────────────────────

/** 处理子 Agent 委派事件（start/completed/error 增量更新 subAgents），详细见 docs/details/注释/tauri/useAgentRust.md */
function handleSubAgentEvent(payload: RustSubAgentPayload): void {
  if (payload.type === 'start') {
    subAgents.value.unshift({
      id: `sub-${payload.subAgentId}-${Date.now()}`,
      subAgentId: payload.subAgentId,
      subAgentName: payload.subAgentName,
      taskDescription: payload.taskDescription,
      status: 'running',
      startedAt: Date.now(),
    })
    return
  }

  // completed / error：在 subAgents 中找该子 Agent 最新一条 running 记录更新
  const idx = subAgents.value.findIndex(
    (s) => s.subAgentId === payload.subAgentId && s.status === 'running',
  )
  if (idx < 0) {
    // 没有匹配的 running 记录（如会话切换后事件迟到），忽略防脏数据
    console.warn(`[useAgentRust] 子 Agent "${payload.subAgentId}" ${payload.type} 无匹配 running 记录，忽略`)
    return
  }
  const target = { ...subAgents.value[idx] }
  target.status = payload.type === 'completed' ? 'completed' : 'error'
  if (payload.type === 'completed') {
    target.outputChars = payload.outputChars
    target.durationMs = payload.durationMs
  } else {
    target.error = payload.error
  }
  subAgents.value[idx] = target
}

/**
 * 为指定会话设置子 Agent 委派事件监听
 *
 * 监听 `agent:event:subagent:{session_id}`，收到 Rust payload 后
 * 转发给 `handleSubAgentEvent` 增量更新 `subAgents`。幂等：已存在监听器则直接返回。
 */
async function setupSubAgentListener(sessionId: string): Promise<void> {
  if (subAgentUnlistenFns.has(sessionId)) return

  const eventName = `agent:event:subagent:${sessionId}`
  try {
    const unlisten = await listen<RustSubAgentPayload>(eventName, (e) => {
      handleSubAgentEvent(e.payload)
    })
    subAgentUnlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useAgentRust] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话的子 Agent 委派事件监听 */
function teardownSubAgentListener(sessionId: string): void {
  const unlisten = subAgentUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    subAgentUnlistenFns.delete(sessionId)
  }
}

// ─── 流式响应事件监听（StreamStart/StreamDelta/StreamEnd）────────────────────

/**
 * 按 id 同时更新 `messages` 与 `sessionMessagesCache` 中的消息
 *
 * 流式 delta 采用不可变替换触发 Vue 响应式；缓存与消息列表存的是同一对象引用，
 * 为避免缓存陈旧，需要同步更新两处。
 */
function upsertMsgInSession(id: string, updated: AgentMessage, sessionId: string): void {
  const mi = messages.value.findIndex((m) => m.id === id)
  if (mi >= 0) messages.value[mi] = updated
  const cache = sessionMessagesCache.get(sessionId)
  if (cache) {
    const ci = cache.findIndex((m) => m.id === id)
    if (ci >= 0) cache[ci] = updated
  }
}

/**
 * 处理一条流式事件，驱动打字机效果
 *
 * - `start`：创建一条空助手消息并推入消息列表，开始累积
 * - `delta`：把增量追加到当前流式消息
 * - `end`：以完整文本为权威内容收尾，清空流式占位
 * - `error` / `agent_end`：清理流式占位
 */
function handleStreamEvent(sessionId: string, payload: RustStreamPayload): void {
  // 会话守卫：仅处理当前会话的流式事件，避免旧会话残留事件污染全局消息区
  if (sessionId !== currentSessionId.value) return
  // O1/O4 修复：编排 run 活跃期间，过程流不进正文——
  // 过程（阶段进度/摘要/终局结论）由编排段（OrchestrationSegment）承载，终稿由 send_message
  // 返回值唯一渲染。这同时拦掉：流式早期工具调用参数 JSON 逐字符渲染成正文（O4）、
  // execute 步骤产物与最终文档重复平铺（O1）、编排各节点 reasoning 块泛滥（O2 主因）。
  // react 退化 run（快问答）无 trace 事件、activeRun 恒空 → 不受影响，正常打字机流式。
  if (
    activeRun.value
    && (payload.type === 'start' || payload.type === 'delta' || payload.type === 'reasoning' || payload.type === 'end')
  ) {
    return
  }
  // 轮次归属：turnId 为空（编排路径未开轮）时仅维护消息状态，不写轮次树
  const turnId = currentTurnId.value

  if (payload.type === 'start') {
    // 新流开始：创建空助手消息承载后续增量（messages 仍维护，供 lastAssistantHas* 等消费）
    const msg: AgentMessage = {
      id: nextAssistantId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    streamingAssistant.value = msg
    lastStreamedMsg.value = msg
    messages.value.push(msg)
    sessionMessagesCache.get(sessionId)?.push(msg)
    if (turnId) applyTurnEvent(sessionId, { type: 'round_start', turnId })
    return
  }

  if (payload.type === 'delta') {
    const target = streamingAssistant.value
    if (!target) return
    const updated: AgentMessage = { ...target, content: target.content + payload.delta }
    streamingAssistant.value = updated
    upsertMsgInSession(target.id, updated, sessionId)
    if (turnId) applyTurnEvent(sessionId, { type: 'text_delta', turnId, delta: payload.delta })
    return
  }

  // 推理增量：双写——消息字段 thinking（供 lastAssistantHasThinking 消费）+ 轮次树推理段
  if (payload.type === 'reasoning') {
    const target = streamingAssistant.value
    if (!target) return
    const updated: AgentMessage = {
      ...target,
      ...((target as { thinking?: string }).thinking !== undefined
        ? { thinking: (target as { thinking?: string }).thinking + payload.delta }
        : { thinking: payload.delta }),
    }
    streamingAssistant.value = updated
    upsertMsgInSession(target.id, updated, sessionId)
    // 分段由归约器判定：连续 reasoning 累积同一段，遇正文则另起新段
    if (turnId) applyTurnEvent(sessionId, { type: 'reasoning', turnId, delta: payload.delta })
    return
  }

  if (payload.type === 'end') {
    const target = streamingAssistant.value
    streamingAssistant.value = null
    if (target) {
      // 以完整文本为权威内容（与 delta 累积可能存在的截断/差异对齐）
      const updated: AgentMessage = { ...target, content: payload.fullText }
      lastStreamedMsg.value = updated
      upsertMsgInSession(target.id, updated, sessionId)
    }
    // fullText 为权威：校正增量丢失，亦覆盖「无 delta 只有 fullText」的一次性输出
    if (turnId) applyTurnEvent(sessionId, { type: 'round_end', turnId, fullText: payload.fullText })
    return
  }

  // 工具调用开始：命令段的权威事件源（tools.rs 真实执行前广播）
  // 同一 toolCallId 可能重复到达（genai 流式期也会广播一次），归约器按 refId 幂等覆盖。
  if (payload.type === 'tool_call_start') {
    if (turnId) {
      applyTurnEvent(sessionId, {
        type: 'action_start',
        turnId,
        id: `tool-${payload.toolCallId}`,
        action: 'tool',
        label: payload.name,
        refId: payload.toolCallId,
        args: (payload.args ?? {}) as Record<string, unknown>,
      })
    }
    return
  }

  // 工具调用结束：result 为工具真实执行结果（失败时为 { error, tool }）
  if (payload.type === 'tool_call_end') {
    if (turnId) {
      const parsed = parseToolResult(payload.result)
      // H7 P0.5：事件顶层 status/error 权威（后端真实执行结果）；解析推断仅作旧事件回退
      const status =
        payload.status === 'failed' ? 'failed' : payload.status === 'success' ? 'completed' : parsed.status
      applyTurnEvent(sessionId, {
        type: 'action_end',
        turnId,
        refId: payload.toolCallId,
        status,
        result: parsed.result,
        error: payload.error ?? parsed.error,
        durationMs: payload.durationMs,
      })
    }
    return
  }

  // error / agent_end：清理流式占位，保留已累积内容
  // 段收尾与结果层固化不在此处——turn_end 由 prompt 的 send_message 返回路径统一发送，
  // 避免「事件先到、返回值后到」两次 turn_end 造成结果层重复段
  // 但动作段必须在此兜底：中断/异常时工具不会有 ToolCallEnd 到达，否则命令段永久转圈
  if (turnId) applyTurnEvent(sessionId, { type: 'actions_settle', turnId })
  streamingAssistant.value = null
  // 复位流式状态：即使 send_message 的 invoke promise 因重载/中断被丢弃，
  // 后端仍会经流事件通道广播 agent_end/error，据此兜底复位，避免「思考中…」卡死
  isStreaming.value = false
}

/**
 * 为指定会话设置流式事件监听
 *
 * 监听 `agent:event:stream:{session_id}`。幂等：已存在监听器则直接返回。
 */
async function setupStreamListener(sessionId: string): Promise<void> {
  if (streamUnlistenFns.has(sessionId)) return

  const eventName = `agent:event:stream:${sessionId}`
  try {
    const unlisten = await listen<RustStreamPayload>(eventName, (e) => {
      handleStreamEvent(sessionId, e.payload)
    })
    streamUnlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useAgentRust] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话的流式事件监听 */
function teardownStreamListener(sessionId: string): void {
  const unlisten = streamUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    streamUnlistenFns.delete(sessionId)
  }
}

// ─── 会话标题更新事件监听（agent:session_title_updated，Phase 5）────────────

/** Rust `cmd_agent_generate_title` 生成的标题更新事件 payload 镜像 */
interface RustSessionTitleUpdatedPayload {
  sessionId: string
  title: string
}

/** 标题更新全局监听器（幂等：module 级单例，dispose 时清理） */
let sessionTitleUnlisten: UnlistenFn | null = null

/**
 * 为全局注册会话标题更新监听（Phase 5）
 *
 * 监听 `agent:session_title_updated`：Rust LLM 生成标题后推送，前端据此：
 * 1. 就地更新 `sessionList` 对应会话的 title（无需整表刷新即刷新 Sidebar）；
 * 2. 清除标题等候动画标记（标题已落地）；
 * 3. 派发 `ws-session-title-updated`，触发 SessionSidebar 的 refresh 保持分组一致。
 */
async function setupSessionTitleListener(): Promise<void> {
  if (sessionTitleUnlisten) return
  try {
    sessionTitleUnlisten = await listen<RustSessionTitleUpdatedPayload>('agent:session_title_updated', (e) => {
      const { sessionId, title } = e.payload
      const s = sessionList.value.find((x) => x.id === sessionId)
      if (s) s.title = title
      // 只清除该会话的标题等候标记，避免影响其他会话
      delete sessionTitlePending.value[sessionId]
      // 通知 SessionSidebar 刷新（其订阅 ws-session-title-updated → refresh）
      window.dispatchEvent(new Event('ws-session-title-updated'))
    })
  } catch (err) {
    console.error('[useAgentRust] listen agent:session_title_updated 失败:', err)
  }
}

/** 生成会话标题（Phase 5：首条消息 + 首条回复 → cmd_agent_generate_title，异步不阻塞输出流） */
async function generateSessionTitle(sessionId: string, firstMessage: string, firstReply: string): Promise<void> {
  try {
    const title = await safeInvoke<string>('cmd_agent_generate_title', { sessionId, firstMessage, firstReply })
    // L2 修复：HTTP 桥（浏览器模式）下 agent:session_title_updated 事件不达前端，
    // 依赖事件会让侧栏标题停留在「新会话」（前端 sessionTitle 兜底=首条消息）——
    // 生成成功后主动刷新列表拉取后端 title。桌面端事件到达时双保险（幂等）。
    void title
    await refreshSessionList().catch((err) => {
      console.warn('[useAgentRust] 标题生成后刷新列表失败:', err)
    })
  } catch (err) {
    // 生成失败降级（Rust 保留「新会话」占位），不影响对话，仅清除等候动画
    console.warn('[useAgentRust] 生成会话标题失败（保留「新会话」占位）:', err)
  }
}

// ─── HITL 工具确认事件监听（agent:confirm:{session_id}，A5）────────────────────

/** Rust `ConfirmationRequested` / `ConfirmationResolved` 事件 payload 镜像 */
interface RustConfirmPayload {
  /** 确认请求唯一 ID（回传 cmd_agent_confirm 时原样返回） */
  confirmId: string
  /** 待确认的工具名 */
  toolName: string
  /** 待确认的工具参数 */
  args?: Record<string, unknown>
  /** 仅 resolved 事件：`resolved` 标记 */
  type?: 'resolved'
  /** 仅 resolved 事件：审批结果 */
  approved?: boolean
}

/** HITL 确认事件监听器清理函数（按 sessionId 索引） */
const confirmUnlistenFns = new Map<string, UnlistenFn>()

/**
 * 为指定会话设置 HITL 工具确认监听（A5）
 *
 * 监听 `agent:confirm:{session_id}`，收到 `ConfirmationRequested` 后弹确认框，
 * 用户选择后经 `cmd_agent_confirm` 回传放行/拒绝。幂等：已存在监听器则直接返回。
 */
async function setupConfirmListener(sessionId: string): Promise<void> {
  if (confirmUnlistenFns.has(sessionId)) return

  const eventName = `agent:confirm:${sessionId}`
  try {
    const unlisten = await listen<RustConfirmPayload>(eventName, async (e) => {
      const payload = e.payload
      // resolved 事件：Rust 已解决（弹窗由 doConfirm/doCancel 关闭），无需处理
      if (payload.type === 'resolved') return
      const { confirm } = useConfirm()
      const argSummary = payload.args ? JSON.stringify(payload.args).slice(0, 200) : ''
      // 三键确认（2026-08-30）：通过 / 取消(跳过) / 拒绝——此前只有 取消+确认(文案"删除"，
      // 被读成"拒绝")，没有「通过」入口。kernel v1 仅 bool：跳过与拒绝均按 false（不执行）处理
      const approved = await confirm({
        type: 'danger',
        title: '危险操作确认',
        description: `工具 "${payload.toolName}" 将执行${argSummary ? `\n参数：${argSummary}` : ''}\n是否继续？`,
        confirmText: '通过',
        cancelText: '拒绝',
        neutralText: '取消(跳过)',
      })
      await safeInvoke('cmd_agent_confirm', {
        sessionId,
        confirmId: payload.confirmId,
        approved,
      })
    })
    confirmUnlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useAgentRust] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话的 HITL 确认事件监听 */
function teardownConfirmListener(sessionId: string): void {
  const unlisten = confirmUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    confirmUnlistenFns.delete(sessionId)
  }
}

// ─── FrontendToolBridge：Rust 前端工具执行桥（agent:tool_call 全局监听）────────

/** Rust `FrontendToolBridge::request` 广播的全局事件 payload（callId + toolName + args） */
interface RustToolCallPayload {
  /** 唯一调用 ID（回传 cmd_agent_tool_result 时原样返回） */
  callId: string
  /** 待执行的工具名（前端 ALL_TOOLS_MAP 查找键） */
  toolName: string
  /** 工具参数 */
  args: Record<string, unknown>
}

/** 桥全局事件监听器清理函数（桥为全局通道，仅 setup/teardown 一次） */
let toolBridgeUnlisten: UnlistenFn | null = null
/** 桥工具执行上下文（惰性构造：首次收到工具调用才建，复用 entity-core stores） */
let toolBridgeContext: IToolContext | null = null

/**
 * 构造桥工具执行上下文（IToolContext）
 *
 * Rust 端桥工具（entity_create/entity_update/content_search）在 Rust ToolBus 注册，
 * 但执行需前端 `ALL_TOOLS_MAP` 中对应 TS 实现，后者依赖 `IToolContext.stores`
 * （entity/relation/file 的 Dexie store）。本函数复用 `@worldsmith/entity-core` 的
 * stores 构造上下文，与 useGroupChat 的 buildToolContext 同构。惰性构造避免首屏开销。
 */
function buildBridgeContext(): IToolContext {
  // 已缓存则仅动态刷新 workdir（会话切换后 dirPath 保持最新），复用 stores 避免重复构造
  if (toolBridgeContext) {
    toolBridgeContext.projectInfo.dirPath = currentWorkdir.value ?? null
    // Phase B 边界加固：同步注入工作区 workdir（供 coding 工具链边界 resolver 使用）
    toolBridgeContext.workspace = { workdir: currentWorkdir.value ?? undefined }
    return toolBridgeContext
  }
  const entityStore = useEntityStore()
  const relationStore = useRelationStore()
  const fileStore = useFileStore()
  const { confirm } = useConfirm()
  toolBridgeContext = {
    stores: {
      entity: entityStore,
      relation: relationStore,
      file: fileStore,
      settings: {
        getProviderConfig: () => null as never,
        getSearchConfig: () => null as never,
      },
      ui: {
        confirm: async (title: string, msg: string) => {
          return confirm({ type: 'warning', title, description: msg })
        },
      },
    },
    projectInfo: {
      name: 'WorldSmith',
      entityTypes: entityStore.types.map((t) => t.typeKey),
      relationTypes: [],
      // Phase 4 工作区：从当前会话 workdir 注入（原硬编码 null）
      dirPath: currentWorkdir.value ?? null,
    },
    // Phase B 边界加固：注入工作区 workdir（供 coding 工具链边界 resolver 使用；
    // 无 workdir 时 workdir 为 undefined = 未绑定工作区、写边界未启用）
    workspace: { workdir: currentWorkdir.value ?? undefined },
    platform: 'web' as const,
    currentSessionId: currentSessionId.value ?? undefined,
  }
  return toolBridgeContext
}

/**
 * 处理一条前端工具桥调用（全局 agent:tool_call 事件）
 *
 * 收到 Rust 桥工具调用后：`ALL_TOOLS_MAP.get(toolName)` 找前端实现 →
 * 以桥上下文执行 → `cmd_agent_tool_result` 回传结果。工具未在前端注册时回传 error。
 */
async function handleToolCall(payload: RustToolCallPayload): Promise<void> {
  const { callId, toolName, args } = payload
  const tool = ALL_TOOLS_MAP.get(toolName)
  if (!tool) {
    await safeInvoke('cmd_agent_tool_result', {
      callId,
      ok: false,
      result: { error: `前端未注册工具 "${toolName}"` },
    })
    return
  }
  try {
    const out = await tool.execute(args, buildBridgeContext())
    // tool.execute 返回 JSON 字符串；原样回传给 Rust（转 Value 保持结构）
    await safeInvoke('cmd_agent_tool_result', {
      callId,
      ok: true,
      result: parseMaybeJson(out),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await safeInvoke('cmd_agent_tool_result', {
      callId,
      ok: false,
      result: { error: msg },
    })
  }
}

/** 尝试把工具返回的 JSON 字符串解析为结构化值；解析失败原样返回字符串 */
function parseMaybeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/**
 * 设置前端工具桥全局监听器（幂等：已监听则直接返回）
 *
 * 桥为全局事件通道（`agent:tool_call`，无 session 后缀），只需注册一次。
 * 跨会话并行调用靠唯一 callId 区分，前端全局只应有一个执行器避免重复。
 */
async function setupToolBridgeListener(): Promise<void> {
  if (toolBridgeUnlisten) return
  try {
    toolBridgeUnlisten = await listen<RustToolCallPayload>('agent:tool_call', (e) => {
      void handleToolCall(e.payload)
    })
  } catch (err) {
    console.error('[useAgentRust] listen agent:tool_call 失败:', err)
  }
}

/** 清理前端工具桥全局监听器（应用 dispose 时调用） */
function teardownToolBridgeListener(): void {
  if (toolBridgeUnlisten) {
    toolBridgeUnlisten()
    toolBridgeUnlisten = null
  }
}

// ─── A4 Plan-Exec 计划事件监听（agent:event:plan_created / plan_update）────────

/** Rust `PlanCreated` 事件 payload：`{ items: PlanItem[] }`（snake_case 字段） */
interface RustPlanCreatedPayload {
  items: Array<{
    id: string
    title: string
    status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
    description?: string
    order: number
    output?: string | null
  }>
}

/** Rust `PlanStepUpdate` 事件 payload：`{ itemId, status, output? }` */
interface RustPlanUpdatePayload {
  itemId: string
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
  output?: unknown
}

/** Rust `PlanReplanned` 事件 payload：`{ items: PlanItem[] }`（整体替换后的完整计划） */
interface RustPlanReplannedPayload {
  items: RustPlanItem[]
}

/** 计划事件监听器清理函数（按 sessionId 索引） */
const planUnlistenFns = new Map<string, UnlistenFn>()

/**
 * 为指定会话设置计划事件监听
 *
 * 监听 `agent:event:plan_created:{session_id}` / `agent:event:plan_update:{session_id}`，
 * 收到 Rust payload 后更新 `usePlanStore`，驱动 PlanPanel 展示。幂等：已存在监听器则直接返回。
 */
async function setupPlanListener(sessionId: string): Promise<void> {
  if (planUnlistenFns.has(sessionId)) return

  const createdEvent = `agent:event:plan_created:${sessionId}`
  const updateEvent = `agent:event:plan_update:${sessionId}`
  const replannedEvent = `agent:event:plan_replanned:${sessionId}`
  try {
    const unlistenCreated = await listen<RustPlanCreatedPayload>(createdEvent, (e) => {
      usePlanStore().createPlan(e.payload.items)
    })
    const unlistenUpdate = await listen<RustPlanUpdatePayload>(updateEvent, (e) => {
      usePlanStore().updateItem(e.payload.itemId, e.payload.status)
    })
    const unlistenReplanned = await listen<RustPlanReplannedPayload>(replannedEvent, (e) => {
      // Replanner：整体替换为重规划后的完整计划（保留失败项及之前已完成进度）
      usePlanStore().createPlan(
        e.payload.items.map((p) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          description: p.description ?? undefined,
          order: p.order,
        })),
      )
    })
    // 统一清理：dispose/teardown 时按 sessionId 释放三个监听
    planUnlistenFns.set(sessionId, () => {
      unlistenCreated()
      unlistenUpdate()
      unlistenReplanned()
    })
  } catch (err) {
    console.error(`[useAgentRust] listen ${createdEvent} / ${updateEvent} / ${replannedEvent} 失败:`, err)
  }
}

/** 清理指定会话的计划事件监听 */
function teardownPlanListener(sessionId: string): void {
  const unlisten = planUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    planUnlistenFns.delete(sessionId)
  }
}

// ─── A1 全链路事件流可观测（agent:event:trace:{session_id}）──────────────

/** Rust `emit_trace` payload：`{ seq, type, summary }`（seq 为全会话递增序号，据此还原时序） */
interface RustTracePayload {
  seq: number
  type: string
  summary: string
}

/** trace 事件类型 → 活动日志类目（未知类型归为 info） */
function traceTypeToLogType(traceType: string): ActivityLogEntry['type'] {
  switch (traceType) {
    case 'error':
    case 'sub_agent_error':
      return 'error'
    case 'tool_call_start':
    case 'tool_call_end':
    case 'plan_created':
    case 'plan_step_update':
    case 'plan_replanned':
    case 'sub_agent_start':
    case 'sub_agent_completed':
    case 'confirmation_requested':
      return 'tool'
    default:
      return 'info'
  }
}

/** trace 事件监听器清理函数（按 sessionId 索引） */
const traceUnlistenFns = new Map<string, UnlistenFn>()

/**
 * 为指定会话设置 trace 事件监听（A1 全链路事件流可观测）
 *
 * 监听 `agent:event:trace:{session_id}`，收到 Rust payload 后把摘要写入
 * `useActivityLog`，使活动日志能按序还原「AgentStart → … → AgentEnd」完整事件链。
 * 幂等：已存在监听器则直接返回。
 */
async function setupTraceListener(sessionId: string): Promise<void> {
  if (traceUnlistenFns.has(sessionId)) return

  const eventName = `agent:event:trace:${sessionId}`
  try {
    const unlisten = await listen<RustTracePayload>(eventName, (e) => {
      const { type, summary } = e.payload
      // 活动日志按事件源会话写入桶（跨会话隔离）
      useActivityLog().addLog(traceTypeToLogType(type), summary, undefined, type, sessionId)
    })
    traceUnlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useAgentRust] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话的 trace 事件监听 */
function teardownTraceListener(sessionId: string): void {
  const unlisten = traceUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    traceUnlistenFns.delete(sessionId)
  }
}

// ─── 命令封装：会话生命周期 ────────────────────────────────────

/** 任务29/D1：取当前项目 id（动态 import ProjectManager；项目系统未就绪/浏览器 preview 返回 null） */
async function getCurrentProjectIdSafe(): Promise<string | null> {
  try {
    const { getProjectManager } = await import('@worldsmith/entity-core/core')
    return getProjectManager().getCurrentProjectId()
  } catch {
    return null
  }
}

/** 新建会话（返回 Rust SessionInfo）
 * - `scenarioId`：B1 场景 ID（可选；缺省不传 → Rust 使用默认场景 worldbuilding）
 */
async function newSession(
  systemPrompt?: string,
  providerConfig?: RustProviderConfigFull,
  scenarioId?: string,
): Promise<RustSessionInfo> {
  // 任务29/A1 统一根：workdir 来源 = 输入栏 WorkdirSelect 选中的目录（currentWorkdir）；
  // 未手动选择则回退当前默认根（resolveWorkspaceDir() 无参 = 当前项目目录优先，
  // 无绑定项目时兜底 ~/.worldsmith/workspace）——见 docs/plans/workspace-unification-plan.md
  const workdir = currentWorkdir.value ?? (await resolveWorkspaceDir())
  await ensureWorkspaceDir(workdir)
  // 任务29/D1 锚点：会话归属当前项目（弱引用前端 ProjectManager 的项目 UUID）
  const projectId = await getCurrentProjectIdSafe()
  const info = await safeInvoke<RustSessionInfo>('new_session', {
    systemPrompt: systemPrompt ?? null,
    providerConfig: providerConfig ?? null,
    scenarioId: scenarioId ?? null,
    workdir,
    projectId: projectId ?? null,
  })
  // L3：真正创建后退出草稿态
  draftSessionActive.value = false
  // 先清理当前会话的旧监听器（避免旧会话残留事件污染全局状态）
  const oldSessionId = currentSessionId.value
  if (oldSessionId && oldSessionId !== info.id) {
    teardownDeepPhaseListener(oldSessionId)
    teardownA2UIListener(oldSessionId)
    teardownSubAgentListener(oldSessionId)
    teardownStreamListener(oldSessionId)
    teardownConfirmListener(oldSessionId)
    teardownPlanListener(oldSessionId)
    teardownTraceListener(oldSessionId)
    teardownOrchListener(oldSessionId)
    teardownOrchSupervisorListener(oldSessionId)
    teardownOrchestrationTraceListener(oldSessionId)
  }
  currentSessionId.value = info.id
  // Phase 5：新建会话标记为「待激活」→ 列表延迟展示（首条消息后才移除并展示条目）
  pendingSessionIds.value = [...pendingSessionIds.value.filter((id) => id !== info.id), info.id]
  // Phase 5：新会话暂无标题生成中状态（重置按会话标记，避免旧会话残留）
  sessionTitlePending.value = {}
  // Phase 4 工作区：记录当前会话 workdir（Rust 持久化回传优先，缺省用解析值）
  currentWorkdir.value = info.workdir ?? workdir
  // 会话级视图状态：新会话绑定空桶（场景继承传参，模式/execTab 默认）
  useSessionViewState().setActiveSession(info.id)
  if (scenarioId) useSessionViewState().setScene(scenarioId)
  messages.value = []
  // 新会话：重置流式/生成状态（旧会话失败遗留的 isStreaming 需归零）
  isStreaming.value = false
  streamingAssistant.value = null
  lastStreamedMsg.value = null
  // 新会话：清空深度模式段与 A2UI 画布，并建立事件监听
  deepSegments.value = []
  a2uiSurfaces.value = {}
  subAgents.value = []
  // M2 编排迹线：新会话重置（跨会话不残留 run）
  resetOrchestrationTrace()
  // A4 Plan-Exec：新会话无计划，清空 usePlanStore（按会话隔离）
  usePlanStore().clearPlan()
  // ToT/GoT/Supervisor 实时树：新会话 active 桶已切换为空桶，无需全局清空
  sessionMessagesCache.set(info.id, [])
  turns.value = []
  sessionTurnsCache.set(info.id, [])
  currentTurnId.value = null
  await setupDeepPhaseListener(info.id)
  await setupA2UIListener(info.id)
  await setupSubAgentListener(info.id)
  await setupStreamListener(info.id)
  await setupConfirmListener(info.id)
  await setupPlanListener(info.id)
  await setupTraceListener(info.id)
  await setupOrchListener(info.id)
  await setupOrchSupervisorListener(info.id)
  await setupOrchestrationTraceListener(info.id)
  // Phase 5：注册全局会话标题更新监听（幂等），供首条消息后的 LLM 标题落地更新
  await setupSessionTitleListener()
  // FrontendToolBridge：全局桥监听器仅在初次建会话时注册一次（幂等）
  await setupToolBridgeListener()
  await refreshSessionList()
  return info
}

/** B1 场景摘要（Rust ScenarioInfo 序列化视图） */
interface RustScenarioInfo {
  id: string
  display_name: string
}

/** 列出可用场景（B1 多场景；默认 worldbuilding，供场景选择器） */
async function listScenarios(): Promise<RustScenarioInfo[]> {
  return safeInvoke<RustScenarioInfo[]>('list_scenarios')
}

/** L3 懒创建：进入「新会话草稿态」——不创建后端会话，仅清空本地显示态。
 *  首条消息发送时 `ensureSession()`（currentSessionId 为 null → new_session）才真正创建，
 *  消除「点 + 产生孤儿空会话」「切走无入口可回」问题（未产生对话不生产会话条目）。 */
async function newDraftSession(): Promise<void> {
  // L3：进入草稿态（先置标志再清 currentSessionId，避免 watch/refresh 自动恢复旧会话）
  draftSessionActive.value = true
  const oldSessionId = currentSessionId.value
  if (oldSessionId) {
    teardownDeepPhaseListener(oldSessionId)
    teardownA2UIListener(oldSessionId)
    teardownSubAgentListener(oldSessionId)
    teardownStreamListener(oldSessionId)
    teardownConfirmListener(oldSessionId)
    teardownPlanListener(oldSessionId)
    teardownTraceListener(oldSessionId)
    teardownOrchListener(oldSessionId)
    teardownOrchSupervisorListener(oldSessionId)
    teardownOrchestrationTraceListener(oldSessionId)
  }
  currentSessionId.value = null
  sessionTitlePending.value = {}
  messages.value = []
  isStreaming.value = false
  streamingAssistant.value = null
  lastStreamedMsg.value = null
  deepSegments.value = []
  a2uiSurfaces.value = {}
  subAgents.value = []
  resetOrchestrationTrace()
  usePlanStore().clearPlan()
  turns.value = []
  currentTurnId.value = null
}

/**
 * 会话显示标题：从消息缓存取首条用户消息截断；无数据回退短 id。
 * L2 修复（2026-08-28）：注释更新——后端 SessionInfo 已有完整 title 体系
 * （title 字段 + update_session_title / cmd_agent_generate_title），本函数仅作
 * 「后端 title 为「新会话」占位」时的前端兜底（首条用户消息 / 短 id）。
 */
function sessionTitle(sessionId?: string | null): string {
  if (!sessionId) return '新会话'
  const cached = sessionMessagesCache.get(sessionId)
  if (cached) {
    const firstUser = cached.find((m) => m.role === 'user')
    if (firstUser && firstUser.content.trim()) {
      const t = firstUser.content.trim()
      return t.length > 24 ? t.slice(0, 24) + '…' : t
    }
  }
  return `会话 · ${sessionId.slice(0, 8)}`
}

/** 会话列表 */
async function listSessions(): Promise<RustSessionInfo[]> {
  const list = await safeInvoke<RustSessionInfo[]>('list_sessions')
  sessionList.value = list
  return list
}

/** 目录实体列表（cmd_list_workdirs；Phase 3 会话树分组标签来源，失败静默保持空） */
async function loadWorkdirs(): Promise<void> {
  try {
    const list = await safeInvoke<RustWorkdirRecord[]>('cmd_list_workdirs')
    workdirs.value = Array.isArray(list) ? list : []
  } catch (err) {
    console.warn('[useAgentRust] loadWorkdirs 失败，保持已有目录实体:', err)
  }
}

/** 刷新会话列表（内部：写入 sessionList） */
async function refreshSessionList(): Promise<void> {
  await listSessions()
  // Phase 3：同步刷新目录实体，保证会话树分组标签与目录列表一致
  await loadWorkdirs()
}

/**
 * 启动/进入空间时恢复上次会话：无活跃会话则回到 LAST_SESSION_KEY 指向的会话（若仍存在），
 * 否则取列表首个。仅当有会话时生效；已活跃则跳过（幂等）。修复「侧边栏默认关闭 → 加载后
 * 无活跃会话 → 执行面板 tab 静默失效」问题：恢复逻辑提升到本层，不再依赖侧边栏挂载。
 */
async function restoreLastSession(): Promise<void> {
  // L3：草稿态跳过自动恢复（用户点「+」进入草稿后不应被切回旧会话）
  if (currentSessionId.value != null || draftSessionActive.value) return
  let list: RustSessionInfo[] = []
  try {
    list = await listSessions()
  } catch {
    return
  }
  if (list.length === 0) return
  let lastId: string | null = null
  try { lastId = localStorage.getItem(LAST_SESSION_KEY) } catch {}
  const target = lastId && list.some((s) => s.id === lastId) ? lastId : list[0].id
  await switchSession(target)
}

/** 删除会话（若删除的是当前会话，清空本地状态） */
async function deleteSession(sessionId: string): Promise<void> {
  await safeInvoke('delete_session', { sessionId })
  sessionMessagesCache.delete(sessionId)
  sessionTurnsCache.delete(sessionId)
  // 级联清理该会话的视图状态（场景/模式/execTab/活动/编排）
  useSessionViewState().removeSession(sessionId)
  teardownDeepPhaseListener(sessionId)
  teardownA2UIListener(sessionId)
  teardownSubAgentListener(sessionId)
  teardownStreamListener(sessionId)
  teardownConfirmListener(sessionId)
  teardownTraceListener(sessionId)
  teardownOrchestrationTraceListener(sessionId)
  if (currentSessionId.value === sessionId) {
    currentSessionId.value = null
    // Phase 4 工作区：删除当前会话时清空工作区引用
    currentWorkdir.value = null
    messages.value = []
    turns.value = []
    currentTurnId.value = null
    deepSegments.value = []
    a2uiSurfaces.value = {}
    subAgents.value = []
    // M2 编排迹线：删除当前会话时清空 run 状态
    resetOrchestrationTrace()
  }
  await refreshSessionList()
}

/** 重命名会话标题（写穿 Rust SQLite，随后刷新列表） */
async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  await safeInvoke('update_session_title', { sessionId, title })
  await refreshSessionList()
}

/** 更新会话绑定的工作区根目录（目录选择器切换工作区时同步会话归属；workdir 可为 null=不限定） */
async function updateSessionWorkdir(sessionId: string, workdir: string | null): Promise<void> {
  await safeInvoke('cmd_update_session_workdir', { sessionId, workdir })
  await refreshSessionList()
}

/** 设置会话固定状态（写穿 Rust SQLite，随后刷新列表） */
async function setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
  await safeInvoke('set_session_pinned', { sessionId, pinned })
  await refreshSessionList()
}

// ─── MCP 连接（H2 重建 P2，2026-08-30 · Rust 原生 rmcp 后端真实接线）───
// 配置持久化（SQLite mcp.db）与连接生命周期（应用级）全在 Rust 侧；
// 本层只做 invoke 转发。旧 localStorage 伪状态已废弃（agent_mcp_connections key 不再读写）。

/** 已保存配置 + 活跃状态合并视图（面板列表数据源） */
async function getMCPConnections(): Promise<MCPConnectionState[]> {
  const saved = await safeInvoke<MCPConnectionConfig[]>('cmd_mcp_saved', {}).catch(() => [])
  const status = await safeInvoke<Array<{ id: string; connected: boolean; toolCount: number }>>(
    'cmd_mcp_status',
    {},
  ).catch(() => [] as Array<{ id: string; connected: boolean; toolCount: number }>)
  const statusMap = new Map(status.map((s) => [s.id, s]))
  return saved.map((config) => {
    const st = statusMap.get(config.id)
    return {
      id: config.id,
      config,
      // 真实状态：enabled 且 Rust 侧活跃连接才算 connected
      status: config.enabled && st?.connected ? 'connected' : 'disconnected',
      tools: [],
    } as MCPConnectionState
  })
}

/** 保存配置并连接（rmcp：stdio/http 按配置分派），幂等（同 id 重连） */
async function addMCPConnection(config: MCPConnectionConfig): Promise<void> {
  await safeInvoke('cmd_mcp_connect', { config })
}

/** 删除配置并断开（连接保留语义由 toggle 组合表达） */
async function removeMCPConnection(serverId: string): Promise<void> {
  await safeInvoke('cmd_mcp_delete', { serverId })
}

/** 切换会话（加载该会话的消息历史） */
async function switchSession(sessionId: string): Promise<void> {
  // 清理旧会话的深度阶段与 A2UI 监听，切换到新会话
  const oldSessionId = currentSessionId.value
  if (oldSessionId && oldSessionId !== sessionId) {
    teardownDeepPhaseListener(oldSessionId)
    teardownA2UIListener(oldSessionId)
    teardownSubAgentListener(oldSessionId)
    teardownStreamListener(oldSessionId)
    teardownConfirmListener(oldSessionId)
    teardownPlanListener(oldSessionId)
    teardownTraceListener(oldSessionId)
    teardownOrchListener(oldSessionId)
    teardownOrchSupervisorListener(oldSessionId)
    teardownOrchestrationTraceListener(oldSessionId)
  }
  currentSessionId.value = sessionId
  // Phase 4 工作区：切换会话时恢复该会话绑定的工作区根目录（列表缺省为 null=不限定）
  currentWorkdir.value = sessionList.value.find((s) => s.id === sessionId)?.workdir ?? null
  // 会话级视图状态：水合该会话的场景/模式/execTab/活动日志/编排现场（切换即恢复）
  useSessionViewState().setActiveSession(sessionId)
  deepSegments.value = []
  a2uiSurfaces.value = {}
  subAgents.value = []
  // M2 编排迹线：切会话重置 run 状态（run 挂会话，不跨会话残留）
  resetOrchestrationTrace()
  await setupDeepPhaseListener(sessionId)
  await setupA2UIListener(sessionId)
  await setupSubAgentListener(sessionId)
  await setupStreamListener(sessionId)
  await setupConfirmListener(sessionId)
  await setupPlanListener(sessionId)
  await setupTraceListener(sessionId)
  await setupOrchListener(sessionId)
  await setupOrchSupervisorListener(sessionId)
  await setupOrchestrationTraceListener(sessionId)
  // FrontendToolBridge：全局桥监听器幂等注册（保证任意会话切换路径可用）
  await setupToolBridgeListener()
  // Phase 3：切换会话后同步刷新目录实体，保证会话树分组最新
  await loadWorkdirs()
  const cached = sessionMessagesCache.get(sessionId)
  if (cached) {
    messages.value = cached
  } else {
    messages.value = []
  }
  // rustMsgs 提升到分支外：事件流重建需要原始形态（含 tool_call_id / meta.thinking）
  let rustMsgs: RustMessage[] = []
  try {
    rustMsgs = await safeInvoke<RustMessage[]>('get_messages', { sessionId })
    const tsMsgs = rustMsgs.map(rustMsgToTsMsg)
    messages.value = tsMsgs
    sessionMessagesCache.set(sessionId, tsMsgs)
  } catch (err) {
    console.warn(`[useAgentRust] switchSession(${sessionId}) 加载消息失败（保持缓存）:`, err)
  }
  // 轮次树：优先从会话缓存恢复；缺失则按历史消息重建并写回缓存
  // 去重不再是问题——归约器本身幂等（动作段按 id、文本段按候选游标），无需事后扫描
  // 展平/映射缓存随会话切换清空（跨会话行 id 必然重复，不清会累积）
  resetStreamCaches()
  currentTurnId.value = null
  turns.value = []
  const cachedTurns = sessionTurnsCache.get(sessionId)
  if (cachedTurns) {
    turns.value = cachedTurns
  } else if (rustMsgs.length > 0) {
    turns.value = rebuildTurnsFromMessages(rustMsgs)
    sessionTurnsCache.set(sessionId, turns.value)
  }
  // A4 Plan-Exec：切换会话时恢复该会话的计划（按会话隔离），无计划则清空
  try {
    const snap = await safeInvoke<RustStateSnapshot>('get_state', { sessionId })
    const plan = snap?.plan
    if (plan && plan.length > 0) {
      // Rust 端 description 可能为 null，映射为前端 usePlanStore 期望的形态
      usePlanStore().createPlan(
        plan.map((p) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          description: p.description ?? undefined,
          order: p.order,
        })),
      )
    } else {
      usePlanStore().clearPlan()
    }
  } catch (err) {
    console.warn(`[useAgentRust] switchSession(${sessionId}) 恢复计划失败:`, err)
  }
}

// ─── 命令封装：对话主链路 ────────────────────────────────────

/** H5 规则工程（P2，2026-08-30）：项目规则文件名（workdir 根，随项目走，类比 AGENTS.md）
 *  导出供 ProjectRulesEditor（编辑侧）共用，保证读写文件名单一来源 */
export const PROJECT_RULES_FILE = 'WORLDSMITH.md'

/**
 * 读取项目规则文本（workdir/WORLDSMITH.md）
 *
 * 未绑定 workdir 或文件不存在时返回 null（无规则不注入）。
 * 规则内容经 new_session(system_prompt) 的 static_p 段注入（与场景 prompt 拼接非覆盖）。
 */
async function loadProjectRules(): Promise<string | null> {
  const dir = currentWorkdir.value
  if (!dir) return null
  try {
    const content = await tauriInvoke<string>('cmd_fs_read', { path: `${dir}/${PROJECT_RULES_FILE}` })
    return content?.trim() ? content : null
  } catch {
    return null // 文件不存在（首次使用）视为无规则
  }
}

/**
 * 构建会话级 system prompt 注入段（ensureSession → newSession 用）。
 *
 * 组成（按序拼接，空段跳过）：
 * ① 项目规则（H5 P2：workdir/WORLDSMITH.md，用户自写的强制约束）；
 * ② 技能索引（H3 P1：initSkillRegistry 每次建会话重扫 + buildSkillIndexPrompt 启停过滤）。
 *
 * 注入契约：new_session(system_prompt) → AgentLoopConfig.system_prompt →
 * build_prompt_options 的 static_p 段与场景 prompt **拼接**（非覆盖，
 * 见 agent-kernel memory.rs）；LLM 据此遵守规则并调用 load_skill 激活技能。
 *
 * ⚠ TODO(await-user · 2026-08-30)：H5 规则工程的设计点已标记待用户说明——
 * 注入措辞（「强制严格遵守」）、生效时机（仅新会话）、单文件格式（WORLDSMITH.md）。
 * 用户后续说明后按其要求调整；调整前请勿视为最终设计。
 */
async function buildSessionSystemPrompt(): Promise<string | undefined> {
  const sections: string[] = []

  // ⚠ TODO(await-user)：规则注入段（措辞/生效时机待用户说明，见函数头标记）
  const rules = await loadProjectRules()
  if (rules) {
    sections.push('## 项目规则（Project Rules）\n\n以下是本项目的强制规则，必须严格遵守：\n\n' + rules.trim())
  }

  try {
    await initSkillRegistry()
  } catch (e) {
    console.warn('[useAgentRust] initSkillRegistry 失败，仅内置技能参与索引', e)
  }
  const index = buildSkillIndexPrompt()
  if (index) sections.push(index)

  return sections.length ? sections.join('\n\n') : undefined
}

/**
 * 确保存在当前会话（无则新建）
 */
async function ensureSession(): Promise<string> {
  if (currentSessionId.value) return currentSessionId.value
  const info = await newSession(await buildSessionSystemPrompt())
  return info.id
}

/** 发送消息（send_message ReAct 循环执行，实现 IAgentBackend.prompt），详细见 docs/details/注释/tauri/useAgentRust.md */
async function prompt(text: string, options?: PromptOptions): Promise<void> {
  const sessionId = await ensureSession()
  const textContent = text.trim()
  // 并发门控（对齐 OpenCode ensureRunning）：上一轮仍在流式/生成时不重复创建 user 消息。
  // 防止连点/重入/非 UI 路径（AISidebar/插件）在 Running 状态下再调 send，避免重复 user 行与重复 AI 响应。
  if (isStreaming.value) {
    console.warn('[useAgentRust] 上一轮仍在生成，忽略重复 send')
    return
  }
  // 上一轮编排 run 异常未收口（后端 error 路径不产 pipe_finished）→ 本地强制收口为 failed，
  // 防止残留的 activeRun 让本轮 react 流式也被 O1/O4 的「编排期间流式抑制」误伤
  if (activeRun.value) {
    const stale = activeRun.value
    stale.status = 'finished'
    stale.finishedStatus = stale.finishedStatus ?? 'failed'
    stale.finishedAt = Date.now()
    if (!finishedRuns.value.some((fr) => fr.runId === stale.runId)) {
      finishedRuns.value = [...finishedRuns.value, stale]
    }
    activeRun.value = null
  }
  // 确保当前会话的 Rust 端已注入模型 + API Key（幂等兜底，避免新会话空 key 报「API Key 缺失」）
  await ensureModelKey()
  // 发送文本 = 用户输入 + 附件注入内容（hiddenText，如"仅附件"消息、图片占位、文件全文）
  const effective = options?.hiddenText ? `${textContent}\n\n${options.hiddenText}` : textContent
  if (!effective.trim()) return

  // 深度模式：为当前会话建立 DeepPhaseChanged 事件监听（幂等）
  await setupDeepPhaseListener(sessionId)
  // 流式监听：支持打字机效果（幂等）
  await setupStreamListener(sessionId)

  // 用户消息（气泡只显示用户输入文本，附件注入内容不进显示）
  const userMsg: AgentMessage = {
    id: nextMsgId('user'),
    role: 'user',
    content: textContent,
    timestamp: Date.now(),
    images: options?.images,
    files: options?.files,
  }
  messages.value.push(userMsg)
  sessionMessagesCache.get(sessionId)?.push(userMsg)
  // 开新轮次（① 用户消息层）：后续流式事件按 turnId 归属到本轮
  const turnId = nextMsgId('turn')
  currentTurnId.value = turnId
  applyTurnEvent(sessionId, {
    type: 'turn_start',
    turnId,
    userMessage: {
      id: userMsg.id,
      text: textContent,
      timestamp: userMsg.timestamp,
      images: options?.images,
      files: options?.files,
    },
  })

  emit({ type: 'agent_start', sessionId, chatMode: options?.chatMode ?? 'deep' })

  isStreaming.value = true
  try {
    const result = await safeInvoke<RustSendMessageResult>('send_message', {
      params: {
        sessionId,
        text: effective,
        images: (options?.images ?? []).map((img) => ({
          data: img.data,
          mimeType: img.mimeType,
        })),
        mode: options?.chatMode ?? null,
      },
    })

    // 助手回复：与流式事件创建的助手消息去重
    // 若已通过 stream 事件落地（打字机），直接复用该消息并以 reply 为最终权威内容；
    // 否则（非流式后端）一次性创建助手消息。
    const streamed = lastStreamedMsg.value
    lastStreamedMsg.value = null
    streamingAssistant.value = null

    // 累计用量（send_message 响应携带会话累计 input/output tokens）
    if (result.usage) {
      totalUsage.value = {
        ...totalUsage.value,
        requestCount: totalUsage.value.requestCount + 1,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
      }
    }

    let assistantMsg: AgentMessage
    if (streamed) {
      assistantMsg = { ...streamed, content: result.reply }
      upsertMsgInSession(streamed.id, assistantMsg, sessionId)
    } else {
      assistantMsg = {
        id: nextAssistantId(),
        role: 'assistant',
        content: result.reply,
        timestamp: Date.now(),
      }
      messages.value.push(assistantMsg)
      sessionMessagesCache.get(sessionId)?.push(assistantMsg)
    }
    // 轮次收口：以 reply 为权威固化 ③ 结果层（turn_end 唯一发送点）
    applyTurnEvent(sessionId, {
      type: 'turn_end',
      turnId,
      status: 'complete',
      finalText: result.reply,
    })
    currentTurnId.value = null

    emit({ type: 'message_start', message: assistantMsg })
    emit({ type: 'message_end', messageId: assistantMsg.id, content: result.reply, thinking: '' })
    emit({ type: 'turn_end', message: assistantMsg })

    // Phase 5：首条消息成功回复后，激活「待激活」会话并异步生成 LLM 标题
    const wasPending = pendingSessionIds.value.includes(sessionId)
    if (wasPending) {
      // 1) 移除待激活标记 → 刷新列表展示会话条目（占位「新会话」归属到目录组）；
      //    刷新失败仅告警，不计入消息发送失败（消息已成功回复）
      pendingSessionIds.value = pendingSessionIds.value.filter((id) => id !== sessionId)
      try {
        await refreshSessionList()
      } catch (err) {
        console.warn('[useAgentRust] 激活会话刷新列表失败:', err)
      }
      // 2) 标题到来前，消息区显示等候动画（按会话隔离标记，避免切会话串扰）
      sessionTitlePending.value[sessionId] = true
      // 3) 异步调 Rust 生成标题（不阻塞输出流；完成后经 agent:session_title_updated 事件更新 Sidebar）
      void generateSessionTitle(sessionId, textContent, result.reply).finally(() => {
        // 兜底：无论生成成功/失败/无事件送达，标题终会落地或保留占位，动画不应残留。
        // 仅清除该会话的标记，避免误清其他会话（切会话场景）。
        delete sessionTitlePending.value[sessionId]
      })
    } else {
      // X1 配套：每轮回复成功后同步侧栏 message_count（后端 finalize/react 均已回写 meta，
      // 前端列表是快照缓存，不刷新会停留在上轮数值；激活分支上面已刷，此处补常规轮次）
      void refreshSessionList().catch((err) => {
        console.warn('[useAgentRust] 回复后刷新会话列表失败:', err)
      })
    }
  } catch (err) {
    // 增强错误信息：附加当前会话/模型配置/key 注入状态，便于在 UI 直接定位「API Key 缺失」根因
    let diagSuffix = ''
    try {
      const s = useSettingsStore()
      const sess = currentSessionId.value
      const provider = s.aiProviderMode === 'cloud' ? (s.aiCloudProvider || '') : (s.aiProviderMode === 'custom' ? (s.aiCustomType || '') : (s.aiLocalType || ''))
      const model = s.aiProviderMode === 'cloud' ? s.aiCloudModel : (s.aiProviderMode === 'custom' ? s.aiCustomModel : s.aiLocalModel)
      const key = (provider && modelKeyInjectedSessions.has(sess ?? '')) ? '(已注入本会话)' : '(本会话尚未注入key)'
      diagSuffix = ` [诊断: session=${sess?.slice(0,8)}, mode=${s.aiProviderMode}, provider=${provider}, model=${model || '空'}, key=${key}]`
    } catch {}
    const error = err instanceof Error ? new Error(err.message + diagSuffix) : new Error(String(err) + diagSuffix)
    // 轮次收口为 error：保留已累积的过程层内容，结果层不落地
    applyTurnEvent(sessionId, { type: 'turn_end', turnId, status: 'error' })
    currentTurnId.value = null
    emit({ type: 'error', error })
    emit({ type: 'agent_end', sessionId, messages: messages.value })
    throw error
  } finally {
    isStreaming.value = false
  }

  emit({ type: 'agent_end', sessionId, messages: messages.value })
}

/** 中途引导（对应 Rust `steer`，实现 IAgentBackend.steer） */
async function steer(text: string): Promise<void> {
  const sessionId = await ensureSession()
  await safeInvoke('steer', { sessionId, text })
}

/** follow-up（对应 steer，实现 IAgentBackend.followUp） */
async function followUp(text: string): Promise<void> {
  await steer(text)
}

/** 中断当前运行（对应 Rust `abort`） */
async function abort(): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  await safeInvoke('abort', { sessionId })
  isStreaming.value = false
  streamingAssistant.value = null
  // N4 修复：流中断提示——轮次标记 aborted，展平时在末尾补「已由用户停止」分隔行
  const turnId = currentTurnId.value
  if (turnId) {
    applyTurnEvent(sessionId, { type: 'turn_end', turnId, status: 'aborted' })
    currentTurnId.value = null
  }
}

/** A7：设置当前会话安全级别（off / dangerous_only / moderate_and_dangerous，运行时生效） */
async function setSecurityLevel(level: string): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  await safeInvoke('cmd_agent_set_security_level', { sessionId, level })
}

/** 清空历史（对应 Rust `clear_history`） */
async function clearHistory(): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  await safeInvoke('clear_history', { sessionId })
  messages.value = []
  sessionMessagesCache.set(sessionId, [])
  resetStreamCaches()
  turns.value = []
  sessionTurnsCache.set(sessionId, [])
  currentTurnId.value = null
}

/** 从后端重新拉取当前会话消息并更新本地状态与缓存（trim / 外部变更后调用） */
async function refreshMessages(): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  try {
    const rustMsgs = await safeInvoke<RustMessage[]>('get_messages', { sessionId })
    const tsMsgs = rustMsgs.map(rustMsgToTsMsg)
    messages.value = tsMsgs
    sessionMessagesCache.set(sessionId, tsMsgs)
  } catch (err) {
    console.warn(`[useAgentRust] refreshMessages 失败:`, err)
  }
}

/** 清理上下文窗口（对应 Rust `trim_context`，移除前 upToIndex 条消息） */
async function trimContext(upToIndex: number): Promise<void> {
  const sessionId = await ensureSession()
  await safeInvoke('trim_context', { sessionId, upToIndex })
  await refreshMessages()
}

/** 热切换模型（对应 Rust `update_model`） */
async function updateModel(
  provider: string,
  modelId: string,
  baseUrl?: string,
  apiKey?: string,
  _contextWindow?: number,
  maxTokens?: number,
  temperature?: number,
  topP?: number,
  topK?: number,
  thinkingMode?: boolean,
): Promise<void> {
  const sessionId = await ensureSession()
  await safeInvoke('update_model', {
    params: {
      sessionId,
      provider,
      modelId,
      baseUrl: baseUrl ?? null,
      apiKey: apiKey ?? null,
      temperature: temperature ?? null,
      maxTokens: maxTokens ?? null,
      // Top P：前端滑块 0~100，Rust/genai 需 0~1
      topP: topP != null ? topP / 100 : null,
      topK: topK ?? null,
      thinkingMode: thinkingMode ?? null,
    },
  })
}

// ─── 发送前「确保模型 + API Key 已注入 Rust 会话」 ───────────────────────
//
// 背景：Rust 侧 `new_session` 用默认占位配置（空 api_key）创建 AgentLoop，key 需前端
// 显式调用 `update_model` / `set_provider_config` 才会写入。而这两者的注入点（ModelSwitcher
// 切换模型 / ModelSettingsDialog 保存 / 设置面板 onModelChange）都要求 `currentSessionId`
// 已存在；若用户「配置完 key 后才建会话」或「应用重启 / 切换会话」，新会话的 Rust 端
// 仍是空 key → `send_message` 报「API Key 缺失」。
//
// 修复：在 `prompt`（send_message）发送前兜底注入——从 localStorage 的 `agent_current_model`
// 读当前 provider/model，经 `loadApiKey(provider)` 取已存 key，若该会话尚未注入过则
// 复用 `update_model` 把 key 推给 Rust。用 Set 记忆已注入会话避免每轮重复 invoke。
const modelKeyInjectedSessions = new Set<string>()

/**
 * 确保当前会话的 Rust 端已注入模型 + API Key（幂等兜底，发送前调用）
 *
 * 数据源取 `settingsStore`（@worldsmith/entity-core，权威）：按 mode 分支读
 * cloud（aiCloudProvider/aiCloudModel）/ local（endpoint/apiType/model）/
 * custom（baseUrl/apiType/model）。key 经 `loadApiKey(provider)` 读取。
 * 有 model 且该会话未经注入过 → 调 `update_model` 注入；否则保持现状
 * （由 Rust 返回「API Key 缺失」错误引导用户配置）。
 */
async function ensureModelKey(): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId || modelKeyInjectedSessions.has(sessionId)) return
  // 记录进入态（诊断：确认是否因 sessionId 空 或 key 未存而跳过）
  void safeInvoke('cmd_diag_log', {
    label: 'ensureModelKey.enter',
    payload: { sessionId },
  }).catch(() => {})
  // settingsStore 需要 Pinia 激活；模块级惰性获取
  let provider: string
  let modelId: string
  let baseUrl: string | undefined
  let apiKey: string
  try {
    const s = useSettingsStore()
    if (s.aiProviderMode === 'custom') {
      provider = s.aiCustomType || 'openai-compatible'
      modelId = s.aiCustomModel
      baseUrl = s.aiCustomBaseUrl || undefined
    } else if (s.aiProviderMode === 'local') {
      provider = s.aiLocalType || 'ollama'
      modelId = s.aiLocalModel
      baseUrl = s.aiLocalEndpoint || undefined
    } else {
      provider = s.aiCloudProvider || 'deepseek'
      modelId = s.aiCloudModel
    }
    if (!modelId) {
      void safeInvoke('cmd_diag_log', {
        label: 'ensureModelKey.noModel',
        payload: { provider, mode: s.aiProviderMode },
      }).catch(() => {})
      return // 未选模型 → 交由用户配置，不猜测
    }
    apiKey = await loadApiKey(provider)
  } catch (err) {
    console.warn('[useAgentRust] ensureModelKey 读取模型配置失败:', err)
    return
  }
  // 诊断：确认读到 provider/model/key 三者（同时打到 Rust tracing，便于在终端定位）
  console.warn('[ensureModelKey] 诊断:', { sessionId, provider, modelId, baseUrl, hasKey: !!apiKey, keyLen: apiKey?.length ?? 0 })
  void safeInvoke('cmd_diag_log', {
    label: 'ensureModelKey.value',
    payload: { sessionId, provider, modelId, baseUrl, hasKey: !!apiKey, keyLen: apiKey?.length ?? 0 },
  }).catch(() => {})
  if (!apiKey) return // 无已存 key → 保持现状，Rust 返回缺失错误引导用户
  try {
    await updateModel(provider, modelId, baseUrl, apiKey, undefined, 8192, undefined)
    modelKeyInjectedSessions.add(sessionId)
    void safeInvoke('cmd_diag_log', {
      label: 'ensureModelKey.injected',
      payload: { sessionId, provider, modelId },
    }).catch(() => {})
  } catch (err) {
    console.warn('[useAgentRust] ensureModelKey 注入 API Key 失败:', err)
  }
}

/** 更新思考级别（对应 Rust `update_thinking_level`），成功后同步本地状态供选择器展示 */
async function updateThinkingLevel(level: ThinkingLevel): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  await safeInvoke('update_thinking_level', { sessionId, level })
  thinkingLevel.value = level
}

/** 获取 Provider 配置（对应 Rust `get_provider_config`） */
async function getProviderConfig(): Promise<RustProviderConfig | null> {
  const sessionId = currentSessionId.value
  if (!sessionId) return null
  try {
    return await safeInvoke<RustProviderConfig>('get_provider_config', { sessionId })
  } catch {
    return null
  }
}

/**
 * 整体写入 Provider 配置（对应 Rust `set_provider_config`，5.4 真实 LLM 接入）
 *
 * 前端从本地存储读取配置 + API Key 后传入，支持 cloud/local/custom 三种
 * 模式，可跨模式切换，不清空消息历史。
 */
async function setProviderConfig(config: RustProviderConfigFull): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  await safeInvoke('set_provider_config', { sessionId, config })
}

/**
 * 注入备用 API Key 池（对应 Rust `set_api_key_pool`，A2 多 Key 降级）
 *
 * 主 key 由 `setProviderConfig` 写入；`keys` 为备用 key 池，主 key 请求
 * 命中认证/限流/网络错误时逐把降级重试。
 */
async function setApiKeyPool(keys: string[]): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  await safeInvoke('set_api_key_pool', { sessionId, keys })
}

/** 获取心跳状态（对应 Rust `get_heartbeat`，长任务监控） */
async function getHeartbeat(): Promise<RustHeartbeatStatus> {
  const sessionId = currentSessionId.value
  if (!sessionId) return 'alive'
  try {
    return await safeInvoke<RustHeartbeatStatus>('get_heartbeat', { sessionId })
  } catch {
    return 'alive'
  }
}

/** 获取状态快照（对应 Rust `get_state`，含 current_iteration 等运行进度） */
async function getState(): Promise<RustStateSnapshot | null> {
  const sessionId = currentSessionId.value
  if (!sessionId) return null
  try {
    return await safeInvoke<RustStateSnapshot>('get_state', { sessionId })
  } catch {
    return null
  }
}

// ─── 事件订阅 / 释放 ────────────────────────────────────

/** 订阅 Agent 事件（实现 IAgentBackend.subscribe） */
function subscribe(listener: AgentEventListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 释放后端资源（实现 IAgentBackend.dispose） */
function dispose(): void {
  listeners.clear()
  // 清理所有深度阶段事件监听器
  for (const unlisten of deepPhaseUnlistenFns.values()) {
    unlisten()
  }
  deepPhaseUnlistenFns.clear()
  // 清理所有 A2UI 事件监听器
  for (const unlisten of a2uiUnlistenFns.values()) {
    unlisten()
  }
  a2uiUnlistenFns.clear()
  // 清理所有子 Agent 委派事件监听器
  for (const unlisten of subAgentUnlistenFns.values()) {
    unlisten()
  }
  subAgentUnlistenFns.clear()
  subAgents.value = []
  // 清理所有流式事件监听器
  for (const unlisten of streamUnlistenFns.values()) {
    unlisten()
  }
  streamUnlistenFns.clear()
  streamingAssistant.value = null
  lastStreamedMsg.value = null
  // 清理所有 HITL 确认事件监听器
  for (const unlisten of confirmUnlistenFns.values()) {
    unlisten()
  }
  confirmUnlistenFns.clear()
  // 清理所有计划事件监听器（A4 Plan-Exec）
  for (const unlisten of planUnlistenFns.values()) {
    unlisten()
  }
  planUnlistenFns.clear()
  // 清理所有 trace 事件监听器（A1 全链路事件流可观测）
  for (const unlisten of traceUnlistenFns.values()) {
    unlisten()
  }
  traceUnlistenFns.clear()
  // 清理 FrontendToolBridge 全局桥监听器
  teardownToolBridgeListener()
  // 清理会话标题更新全局监听器（Phase 5）
  if (sessionTitleUnlisten) {
    sessionTitleUnlisten()
    sessionTitleUnlisten = null
  }
  // 清理轮次树状态
  turns.value = []
  sessionTurnsCache.clear()
  currentTurnId.value = null
}

// ─── 派生状态 ────────────────────────────────────

/** 最后一条助手消息是否有内容（AgentSpaceChat / AgentMessageList 依赖） */
const lastAssistantHasContent = computed(() => {
  const last = [...messages.value].reverse().find((m) => m.role === 'assistant')
  return last ? Boolean(last.content) : false
})

/** 最后一条助手消息是否有思考过程 */
const lastAssistantHasThinking = computed(() => {
  const last = [...messages.value].reverse().find((m) => m.role === 'assistant')
  return last ? Boolean((last as { thinking?: unknown }).thinking) : false
})

// ─── 命令入口：sendMessage 别名（AgentSpaceChat 调用） ────────────────────

/** 发送消息并返回助手回复（供 UI 直接使用，等价 prompt + 返回值） */
async function sendMessage(
  text: string,
  images?: ImageAttachment[],
  files?: FileAttachment[],
  mode?: ChatMode,
): Promise<void> {
  await prompt(text, { images, files, chatMode: mode })
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue Composable（模块级单例）
// ─────────────────────────────────────────────────────────────────────────────

/** Tauri 端 Agent Backend composable（模块级单例，实现 IAgentBackend 契约），详细见 docs/details/注释/tauri/useAgentRust.md */
export function useAgentRust() {
  return {
    // ── IAgentBackend 契约 ──
    prompt,
    steer,
    followUp,
    abort,
    setSecurityLevel,
    updateModel,
    updateThinkingLevel,
    clearHistory,
    subscribe,
    dispose,
    isStreaming: readonly(isStreaming),

    // ── 会话管理 ──
    newSession,
    newDraftSession,
    draftSessionActive,
    listScenarios,
    listSessions,
    deleteSession,
    updateSessionTitle,
    updateSessionWorkdir,
    setSessionPinned,
    switchSession,
    restoreLastSession,
    sessionTitle,
    currentSessionId,
    // Phase 4 工作区：当前会话绑定的工作区根目录（WorkspacePanel 消费）
    currentWorkdir,
    sessionList,
    // Phase 5：待激活会话（SessionSidebar 过滤）+ 标题生成中等候动画（消息区）
    pendingSessionIds,
    sessionTitlePending,
    // Phase 3 会话树：目录实体列表 + 刷新（SessionSidebar 分组用）
    workdirs,
    loadWorkdirs,

    // ── MCP 连接（本地管理，供设置面板 McpPanel 使用）──
    getMCPConnections,
    addMCPConnection,
    removeMCPConnection,

    // ── 用量（设置面板 UsagePanel 依赖）──
    totalUsage,

    // ── 消息 ──
    messages,
    sendMessage,
    lastAssistantHasContent,
    lastAssistantHasThinking,

    // ── 事件流（唯一渲染源，Phase 1+）──
    agentStream,
    // 过程层折叠态（用户手动展开/收起；自动折叠控制器写同一字段）
    setProcessCollapsed,
    markTurnExpanded,
    autoCollapseProcess,
    // 轮次树（折叠控制器与视口判定消费）
    turns,

    // ── 深度模式段（DeepProcessPanel 依赖）──
    /** @deprecated 待后续清理，改用 agentStream */
    deepSegments,
    resolveToolConfirmation,

    // ── A2UI（A2UIRenderer 依赖）──
    a2uiSurfaces,
    resolveDataBinding,

    // ── 子 Agent 委派状态（SubAgentSection 依赖）──
    subAgents,

    // ── 流式响应（打字机效果）──
    streamingAssistant,
    lastStreamedMsg,

    // ── 状态查询 ──
    getProviderConfig,
    setProviderConfig,
    setApiKeyPool,
    getHeartbeat,
    getState,
    refreshMessages,
    trimContext,
    isInitialized,
    thinkingLevel,

    // ── 初始化（Tauri 端同步就绪，返回 true）──
    ensureInitialized: async (): Promise<boolean> => {
      isInitialized.value = true
      return true
    },
  } as any
}