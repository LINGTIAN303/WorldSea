/**
 * # useAgentRust — Rust Agent 的前端适配层
 *
 * 阶段 1.5 新增。本文件桥接前端 Vue 层与 Rust 端 `agent_runtime::AgentLoop`，
 * 实现 `IAgentBackend` 接口，通过 Tauri `invoke` + `listen` 通信。
 *
 * ## 架构位置
 * ```text
 * ┌──────────────────────────────────────────────┐
 * ┌─ Vue 组件 (useAgentRust composable)           │
 * │    ↓ subscribe(event => update messages)      │
 * ├──────────────────────────────────────────────┤
 * │  RustAgentBackend (implements IAgentBackend)  │
 * │    ↓ invoke('cmd_agent_*')                    │
 * │    ↓ listen('agent:event:{sessionId}')        │
 * ├──────────────────────────────────────────────┤
 * │  Tauri 命令层 (commands/agent.rs)             │
 * │    ↓ 调用                                      │
 * ├──────────────────────────────────────────────┤
 * │  agent_runtime (AgentLoop + GenaiBackend)     │
 * └──────────────────────────────────────────────┘
 * ```
 *
 * ## 事件转换
 * Rust 端 `AgentEventPayload`（snake_case type + camelCase 字段）→
 * TS 端 `AgentEvent`（snake_case type + camelCase 字段）：
 *
 * | Rust payload           | TS AgentEvent          | 字段映射                          |
 * |------------------------|------------------------|----------------------------------|
 * | `agent_start`          | `agent_start`          | chatMode 默认 'normal'            |
 * | `agent_end`            | `agent_end`            | messages 从本地缓存取              |
 * | `stream_start`         | `message_start`        | 构造 AgentMessage                 |
 * | `stream_delta`         | `message_update`       | delta 拼接为完整 content           |
 * | `stream_end`           | `message_end`          | fullText → content                |
 * | `tool_call_start`      | `tool_execution_start` | toolCall 结构一致                 |
 * | `tool_call_end`        | `tool_execution_end`   | result JSON.stringify             |
 * | `error`                | `error`                | message 包装为 Error              |
 *
 * ## ProviderConfig 字段命名差异
 * - **TS 联合类型** (`@agent/index` ProviderConfig)：camelCase（`modelId`/`baseUrl`/`apiKey`）
 * - **Rust 枚举** (`agent_runtime::llm::config::ProviderConfig`)：snake_case（`model_id`/`base_url`/`api_key`）
 * - 原因：Rust 端 `#[serde(tag = "mode", rename_all = "lowercase")]` 只重命名 enum 变体，
 *   内部字段保持 snake_case
 * - 因此 `cmd_agent_create` 的 `providerConfig` 参数需用 snake_case 字段
 *
 * ## Tauri 命令参数命名
 * Tauri 2.x 自动将 Rust snake_case 参数名转为 JS camelCase：
 * - `session_id: String` → `sessionId`
 * - `model_id: String` → `modelId`
 * - `base_url: Option<String>` → `baseUrl`
 */

import { ref, readonly, shallowRef, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  IAgentBackend,
  AgentEvent,
  AgentEventListener,
  AgentMessage,
  AgentStateSnapshot,
  ImageAttachment,
  ThinkingLevel,
  PromptOptions,
  UsageData,
  ProviderConfig,
  A2UIMessage,
  A2UIComponent,
} from '@agent/index'
import { ALL_TOOLS_MAP } from '@agent/index'
import type { IToolContext } from '@agent/index'
import { useSettingsStore } from '../../stores/settingsStore'
import type { LongTaskRecord } from './longTaskStore'
import { generateTitle } from './useTitleGen'
import { useLongTaskRust } from './useLongTaskRust'
// 阶段 3.2 集成：在 useAgentRustAdapter 中暴露 Supervisor 入口
// UI 组件可通过 useAgentRustAdapter().supervisor 访问 Supervisor 能力，
// 也可单独调用 useSupervisorRust()（模块级单例，多次调用返回同一实例）
import { useSupervisorRust } from './useSupervisorRust'
// P2 Deep Mode：构建 deepSegments 所需的类型（type-only，避免运行时循环依赖）
// DeepSegment / ToolCallView 定义在 ./useAgent，被 21+ 组件引用
import type { DeepSegment, ToolCallView } from './useAgent'

// ─── Rust 端类型镜像 ────────────────────────────────────────────

/**
 * Rust `agent_bridge::payload::AgentEventPayload` 的前端镜像
 *
 * 对应 `src-tauri/src/agent_bridge/payload.rs` 的序列化结果：
 * - `#[serde(tag = "type", rename_all = "snake_case")]` → 变体名 snake_case
 * - `#[serde(rename_all = "camelCase")]` → 字段名 camelCase
 */
export type RustAgentEvent =
  | { type: 'agent_start'; sessionId: string; model?: string }
  | { type: 'agent_end'; sessionId: string }
  | { type: 'stream_start'; sessionId: string; messageId: string; model?: string }
  | { type: 'stream_delta'; messageId: string; delta: string }
  | {
      type: 'stream_end'
      sessionId: string
      messageId: string
      fullText: string
      usage?: RustUsageInfo
    }
  | {
      type: 'tool_call_start'
      sessionId: string
      toolCall: { id: string; name: string; args: Record<string, unknown> }
    }
  | {
      type: 'tool_call_end'
      sessionId: string
      toolCallId: string
      result: unknown
      success: boolean
    }
  | { type: 'error'; sessionId: string; message: string }
  | {
      type: 'deep_phase_changed'
      sessionId: string
      phaseLabel: string
      phaseIndex: number
      triggerTool: string
    }
  // P2 A2UI：Rust 端 AgentEventPayload::A2UI 的前端镜像
  // 由 Rust 端 A2UI 工具（ui_create_surface 等）触发，
  // 通过 Tauri 事件流推送到前端，由 useAgentRustAdapter 构建 a2uiSurfaces 状态。
  | {
      type: 'a2ui'
      sessionId: string
      surfaceId: string
      message: A2UIMessage
    }

/** Rust `agent_bridge::payload::UsageInfo` 的前端镜像 */
export interface RustUsageInfo {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/**
 * Deep Mode 阶段切换事件 payload（对应 Rust `DeepPhaseChanged`）
 *
 * 由 `RustAgentBackend.subscribeDeepPhase` 监听器接收。
 * 前端据此构建 `deepSegments` 状态：标记上一阶段结束、推入新阶段段。
 *
 * # 字段
 * - `phaseLabel`：阶段标签（如 "问题拆解"），未匹配工具时为 "其他操作"
 * - `phaseIndex`：阶段索引 0..4，未匹配为 -1
 * - `triggerTool`：触发本次阶段切换的工具名
 */
export interface DeepPhaseChangedPayload {
  phaseLabel: string
  phaseIndex: number
  triggerTool: string
}

/** Deep Phase 事件监听器类型 */
export type DeepPhaseChangeListener = (payload: DeepPhaseChangedPayload) => void

/**
 * Rust `agent_runtime::llm::config::ProviderConfig` 的前端镜像
 *
 * 注意：字段名 snake_case（Rust 端未启用 camelCase rename）
 */
export type RustProviderConfig =
  | { mode: 'cloud'; provider: string; model_id: string; api_key: string }
  | {
      mode: 'local'
      endpoint: string
      api_type: 'ollama' | 'lm-studio' | 'vllm' | 'llama-cpp'
      model_id: string
    }
  | {
      mode: 'custom'
      base_url: string
      api_key: string
      api_type: 'openai-compatible' | 'anthropic-compatible'
      model_id: string
      context_window?: number
      max_tokens?: number
    }

/**
 * `cmd_agent_create` 的 options 参数（对应 Rust `CreateAgentOptions`）
 *
 * Rust 端用了 `#[serde(rename_all = "camelCase")]`，所以前端用 camelCase
 */
export interface RustCreateAgentOptions {
  systemPrompt?: string
  maxIterations?: number
  temperature?: number
  maxTokens?: number
  parallelToolCalls?: boolean
  thinkingLevel?: ThinkingLevel
}

// ─── Rust → TS 工具调用请求（对应 Rust `ToolCallRequest`） ────────────────────────────────────────────

/**
 * Rust 端 `agent_bridge::tool_bridge::ToolCallRequest` 的前端镜像
 *
 * Rust 通过 `app.emit("agent:tool_call:{session_id}", this)` 推送到前端。
 * 前端执行完工具后，调用 `invoke('cmd_agent_tool_result', {...})` 回传结果。
 *
 * 字段命名：Rust 端 `#[serde(rename_all = "camelCase")]` → 前端 camelCase
 */
export interface RustToolCallRequest {
  /** 调用 ID（回传结果时用作关联键） */
  callId: string
  /** 会话 ID（前端校验用） */
  sessionId: string
  /** 工具名称（如 "entity_create"） */
  toolName: string
  /** 调用参数（LLM 生成的 JSON） */
  args: Record<string, unknown>
}

// ─── Rust 端 Session 持久化镜像（对应 persistence.rs） ────────────────────────────────────────────

/**
 * Rust 端 `agent_bridge::persistence::SessionSummary` 的前端镜像
 *
 * 列表用，不含消息体。对应 `cmd_session_list` 返回值。
 */
export interface RustSessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  pinned: boolean
}

/**
 * Rust 端 `agent_bridge::persistence::SessionTotalUsage` 的前端镜像（P1-4 新增）
 *
 * 所有字段对应前端 totalUsage ref 的结构，跨会话恢复时用于显示成本统计。
 */
export interface RustSessionTotalUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalCost: number
}

/**
 * Rust 端 `agent_bridge::persistence::SessionRecord` 的前端镜像
 *
 * 包含完整消息历史和 provider 配置。对应 `cmd_session_load` 返回值。
 */
export interface RustSessionRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  pinned: boolean
  providerConfig: RustProviderConfig
  messages: AgentMessage[]
  thinkingLevel?: string
  systemPrompt?: string
  /** 累计 usage（P1-4 新增，老会话可能为 undefined） */
  totalUsage?: RustSessionTotalUsage
}

/**
 * Rust 端 `agent_bridge::persistence::SaveSessionRequest` 的前端镜像
 *
 * 对应 `cmd_session_save` 的请求体。
 */
export interface RustSaveSessionRequest {
  id: string
  title: string
  providerConfig: RustProviderConfig
  messages: AgentMessage[]
  thinkingLevel?: string | null
  systemPrompt?: string | null
  pinned?: boolean | null
  /** 累计 usage（P1-4 新增，可选） */
  totalUsage?: RustSessionTotalUsage | null
}

// ─── RustAgentBackend ────────────────────────────────────────────

