/**
 * # useAgentRust — Tauri 端 Agent Backend 适配器（Phase 5.2）
 *
 * ## 架构位置
 * 本文件是 Tauri 端的 Agent Backend 入口，对应 Web 端的 useAgent.ts。
 * 通过 Tauri `invoke` 调用 Rust 命令层（`crates/agent-commands`），
 * 打通「前端 → IPC → Rust 命令 → 响应」完整链路。
 *
 * ## 端分离策略
 * - 共享层：`@worldsmith/shared-composables/agent/useAgent`（inject 模式 + 类型定义）
 * - Tauri 端：本文件（Rust IPC 适配器）
 * - Web 端：`apps/web/src/agent/composables/useAgent.ts`（本地状态机 + 占位）
 *
 * ## 与 5.1 命令层的映射
 * | TS 方法             | Rust 命令                 | 说明                                    |
 * |---------------------|---------------------------|----------------------------------------|
 * | `newSession`        | `new_session`             | 新建会话（返回 SessionInfo）            |
 * | `listSessions`      | `list_sessions`           | 会话列表                                |
 * | `deleteSession`     | `delete_session`          | 删除会话                                |
 * | `prompt`/`sendMessage`| `send_message`           | ReAct 循环执行（返回 reply + state）    |
 * | `steer`/`followUp`  | `steer`                   | 中途引导（对应 sendBlockAction）        |
 * | `abort`             | `abort`                   | 中断当前运行                            |
 * | `clearHistory`      | `clear_history`           | 清空历史                                |
 * | `updateModel`       | `update_model`            | 热切换模型                              |
 * | `updateThinkingLevel`| `update_thinking_level`  | 更新思考级别                            |
 * | `getState`          | `get_state`               | 状态快照                                |
 * | `getMessages`       | `get_messages`            | 消息列表                                |
 * | `getHeartbeat`      | `get_heartbeat`           | 心跳状态（长任务监控）                  |
 * | `getProviderConfig` | `get_provider_config`     | Provider 配置                           |
 *
 * ## 状态设计
 * 模块级单例（与 useLongTaskRust / useLoopControlRust 一致）：
 * 多次调用返回同一组响应式状态与方法，避免多组件各自维护 session/messages。
 *
 * ## 事件
 * 实现 `IAgentBackend.subscribe(listener)`，在 prompt / abort 等调用时
 * 通过 `AgentEvent` 分发（agent_start / agent_end / message_start /
 * message_end / error）。当前 5.2 为 mock 后端，send_message 一次性返回，
 * 无流式 message_update，后续接入真实 genai 后端时按需补充。
 */

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
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
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
} from '@agent/index'
import type { DeepSegment } from '@worldsmith/shared-composables/agent/useAgent'

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

// ─── Rust 端类型镜像（snake_case，与 agent-runtime 序列化一致）──────────────

/** Rust `agent_commands::SessionInfo` 镜像 */
interface RustSessionInfo {
  id: string
  created_at: number
  message_count: number
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
}

