/** useAgentRust：Tauri 端 Agent Backend 适配器（Rust IPC + 事件转发），详细见 docs/details/注释/tauri/useAgentRust.md */

// re-export 共享类型（与 Web 端 useAgent 一致，供依赖这些类型的组件使用）
export type {
  ChatMode,
  InteractiveToolType,
  ToolCallView,
  PhaseOutput,
  FinalOutput,
  DeepSegment,
} from '@worldsmith/shared-composables/agent/useAgent'

// re-export 注入工具（供需要 provide/inject 的组件使用）
export {
  provideAgentBackend,
  useAgentOptional,
  AGENT_BACKEND_INJECTION_KEY,
} from '@worldsmith/shared-composables/agent/useAgent'

import { ref, computed, readonly } from 'vue'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useConfirm } from '@worldsmith/ui-kit'
import { ALL_TOOLS_MAP, loadApiKey, type IToolContext } from '@agent/index'
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
import type { DeepSegment } from '@worldsmith/shared-composables/agent/useAgent'
import { usePlanStore } from '@worldsmith/shared-composables/agent/usePlanStore'
import { useActivityLog, type ActivityLogEntry } from './useActivityLog'

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
    default:
      // 无法桥接 Rust 的命令返回空对象，避免调用方因 undefined 崩溃
      return {}
  }
}

/** 安全 invoke：Tauri 环境走真实 IPC；浏览器 preview 走 mock */
function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
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
  | { type: 'end'; fullText: string }
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
  /** A3 四管线路由开关（持久化） */
  routerEnabled: boolean
}