/**
 * Rust Agent 的前端 Backend 适配器
 *
 * 实现 `IAgentBackend` 接口，封装 Tauri `invoke` + `listen` 通信。
 *
 * # 内部状态
 * - `_messages`：消息列表（双向同步：用户消息主动 push，助手消息由事件流 push）
 * - `_isStreaming`：是否正在流式输出
 * - `_pendingToolCalls`：待处理工具调用
 * - `_model` / `_thinkingLevel`：当前模型与思考级别
 * - `_listeners`：事件订阅者集合
 *
 * # 事件流
 * 构造时 `listen('agent:event:{sessionId}')`，收到 Rust payload 后：
 * 1. 转换为 TS `AgentEvent`
 * 2. 同步更新内部状态（messages / isStreaming 等）
 * 3. 分发给所有 listener
 *
 * # prompt 的 fire-and-forget
 * `prompt()` 不 await `invoke('cmd_agent_prompt')` 的最终结果，
 * 因为最终文本会通过 `stream_end` 事件推送。
 * `invoke` 的 Promise 仅用于捕获错误（如 session 不存在）。
 */
export class RustAgentBackend implements IAgentBackend {
  private readonly sessionId: string
  private readonly listeners = new Set<AgentEventListener>()
  /**
   * Deep Mode 阶段切换事件监听器集合（P2 新增）
   *
   * 与 `listeners` 分离，因为 `deep_phase_changed` 不属于 TS `AgentEvent` 联合类型
   * （`bridge-types.ts` 未定义该变体），无法通过常规 `dispatch` 分发。
   * 适配器通过 `subscribeDeepPhase` 注册，独立构建 `deepSegments` 状态。
   */
  private readonly deepPhaseListeners = new Set<DeepPhaseChangeListener>()
  private unlistenFn: UnlistenFn | null = null
  /**
   * 工具调用事件监听器（P0-A3b 新增）
   *
   * 监听 `agent:tool_call:{sessionId}` 事件，调用 TS 工具实现，
   * 通过 `invoke('cmd_agent_tool_result', ...)` 回传结果给 Rust。
   */
  private unlistenToolCallFn: UnlistenFn | null = null
  /**
   * 工具上下文提供者（P0-A3b 新增）
   *
   * 返回当前的 IToolContext，用于调用 TS 工具实现。
   * 采用 provider 函数而非直接引用，是因为 toolContext 在 ensureInitialized
   * 阶段才构造完成，且可能随会话切换而变化。
   */
  private readonly toolContextProvider: (() => IToolContext | null) | null

  // 内部状态
  private _messages: AgentMessage[] = []
  private _isStreaming = false
  // NonNullable<...> 避免 `ToolCallRecord[] | undefined` 导致索引访问告警
  private _pendingToolCalls: NonNullable<AgentMessage['toolCalls']> = []
  private _model: AgentStateSnapshot['model'] = null
  private _thinkingLevel: string = 'off'

  // 当前轮的流式状态
  private currentMessageId: string | null = null
  private currentMessageContent = ''

  private disposed = false

  /**
   * @param sessionId 会话 ID
   * @param toolContextProvider 可选的工具上下文提供者。
   *        若提供，则启用 Rust → TS 工具调用桥接（监听 `agent:tool_call` 事件）。
   *        若为 null，则 Rust 端 emit 的工具调用事件会被忽略（前端无法执行业务工具）。
   */
  constructor(sessionId: string, toolContextProvider?: (() => IToolContext | null) | null) {
    this.sessionId = sessionId
    this.toolContextProvider = toolContextProvider ?? null
    // 异步设置事件监听（构造不阻塞）
    void this.setupEventListener()
    void this.setupToolCallEventListener()
  }

  // ─── 事件监听 ────────────────────────────────────────────

  private async setupEventListener(): Promise<void> {
    const eventName = `agent:event:${this.sessionId}`
    try {
      this.unlistenFn = await listen<RustAgentEvent>(eventName, (e) => {
        this.handleRustEvent(e.payload)
      })
    } catch (err) {
      console.error(`[useAgentRust] listen ${eventName} 失败:`, err)
    }
  }

  /**
   * 设置工具调用事件监听（P0-A3b）
   *
   * 监听 `agent:tool_call:{sessionId}` 事件，收到 Rust 端工具调用请求后：
   * 1. 从 `ALL_TOOLS_MAP` 查找 TS 工具实现
   * 2. 通过 `toolContextProvider()` 获取 IToolContext
   * 3. 调用 `tool.execute(args, ctx)` 执行工具
   * 4. 通过 `invoke('cmd_agent_tool_result', ...)` 回传结果给 Rust
   *
   * 若 `toolContextProvider` 为 null，跳过监听设置（无业务工具能力）。
   */
  private async setupToolCallEventListener(): Promise<void> {
    if (!this.toolContextProvider) {
      // 未注入 toolContextProvider：不监听工具调用事件
      // Rust 端 emit 的 tool_call 事件会因前端无 listener 而丢失，
      // AgentLoop 在 FrontendToolBridge.call_tool 中会因 60s 超时返回 ToolError::Timeout。
      // 这是预期行为：调用方应在 ensureInitialized 时注入 provider。
      return
    }
    const eventName = `agent:tool_call:${this.sessionId}`
    try {
      this.unlistenToolCallFn = await listen<RustToolCallRequest>(eventName, (e) => {
        void this.handleToolCallEvent(e.payload)
      })
    } catch (err) {
      console.error(`[useAgentRust] listen ${eventName} 失败:`, err)
    }
  }

