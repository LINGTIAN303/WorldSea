/**
 * RustGroupChatBackend：群聊参与者 LLM 通道（2026-08-09 桥 Rust 会话，方案 A：per-participant session）
 *
 * 职责：把群聊中每个参与者映射为一个独立 Rust AgentLoop 会话（复用既有 new_session /
 * send_message / abort / update_model / clear_history / delete_session 命令），并以
 * IAgentBackend 契约暴露给群聊引擎（GroupChatCoordinator / GroupChatEngine / AgentPrivateChat）。
 *
 * 关键差异（vs 单聊 useAgentRust）：单聊的 handleStreamEvent 只更新自己的 refs、不向
 * listeners emit message_update；而群聊 Coordinator 的打字机效果（store.setStreaming）
 * 完全依赖 message_update 事件（GroupChatCoordinator.ts L406-409）。因此本工厂的流式
 * 监听是独立实现——每个 delta 都转成 message_update 转发给订阅者。
 *
 * 详细设计见 docs/plans/2026-08-09-group-chat-rust-bridge-plan.md
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AgentEvent,
  AgentEventListener,
  AgentStateSnapshot,
  IAgentBackend,
  ThinkingLevel,
} from '@agent/index'

// ─── Rust 端类型镜像（snake_case，与 agent-runtime 序列化一致）──────────────
// （与 useAgentRust.ts 同源；此处仅声明本工厂用到的子集，避免跨模块强耦合）

interface RustStreamPayload {
  type: 'start' | 'delta' | 'end' | 'error' | 'agent_end'
  delta?: string
  fullText?: string
  message?: string
}

interface RustSessionInfo {
  id: string
  created_at: number
  message_count: number
  title: string
  pinned: boolean
}

interface RustSendMessageResult {
  session_id: string
  reply: string
  state: {
    current_iteration: number
    aborted: boolean
    paused: boolean
    is_streaming: boolean
    messages: Array<{ role: string; content: string; tool_calls?: unknown[] }>
    model: string
    thinking_level: string | null
  }
  usage?: { input_tokens: number; output_tokens: number }
}

/** Rust ProviderConfigFull 镜像（tagged enum：cloud/local/custom） */
export interface RustProviderConfigInput {
  mode: 'cloud' | 'local' | 'custom'
  provider?: string
  model_id?: string
  api_key?: string
  endpoint?: string
  api_type?: 'ollama' | 'lm-studio' | 'vllm' | 'llama-cpp' | 'openai-compatible' | 'anthropic-compatible'
  base_url?: string
  context_window?: number
  max_tokens?: number
}

/** 创建群聊参与者后端的入参（GroupChatCoordinator / GroupChatEngine 传入） */
export interface RustGroupChatParticipantOptions {
  /** 参与者 id（群聊内唯一，用于 participantSessionMap 映射） */
  participantId: string
  /** 参与者名称（仅日志） */
  name: string
  /** 独立系统提示词（参与者人格） */
  systemPrompt?: string
  /** 全局 Provider 配置（参与者未配时回退） */
  providerConfig?: RustProviderConfigInput
  /** 模型 id（创建后热切换） */
  modelId?: string
  /** 是否在 dispose 时删除 Rust 会话（默认 true） */
  cleanupOnDispose?: boolean
}

/** 工厂单例状态：participantId → rustSessionId */
const participantSessionMap = new Map<string, string>()
/** participantId → unlisten 清理函数（dispose 时移除事件监听） */
const listenerCleanupMap = new Map<string, UnlistenFn>()

/** 将 Rust ProviderConfigFull 转成 useAgentRust 期望的 snake_case 结构（透传） */
function normalizeProviderConfig(cfg?: RustProviderConfigInput): RustProviderConfigInput | null {
  if (!cfg) return null
  return cfg
}

/**
 * 创建群聊参与者的 Rust 后端（实现 IAgentBackend）
 *
 * 生命周期：
 * - 创建：invoke('new_session', { systemPrompt, providerConfig }) → rustSessionId
 * - 发言：invoke('send_message', { params: { sessionId, text } }) → { reply, usage, state }
 * - 流式：listen('agent:event:stream:' + sessionId) → 逐 delta 转 message_update
 * - 销毁：dispose() → delete_session + unlisten + 清映射
 */