/** Rust `agent_commands::SendMessageResult` 镜像 */
interface RustSendMessageResult {
  session_id: string
  reply: string
  state: RustStateSnapshot
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

/**
 * Rust `agent_runtime::llm::config::ProviderConfig` 镜像（tagged enum，`mode` 区分）
 *
 * 三种模式（serde tag = "mode"，lowercase）：
 * - `cloud`：`{ mode, provider, model_id, api_key }`
 * - `local`：`{ mode, endpoint, api_type, model_id }`
 * - `custom`：`{ mode, base_url, api_key, api_type, model_id, context_window, max_tokens }`
 *
 * 注意：`api_key` 在 Rust 侧 `skip_serializing`（不回显），但反序列化时
 * 必需，故前端必须按模式补齐该字段。
 */
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
/** 是否已初始化（Tauri 端无需异步初始化，直接置 true） */
const isInitialized = ref(true)

/** 事件订阅者集合（subscribe 注册，dispose / 触发时分发） */
const listeners = new Set<AgentEventListener>()

/** 待办：会话消息缓存（按 sessionId），切换会话时恢复 */
const sessionMessagesCache = new Map<string, AgentMessage[]>()

/** 深度模式段（thinking | phase），由 Rust DeepPhaseChanged 事件驱动构建 */
const deepSegments = ref<DeepSegment[]>([])

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

// ─── 事件分发 ────────────────────────────────────────────

/** 向所有订阅者分发 AgentEvent（单个订阅者异常不影响其他） */
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

/**
 * 为指定会话设置 DeepPhaseChanged 事件监听
 *
 * 监听 `agent:event:deep_phase_changed:{session_id}`，收到 Rust payload 后：
 * 1. 按 phaseIndex 去重：同一阶段只保留首个 phase 段（避免重复累计）
 * 2. 将 phase 段追加到 `deepSegments`（保持阶段出现的先后顺序）
 * 3. 记录 triggerTool 到该阶段 tools（供 DeepProcessPanel 展示触发工具）
 * 4. 依据 payload.toolStatus 更新工具状态（completed/failed）
 * 5. 依据 payload.phaseCompleted 更新阶段状态（active/done）
 *
 * 幂等：若已存在监听器，直接返回（避免重复监听）。
 */
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

// ─── 命令封装：会话生命周期 ────────────────────────────────────

/** 新建会话（返回 Rust SessionInfo） */
async function newSession(
  systemPrompt?: string,
  providerConfig?: RustProviderConfigFull,
): Promise<RustSessionInfo> {
  const info = await invoke<RustSessionInfo>('new_session', {
    systemPrompt: systemPrompt ?? null,
    providerConfig: providerConfig ?? null,
  })
  currentSessionId.value = info.id
  messages.value = []
  // 新会话：清空深度模式段与 A2UI 画布，并建立事件监听
  deepSegments.value = []
  a2uiSurfaces.value = {}
  sessionMessagesCache.set(info.id, [])
  await setupDeepPhaseListener(info.id)
  await setupA2UIListener(info.id)
  await refreshSessionList()
  return info
}

/** 会话列表 */
async function listSessions(): Promise<RustSessionInfo[]> {
  const list = await invoke<RustSessionInfo[]>('list_sessions')
  sessionList.value = list
  return list
}

/** 刷新会话列表（内部：写入 sessionList） */
async function refreshSessionList(): Promise<void> {
  await listSessions()
}

/** 删除会话（若删除的是当前会话，清空本地状态） */
async function deleteSession(sessionId: string): Promise<void> {
  await invoke('delete_session', { sessionId })
  sessionMessagesCache.delete(sessionId)
  teardownDeepPhaseListener(sessionId)
  teardownA2UIListener(sessionId)
  if (currentSessionId.value === sessionId) {
    currentSessionId.value = null
    messages.value = []
    deepSegments.value = []
    a2uiSurfaces.value = {}
  }
  await refreshSessionList()
}

/** 切换会话（加载该会话的消息历史） */
async function switchSession(sessionId: string): Promise<void> {
  // 清理旧会话的深度阶段与 A2UI 监听，切换到新会话
  const oldSessionId = currentSessionId.value
  if (oldSessionId && oldSessionId !== sessionId) {
    teardownDeepPhaseListener(oldSessionId)
    teardownA2UIListener(oldSessionId)
  }
  currentSessionId.value = sessionId
  deepSegments.value = []
  a2uiSurfaces.value = {}
  await setupDeepPhaseListener(sessionId)
  await setupA2UIListener(sessionId)
  const cached = sessionMessagesCache.get(sessionId)
  if (cached) {
    messages.value = cached
  } else {
    messages.value = []
  }
  try {
    const rustMsgs = await invoke<RustMessage[]>('get_messages', { sessionId })
    const tsMsgs = rustMsgs.map(rustMsgToTsMsg)
    messages.value = tsMsgs
    sessionMessagesCache.set(sessionId, tsMsgs)
  } catch (err) {
    console.warn(`[useAgentRust] switchSession(${sessionId}) 加载消息失败（保持缓存）:`, err)
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

/**
 * 发送消息（对应 Rust `send_message`，ReAct 循环执行）
 *
 * 实现 `IAgentBackend.prompt`。流程：
 * 1. 确保会话存在
 * 2. 先推入用户消息（本地）
 * 3. 触发 agent_start / message_start 事件
 * 4. invoke `send_message`（阻塞直到完整回复返回）
 * 5. 触发 message_end / agent_end 事件，更新消息 + 缓存
 */
async function prompt(text: string, options?: PromptOptions): Promise<void> {
  const sessionId = await ensureSession()
  const textContent = text.trim()
  if (!textContent) return

  // 深度模式：为当前会话建立 DeepPhaseChanged 事件监听（幂等）
  await setupDeepPhaseListener(sessionId)

  // 用户消息
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

  emit({ type: 'agent_start', sessionId, chatMode: options?.chatMode ?? 'normal' })

  isStreaming.value = true
  try {
    const result = await invoke<RustSendMessageResult>('send_message', {
      params: {
        sessionId,
        text: textContent,
        images: (options?.images ?? []).map((img) => ({
          data: img.data,
          mimeType: img.mimeType,
        })),
        mode: options?.chatMode ?? null,
      },
    })

    // 助手回复
    const replyId = `assistant-${Date.now()}`
    const assistantMsg: AgentMessage = {
      id: replyId,
      role: 'assistant',
      content: result.reply,
      timestamp: Date.now(),
    }
    emit({ type: 'message_start', message: assistantMsg })
    messages.value.push(assistantMsg)
    sessionMessagesCache.get(sessionId)?.push(assistantMsg)
    emit({ type: 'message_end', messageId: replyId, content: result.reply, thinking: '' })
    emit({ type: 'turn_end', message: assistantMsg })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
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
  await invoke('steer', { sessionId, text })
}

/** follow-up（对应 steer，实现 IAgentBackend.followUp） */
async function followUp(text: string): Promise<void> {
  await steer(text)
}

/** 中断当前运行（对应 Rust `abort`） */
async function abort(): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  await invoke('abort', { sessionId })
  isStreaming.value = false
}

/** 清空历史（对应 Rust `clear_history`） */
async function clearHistory(): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  await invoke('clear_history', { sessionId })
  messages.value = []
  sessionMessagesCache.set(sessionId, [])
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
  await invoke('update_model', {
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

/** 更新思考级别（对应 Rust `update_thinking_level`） */
async function updateThinkingLevel(level: ThinkingLevel): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  await invoke('update_thinking_level', { sessionId, level })
}

/** 获取 Provider 配置（对应 Rust `get_provider_config`） */
async function getProviderConfig(): Promise<RustProviderConfig | null> {
  const sessionId = currentSessionId.value
  if (!sessionId) return null
  try {
    return await invoke<RustProviderConfig>('get_provider_config', { sessionId })
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
  await invoke('set_provider_config', { sessionId, config })
}

/** 获取心跳状态（对应 Rust `get_heartbeat`，长任务监控） */
async function getHeartbeat(): Promise<RustHeartbeatStatus> {
  const sessionId = currentSessionId.value
  if (!sessionId) return 'alive'
  try {
    return await invoke<RustHeartbeatStatus>('get_heartbeat', { sessionId })
  } catch {
    return 'alive'
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

/**
 * Tauri 端 Agent Backend composable
 *
 * 模块级单例，多次调用返回同一组状态与方法。
 * 在应用入口调用 `provideAgentBackend(useAgentRust())` 注入。
 *
 * 实现 `IAgentBackend` 契约（prompt / steer / followUp / abort / updateModel /
 * updateThinkingLevel / clearHistory / subscribe / dispose / isStreaming），
 * 并补充会话管理 / 消息列表 / 心跳等 UI 需要的扩展方法。
 */
export function useAgentRust() {
  return {
    // ── IAgentBackend 契约 ──
    prompt,
    steer,
    followUp,
    abort,
    updateModel,
    updateThinkingLevel,
    clearHistory,
    subscribe,
    dispose,
    isStreaming: readonly(isStreaming),

    // ── 会话管理 ──
    newSession,
    listSessions,
    deleteSession,
    switchSession,
    currentSessionId,
    sessionList,

    // ── 消息 ──
    messages,
    sendMessage,
    lastAssistantHasContent,
    lastAssistantHasThinking,

    // ── 深度模式段（DeepProcessPanel 依赖）──
    deepSegments,

    // ── A2UI（A2UIRenderer 依赖）──
    a2uiSurfaces,
    resolveDataBinding,

    // ── 状态查询 ──
    getProviderConfig,
    setProviderConfig,
    getHeartbeat,
    isInitialized,

    // ── 初始化（Tauri 端同步就绪，返回 true）──
    ensureInitialized: async (): Promise<boolean> => {
      isInitialized.value = true
      return true
    },
  } as any
}