/** Rust `agent_runtime::types::OrchestratorMessage` 镜像 */
interface RustMessage {
  role: 'user' | 'assistant' | 'tool_result' | 'system'
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
 * - role：`tool_result` → `toolResult`（TS 约定）
 * - 补充 `id` / `timestamp`（Rust 端无此字段，前端生成）
 * - tool_calls → toolCalls（camelCase）
 */
function rustMsgToTsMsg(r: RustMessage, index: number): AgentMessage {
  return {
    id: `rust-${Date.now()}-${index}`,
    role: r.role === 'tool_result' ? 'toolResult' : r.role,
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

/** 当前会话 ID（null=尚未创建会话） */
const currentSessionId = ref<string | null>(null)
/** 当前会话消息列表 */
const messages = ref<AgentMessage[]>([])
/** 是否正在流式输出 */
const isStreaming = ref(false)
/** 会话列表（listSessions 结果） */
const sessionList = ref<RustSessionInfo[]>([])
/** 当前会话的四管线路由开关（A3，持久化；无会话/缺省视为开启） */
const currentSessionRouterEnabled = computed<boolean>(() => {
  const sid = currentSessionId.value
  if (!sid) return true
  const s = sessionList.value.find((x) => x.id === sid)
  return s ? s.routerEnabled : true
})
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

/** 深度模式段（thinking | phase），由 Rust DeepPhaseChanged 事件驱动构建 */
const deepSegments = ref<DeepSegment[]>([])

/** 深度模式最终输出（占位：Rust 端经消息 content 返回，与 web 版一致暂未接通） */
const finalOutput = ref<unknown>(null)

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

// ─── 深度阶段事件监听（DeepPhaseChanged）────────────────────────────

/** 设置 DeepPhaseChanged 事件监听（去重/追加阶段段/更新工具与阶段状态），详细见 docs/details/注释/tauri/useAgentRust.md */
async function setupDeepPhaseListener(sessionId: string): Promise<void> {
  if (deepPhaseUnlistenFns.has(sessionId)) return

  const eventName = `agent:event:deep_phase_changed:${sessionId}`
  try {
    const unlisten = await listen<RustDeepPhaseChangedPayload>(eventName, (e) => {
      const payload = e.payload
      // 去重：同一 phaseIndex 已存在则更新其工具/状态，不重复追加
      const existing = deepSegments.value.find((s) => s.type === 'phase' && s.index === payload.phaseIndex)
      if (existing && existing.type === 'phase') {
        // 阶段完成事件（phase_completed=true）：trigger_tool 是"触发本次切换的新工具"
        // （属于下一阶段），不应加入旧阶段段。仅更新已存在工具的状态并标记完成。
        if (payload.phaseCompleted) {
          const toolIdx = existing.tools.findIndex((t) => t.name === payload.triggerTool)
          if (toolIdx >= 0) {
            existing.tools[toolIdx].status = payload.toolStatus
            if (payload.toolStatus !== 'running') existing.tools[toolIdx].endedAt = Date.now()
          }
          existing.status = 'done'
          return
        }
        // 同阶段内工具状态更新（phase_completed=false）：更新/新增触发工具
        const toolIdx = existing.tools.findIndex((t) => t.name === payload.triggerTool)
        const now = Date.now()
        if (toolIdx >= 0) {
          existing.tools[toolIdx].status = payload.toolStatus
          if (payload.toolStatus !== 'running') existing.tools[toolIdx].endedAt = now
        } else {
          existing.tools.push({
            id: `phase-tool-${now}`,
            name: payload.triggerTool,
            args: {},
            status: payload.toolStatus,
            startedAt: now,
            endedAt: payload.toolStatus !== 'running' ? now : undefined,
          })
        }
        return
      }
      // 新阶段：先把之前所有 active 阶段标记为 done（阶段切换）
      for (const seg of deepSegments.value) {
        if (seg.type === 'phase' && seg.status === 'active') {
          seg.status = 'done'
        }
      }
      const now = Date.now()
      const newSegment: DeepSegment = {
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
      }
      deepSegments.value.push(newSegment)
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
  if (payload.type === 'start') {
    const msg: AgentMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    streamingAssistant.value = msg
    lastStreamedMsg.value = msg
    messages.value.push(msg)
    sessionMessagesCache.get(sessionId)?.push(msg)
    return
  }

  if (payload.type === 'delta') {
    const target = streamingAssistant.value
    if (!target) return
    const updated: AgentMessage = { ...target, content: target.content + payload.delta }
    streamingAssistant.value = updated
    upsertMsgInSession(target.id, updated, sessionId)
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
    return
  }

  // error / agent_end：清理流式占位，保留已累积内容
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
      const approved = await confirm({
        type: 'danger',
        title: '危险操作确认',
        description: `工具 "${payload.toolName}" 将执行${argSummary ? `\n参数：${argSummary}` : ''}\n是否继续？`,
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
  if (toolBridgeContext) return toolBridgeContext
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
      dirPath: null,
    },
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
      useActivityLog().addLog(traceTypeToLogType(type), summary, undefined, type)
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

/** 新建会话（返回 Rust SessionInfo）
 * - `scenarioId`：B1 场景 ID（可选；缺省不传 → Rust 使用默认场景 worldbuilding）
 */
async function newSession(
  systemPrompt?: string,
  providerConfig?: RustProviderConfigFull,
  scenarioId?: string,
): Promise<RustSessionInfo> {
  const info = await safeInvoke<RustSessionInfo>('new_session', {
    systemPrompt: systemPrompt ?? null,
    providerConfig: providerConfig ?? null,
    scenarioId: scenarioId ?? null,
  })
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
  }
  currentSessionId.value = info.id
  messages.value = []
  // 新会话：重置流式/生成状态（旧会话失败遗留的 isStreaming 需归零）
  isStreaming.value = false
  streamingAssistant.value = null
  lastStreamedMsg.value = null
  // 新会话：清空深度模式段与 A2UI 画布，并建立事件监听
  deepSegments.value = []
  a2uiSurfaces.value = {}
  subAgents.value = []
  // A4 Plan-Exec：新会话无计划，清空 usePlanStore（按会话隔离）
  usePlanStore().clearPlan()
  sessionMessagesCache.set(info.id, [])
  await setupDeepPhaseListener(info.id)
  await setupA2UIListener(info.id)
  await setupSubAgentListener(info.id)
  await setupStreamListener(info.id)
  await setupConfirmListener(info.id)
  await setupPlanListener(info.id)
  await setupTraceListener(info.id)
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

/**
 * 会话显示标题：从消息缓存取首条用户消息截断；无数据回退短 id。
 * 供会话列表展示更友好的标题（Rust 端 SessionInfo 无 title 字段）。
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

/** 刷新会话列表（内部：写入 sessionList） */
async function refreshSessionList(): Promise<void> {
  await listSessions()
}

/** 删除会话（若删除的是当前会话，清空本地状态） */
async function deleteSession(sessionId: string): Promise<void> {
  await safeInvoke('delete_session', { sessionId })
  sessionMessagesCache.delete(sessionId)
  teardownDeepPhaseListener(sessionId)
  teardownA2UIListener(sessionId)
  teardownSubAgentListener(sessionId)
  teardownStreamListener(sessionId)
  teardownConfirmListener(sessionId)
  teardownTraceListener(sessionId)
  if (currentSessionId.value === sessionId) {
    currentSessionId.value = null
    messages.value = []
    deepSegments.value = []
    a2uiSurfaces.value = {}
    subAgents.value = []
  }
  await refreshSessionList()
}

/** 重命名会话标题（写穿 Rust SQLite，随后刷新列表） */
async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  await safeInvoke('update_session_title', { sessionId, title })
  await refreshSessionList()
}

/** 设置会话固定状态（写穿 Rust SQLite，随后刷新列表） */
async function setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
  await safeInvoke('set_session_pinned', { sessionId, pinned })
  await refreshSessionList()
}

/** 设置会话级四管线路由开关（A3，默认开启；关闭后发送跳过路由意图分类） */
async function setRouterEnabled(sessionId: string, enabled: boolean): Promise<void> {
  await safeInvoke('set_session_router_enabled', { sessionId, enabled })
}

// ─── MCP 连接（本地持久化；Rust 端暂无 MCP 后端，配置可管理，真实连接待后端支持）───

/** MCP 配置存储 key（与 shared-composables useMcpConnections 同 key，保持一致） */
const MCP_STORAGE_KEY = 'agent_mcp_connections'

function loadMcpFromStorage(): MCPConnectionConfig[] {
  try {
    const raw = localStorage.getItem(MCP_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as MCPConnectionConfig[]) : []
  } catch {
    return []
  }
}

function saveMcpToStorage(configs: MCPConnectionConfig[]): void {
  try {
    localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(configs))
  } catch {}
}

function toMcpState(config: MCPConnectionConfig): MCPConnectionState {
  return {
    id: config.id,
    config,
    status: config.enabled ? 'connected' : 'disconnected',
    tools: [],
  }
}

/** MCP 连接状态列表（读自 localStorage，映射为 MCPConnectionState） */
function getMCPConnections(): MCPConnectionState[] {
  return loadMcpFromStorage().map(toMcpState)
}

/** 添加/更新 MCP 连接（写 localStorage，幂等） */
async function addMCPConnection(config: MCPConnectionConfig): Promise<void> {
  const list = loadMcpFromStorage()
  const idx = list.findIndex((c) => c.id === config.id)
  if (idx >= 0) list[idx] = config
  else list.push(config)
  saveMcpToStorage(list)
}

/** 移除 MCP 连接（写 localStorage） */
async function removeMCPConnection(serverId: string): Promise<void> {
  const list = loadMcpFromStorage().filter((c) => c.id !== serverId)
  saveMcpToStorage(list)
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
  }
  currentSessionId.value = sessionId
  deepSegments.value = []
  a2uiSurfaces.value = {}
  subAgents.value = []
  await setupDeepPhaseListener(sessionId)
  await setupA2UIListener(sessionId)
  await setupSubAgentListener(sessionId)
  await setupStreamListener(sessionId)
  await setupConfirmListener(sessionId)
  await setupPlanListener(sessionId)
  await setupTraceListener(sessionId)
  // FrontendToolBridge：全局桥监听器幂等注册（保证任意会话切换路径可用）
  await setupToolBridgeListener()
  const cached = sessionMessagesCache.get(sessionId)
  if (cached) {
    messages.value = cached
  } else {
    messages.value = []
  }
  try {
    const rustMsgs = await safeInvoke<RustMessage[]>('get_messages', { sessionId })
    const tsMsgs = rustMsgs.map(rustMsgToTsMsg)
    messages.value = tsMsgs
    sessionMessagesCache.set(sessionId, tsMsgs)
  } catch (err) {
    console.warn(`[useAgentRust] switchSession(${sessionId}) 加载消息失败（保持缓存）:`, err)
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

/**
 * 确保存在当前会话（无则新建）
 */
async function ensureSession(): Promise<string> {
  if (currentSessionId.value) return currentSessionId.value
  const info = await newSession()
  return info.id
}

/** 发送消息（send_message ReAct 循环执行，实现 IAgentBackend.prompt），详细见 docs/details/注释/tauri/useAgentRust.md */
async function prompt(text: string, options?: PromptOptions): Promise<void> {
  const sessionId = await ensureSession()
  const textContent = text.trim()
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
    id: `user-${Date.now()}`,
    role: 'user',
    content: textContent,
    timestamp: Date.now(),
    images: options?.images,
    files: options?.files,
  }
  messages.value.push(userMsg)
  sessionMessagesCache.get(sessionId)?.push(userMsg)

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
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.reply,
        timestamp: Date.now(),
      }
      messages.value.push(assistantMsg)
      sessionMessagesCache.get(sessionId)?.push(assistantMsg)
    }

    emit({ type: 'message_start', message: assistantMsg })
    emit({ type: 'message_end', messageId: assistantMsg.id, content: result.reply, thinking: '' })
    emit({ type: 'turn_end', message: assistantMsg })
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
    listScenarios,
    listSessions,
    deleteSession,
    updateSessionTitle,
    setSessionPinned,
    setRouterEnabled,
    switchSession,
    sessionTitle,
    currentSessionId,
    sessionList,
    currentSessionRouterEnabled,

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

    // ── 深度模式段（DeepProcessPanel 依赖）──
    deepSegments,
    finalOutput,
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