  /**
   * 处理 Rust 端的工具调用请求（P0-A3b）
   *
   * # 流程
   * 1. 从 ALL_TOOLS_MAP 查找工具
   * 2. 通过 toolContextProvider 获取 IToolContext
   * 3. 执行 tool.execute(args, ctx)
   * 4. 通过 invoke('cmd_agent_tool_result') 回传结果
   *
   * # 错误处理
   * - 工具不存在：回传 `{ error: "未知工具: xxx" }`, success=false
   * - ctx 未就绪：回传 `{ error: "toolContext 未初始化" }`, success=false
   * - 执行异常：回传 `{ error: err.message }`, success=false
   *
   * # 结果序列化
   * TS 工具 execute 返回 string（多数是 JSON.stringify(...)）。
   * Rust 端 ToolCallResult.result 是 serde_json::Value。
   * 这里尝试 JSON.parse：
   * - 成功：回传解析后的对象（Rust 反序列化为 Value::Object）
   * 失败：回传原字符串（Rust 反序列化为 Value::String）
   */
  private async handleToolCallEvent(payload: RustToolCallRequest): Promise<void> {
    if (this.disposed) return
    const { callId, sessionId, toolName, args } = payload

    // 校验 sessionId（防御性，避免跨会话污染）
    if (sessionId !== this.sessionId) {
      console.warn(
        `[useAgentRust] 收到其他 session 的工具调用: expected=${this.sessionId} got=${sessionId}`,
      )
      return
    }

    const ctx = this.toolContextProvider?.()
    if (!ctx) {
      await this.sendToolResult(callId, { error: 'toolContext 未初始化' }, false)
      return
    }

    const tool = ALL_TOOLS_MAP.get(toolName)
    if (!tool) {
      await this.sendToolResult(callId, { error: `未知工具: ${toolName}` }, false)
      return
    }

    try {
      const resultStr = await tool.execute(args, ctx)
      // 尝试 JSON.parse：TS 工具大多返回 JSON.stringify({...})，
      // 解析后回传可让 Rust 端直接拿到结构化 Value，无需二次反序列化
      let parsed: unknown = resultStr
      if (typeof resultStr === 'string') {
        try {
          parsed = JSON.parse(resultStr)
        } catch {
          // 非 JSON 字符串：保留原字符串
          parsed = resultStr
        }
      }
      await this.sendToolResult(callId, parsed, true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[useAgentRust] 工具 ${toolName} 执行失败:`, err)
      await this.sendToolResult(callId, { error: message }, false)
    }
  }

  /**
   * 回传工具调用结果给 Rust（P0-A3b）
   *
   * 对应 Tauri 命令 `cmd_agent_tool_result`：
   * ```rust
   * async fn cmd_agent_tool_result(
   *     session_id: String,
   *     call_id: String,
   *     result: serde_json::Value,
   *     success: bool,
   * ) -> Result<bool, AgentRegistryError>
   * ```
   */
  private async sendToolResult(
    callId: string,
    result: unknown,
    success: boolean,
  ): Promise<void> {
    try {
      await invoke('cmd_agent_tool_result', {
        sessionId: this.sessionId,
        callId,
        result,
        success,
      })
    } catch (err) {
      console.error(`[useAgentRust] cmd_agent_tool_result 失败 (callId=${callId}):`, err)
    }
  }

  /**
   * 处理 Rust 端推送的事件
   *
   * 1. 转换为 TS AgentEvent
   * 2. 同步更新内部状态
   * 3. 分发给 listeners
   */
  private handleRustEvent(payload: RustAgentEvent): void {
    if (this.disposed) return

    switch (payload.type) {
      case 'agent_start': {
        this._isStreaming = true
        if (payload.model) {
          this._model = {
            provider: '',
            modelId: payload.model,
            displayName: payload.model,
          }
        }
        const event: AgentEvent = {
          type: 'agent_start',
          sessionId: this.sessionId,
          chatMode: 'normal',
        }
        this.dispatch(event)
        break
      }

      case 'stream_start': {
        this.currentMessageId = payload.messageId
        this.currentMessageContent = ''
        const message: AgentMessage = {
          id: payload.messageId,
          role: 'assistant',
          content: '',
          thinking: '',
          timestamp: Date.now(),
        }
        this._messages.push(message)
        if (payload.model) {
          this._model = {
            provider: '',
            modelId: payload.model,
            displayName: payload.model,
          }
        }
        const event: AgentEvent = { type: 'message_start', message }
        this.dispatch(event)
        break
      }

      case 'stream_delta': {
        this.currentMessageContent += payload.delta
        // 同步更新 messages 中对应消息
        const target = this.findMessage(payload.messageId)
        if (target) target.content = this.currentMessageContent
        const event: AgentEvent = {
          type: 'message_update',
          messageId: payload.messageId,
          content: this.currentMessageContent,
          thinking: '',
        }
        this.dispatch(event)
        break
      }

      case 'stream_end': {
        const target = this.findMessage(payload.messageId)
        if (target) {
          target.content = payload.fullText
        }
        const usage = payload.usage ? this.convertUsage(payload.usage) : undefined
        const event: AgentEvent = {
          type: 'message_end',
          messageId: payload.messageId,
          content: payload.fullText,
          thinking: '',
          ...(usage ? { usage } : {}),
        }
        this.dispatch(event)
        // 重置流式状态
        this.currentMessageId = null
        this.currentMessageContent = ''
        break
      }

      case 'tool_call_start': {
        const toolCallRecord = {
          id: payload.toolCall.id,
          name: payload.toolCall.name,
          args: payload.toolCall.args,
          status: 'running' as const,
          startedAt: Date.now(),
        }
        this._pendingToolCalls.push(toolCallRecord)
        // 关联到当前 assistant 消息（如有）
        if (this.currentMessageId) {
          const target = this.findMessage(this.currentMessageId)
          if (target) {
            if (!target.toolCalls) target.toolCalls = []
            target.toolCalls.push(toolCallRecord)
          }
        }
        const event: AgentEvent = {
          type: 'tool_execution_start',
          toolCall: payload.toolCall,
        }
        this.dispatch(event)
        break
      }

      case 'tool_call_end': {
        // 更新 pendingToolCalls 状态
        const pendingIdx = this._pendingToolCalls.findIndex(
          (tc) => tc.id === payload.toolCallId,
        )
        if (pendingIdx >= 0) {
          const tc = this._pendingToolCalls[pendingIdx]
          if (tc) {
            tc.status = payload.success ? 'completed' : 'failed'
            tc.endedAt = Date.now()
            tc.result = this.stringifyResult(payload.result)
          }
          this._pendingToolCalls.splice(pendingIdx, 1)
        }
        // 同步更新当前消息中的 toolCalls
        if (this.currentMessageId) {
          const target = this.findMessage(this.currentMessageId)
          if (target?.toolCalls) {
            const tcInMsg = target.toolCalls.find(
              (tc) => tc.id === payload.toolCallId,
            )
            if (tcInMsg) {
              tcInMsg.status = payload.success ? 'completed' : 'failed'
              tcInMsg.endedAt = Date.now()
              tcInMsg.result = this.stringifyResult(payload.result)
            }
          }
        }
        const event: AgentEvent = {
          type: 'tool_execution_end',
          toolCallId: payload.toolCallId,
          result: this.stringifyResult(payload.result),
          success: payload.success,
        }
        this.dispatch(event)
        break
      }

      case 'error': {
        const event: AgentEvent = {
          type: 'error',
          error: new Error(payload.message),
        }
        this.dispatch(event)
        break
      }

      case 'agent_end': {
        this._isStreaming = false
        const event: AgentEvent = {
          type: 'agent_end',
          sessionId: this.sessionId,
          messages: this._messages,
        }
        this.dispatch(event)
        break
      }

      case 'deep_phase_changed': {
        // P2 新增：Deep Mode 阶段切换
        // 不走常规 dispatch（AgentEvent 联合类型无此变体），
        // 改由独立的 deepPhaseListeners 通道通知适配器构建 deepSegments。
        const phasePayload: DeepPhaseChangedPayload = {
          phaseLabel: payload.phaseLabel,
          phaseIndex: payload.phaseIndex,
          triggerTool: payload.triggerTool,
        }
        for (const listener of this.deepPhaseListeners) {
          try {
            listener(phasePayload)
          } catch (err) {
            console.error('[useAgentRust] deepPhase listener 异常:', err)
          }
        }
        break
      }

      case 'a2ui': {
        // P2 A2UI 事件：转发为 TS AgentEvent.a2ui，
        // 由 useAgentRustAdapter 的 subscribe 回调构建 a2uiSurfaces 状态。
        // TS 端 AgentEvent 联合类型已定义 a2ui 变体（bridge-types.ts），
        // 故走常规 dispatch 通道（与 deep_phase_changed 不同）。
        const event: AgentEvent = {
          type: 'a2ui',
          surfaceId: payload.surfaceId,
          message: payload.message,
        }
        this.dispatch(event)
        break
      }
    }
  }

  /** 分发事件给所有 listener */
  private dispatch(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[useAgentRust] listener 异常:', err)
      }
    }
  }

  /** 查找消息（避免重复遍历） */
  private findMessage(messageId: string): AgentMessage | undefined {
    for (let i = this._messages.length - 1; i >= 0; i--) {
      if (this._messages[i].id === messageId) return this._messages[i]
    }
    return undefined
  }

  /** 工具结果序列化（Rust 返回 unknown，TS 期望 string） */
  private stringifyResult(result: unknown): string {
    if (typeof result === 'string') return result
    if (result === null || result === undefined) return ''
    try {
      return JSON.stringify(result)
    } catch {
      return String(result)
    }
  }

  /** Rust UsageInfo → TS UsageData */
  private convertUsage(u: RustUsageInfo): UsageData {
    const inputTokens = u.inputTokens ?? 0
    const outputTokens = u.outputTokens ?? 0
    const totalTokens = u.totalTokens ?? inputTokens + outputTokens
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    }
  }

  // ─── IAgentBackend 实现 ────────────────────────────────────

  /**
   * 发送用户消息并启动 ReAct 循环
   *
   * # 行为
   * 1. 将 user message 加入 _messages
   * 2. fire-and-forget 调用 `cmd_agent_prompt`
   * 3. 通过事件流接收助手响应（stream_start / stream_delta / stream_end）
   *
   * # 不 await invoke 的原因
   * `cmd_agent_prompt` 返回最终文本，但事件流已经推送过（stream_end.fullText）。
   * 如果 await，前端会阻塞直到整个 ReAct 循环结束，无法实时响应事件。
   * 所以 fire-and-forget，仅捕获错误。
   *
   * # 错误兜底
   * invoke 失败时（如 session 不存在）通过 error 事件通知 listeners。
   */
  async prompt(text: string, options?: PromptOptions): Promise<void> {
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      ...(options?.images ? { images: options.images } : {}),
      ...(options?.files ? { files: options.files } : {}),
    }
    this._messages.push(userMessage)

    // fire-and-forget
    void invoke<string>('cmd_agent_prompt', {
      sessionId: this.sessionId,
      text,
    })
      .then((finalText) => {
        // 兜底：如果 stream_end 没推送过，用 finalText 补全
        const lastAssistant = [...this._messages]
          .reverse()
          .find((m) => m.role === 'assistant')
        if (lastAssistant && !lastAssistant.content && finalText) {
          lastAssistant.content = finalText
          this.dispatch({
            type: 'message_end',
            messageId: lastAssistant.id,
            content: finalText,
            thinking: '',
          })
        }
      })
      .catch((err) => {
        this.dispatch({
          type: 'error',
          error: new Error(String(err?.message ?? err)),
        })
      })
  }

  async steer(text: string): Promise<void> {
    await invoke('cmd_agent_steer', { sessionId: this.sessionId, text })
  }

  async followUp(text: string): Promise<void> {
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    this._messages.push(userMessage)

    void invoke<string>('cmd_agent_follow_up', {
      sessionId: this.sessionId,
      text,
    }).catch((err) => {
      this.dispatch({
        type: 'error',
        error: new Error(String(err?.message ?? err)),
      })
    })
  }

  async abort(): Promise<void> {
    await invoke('cmd_agent_abort', { sessionId: this.sessionId })
    this._isStreaming = false
  }

  async updateModel(
    provider: string,
    modelId: string,
    baseUrl?: string,
    apiKey?: string,
    _contextWindow?: number,
    maxTokens?: number,
    temperature?: number,
  ): Promise<void> {
    await invoke('cmd_agent_update_model', {
      sessionId: this.sessionId,
      provider,
      modelId,
      baseUrl,
      apiKey,
      maxTokens,
      temperature,
    })
    // 更新本地 model 快照
    this._model = {
      provider,
      modelId,
      displayName: modelId,
    }
  }

  updateThinkingLevel(level: ThinkingLevel): void {
    this._thinkingLevel = level
    void invoke('cmd_agent_update_thinking_level', {
      sessionId: this.sessionId,
      level,
    }).catch((err) => {
      console.error('[useAgentRust] updateThinkingLevel 失败:', err)
    })
  }

  clearHistory(): void {
    this._messages = []
    this._pendingToolCalls = []
    void invoke('cmd_agent_clear_history', { sessionId: this.sessionId }).catch(
      (err) => {
        console.error('[useAgentRust] clearHistory 失败:', err)
      },
    )
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 订阅 Deep Mode 阶段切换事件（P2 新增）
   *
   * 与 `subscribe` 分离的原因：`deep_phase_changed` 不在 TS `AgentEvent` 联合类型中，
   * 走独立通道避免类型污染。适配器据此构建 `deepSegments` 响应式状态。
   *
   * # 监听器调用时机
   * Rust 端 `AgentLoop` 在每次工具调用判定阶段后，若阶段发生变化则 emit
   * `DeepPhaseChanged` 事件。前端收到后调用所有已注册的监听器。
   *
   * # 返回
   * 反订阅函数，调用后移除监听器。`dispose()` 也会清空全部监听器。
   */
  subscribeDeepPhase(listener: DeepPhaseChangeListener): () => void {
    this.deepPhaseListeners.add(listener)
    return () => {
      this.deepPhaseListeners.delete(listener)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    if (this.unlistenFn) {
      this.unlistenFn()
      this.unlistenFn = null
    }
    if (this.unlistenToolCallFn) {
      this.unlistenToolCallFn()
      this.unlistenToolCallFn = null
    }
    this.listeners.clear()
    this.deepPhaseListeners.clear()
    this._isStreaming = false

    void invoke('cmd_agent_destroy', { sessionId: this.sessionId }).catch(
      (err) => {
        console.error('[useAgentRust] dispose 失败:', err)
      },
    )
  }

  /**
   * 清理 Agent 内部上下文消息（不影响前端显示）
   *
   * 对应 IAgentBackend.trimContext 可选方法
   */
  trimContext(upToIndex: number): void {
    void invoke('cmd_agent_trim_context', {
      sessionId: this.sessionId,
      upToIndex,
    }).catch((err) => {
      console.error('[useAgentRust] trimContext 失败:', err)
    })
  }

  /**
   * 获取 Rust 端 Agent 内部 messages（含完整 tool call/result）
   *
   * 用于长任务 checkpoint 持久化。
   * 注意：Rust 端是 async，但 IAgentBackend 接口定义为同步。
   * 这里返回本地缓存，真正的持久化应调 `fetchRuntimeMessages()`。
   */
  getRuntimeMessages(): unknown[] {
    return this._messages
  }

  /** 异步获取 Rust 端真实 messages（用于 checkpoint 持久化） */
  async fetchRuntimeMessages(): Promise<unknown[]> {
    try {
      return await invoke<unknown[]>('cmd_agent_get_runtime_messages', {
        sessionId: this.sessionId,
      })
    } catch (err) {
      console.error('[useAgentRust] getRuntimeMessages 失败:', err)
      return this._messages
    }
  }

  /**
   * 写回内部 messages（断点恢复用）
   *
   * 对应 IAgentBackend.setRuntimeMessages 可选方法
   */
  setRuntimeMessages(messages: unknown[]): void {
    void invoke('cmd_agent_set_runtime_messages', {
      sessionId: this.sessionId,
      messages,
    }).catch((err) => {
      console.error('[useAgentRust] setRuntimeMessages 失败:', err)
    })
  }

  // ─── 只读 getter ────────────────────────────────────────────

  get state(): AgentStateSnapshot {
    return {
      sessionId: this.sessionId,
      model: this._model,
      thinkingLevel: this._thinkingLevel,
      messages: this._messages,
      isStreaming: this._isStreaming,
      pendingToolCalls: this._pendingToolCalls,
    }
  }

  get isStreaming(): boolean {
    return this._isStreaming
  }
}

// ─── 工厂函数 ────────────────────────────────────────────

/**
 * 创建 Rust Agent Backend 实例
 *
 * # 流程
 * 1. 调用 `cmd_agent_create` 在 Rust 端创建 AgentLoop
 * 2. 构造 `RustAgentBackend` 前端适配器
 * 3. 适配器内部 `listen('agent:event:{sessionId}')` 接收事件
 *
 * # 参数
 * - `sessionId`：会话 ID（前端生成，建议用 crypto.randomUUID()）
 * - `providerConfig`：Rust 端 ProviderConfig（snake_case 字段）
 * - `options`：可选配置（camelCase 字段）
 *
 * # 错误
 * - `AlreadyExists`：session_id 已存在（需先 dispose）
 * - LLM Provider 配置无效
 */
export async function createRustAgent(
  sessionId: string,
  providerConfig: RustProviderConfig,
  options?: RustCreateAgentOptions,
  toolContextProvider?: (() => IToolContext | null) | null,
): Promise<RustAgentBackend> {
  await invoke('cmd_agent_create', {
    sessionId,
    providerConfig,
    options: options ?? null,
  })
  return new RustAgentBackend(sessionId, toolContextProvider)
}

/** 列出所有已注册的 Rust Agent session */
export async function listRustAgentSessions(): Promise<string[]> {
  return await invoke<string[]>('cmd_agent_list_sessions')
}

// ─── Vue Composable ────────────────────────────────────────────

/**
 * Rust Agent 的 Vue Composable
 *
 * 提供：
 * - 响应式 `messages` / `isStreaming` / `model` 状态
 * - `init()` 初始化 Agent
 * - `sendMessage()` 发送用户消息
 * - `abort()` / `clearHistory()` / `dispose()` 控制方法
 *
 * # 用法
 * ```ts
 * const { messages, isStreaming, sendMessage, init } = useAgentRust()
 * await init('sess_xxx', { mode: 'cloud', provider: 'deepseek', model_id: '...', api_key: '...' })
 * await sendMessage('你好')
 * ```
 *
 * # 注意
 * - 本 composable 是阶段 1.5 的最小实现，**不包含**：
 *   - 深度模式（DEEP_PHASES 阶段拆分）
 *   - 长任务管理（useLongTask）
 *   - 群聊/技能加载
 *   - 工具权限守卫
 * - 这些高级特性在 Rust AgentLoop 具备相应能力后再补充
 */
export function useAgentRust() {
  const backend = shallowRef<RustAgentBackend | null>(null)
  const messages = ref<AgentMessage[]>([])
  const isStreaming = ref(false)
  const model = ref<AgentStateSnapshot['model']>(null)
  const thinkingLevel = ref<string>('off')

  let unsubscribe: (() => void) | null = null

  /**
   * 初始化 Rust Agent
   *
   * 创建新 session 并设置事件订阅。
   * 如果已有 backend，会先 dispose。
   *
   * @param toolContextProvider 工具上下文提供者。若提供，则启用 Rust → TS 工具调用桥接
   *        （监听 `agent:tool_call` 事件，调用 TS 工具实现并回传结果）。
   *        P2 A2UI：必须传入此参数，否则 A2UI 工具的 `ctx.emitA2UI` 调用不会触发。
   */
  async function init(
    sessionId: string,
    providerConfig: RustProviderConfig,
    options?: RustCreateAgentOptions,
    toolContextProvider?: (() => IToolContext | null) | null,
  ): Promise<void> {
    // 先清理旧 backend
    if (backend.value) {
      dispose()
    }

    const b = await createRustAgent(sessionId, providerConfig, options, toolContextProvider)
    backend.value = b

    // 订阅事件并同步响应式状态
    unsubscribe = b.subscribe((event) => {
      switch (event.type) {
        case 'agent_start':
          isStreaming.value = true
          // AgentEvent.agent_start 未携带 model 字段，从 backend.state 同步
          model.value = b.state.model
          break
        case 'agent_end':
          isStreaming.value = false
          break
        case 'message_start':
          messages.value = [...b.state.messages]
          break
        case 'message_update':
        case 'message_end':
          messages.value = [...b.state.messages]
          break
        case 'error':
          isStreaming.value = false
          console.error('[useAgentRust] Agent 错误:', event.error)
          break
      }
    })

    // 初始化状态快照
    messages.value = b.state.messages
    isStreaming.value = b.state.isStreaming
    model.value = b.state.model
    thinkingLevel.value = b.state.thinkingLevel
  }

  /** 发送用户消息 */
  async function sendMessage(
    text: string,
    images?: ImageAttachment[],
  ): Promise<void> {
    if (!backend.value) {
      console.warn('[useAgentRust] backend 未初始化，无法发送消息')
      return
    }
    const options: PromptOptions | undefined = images ? { images } : undefined
    await backend.value.prompt(text, options)
  }

  /** 中断当前运行 */
  async function abort(): Promise<void> {
    if (!backend.value) return
    await backend.value.abort()
    isStreaming.value = false
  }

  /** 清空对话历史 */
  function clearHistory(): void {
    if (!backend.value) return
    backend.value.clearHistory()
    messages.value = []
  }

  /** 销毁 Agent */
  function dispose(): void {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    if (backend.value) {
      backend.value.dispose()
      backend.value = null
    }
    messages.value = []
    isStreaming.value = false
    model.value = null
  }

  return {
    /** backend 实例（shallowRef，避免深度代理影响性能） */
    backend: readonly(backend),
    /** 消息列表（响应式，与 useAgent 对齐保留 mutable 以兼容返回类型） */
    messages,
    /** 是否正在流式输出 */
    isStreaming: readonly(isStreaming),
    /** 当前模型信息 */
    model: readonly(model),
    /** 思考级别 */
    thinkingLevel: readonly(thinkingLevel),
    // 控制方法
    init,
    sendMessage,
    abort,
    clearHistory,
    dispose,
  }
}

// ─── A2UI 类型与辅助函数（P2 新增） ────────────────────────────────────────────

/**
 * A2UI 画布状态（与 A2UIRenderer.vue 的 Surface 接口对齐）
 *
 * 由 `handleA2UIEvent` 维护，存储在 `a2uiSurfaces` ref 中。
 * `A2UIRenderer.vue` 通过 `:surfaces="a2uiSurfaces"` 接收并渲染。
 */
interface A2UISurface {
  surfaceId: string
  catalogId: string
  theme?: Record<string, unknown>
  /** 组件映射（id → component 定义），便于 O(1) 查找 */
  components: Record<string, A2UIComponent>
  /** 根组件 ID 列表（无父组件的组件，按声明顺序） */
  rootIds: string[]
  /** 数据模型（按 path 设置的嵌套对象） */
  dataModel: Record<string, unknown>
}

/**
 * 按 path（如 '/entity/name' 或 'entity.name'）在对象中设置嵌套值
 *
 * 用于 `updateDataModel` 事件：将 value 设置到 dataModel 的指定路径。
 * 路径分隔符支持 `/` 和 `.`，自动过滤空段。
 *
 * @param obj 目标对象（会被原地修改）
 * @param path 路径字符串
 * @param value 要设置的值
 */
function setPathValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(/[/.]/).filter(Boolean)
  if (segments.length === 0) return
  let current: Record<string, unknown> = obj
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!
    if (!current[seg] || typeof current[seg] !== 'object') {
      current[seg] = {}
    }
    current = current[seg] as Record<string, unknown>
  }
  current[segments[segments.length - 1]!] = value
}

/**
 * 按 path（如 'user.name' 或 '/user/name'）从对象中取值
 *
 * 用于 `resolveA2UIBinding`：从 dataModel 中解析绑定路径。
 *
 * @param obj 源对象
 * @param path 路径字符串
 * @returns 路径对应的值；路径不存在则返回 undefined
 */
function getPathValue(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split(/[/.]/).filter(Boolean)
  let current: unknown = obj
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[seg]
  }
  return current
}

/**
 * A2UI 数据绑定解析（P2 新增）
 *
 * 解析组件属性中的数据绑定表达式，从 dataModel 中取值替换。
 *
 * # 支持的绑定形式
 * 1. **字符串模板**：`'${user.name} 的资料'` → 用 dataModel.user.name 替换 `${...}`
 * 2. **直接路径**：`'user.name'` → 直接从 dataModel 取 user.name 的值
 *    （判断条件：包含 `.` 且不以 `/` 开头；纯字符串无 `.` 视为字面量）
 * 3. **对象/数组**：递归解析每个属性/元素
 *
 * # 与 TS 端 a2ui-tools.ts 的关系
 * TS 端工具只负责 emit 事件，不解析绑定；
 * 绑定解析在前端渲染时进行（A2UIComponent.vue 调用 resolveBinding prop）。
 * 本函数作为 `resolveDataBinding` 返回值，注入到 A2UIRenderer.vue。
 *
 * @param binding 绑定表达式（string/object/array/null）
 * @param dataModel 画布数据模型
 * @returns 解析后的值（类型保持与 binding 一致，除路径解析外）
 */
function resolveA2UIBinding(binding: unknown, dataModel: Record<string, unknown>): unknown {
  if (binding === null || binding === undefined) return null
  if (typeof binding === 'string') {
    // 字符串模板：${path.to.value}
    if (binding.includes('${')) {
      return binding.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
        const val = getPathValue(dataModel, expr.trim())
        return val !== undefined && val !== null ? String(val) : ''
      })
    }
    // 直接路径：包含 '.' 且不以 '/' 开头（避免误判 URL 如 'http://...'）
    // 注意：以 '/' 开头的路径（如 '/entity'）也走 getPathValue
    if (binding.startsWith('/') || (binding.includes('.') && !/^[a-z]+:\/\//i.test(binding))) {
      const val = getPathValue(dataModel, binding)
      return val !== undefined ? val : binding
    }
    return binding
  }
  if (Array.isArray(binding)) {
    return binding.map((item) => resolveA2UIBinding(item, dataModel))
  }
  if (typeof binding === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(binding)) {
      result[key] = resolveA2UIBinding(val, dataModel)
    }
    return result
  }
  return binding
}

// ─── useAgentRustAdapter ────────────────────────────────────────────

/**
 * # useAgentRustAdapter — useAgent 的 Rust 后端适配版
 *
 * 阶段 2.0 新增。返回与 `useAgent` 完全一致的字段结构，
 * 内部使用 Rust Agent（通过 Tauri IPC）而非 TS Agent。
 *
 * ## 占位策略（方案 B：开关切换）
 * - **核心可工作**：messages / isStreaming / sendMessage / abort / newSession /
 *   dispose / currentSessionId / initError / isInitialized / ensureInitialized
 * - **空 ref 占位**：a2uiSurfaces / deepSegments / finalOutput / totalUsage /
 *   cumulativeUsage / lastRequestUsage / terminalVisible / ptyId / ptyReady
 * - **no-op 方法**：sendBlockAction / steer / setChatMode / updateModel /
 *   refreshSearchConfig / updateThinkingLevel / trimContext / resolveDataBinding /
 *   resolveToolConfirmation / getMCPManager / addMCPConnection / removeMCPConnection /
 *   getMCPConnections / createSubBackend / openTerminal / closeTerminal /
 *   writePtyInput / resizePty
 * - **长任务（已接入 useLongTaskRust）**：resumableTasks / activeTask /
 *   heartbeatStatus / hasActiveTask / resumeTask / discardTask / detectAndOfferResume
 * - **computed（基于 messages）**：lastAssistantHasContent / lastAssistantHasThinking / cacheHitRate
 * - **UI v-if 隐藏**：AgentChat / SpaceChat 中依赖未实现功能的元素
 *
 * ## 初始化流程
 * `ensureInitialized()` 从 `settingsStore` 读取 provider 配置，
 * 转换为 `RustProviderConfig`（snake_case），调用 `cmd_agent_create`。
 *
 * ## 与 useAgent 的契约差异
 * - Rust 版无持久化层：switchSession 实际是重置新会话
 * - Rust 版无工具系统：createSubBackend 抛错
 * - Rust 版无 A2UI：a2uiSurfaces 永远为空数组
 * - Rust 版无深度模式：deepSegments 永远为空数组
 * - Rust 版无终端：terminalVisible / ptyId / ptyReady 为空，openTerminal 为 no-op
 * - Rust 版长任务通过 useLongTaskRust 接入（SQLite 持久化 + 心跳 + 断点恢复）
 */
export function useAgentRustAdapter() {
  // 延迟导入避免循环依赖（settingsStore 间接依赖 agent store）
  const settingsStore = useSettingsStore()
  const inner = useAgentRust()
  // 长任务管理器（Rust SQLite 持久化版）— 阶段 2.2 接入
  const longTask = useLongTaskRust()
  // Supervisor Pattern 管理器（Rust 端 SupervisorNode 适配）— 阶段 2.1 批次3.2 接入
  // 模块级单例：多个 useAgentRustAdapter 实例共享同一组 supervisor 状态与方法
  const supervisor = useSupervisorRust()

  // ── 响应式状态（核心） ──
  const isInitialized = ref(false)
  const initError = ref<string | null>(null)
  const currentSessionId = ref<string>('')
  const isVisible = ref(true)
  const isPinned = ref(false)
  const activeChatMode = ref<'normal' | 'deep' | 'plan'>('normal')
  const lockedChatMode = ref<'normal' | 'deep' | 'plan' | null>(null)
  const sessionChatMode = ref<'normal' | 'deep' | 'plan' | null>(null)

  // ── 响应式状态（占位） ──
  // P2 Deep Mode：由 ensureInitialized 中注册的 deepPhase 监听器与 tool 事件
  // 监听器协同构建。agent_start 时重置，agent_end 时全部标记 done。
  const deepSegments = ref<DeepSegment[]>([])
  const finalOutput = ref<{
    content: string
    blocks: unknown[]
    images: unknown[]
    files: unknown[]
    status: 'streaming' | 'complete'
  }>({
    content: '',
    blocks: [],
    images: [],
    files: [],
    status: 'complete',
  })
  const totalUsage = ref({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
  })
  const lastRequestUsage = ref({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
  })
  const cumulativeUsage = ref({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
  })
  const cacheHitRate = computed(() => 0)
  // P2 A2UI：画布状态映射（surfaceId → Surface）
  // 由 backend.subscribe 中的 'a2ui' 事件处理函数维护：
  //   createSurface → 新增画布
  //   updateComponents → 更新组件布局
  //   updateDataModel → 更新数据模型（按 path 设置）
  //   deleteSurface → 删除画布
  // A2UIRenderer.vue 通过 :surfaces="a2uiSurfaces" 接收并渲染。
  const a2uiSurfaces = ref<Record<string, A2UISurface>>({})
  // 长任务：可恢复任务列表（detectAndOfferResume 填充，resumeTask/discardTask 移除）
  // 类型对齐 ResumeBanner.vue 期望的 LongTaskRecord[]
  const resumableTasks = ref<LongTaskRecord[]>([])
  // 长任务：activeTask / heartbeatStatus / hasActiveTask
  // 通过 watch 从 useLongTaskRust 同步（其导出为 readonly，无法直接传给组件解构）
  // AgentChat.vue 解构后期望 mutable Ref，故本地维护 ref 镜像
  const activeTask = ref<LongTaskRecord | null>(null)
  const heartbeatStatus = ref<'alive' | 'stale' | 'dead'>('alive')
  const hasActiveTask = ref(false)
  // 同步 useLongTaskRust 的状态到本地 ref（单向：useLongTaskRust 是单例真源）
  // useLongTaskRust 导出经 readonly() 包装为 DeepReadonly，但数据本身来自 Tauri 命令
  // 反序列化结果为可变对象，此处用类型断言还原可变类型以匹配本地 ref
  watch(
    longTask.activeTask,
    (v) => { activeTask.value = v as LongTaskRecord | null },
    { immediate: true },
  )
  watch(longTask.heartbeatStatus, (v) => { heartbeatStatus.value = v }, { immediate: true })
  watch(longTask.hasActiveTask, (v) => { hasActiveTask.value = v }, { immediate: true })
  const terminalVisible = ref(false)
  const ptyId = ref<string | null>(null)
  const ptyReady = ref(false)
  // logBridge stub：对齐 TerminalLogBridge 接口的所有公共方法
  // Rust 后端暂不支持终端日志桥接，所有方法 no-op，避免 TerminalPanel.vue 运行时错误
  // 接口定义见 src/agent/TerminalLogBridge.ts
  const logBridge = {
    attach: () => {},
    detach: () => {},
    setFilters: (_categories: unknown[]) => {},
    setPaused: (_paused: boolean) => {},
    handleEvent: (_event: unknown) => {},
    writeCommandOutput: (_output: string) => {},
    writeMcpLog: (_message: string) => {},
    onLog: () => {},
    dispose: () => {},
  }

  // ── P2 A2UI：事件处理（维护 a2uiSurfaces 状态） ──
  // 在 ensureInitialized 的 subscribe 回调中被调用，处理 4 种 A2UIMessage 变体。
  // 与 Rust 端 a2ui.rs 的 A2UIMessage 结构对应，字段名 camelCase 一致。
  function handleA2UIEvent(_surfaceId: string, message: A2UIMessage): void {
    const surfaces = a2uiSurfaces.value

    // createSurface：新增画布
    if ('createSurface' in message) {
      const { surfaceId: sid, catalogId, theme } = message.createSurface
      const newSurface: A2UISurface = {
        surfaceId: sid,
        catalogId: catalogId ?? 'worldsmith',
        theme,
        components: {},
        rootIds: [],
        dataModel: {},
      }
      a2uiSurfaces.value = { ...surfaces, [sid]: newSurface }
      return
    }

    // updateComponents：更新组件布局
    if ('updateComponents' in message) {
      const { surfaceId: sid, components } = message.updateComponents
      const surface = surfaces[sid]
      if (!surface) {
        console.warn(`[useAgentRustAdapter] A2UI updateComponents: 画布 ${sid} 不存在`)
        return
      }
      // 构建组件映射（id → component 定义）
      const componentsMap: Record<string, A2UIComponent> = {}
      for (const comp of components) {
        componentsMap[comp.id] = comp
      }
      // 计算根组件：未被其他组件的 children 引用的视为根
      const childIds = new Set<string>()
      for (const comp of components) {
        if (comp.children) {
          if (Array.isArray(comp.children)) {
            for (const c of comp.children) childIds.add(c)
          } else if (typeof comp.children === 'object' && comp.children.componentId) {
            childIds.add(comp.children.componentId)
          }
        }
      }
      const rootIds = components
        .map((c: A2UIComponent) => c.id)
        .filter((id: string) => !childIds.has(id))
      a2uiSurfaces.value = {
        ...surfaces,
        [sid]: {
          ...surface,
          components: componentsMap,
          rootIds,
        },
      }
      return
    }

    // updateDataModel：更新数据模型（按 path 设置嵌套值）
    if ('updateDataModel' in message) {
      const { surfaceId: sid, path, value } = message.updateDataModel
      const surface = surfaces[sid]
      if (!surface) {
        console.warn(`[useAgentRustAdapter] A2UI updateDataModel: 画布 ${sid} 不存在`)
        return
      }
      const newDataModel = { ...surface.dataModel }
      setPathValue(newDataModel, path, value)
      a2uiSurfaces.value = {
        ...surfaces,
        [sid]: { ...surface, dataModel: newDataModel },
      }
      return
    }

    // deleteSurface：删除画布
    if ('deleteSurface' in message) {
      const { surfaceId: sid } = message.deleteSurface
      if (!surfaces[sid]) {
        console.warn(`[useAgentRustAdapter] A2UI deleteSurface: 画布 ${sid} 不存在`)
        return
      }
      const newSurfaces = { ...surfaces }
      delete newSurfaces[sid]
      a2uiSurfaces.value = newSurfaces
      return
    }
  }

  // ── ProviderConfig 缓存（A4：getProviderConfig 返回最近一次构建的配置） ──
  // 每次 ensureInitialized 时更新；getProviderConfig 直接返回，避免重复读 settingsStore
  let cachedProviderConfig: RustProviderConfig | null = null

  // ── cumulativeUsage 持久化 key（按 sessionId 隔离） ──
  const CUMULATIVE_USAGE_STORAGE_PREFIX = 'worldsmith:rustAgent:cumulativeUsage:'

  /** 加载 cumulativeUsage from localStorage（按 sessionId 隔离） */
  function loadCumulativeUsage(sessionId: string): void {
    if (!sessionId) return
    try {
      const raw = localStorage.getItem(CUMULATIVE_USAGE_STORAGE_PREFIX + sessionId)
      if (raw) {
        const parsed = JSON.parse(raw) as typeof cumulativeUsage.value
        cumulativeUsage.value = {
          inputTokens: parsed.inputTokens || 0,
          outputTokens: parsed.outputTokens || 0,
          cacheReadTokens: parsed.cacheReadTokens || 0,
          cacheWriteTokens: parsed.cacheWriteTokens || 0,
          totalCost: parsed.totalCost || 0,
        }
      } else {
        cumulativeUsage.value = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCost: 0,
        }
      }
    } catch (err) {
      console.warn('[useAgentRustAdapter] loadCumulativeUsage 失败:', err)
    }
  }

  /** 持久化 cumulativeUsage 到 localStorage */
  function persistCumulativeUsage(sessionId: string): void {
    if (!sessionId) return
    try {
      localStorage.setItem(
        CUMULATIVE_USAGE_STORAGE_PREFIX + sessionId,
        JSON.stringify(cumulativeUsage.value),
      )
    } catch (err) {
      console.warn('[useAgentRustAdapter] persistCumulativeUsage 失败:', err)
    }
  }

  // ── computed（基于 messages） ──
  const lastAssistantHasContent = computed(() => {
    const msgs = inner.messages.value
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return (msgs[i].content || '').length > 0
    }
    return false
  })
  const lastAssistantHasThinking = computed(() => {
    const msgs = inner.messages.value
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return (msgs[i].thinking || '').length > 0
    }
    return false
  })

  // ── 构建 RustProviderConfig（snake_case） ──
  async function buildRustProviderConfig(): Promise<RustProviderConfig> {
    const mode = settingsStore.aiProviderMode as 'cloud' | 'local' | 'custom'
    if (mode === 'cloud') {
      const { loadApiKey } = await import('@agent/index')
      const apiKey = await loadApiKey(settingsStore.aiCloudProvider)
      return {
        mode: 'cloud',
        provider: settingsStore.aiCloudProvider,
        model_id: settingsStore.aiCloudModel,
        api_key: apiKey,
      }
    }
    if (mode === 'local') {
      return {
        mode: 'local',
        endpoint: settingsStore.aiLocalEndpoint,
        api_type: settingsStore.aiLocalType as 'ollama' | 'lm-studio' | 'vllm' | 'llama-cpp',
        model_id: settingsStore.aiLocalModel,
      }
    }
    const { loadApiKey } = await import('@agent/index')
    const apiKey = await loadApiKey(
      settingsStore.getCustomKeyStoreId(settingsStore.aiCustomBaseUrl),
    )
    return {
      mode: 'custom',
      base_url: settingsStore.aiCustomBaseUrl,
      api_key: apiKey,
      api_type: settingsStore.aiCustomType as 'openai-compatible' | 'anthropic-compatible',
      model_id: settingsStore.aiCustomModel,
      context_window: 1048576,
      max_tokens: 65536,
    }
  }

  // ── ensureInitialized（从 settingsStore 读取配置并初始化） ──
  async function ensureInitialized(): Promise<boolean> {
    if (isInitialized.value && inner.backend.value) return true
    initError.value = null
    try {
      const sessionId = `rust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const providerConfig = await buildRustProviderConfig()
      cachedProviderConfig = providerConfig

      // P2 A2UI：构造 toolContext，提供 emitA2UI 实现
      // Rust 模式下业务工具（entity/kb/schema 等）的 stores 暂未桥接，
      // 仅 A2UI 工具可用（它只依赖 emitA2UI）。
      // 业务工具调用时会因 stores 为 stub 报错，handleToolCallEvent 的 catch 会回传错误。
      // 后续 P3/P4 阶段补全 stores 桥接后，业务工具即可正常工作。
      const toolContext: IToolContext = {
        stores: {
          entity: {} as never,
          relation: {} as never,
          file: {} as never,
          settings: {
            getProviderConfig: () =>
              ({ mode: 'cloud', provider: 'unknown', modelId: '', apiKey: '' }) as never,
          },
          ui: { confirm: async () => true },
        },
        projectInfo: {
          name: 'WorldSmith-Rust',
          entityTypes: [],
          relationTypes: [],
          dirPath: null,
        },
        // A2UI 事件直接路由到 handleA2UIEvent，同步更新 a2uiSurfaces 状态
        emitA2UI: (surfaceId, message) => handleA2UIEvent(surfaceId, message),
      }
      await inner.init(
        sessionId,
        providerConfig,
        { thinkingLevel: 'off' },
        () => toolContext,
      )
      currentSessionId.value = sessionId
      isInitialized.value = true
      // 加载该 session 的累计 usage
      loadCumulativeUsage(sessionId)

      // 订阅事件：累加 usage（A2）+ 构建 deepSegments（P2）
      // inner.backend.value 一定不为 null（init 成功）
      const backend = inner.backend.value
      if (backend) {
        backend.subscribe((event) => {
          if (event.type === 'message_end' && event.usage) {
            // 累加 totalUsage / cumulativeUsage，并刷新 lastRequestUsage
            const u = event.usage
            lastRequestUsage.value = {
              inputTokens: u.inputTokens || 0,
              outputTokens: u.outputTokens || 0,
              cacheReadTokens: u.cacheReadTokens || 0,
              cacheWriteTokens: u.cacheWriteTokens || 0,
              totalCost: u.cost?.total || 0,
            }
            totalUsage.value = {
              inputTokens: totalUsage.value.inputTokens + (u.inputTokens || 0),
              outputTokens: totalUsage.value.outputTokens + (u.outputTokens || 0),
              cacheReadTokens:
                totalUsage.value.cacheReadTokens + (u.cacheReadTokens || 0),
              cacheWriteTokens:
                totalUsage.value.cacheWriteTokens + (u.cacheWriteTokens || 0),
              totalCost: totalUsage.value.totalCost + (u.cost?.total || 0),
            }
            cumulativeUsage.value = {
              inputTokens: cumulativeUsage.value.inputTokens + (u.inputTokens || 0),
              outputTokens: cumulativeUsage.value.outputTokens + (u.outputTokens || 0),
              cacheReadTokens:
                cumulativeUsage.value.cacheReadTokens + (u.cacheReadTokens || 0),
              cacheWriteTokens:
                cumulativeUsage.value.cacheWriteTokens + (u.cacheWriteTokens || 0),
              totalCost: cumulativeUsage.value.totalCost + (u.cost?.total || 0),
            }
            persistCumulativeUsage(sessionId)
          }

          // ── P2 Deep Mode：deepSegments 状态机构建 ──
          // 与 backend.subscribeDeepPhase 协同：
          //   agent_start → 重置 segments
          //   deep_phase_changed（via subscribeDeepPhase）→ 推入新阶段段
          //   tool_execution_start → 工具挂到当前活跃阶段
          //   tool_execution_end → 更新工具状态
          //   agent_end → 全部标记 done
          if (event.type === 'agent_start') {
            deepSegments.value = []
          }

          if (event.type === 'tool_execution_start') {
            const segs = deepSegments.value
            // 找到最后一个 active 的 phase 段，挂载工具
            for (let i = segs.length - 1; i >= 0; i--) {
              const seg = segs[i]
              if (seg.type === 'phase' && seg.status === 'active') {
                const newTool: ToolCallView = {
                  id: event.toolCall.id,
                  name: event.toolCall.name,
                  args: event.toolCall.args,
                  status: 'running',
                  startedAt: Date.now(),
                }
                seg.tools.push(newTool)
                // 触发响应式更新（直接 mutate 不触发 ref，需重新赋值）
                deepSegments.value = [...segs]
                break
              }
            }
          }

          if (event.type === 'tool_execution_end') {
            const segs = deepSegments.value
            // 从后往前找包含该工具的 phase 段
            for (let i = segs.length - 1; i >= 0; i--) {
              const seg = segs[i]
              if (seg.type === 'phase') {
                const tc = seg.tools.find((t) => t.id === event.toolCallId)
                if (tc) {
                  tc.status = event.success ? 'completed' : 'failed'
                  tc.endedAt = Date.now()
                  tc.result = event.result
                  deepSegments.value = [...segs]
                  break
                }
              }
            }
          }

          // agent_end 时触发防抖自动保存到 SQLite（阶段 2.5）
          // P1-1: 同时尝试生成会话标题（首轮对话后）
          // P2: 同时标记所有 active phase 段为 done
          if (event.type === 'agent_end') {
            scheduleAutoSave()
            void generateTitleIfNeeded()
            const segs = deepSegments.value
            let changed = false
            for (const seg of segs) {
              if (seg.type === 'phase' && seg.status === 'active') {
                seg.status = 'done'
                changed = true
              }
            }
            if (changed) deepSegments.value = [...segs]
          }

          // ── P2 A2UI：处理 A2UI 事件 ──
          // 收到 Rust 端 A2UI 工具触发的 a2ui 事件，按消息变体更新 a2uiSurfaces 状态。
          // 4 种变体：createSurface / updateComponents / updateDataModel / deleteSurface
          if (event.type === 'a2ui') {
            handleA2UIEvent(event.surfaceId, event.message)
          }
        })

        // P2 Deep Mode：注册 deep phase 监听器
        // 收到阶段切换事件 → 标记上一阶段 done、推入新阶段段（active）
        // event 顺序：agent_start（重置）→ deep_phase_changed（建段）→ tool_call_start（挂工具）→ ...
        backend.subscribeDeepPhase((p) => {
          const segs = deepSegments.value
          // 标记上一活跃阶段为 done
          if (segs.length > 0) {
            const last = segs[segs.length - 1]
            if (last && last.type === 'phase' && last.status === 'active') {
              last.status = 'done'
            }
          }
          // 推入新阶段段（phaseIndex === -1 表示"其他操作"，仍展示以保留完整工具链）
          const newSeg: DeepSegment = {
            id: `phase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'phase',
            label: p.phaseLabel,
            index: p.phaseIndex,
            timestamp: Date.now(),
            tools: [],
            outputs: [],
            status: 'active',
          }
          deepSegments.value = [...segs, newSeg]
        })
      }
      return true
    } catch (err: unknown) {
      initError.value = err instanceof Error ? err.message : String(err)
      console.error('[useAgentRustAdapter] ensureInitialized 失败:', err)
      return false
    }
  }

  // ── sendMessage（包一层 ensureInitialized） ──
  async function sendMessage(
    text: string,
    images?: unknown[],
    _files?: unknown[],
    _chatMode?: unknown,
  ): Promise<void> {
    if (!isInitialized.value) {
      const ok = await ensureInitialized()
      if (!ok) return
    }
    await inner.sendMessage(text, images as ImageAttachment[] | undefined)
  }

  // ── no-op 工具（仅用于真正缺失的能力） ──
  function noop(..._args: unknown[]): void {
    /* no-op */
  }
  function noopAsync(..._args: unknown[]): Promise<void> {
    return Promise.resolve()
  }

  // ── A1: steer — 真实调用 cmd_agent_steer ──
  async function steer(text: string): Promise<void> {
    if (!inner.backend.value) return
    try {
      await inner.backend.value.steer(text)
    } catch (err) {
      console.error('[useAgentRustAdapter] steer 失败:', err)
    }
  }

  // ── A1: sendBlockAction — 复用 steer 逻辑 ──
  // 与 TS 版语义一致：流式输出中调 steer，否则把 displayText 推入消息并 prompt
  async function sendBlockAction(steerText: string, displayText: string): Promise<void> {
    if (inner.isStreaming.value) {
      await steer(steerText)
    } else {
      if (!isInitialized.value) {
        const ok = await ensureInitialized()
        if (!ok) return
      }
      // 推入 displayText 作为用户可见消息
      const { crypto } = window
      inner.messages.value.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: displayText,
        timestamp: Date.now(),
      })
      // 用 steerText 作为实际 prompt 输入
      await inner.sendMessage(steerText)
    }
  }

  // ── A1: updateModel — 调用 cmd_agent_update_model 并更新本地缓存 ──
  async function updateModel(
    provider: string,
    modelId: string,
    baseUrl?: string,
    apiKey?: string,
    temperature?: number,
    maxTokens?: number,
    _contextWindow?: number,
    _maxOut?: number,
  ): Promise<void> {
    if (!inner.backend.value) {
      console.warn('[useAgentRustAdapter] updateModel: backend 未初始化')
      return
    }
    try {
      // Rust cmd_agent_update_model 的参数顺序：
      // (session_id, provider, model_id, base_url, api_key, temperature, max_tokens)
      // Tauri 自动转 camelCase：provider, modelId, baseUrl, apiKey, temperature, maxTokens
      await invoke('cmd_agent_update_model', {
        sessionId: currentSessionId.value,
        provider,
        modelId,
        baseUrl,
        apiKey,
        // temperature TS 版传 0-100 整数，Rust 端接收 f32（0.0-1.0），转换保持一致
        temperature: temperature !== undefined ? temperature / 100 : undefined,
        maxTokens,
      })
      // 同步更新本地 cachedProviderConfig（保留与 settingsStore 一致的快照）
      if (cachedProviderConfig) {
        if (cachedProviderConfig.mode === 'cloud') {
          cachedProviderConfig.provider = provider
          cachedProviderConfig.model_id = modelId
          if (apiKey !== undefined) cachedProviderConfig.api_key = apiKey
        } else if (cachedProviderConfig.mode === 'custom') {
          cachedProviderConfig.model_id = modelId
          if (apiKey !== undefined) cachedProviderConfig.api_key = apiKey
          if (baseUrl !== undefined) cachedProviderConfig.base_url = baseUrl
        } else if (cachedProviderConfig.mode === 'local') {
          cachedProviderConfig.model_id = modelId
        }
      }
    } catch (err) {
      console.error('[useAgentRustAdapter] updateModel 失败:', err)
    }
  }

  // ── A1: updateThinkingLevel — 调用 cmd_agent_update_thinking_level ──
  function updateThinkingLevel(level: ThinkingLevel): void {
    if (!inner.backend.value) return
    try {
      inner.backend.value.updateThinkingLevel(level)
    } catch (err) {
      console.error('[useAgentRustAdapter] updateThinkingLevel 失败:', err)
    }
  }

  // ── A1: trimContext — 调用 cmd_agent_trim_context ──
  function trimContext(upToIndex: number): void {
    if (!inner.backend.value) return
    try {
      inner.backend.value.trimContext(upToIndex)
    } catch (err) {
      console.error('[useAgentRustAdapter] trimContext 失败:', err)
    }
  }

  // ── 长任务：断点恢复 / 放弃 / 启动检测（阶段 2.2 接入 useLongTaskRust） ──

  /**
   * detectAndOfferResume — 应用启动时检测可恢复任务
   *
   * 查询 SQLite 中所有 status=running 的任务（刷新/崩溃后未终结的），
   * 填充 `resumableTasks` ref，触发 `ResumeBanner.vue` 显示恢复横幅。
   *
   * 调用时机：AgentOverlay.vue onMounted
   */
  async function detectAndOfferResume(): Promise<void> {
    try {
      const tasks = await longTask.detectResumableTasks()
      resumableTasks.value = tasks
      if (tasks.length > 0) {
        console.log(`[useAgentRustAdapter] 检测到 ${tasks.length} 个可恢复任务`)
      }
    } catch (err) {
      console.warn('[useAgentRustAdapter] detectAndOfferResume 失败:', err)
    }
  }

  /**
   * resumeTask — 用户点击"恢复"按钮，从断点恢复长任务
   *
   * 流程：
   * 1. 加载任务 record（含 checkpoint.agentMessages）
   * 2. 确保后端已初始化（若未初始化则调 ensureInitialized）
   * 3. 通过 `cmd_agent_set_runtime_messages` 写回 AgentLoop 内部 messages
   * 4. 调用 `longTask.resumeActiveTask` 恢复内存状态（启动心跳、设 activeTask）
   * 5. 从 `resumableTasks` 列表移除该任务
   *
   * 注：恢复后不会自动 prompt（避免未授权 LLM 调用），
   * 用户可在输入框键入"继续"或新指令触发 cmd_agent_prompt。
   *
   * @param taskId 任务 ID
   */
  async function resumeTask(taskId: string): Promise<void> {
    try {
      const record = await longTask.loadTask(taskId)
      if (!record) {
        console.warn(`[useAgentRustAdapter] resumeTask: 任务 ${taskId} 不存在（已被清理？）`)
        resumableTasks.value = resumableTasks.value.filter((t) => t.taskId !== taskId)
        return
      }

      // 确保后端已初始化（首次启动后用户可能未发消息就点恢复）
      if (!isInitialized.value || !inner.backend.value) {
        const ok = await ensureInitialized()
        if (!ok) {
          console.warn('[useAgentRustAdapter] resumeTask: 后端初始化失败')
          return
        }
      }

      // 写回 AgentLoop 内部 messages（恢复 ReAct 上下文）
      // checkpoint.agentMessages 是 OrchestratorMessage 镜像，可直接传回 Rust
      const agentMessages = record.checkpoint?.agentMessages
      if (agentMessages && agentMessages.length > 0 && inner.backend.value) {
        inner.backend.value.setRuntimeMessages(agentMessages)
        console.log(
          `[useAgentRustAdapter] resumeTask: 已写回 ${agentMessages.length} 条 messages 到 AgentLoop`,
        )
      }

      // 恢复 useLongTaskRust 内存状态（启动心跳、设 activeTask、注册 checkpointProvider）
      longTask.resumeActiveTask(record, () => {
        // getCheckpointData 回调：返回当前 AgentLoop messages 快照
        return {
          agentMessages: inner.backend.value?.getRuntimeMessages() ?? [],
          lastUserText: record.checkpoint?.lastUserText ?? '',
          skillNames: record.checkpoint?.skillNames,
          chatMode: record.checkpoint?.chatMode,
          lockedChatMode: record.checkpoint?.lockedChatMode,
        }
      })

      // 从可恢复列表移除
      resumableTasks.value = resumableTasks.value.filter((t) => t.taskId !== taskId)

      console.log(
        `[useAgentRustAdapter] 任务 ${taskId} 已恢复（轮次: ${record.turnCount}），等待用户继续`,
      )
    } catch (err) {
      console.error('[useAgentRustAdapter] resumeTask 失败:', err)
    }
  }

  /**
   * discardTask — 用户点击"放弃"按钮，丢弃可恢复任务
   *
   * 流程：
   * 1. 若任务在内存中活跃（activeTask 是它）：调 cancelTask 标记 cancelled
   *    （否则心跳可能仍在跑，污染后续任务）
   * 2. 否则直接调 deleteTask 删除 SQLite record（任务已不在内存）
   * 3. 从 resumableTasks 移除
   *
   * @param taskId 任务 ID
   */
  async function discardTask(taskId: string): Promise<void> {
    try {
      if (longTask.getActiveTaskId() === taskId) {
        // 内存中活跃：调 cancelTask（会停止心跳、标记 cancelled、清理内存）
        await longTask.cancelTask(taskId)
      } else {
        // 仅在 SQLite 中：直接删除 record
        await longTask.deleteTask(taskId)
      }
      resumableTasks.value = resumableTasks.value.filter((t) => t.taskId !== taskId)
      console.log(`[useAgentRustAdapter] 已放弃任务 ${taskId}`)
    } catch (err) {
      console.error('[useAgentRustAdapter] discardTask 失败:', err)
    }
  }

  // ── A3: setChatMode — 本地状态切换（参考 TS 版 useAgent 语义） ──
  // TS 版规则：若 sessionChatMode/lockedChatMode 均为 null，则更新 activeChatMode
  // lockedChatMode 在 sendBlockAction 中设置（深度模式锁定），结束时清除
  function setChatMode(mode: 'normal' | 'deep' | 'plan'): void {
    if (sessionChatMode.value === null && lockedChatMode.value === null) {
      activeChatMode.value = mode
    }
  }

  // ── A4: getProviderConfig — 返回缓存的 RustProviderConfig ──
  function getProviderConfig(): RustProviderConfig | null {
    return cachedProviderConfig
  }

  // ── 会话持久化（阶段 2.5） ──

  /**
   * 自动保存当前会话到 SQLite
   *
   * 调用 `cmd_session_save`，包含 messages / providerConfig / thinkingLevel / pinned 等。
   * 标题取自首条用户消息前 50 字符，无消息时不保存。
   */
  async function autoSaveCurrentSession(): Promise<void> {
    if (!currentSessionId.value || !cachedProviderConfig) return
    if (inner.messages.value.length === 0) return

    const title = inner.messages.value[0]?.content?.slice(0, 50) || 'Untitled Session'
    const req: RustSaveSessionRequest = {
      id: currentSessionId.value,
      title,
      providerConfig: cachedProviderConfig,
      messages: inner.messages.value,
      thinkingLevel: inner.thinkingLevel.value ?? 'off',
      systemPrompt: null,
      pinned: isPinned.value,
      // P1-4: 持久化累计 usage，跨会话恢复时显示成本统计
      totalUsage: {
        inputTokens: totalUsage.value.inputTokens,
        outputTokens: totalUsage.value.outputTokens,
        cacheReadTokens: totalUsage.value.cacheReadTokens,
        cacheWriteTokens: totalUsage.value.cacheWriteTokens,
        totalCost: totalUsage.value.totalCost,
      },
    }
    try {
      await invoke('cmd_session_save', { req })
    } catch (err) {
      console.error('[useAgentRustAdapter] autoSaveCurrentSession 失败', err)
    }
  }

  /**
   * 防抖自动保存计时器
   *
   * agent_end 事件触发后延迟 2 秒保存，避免连续多轮快速触发写入。
   */
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleAutoSave(): void {
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => {
      void autoSaveCurrentSession().finally(() => {
        autoSaveTimer = null
      })
    }, 2000)
  }

  // ── P1-1: 标题生成 ──

  /** 标志：当前会话是否已生成过标题（避免重复调用 LLM） */
  let titleGenerated = false

  /**
   * 将 RustProviderConfig（snake_case）转换为 TS ProviderConfig（camelCase）
   *
   * 用于调用 generateTitle（该函数期望 TS 端 ProviderConfig）。
   * cloud 模式的 provider 字段是 CloudProvider 联合类型，string 不能直接赋值，用 as 断言。
   */
  function rustProviderConfigToTs(rust: RustProviderConfig): ProviderConfig {
    if (rust.mode === 'cloud') {
      return {
        mode: 'cloud',
        provider: rust.provider,
        modelId: rust.model_id,
        apiKey: rust.api_key,
      } as ProviderConfig
    }
    if (rust.mode === 'local') {
      return {
        mode: 'local',
        endpoint: rust.endpoint,
        apiType: rust.api_type,
        modelId: rust.model_id,
      }
    }
    return {
      mode: 'custom',
      baseUrl: rust.base_url,
      apiKey: rust.api_key,
      apiType: rust.api_type,
      modelId: rust.model_id,
      contextWindow: rust.context_window,
      maxTokens: rust.max_tokens,
    }
  }

  /**
   * 首轮对话后自动生成标题并更新到 SQLite
   *
   * 触发条件：
   * - 当前会话未生成过标题
   * - 至少 1 轮对话（user + assistant）
   * - 已有 cachedProviderConfig
   */
  async function generateTitleIfNeeded(): Promise<void> {
    if (titleGenerated) return
    if (!currentSessionId.value || !cachedProviderConfig) return

    const userMsgs = inner.messages.value.filter(m => m.role === 'user')
    const assistantMsgs = inner.messages.value.filter(m => m.role === 'assistant')
    if (userMsgs.length === 0 || assistantMsgs.length === 0) return

    const firstUser = userMsgs[0].content
    const firstAssistant = assistantMsgs[0].content

    try {
      const tsConfig = rustProviderConfigToTs(cachedProviderConfig)
      const title = await generateTitle(tsConfig, firstUser, firstAssistant)
      if (title && currentSessionId.value) {
        await invoke('cmd_session_update_title', {
          sessionId: currentSessionId.value,
          title,
        })
        titleGenerated = true
      }
    } catch (err) {
      console.error('[useAgentRustAdapter] generateTitleIfNeeded 失败', err)
    }
  }

  // ── P1-2: 会话列表 ──

  /** 会话列表（按 pinned DESC, updated_at DESC 排序） */
  const sessionList = ref<RustSessionSummary[]>([])

  /** 从 SQLite 加载所有会话摘要 */
  async function loadSessionList(): Promise<void> {
    try {
      sessionList.value = await invoke<RustSessionSummary[]>('cmd_session_list')
    } catch (err) {
      console.error('[useAgentRustAdapter] loadSessionList 失败', err)
      sessionList.value = []
    }
  }

  // ── P1-3: 置顶 / 删除 ──

  /**
   * 切换会话置顶状态
   * @param sessionId 不传时切换当前会话
   */
  async function togglePin(sessionId?: string): Promise<void> {
    const id = sessionId ?? currentSessionId.value
    if (!id) return
    const newPinned = !isPinned.value
    try {
      await invoke('cmd_session_toggle_pin', { sessionId: id, pinned: newPinned })
      if (id === currentSessionId.value) {
        isPinned.value = newPinned
      }
      await loadSessionList()
    } catch (err) {
      console.error('[useAgentRustAdapter] togglePin 失败', err)
    }
  }

  /**
   * 删除会话
   * @param sessionId 待删除会话 ID；若为当前会话则切换到新会话
   */
  async function deleteSession(sessionId: string): Promise<void> {
    try {
      await invoke('cmd_session_delete', { sessionId })
      if (sessionId === currentSessionId.value) {
        await newSession()
      }
      await loadSessionList()
    } catch (err) {
      console.error('[useAgentRustAdapter] deleteSession 失败', err)
    }
  }

  // ── newSession / switchSession / dispose ──
  async function newSession(): Promise<void> {
    // 1. 保存当前会话（如果有）
    if (currentSessionId.value && inner.messages.value.length > 0) {
      await autoSaveCurrentSession()
    }
    // 2. 销毁当前 backend
    if (inner.backend.value) {
      inner.dispose()
    }
    isInitialized.value = false
    currentSessionId.value = ''
    cachedProviderConfig = null
    titleGenerated = false
    // 重置 usage 统计（cumulativeUsage 保留——新 session 重新加载）
    totalUsage.value = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
    }
    lastRequestUsage.value = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
    }
    isPinned.value = false
    activeChatMode.value = 'normal'
    lockedChatMode.value = null
    sessionChatMode.value = null
    // 3. 用缓存的 providerConfig 初始化新 Agent（ensureInitialized 会自动生成新 sessionId）
    await ensureInitialized()
  }

  async function switchSession(sessionId: string): Promise<void> {
    // 1. 保存当前会话到 SQLite
    if (currentSessionId.value && inner.messages.value.length > 0) {
      await autoSaveCurrentSession()
    }

    // 2. 销毁当前 Rust Agent
    if (inner.backend.value) {
      inner.dispose()
    }
    isInitialized.value = false
    titleGenerated = false

    // 3. 从 SQLite 加载目标会话
    let record: RustSessionRecord
    try {
      record = await invoke<RustSessionRecord>('cmd_session_load', { sessionId })
    } catch (err) {
      console.error('[useAgentRustAdapter] switchSession: 加载会话失败', err)
      // 加载失败时回退到新建会话
      await newSession()
      return
    }

    // 4. 用 record.providerConfig 创建新 Rust Agent
    cachedProviderConfig = record.providerConfig
    await inner.init(sessionId, record.providerConfig, {
      thinkingLevel: (record.thinkingLevel as ThinkingLevel) ?? 'off',
      systemPrompt: record.systemPrompt ?? undefined,
    })
    currentSessionId.value = sessionId
    isInitialized.value = true
    loadCumulativeUsage(sessionId)

    // 5. 写回 AgentLoop 内部 messages（恢复 ReAct 上下文）
    // 注意：Rust 端 OrchestratorMessage 与前端 AgentMessage 结构有差异，
    // 简化策略：只恢复 user/assistant 文本消息，tool_calls 丢失可接受（历史不重放）
    if (record.messages.length > 0 && inner.backend.value) {
      const runtimeMessages = record.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role,
          content: m.content,
        }))
      inner.backend.value.setRuntimeMessages(runtimeMessages)
    }

    // 6. 恢复前端状态
    inner.messages.value = record.messages
    isPinned.value = record.pinned

    // 7. 恢复累计 usage（P1-4：从 SQLite 持久化的 totalUsage 字段恢复）
    //    若 record.totalUsage 不存在（老会话），则置零
    if (record.totalUsage) {
      totalUsage.value = {
        inputTokens: record.totalUsage.inputTokens,
        outputTokens: record.totalUsage.outputTokens,
        cacheReadTokens: record.totalUsage.cacheReadTokens,
        cacheWriteTokens: record.totalUsage.cacheWriteTokens,
        totalCost: record.totalUsage.totalCost,
      }
    } else {
      totalUsage.value = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCost: 0,
      }
    }
    // lastRequestUsage 始终重置（仅记录最近一次请求的 usage）
    lastRequestUsage.value = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
    }
    activeChatMode.value = 'normal'
    lockedChatMode.value = null
    sessionChatMode.value = null

    // 8. 若已有标题则标记为已生成
    titleGenerated = record.title !== 'Untitled Session' && record.title !== ''
  }

  function dispose(): void {
    // 保存最后状态到 SQLite（fire-and-forget，不阻塞 dispose）
    if (currentSessionId.value && inner.messages.value.length > 0) {
      void autoSaveCurrentSession().catch(err => {
        console.error('[useAgentRustAdapter] dispose 时保存会话失败', err)
      })
    }
    // 清理防抖计时器
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    inner.dispose()
    isInitialized.value = false
    currentSessionId.value = ''
    cachedProviderConfig = null
  }

  // ── 返回与 useAgent 完全一致的字段结构 ──
  return {
    // 核心
    isVisible: readonly(isVisible),
    isInitialized: readonly(isInitialized),
    messages: inner.messages,
    isStreaming: inner.isStreaming,
    currentSessionId: readonly(currentSessionId),
    initError: readonly(initError),
    isPinned,
    activeChatMode: readonly(activeChatMode),
    lockedChatMode: readonly(lockedChatMode),
    sessionChatMode: readonly(sessionChatMode),
    deepSegments: readonly(deepSegments),
    finalOutput: readonly(finalOutput),
    lastAssistantHasContent,
    lastAssistantHasThinking,
    setChatMode,
    totalUsage: readonly(totalUsage),
    lastRequestUsage: readonly(lastRequestUsage),
    cumulativeUsage: readonly(cumulativeUsage),
    cacheHitRate,
    a2uiSurfaces: readonly(a2uiSurfaces),
    // P2 A2UI：数据绑定解析函数（注入 A2UIRenderer.vue 的 resolveBinding prop）
    // 签名对齐 AgentMessageList.vue:139 期望的 (binding: any, dataModel: Record<string, unknown>) => any
    resolveDataBinding: resolveA2UIBinding,
    updateThinkingLevel,
    refreshSearchConfig: noopAsync,
    getMCPManager: () => null,
    addMCPConnection: noopAsync,
    removeMCPConnection: noopAsync,
    getMCPConnections: () => [],
    updateModel,
    ensureInitialized,
    sendMessage,
    steer,
    sendBlockAction,
    abort: inner.abort,
    resumableTasks: readonly(resumableTasks),
    resumeTask,
    discardTask,
    detectAndOfferResume,
    // 对齐 TS 版 useAgent：activeTask/heartbeatStatus/hasActiveTask 不包 readonly
    // useLongTaskProgress 期望 mutable Ref，readonly 会导致类型不兼容
    activeTask,
    heartbeatStatus,
    hasActiveTask,
    trimContext,
    newSession,
    switchSession,
    clearInitError: () => {
      initError.value = null
    },
    toggleVisibility: () => {
      isVisible.value = !isVisible.value
    },
    show: () => {
      isVisible.value = true
    },
    hide: () => {
      isVisible.value = false
    },
    dispose,
    // 对齐 TS 版 useAgent：terminalVisible/ptyId/ptyReady 不包 readonly
    terminalVisible,
    ptyId,
    ptyReady,
    logBridge,
    openTerminal: noopAsync,
    closeTerminal: noop,
    writePtyInput: noop,
    resizePty: noop,
    createSubBackend: async () => {
      throw new Error('[Rust] createSubBackend 未实现')
    },
    getProviderConfig,
    getToolContext: () => null,
    resolveToolConfirmation: noop,
    // P1-2/P1-3：会话列表与置顶/删除
    sessionList: readonly(sessionList),
    loadSessionList,
    togglePin,
    deleteSession,
    // 阶段 2.1 批次3.2：Supervisor Pattern 入口（useAgent 没有此字段，是 Rust 版独有扩展）
    // UI 组件可通过此入口访问 Supervisor 能力，也可直接调用 useSupervisorRust()
    supervisor,
  }
}