export async function createRustGroupChatBackend(
  options: RustGroupChatParticipantOptions,
): Promise<IAgentBackend> {
  let disposed = false
  const listeners = new Set<AgentEventListener>()
  const initialModel = options.modelId
    ? {
        provider: options.providerConfig?.provider || 'deepseek',
        modelId: options.modelId,
        displayName: options.modelId,
      }
    : null
  let state: AgentStateSnapshot = {
    sessionId: '',
    model: initialModel,
    thinkingLevel: 'off' as ThinkingLevel,
    messages: [],
    isStreaming: false,
    pendingToolCalls: [],
  }
  let cleanup: UnlistenFn | null = null

  // ── 创建 Rust 会话 ──────────────────────────────────────────────
  const sessionInfo = await invoke<RustSessionInfo>('new_session', {
    systemPrompt: options.systemPrompt ?? null,
    providerConfig: normalizeProviderConfig(options.providerConfig),
  })
  const sessionId = sessionInfo.id
  state = { ...state, sessionId }
  participantSessionMap.set(options.participantId, sessionId)

  // ── 注册流式监听（独立实现：delta → message_update 转发）───────────
  cleanup = await listen<RustStreamPayload>(`agent:event:stream:${sessionId}`, (event) => {
    if (disposed) return
    const payload = event.payload
    switch (payload.type) {
      case 'start':
        emit({ type: 'message_start', message: { id: `stream-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() } })
        break
      case 'delta':
        emit({ type: 'message_update', messageId: `stream-${Date.now()}`, content: payload.delta || '', thinking: '' })
        break
      case 'end':
        emit({ type: 'message_update', messageId: `stream-${Date.now()}`, content: payload.fullText || '', thinking: '' })
        break
      case 'error':
        emit({ type: 'error', error: new Error(payload.message || '群聊参与者 API 请求失败') })
        break
      case 'agent_end':
        state = { ...state, isStreaming: false }
        emit({ type: 'agent_end', sessionId, messages: [] })
        break
    }
  })
  listenerCleanupMap.set(options.participantId, cleanup)

  // 创建后热切换模型（participant.modelId 与全局不同时）
  if (options.modelId) {
    try {
      await invoke('update_model', {
        params: {
          sessionId,
          provider: options.providerConfig?.provider || 'deepseek',
          modelId: options.modelId,
          baseUrl: null,
          apiKey: options.providerConfig?.api_key ?? null,
          temperature: null,
          maxTokens: null,
        },
      })
      state = { ...state, model: { provider: options.providerConfig?.provider || 'deepseek', modelId: options.modelId, displayName: options.modelId } }
    } catch (err) {
      console.warn(`[RustGroupChatBackend] update_model 失败 (${options.name}):`, err)
    }
  }

  /** 向所有订阅者广播事件（快照防遍历中增删） */
  function emit(event: AgentEvent): void {
    for (const l of [...listeners]) {
      try {
        l(event)
      } catch (err) {
        console.warn('[RustGroupChatBackend] listener 异常:', err)
      }
    }
  }

  /** 将 Rust usage 转成 UsageData（缺 cache/cost 字段补零） */
  function toUsageData(u: NonNullable<RustSendMessageResult['usage']>): {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalTokens: number
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  } {
    const inputTokens = u.input_tokens
    const outputTokens = u.output_tokens
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: inputTokens + outputTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    }
  }

  const backend: IAgentBackend = {
    async prompt(text: string): Promise<void> {
      if (disposed) return
      state = { ...state, isStreaming: true }
      emit({ type: 'agent_start', sessionId, chatMode: 'group-chat' })
      try {
        const result = await invoke<RustSendMessageResult>('send_message', {
          params: { sessionId, text, images: [], mode: 'group-chat' },
        })
        state = {
          ...state,
          isStreaming: false,
          messages: (result.state?.messages || []).map((m) => ({
            id: `r-${Date.now()}`,
            role: m.role as AgentStateSnapshot['messages'][number]['role'],
            content: m.content,
            timestamp: Date.now(),
          })),
        }
        // 整轮落定：message_end 携带 reply（Coordinator 以 message_update 累积为权威，
        // 但若无流式事件（非流式后端）则靠此收尾）
        emit({
          type: 'message_end',
          messageId: `msg-${Date.now()}`,
          content: result.reply,
          thinking: '',
          usage: result.usage ? toUsageData(result.usage) : undefined,
        })
        if (result.usage) {
          emit({ type: 'usage', usage: toUsageData(result.usage) })
        }
      } catch (err) {
        state = { ...state, isStreaming: false }
        const error = err instanceof Error ? err : new Error(String(err))
        emit({ type: 'error', error })
        throw error
      } finally {
        state = { ...state, isStreaming: false }
        emit({ type: 'agent_end', sessionId, messages: [] })
      }
    },

    async steer(text: string): Promise<void> {
      if (disposed) return
      await invoke('steer', { sessionId, text })
    },

    async followUp(text: string): Promise<void> {
      await this.steer(text)
    },

    async abort(): Promise<void> {
      if (disposed) return
      await invoke('abort', { sessionId })
      state = { ...state, isStreaming: false }
    },

    async updateModel(
      provider: string,
      modelId: string,
      baseUrl?: string,
      apiKey?: string,
      _contextWindow?: number,
      maxTokens?: number,
      temperature?: number,
    ): Promise<void> {
      if (disposed) return
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
      state = { ...state, model: { provider, modelId, displayName: modelId } }
    },

    updateThinkingLevel(level: ThinkingLevel): void {
      if (disposed) return
      void invoke('update_thinking_level', { sessionId, level })
      state = { ...state, thinkingLevel: level }
    },

    clearHistory(): void {
      if (disposed) return
      void invoke('clear_history', { sessionId })
      state = { ...state, messages: [] }
    },

    subscribe(listener: AgentEventListener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      listeners.clear()
      const unlisten = listenerCleanupMap.get(options.participantId)
      unlisten?.()
      listenerCleanupMap.delete(options.participantId)
      participantSessionMap.delete(options.participantId)
      if (options.cleanupOnDispose !== false) {
        void invoke('delete_session', { sessionId }).catch((err) =>
          console.warn(`[RustGroupChatBackend] delete_session 失败 (${options.name}):`, err),
        )
      }
    },

    state,
    get isStreaming(): boolean {
      return state.isStreaming
    },
  }

  return backend
}

/** 查询某参与者的 Rust 会话 id（调试/诊断用） */
export function getRustSessionId(participantId: string): string | undefined {
  return participantSessionMap.get(participantId)
}
