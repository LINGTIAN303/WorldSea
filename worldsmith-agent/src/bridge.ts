import type { AgentStateSnapshot, AgentMessage } from './session/types'
import type { PromptOptions, AgentEvent, AgentEventListener, AgentConfig, ToolDefinition, ToolParameter, IAgentBackend, UsageData, ThinkingLevel, ChatMode, A2UIMessage, A2UIComponent } from './bridge-types'
import { buildSkillIndexPrompt, buildOutputGuidePrompt } from './skills/registry'
import { activateSkills } from './skills/loader'
import { buildPluginCapabilityPrompt } from './skills/plugin-bridge'
import { PERSONA_PRESETS } from './context/injector'
import { DefaultToolBus } from './toolbus/toolbus'
import type { ToolBus } from './toolbus/toolbus'
import { MCPManager } from './mcp/mcp-manager'
import { recallMemory, formatMemoryForPrompt } from './tools/memory'
import { retryWithBackoff } from './group-chat/flow-control'
import { kbSearchKeyword, kbList } from './kb/kb-store'
import { semanticSearchKB, isEmbeddingReady as isKBEmbeddingReady } from './kb/kb-indexer'
import { extractFromConversation, extractShortMemory } from './kb/kb-extractor'
import { streamSimple } from '@earendil-works/pi-ai'
import {
  getProviderManifest,
  detectVisionSupport,
  detectThinkingSupport,
  resolveModelId as registryResolveModelId,
  buildProxyEndpoint,
} from './providers/provider-registry'

export type {
  PromptOptions,
  AgentEvent,
  AgentEventListener,
  AgentConfig,
  ToolDefinition,
  ToolParameter,
  IAgentBackend,
  UsageData,
  ThinkingLevel,
  A2UIMessage,
  A2UIComponent,
}

export class CoreBackend implements IAgentBackend {
  private agent: any = null
  private listeners: Set<AgentEventListener> = new Set()
  private _state: AgentStateSnapshot
  private config: AgentConfig
  private unsub: (() => void) | null = null
  private originalSystemPrompt: string = ''
  private activeSkillIds: Set<string> = new Set()
  private skillIndexPrompt: string = ''
  private pendingModel: any = null
  private toolBus: DefaultToolBus
  private mcpManager: MCPManager
  private _developerMode: boolean = false
  private _advancedMode: boolean = false
  private _temperature?: number
  private _maxTokens?: number
  private _currentChatMode: ChatMode = 'normal'
  private _lastUserText: string = ''
  private _lastAssistantText: string = ''

  constructor(config: AgentConfig) {
    this.config = config
    this.toolBus = new DefaultToolBus()
    for (const tool of config.tools) {
      this.toolBus.register(tool)
    }
    this.mcpManager = new MCPManager()
    this.mcpManager.setToolBus(this.toolBus)
    this.mcpManager.setOnToolsChanged(async () => {
      await this.reloadTools()
    })
    this._state = {
      sessionId: crypto.randomUUID(),
      model: null,
      thinkingLevel: 'medium',
      messages: [],
      isStreaming: false,
      pendingToolCalls: [],
    }
    this.config.toolContext.emitA2UI = (surfaceId: string, message: A2UIMessage) => {
      this.emit({ type: 'a2ui', surfaceId, message })
    }
  }

  async initialize(): Promise<void> {
    this.skillIndexPrompt = buildSkillIndexPrompt(this._developerMode, this._advancedMode)
    this._state.model = {
      provider: (this.config.providerConfig as any).provider ?? this.config.providerConfig.mode,
      modelId: this.config.providerConfig.modelId,
      displayName: this.config.providerConfig.modelId,
      contextWindow: (this.config.providerConfig as any).contextWindow,
    }
  }

  private convertParamsToJsonSchema(params: Record<string, any>): Record<string, any> {
    const properties: Record<string, any> = {}
    const required: string[] = []

    for (const [name, param] of Object.entries(params)) {
      const prop: Record<string, any> = { type: param.type, description: param.description }
      if (param.enum) prop.enum = param.enum
      if (param.type === 'array' && param.items) {
        prop.items = { type: param.items.type, description: param.items.description }
        if (param.items.enum) prop.items.enum = param.items.enum
      }
      properties[name] = prop
      if (param.required) required.push(name)
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    }
  }

  private static getOrigin(): string {
    return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
  }

  private static resolveProxyUrl(proxyPath: string): string {
    return `${CoreBackend.getOrigin()}${proxyPath}`
  }

  private checkVisionSupport(provider: string, modelId: string): boolean {
    const cfg = this.config.providerConfig as any
    if (cfg.supportsVision !== undefined) return !!cfg.supportsVision
    return detectVisionSupport(provider, modelId)
  }

  private async buildModel(): Promise<any> {
    const { getModel } = await import('@earendil-works/pi-ai')
    const cfg = this.config.providerConfig as any
    const manifest = getProviderManifest(cfg.provider)
    const isDomestic = manifest?.isDomestic ?? false

    if (cfg.mode === 'cloud' && !isDomestic) {
      try {
        const model = getModel(cfg.provider, cfg.modelId)
        if (model) {
          if (manifest) model.baseUrl = buildProxyEndpoint(cfg.provider)
          return model
        }
      } catch { /* fall through to custom */ }
    }

    if (cfg.mode === 'cloud') {
      return this.buildCustomModel(cfg.provider, cfg.modelId, undefined, cfg.apiKey)
    }

    if (cfg.mode === 'local') {
      return this.buildCustomModel(cfg.apiType, cfg.modelId, cfg.endpoint, undefined)
    }

    return this.buildCustomModel(cfg.apiType, cfg.modelId, cfg.baseUrl, cfg.apiKey)
  }

  private buildCustomModel(provider: string, modelId: string, baseUrl?: string, apiKey?: string): any {
    const manifest = getProviderManifest(provider)
    const isAnthropic = manifest?.apiType === 'anthropic-messages' || provider.includes('anthropic')
    const isGoogle = manifest?.apiType === 'google-generative-ai' || provider === 'google-vertex'
    const api = manifest?.apiType || (isAnthropic ? 'anthropic-messages' : isGoogle ? 'google-generative-ai' : 'openai-completions')

    let resolvedBaseUrl = baseUrl || (manifest ? buildProxyEndpoint(provider) : '') || (provider === 'ollama' ? 'http://localhost:11434/v1' : '')

    const isCustomRemote = baseUrl && /^https?:\/\//.test(baseUrl)
    let customProxyHeaders: Record<string, string> | undefined
    if (isCustomRemote) {
      try {
        const url = new URL(baseUrl!)
        let pathName = url.pathname.replace(/\/+$/, '')
        if (!pathName) pathName = '/v1'
        const proxyPath = `/api/custom-proxy${pathName}`
        customProxyHeaders = { 'X-Target-Base-Url': `${url.protocol}//${url.host}` }
        resolvedBaseUrl = CoreBackend.resolveProxyUrl(proxyPath)
      } catch {}
    }

    // DeepSeek 特殊处理：URL 中包含 deepseek.com 也视为 DeepSeek
    const isDeepSeekByUrl = (baseUrl || '').includes('deepseek.com')
    const isDeepSeek = provider === 'deepseek' || isDeepSeekByUrl

    const resolvedModelId = registryResolveModelId(provider, modelId)
    const supportsVision = this.checkVisionSupport(provider, resolvedModelId)
    const supportsThinking = detectThinkingSupport(provider, resolvedModelId)

    const model: any = {
      id: resolvedModelId,
      name: resolvedModelId,
      api,
      provider: isDeepSeek ? 'deepseek' : provider,
      baseUrl: resolvedBaseUrl,
      reasoning: supportsThinking,
      input: supportsVision ? ['text', 'image'] : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: (this.config.providerConfig as any).contextWindow || 1048576,
      maxTokens: (this.config.providerConfig as any).maxTokens || 65536,
    }

    // 从 manifest 读取 compat 配置
    if (manifest?.compat) {
      model.compat = { ...manifest.compat }
      // 思考格式：如果模型支持思考且 manifest 定义了 thinkingFormat
      if (supportsThinking && manifest.thinkingFormat && !model.compat.thinkingFormat) {
        model.compat.thinkingFormat = manifest.thinkingFormat
      }
    } else if (!isAnthropic && !isGoogle) {
      model.compat = { maxTokensField: 'max_tokens', supportsStrictMode: false, supportsUsageInStreaming: true }
    }

    // 思考级别映射
    if (manifest?.thinkingLevelMap) {
      model.thinkingLevelMap = manifest.thinkingLevelMap
    }

    if (apiKey) {
      model.headers = { 'Authorization': `Bearer ${apiKey}`, ...customProxyHeaders }
    } else if (customProxyHeaders) {
      model.headers = { ...customProxyHeaders }
    }

    return model
  }

  private agentInitPromise: Promise<any> | null = null

  private async ensureAgent(): Promise<any> {
    if (this.agent) return this.agent
    if (this.agentInitPromise) return this.agentInitPromise

    this.agentInitPromise = this._initAgent()
    try {
      return await this.agentInitPromise
    } finally {
      this.agentInitPromise = null
    }
  }

  private convertToolToPi(t: ToolDefinition): any {
    return {
      name: t.name,
      label: t.name,
      description: t.description,
      parameters: this.convertParamsToJsonSchema(t.parameters),
      execute: async (toolCallId: string, params: unknown, _signal?: AbortSignal, _onUpdate?: any) => {
        const args = params as Record<string, unknown>
        // 深度模式下等待用户确认后再执行工具
        if (this.config.toolContext?.waitForConfirmation) {
          const approved = await this.config.toolContext.waitForConfirmation(toolCallId)
          if (!approved) {
            return {
              content: [{ type: 'text' as const, text: '用户拒绝执行' }],
              details: { error: true },
              isError: true,
            }
          }
        }
        // 注意：PI 框架会自动发射 tool_execution_start / tool_execution_end 事件，
        // 这里不再手动发射，避免双重发射导致 useAgent 收到重复事件
        const ctx: typeof this.config.toolContext = {
          ...this.config.toolContext,
          reportProgress: (progress: number, status?: string) => {
            this.emit({
              type: 'tool_execution_update',
              toolCallId,
              progress,
              status,
            })
          },
        }
        try {
          const res = await t.execute(args, ctx)
          if (t.name.startsWith('output_') && this.config.toolContext.appendBlock) {
            console.log('[Agent] output tool executed:', t.name, 'result:', res)
          }
          return {
            content: [{ type: 'text' as const, text: res }],
            details: { success: true },
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return {
            content: [{ type: 'text' as const, text: msg }],
            details: { error: true },
            isError: true,
          }
        }
      },
    }
  }

  private async _initAgent(): Promise<any> {
    if (this.agent) return this.agent

    const { Agent } = await import('@earendil-works/pi-agent-core')
    let model = this.pendingModel || await this.buildModel()

    const piTools = this.toolBus.getAll().map(t => this.convertToolToPi(t))

    console.log('[Agent] Tools loaded:', piTools.length, '| output tools:', piTools.filter(t => t.name.startsWith('output_')).map(t => t.name))

    const apiKey = this.extractApiKeyFromModel(model) || (this.config.providerConfig as any).apiKey
    const savedTemp = (this.config.providerConfig as any).temperature
    const savedMaxTokens = (this.config.providerConfig as any).maxTokens
    if (savedTemp !== undefined) this._temperature = savedTemp
    if (savedMaxTokens !== undefined) this._maxTokens = savedMaxTokens

    console.log('[Agent] Model config:', {
      id: model.id,
      provider: model.provider,
      baseUrl: model.baseUrl,
      api: model.api,
      reasoning: model.reasoning,
      compat: model.compat,
      hasApiKey: !!apiKey,
      headers: model.headers ? Object.keys(model.headers).reduce((acc: any, k: string) => {
        acc[k] = k.toLowerCase().includes('auth') ? `${(model.headers[k] as string).slice(0, 15)}...` : model.headers[k]
        return acc
      }, {}) : undefined,
    })

    this.agent = new Agent({
      initialState: {
        systemPrompt: this.config.systemPrompt,
        model,
        tools: piTools,
        messages: [],
      },
      convertToLlm: (msgs: any[]) => msgs.filter((m: any) =>
        ['user', 'assistant', 'toolResult'].includes(m.role)
      ),
      streamFn: (model: any, context: any, options: any) => {
        if (!model || typeof model !== 'object') {
          console.error('[Agent] streamFn called with invalid model:', model)
          throw new Error(`streamFn: model is invalid (type=${typeof model})`)
        }
        if (!model.api || typeof model.api !== 'string') {
          console.error('[Agent] streamFn called with invalid model.api:', model.api, '(model.id=', model.id, ', model.provider=', model.provider, ')')
          throw new Error(`streamFn: model.api is invalid ("${model.api}"). Model id="${model.id}", provider="${model.provider}"`)
        }
        let ctx = context
        if (this._currentChatMode === 'normal') {
          ctx = { ...context, tools: [] }
        }
        const merged = { ...options }
        if (this._temperature !== undefined) merged.temperature = this._temperature
        if (this._maxTokens !== undefined) merged.maxTokens = this._maxTokens
        try {
          return streamSimple(model, ctx, merged)
        } catch (err) {
          console.error('[Agent] streamSimple threw:', err, '| model.api=', model.api, '| model.id=', model.id, '| model.provider=', model.provider)
          throw err
        }
      },
      getApiKey: apiKey ? async (_provider: string) => apiKey : undefined,
      onPayload: async (payload: any) => {
        const sensitiveKeys = ['apiKey', 'api_key', 'authorization']
        const safePayload = JSON.parse(JSON.stringify(payload || {}))
        for (const msg of safePayload.messages || []) {
          if (typeof msg.content === 'string') msg.content = `[${msg.content.length} chars]`
          else if (Array.isArray(msg.content)) msg.content = `[${msg.content.length} blocks]`
        }
        for (const key of sensitiveKeys) delete safePayload[key]
        console.log('[Agent] → Full payload to API:', JSON.stringify(safePayload, null, 2))
        return payload
      },
      beforeToolCall: async (ctx: any) => {
        if (this.config.beforeToolCall) {
          const result = await this.config.beforeToolCall({ toolCall: { id: ctx.toolCallId || ctx.toolCall?.id, name: ctx.toolCall?.name, args: ctx.args } })
          if (result?.block) return { block: true, reason: result.reason }
        }
        return undefined
      },
    })

    this.originalSystemPrompt = this.config.systemPrompt

    this.unsub = this.agent.subscribe((event: any, _signal: AbortSignal) => {
      this.handlePiEvent(event)
    })

    this.pendingModel = null

    return this.agent
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private handlePiEvent(event: any): void {
    const mapped = this.mapPiEvent(event)
    if (mapped) this.emit(mapped)
  }

  private mapPiEvent(event: any): AgentEvent | null {
    switch (event.type) {
      case 'agent_start':
        this._state.isStreaming = true
        return { type: 'agent_start', sessionId: this._state.sessionId, chatMode: this._currentChatMode }
      case 'agent_end':
        this._state.isStreaming = false
        const agentEndMessages = (event.messages || [])
          .filter((m: any) => m.role === 'assistant')
          .map((m: any) => this.piMsgToAgentMsg(m))
        if (agentEndMessages.length > 0) {
          const lastAssistant = agentEndMessages[agentEndMessages.length - 1]
          this._lastAssistantText = lastAssistant.content || ''
        }
        if (this._lastUserText && this._lastAssistantText && this._currentChatMode !== 'normal' && this._currentChatMode !== 'group-chat') {
          const userText = this._lastUserText
          const asstText = this._lastAssistantText
          Promise.all([
            extractFromConversation(userText, asstText).catch(() => {}),
            extractShortMemory(userText, asstText).catch(() => {}),
          ]).catch(() => {})
        }
        return {
          type: 'agent_end',
          sessionId: this._state.sessionId,
          messages: agentEndMessages,
        }
      case 'turn_end':
        if (event.message?.role !== 'assistant') return null
        return {
          type: 'turn_end',
          message: this.piMsgToAgentMsg(event.message),
        }
      case 'message_start':
        return { type: 'message_start', message: this.piMsgToAgentMsg(event.message) }
      case 'message_update':
        if (event.message?.role !== 'assistant') return null
        return {
          type: 'message_update',
          messageId: event.message?.id || '',
          content: this.extractText(event.message),
          thinking: this.extractThinking(event.message),
        }
      case 'message_end':
        if (event.message?.role !== 'assistant') return null
        const msgEndUsage = this.extractUsage(event.message)
        return {
          type: 'message_end',
          messageId: event.message?.id || '',
          content: this.extractText(event.message),
          thinking: this.extractThinking(event.message),
          usage: msgEndUsage,
        }
      case 'tool_execution_start':
        return {
          type: 'tool_execution_start',
          toolCall: { id: event.toolCallId, name: event.toolName, args: event.args },
        }
      case 'tool_execution_update':
        return {
          type: 'tool_execution_update',
          toolCallId: event.toolCallId,
          progress: event.progress,
          status: event.status,
        }
      case 'tool_execution_end':
        return {
          type: 'tool_execution_end',
          toolCallId: event.toolCallId,
          result: this.extractToolResult(event.result),
          success: !event.isError,
        }
      default:
        return null
    }
  }

  private piMsgToAgentMsg(msg: any): AgentMessage {
    return {
      id: crypto.randomUUID(),
      role: msg?.role ?? 'assistant',
      content: this.extractText(msg),
      thinking: this.extractThinking(msg),
      timestamp: Date.now(),
      metadata: { chatMode: this._currentChatMode },
    }
  }

  private extractText(msg: any): string {
    if (!msg) return ''
    if (typeof msg.content === 'string') return msg.content
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('')
    }
    return ''
  }

  private extractThinking(msg: any): string {
    if (!msg) return ''
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((c: any) => c.type === 'thinking')
        .map((c: any) => c.thinking || c.text || '')
        .join('')
    }
    return ''
  }

  private extractToolResult(result: any): string {
    if (!result) return ''
    if (typeof result === 'string') return result
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('')
    }
    return JSON.stringify(result)
  }

  private extractUsage(msg: any): UsageData | undefined {
    if (!msg?.usage) return undefined
    const u = msg.usage
    return {
      inputTokens: u.input || 0,
      outputTokens: u.output || 0,
      cacheReadTokens: u.cacheRead || 0,
      cacheWriteTokens: u.cacheWrite || 0,
      totalTokens: u.totalTokens || 0,
      cost: {
        input: u.cost?.input || 0,
        output: u.cost?.output || 0,
        cacheRead: u.cost?.cacheRead || 0,
        cacheWrite: u.cost?.cacheWrite || 0,
        total: u.cost?.total || 0,
      },
    }
  }

  get state(): AgentStateSnapshot {
    return this._state
  }

  get isStreaming(): boolean {
    return this._state.isStreaming
  }

  setVisibilityMode(developerMode: boolean, advancedMode: boolean): void {
    this._developerMode = developerMode
    this._advancedMode = advancedMode
    this.skillIndexPrompt = buildSkillIndexPrompt(developerMode, advancedMode)
  }

  async prompt(text: string, options?: PromptOptions): Promise<void> {
    const agent = await this.ensureAgent()

    this.activeSkillIds.clear()

    const chatMode = options?.chatMode || 'normal'
    this._currentChatMode = chatMode

    const thinkingLevelMap: Record<ChatMode, ThinkingLevel> = {
      normal: 'off',
      deep: 'high',
      explore: 'medium',
      'group-chat': 'medium',
    }
    this.updateThinkingLevel(thinkingLevelMap[chatMode])

    const modeSkillMap: Record<string, string> = {
      deep: 'deep-thinking',
      explore: 'knowledge-explorer',
    }
    const modeSkillId = modeSkillMap[chatMode]
    if (modeSkillId) {
      this.activeSkillIds.add(modeSkillId)
    }

    let prompt = this.originalSystemPrompt

    if (chatMode === 'normal') {
      prompt += '\n\n[模式指令] 你处于快问快答模式。直接回答用户问题，不要调用任何工具，不要进行深度分析。简洁、直接地给出答案。如果用户的问题需要深度分析或工具调用，简要提示用户可切换到深度思考或知识探索模式。'
      if (options?.contextOverride) {
        prompt += `\n\n[上下文] ${options.contextOverride}`
      }
      if (options?.personaPreset && options.personaPreset !== 'default') {
        const persona = PERSONA_PRESETS[options.personaPreset]
        if (persona) {
          prompt += `\n\n## 人格设定\n${persona.instruction}`
        }
      }
    } else {
      prompt += '\n\n' + this.skillIndexPrompt

      if (options?.contextOverride) {
        prompt += `\n\n[上下文] ${options.contextOverride}`
      }

      const memoryLimit = chatMode === 'explore' ? 8 : 5
      const memoryEntries = await recallMemory(text, memoryLimit)
      const memoryBlock = formatMemoryForPrompt(memoryEntries)
      if (memoryBlock) {
        prompt += `\n\n${memoryBlock}`
      }

      try {
        const allEntries = await kbList()
        if (allEntries.length > 0) {
          const kbLimit = chatMode === 'explore' ? 8 : 3
          const kbThreshold = chatMode === 'explore' ? 0.2 : 0.3
          const kwResults = await kbSearchKeyword(text, undefined, kbLimit)
          const kbLines: string[] = []
          for (const e of kwResults) {
            const summary = e.summary ? ` — ${e.summary.slice(0, 80)}` : ''
            kbLines.push(`- [${e.scope}] ${e.path}${summary}`)
          }
          if (isKBEmbeddingReady()) {
            const semLimit = chatMode === 'explore' ? 8 : 3
            const semResults = await semanticSearchKB(text, semLimit, kbThreshold)
            for (const r of semResults) {
              const path = r.metadata?.path || ''
              const scope = r.metadata?.scope || 'project'
              const summary = r.metadata?.summary ? ` — ${r.metadata.summary.slice(0, 80)}` : ''
              if (!kbLines.some(l => l.includes(path))) {
                kbLines.push(`- [${scope}] ${path}${summary}`)
              }
            }
          }
          if (kbLines.length > 0) {
            prompt += `\n\n[知识库] 共 ${allEntries.length} 条知识，相关条目：\n${kbLines.join('\n')}`
          }
        }
      } catch {}

      if (options?.personaPreset && options.personaPreset !== 'default') {
        const persona = PERSONA_PRESETS[options.personaPreset]
        if (persona) {
          prompt += `\n\n## 人格设定\n${persona.instruction}`
        }
      }

      if (options?.skillNames && options.skillNames.length > 0) {
        for (const name of options.skillNames) {
          this.activeSkillIds.add(name)
        }
      }

      if (this.activeSkillIds.size > 0) {
        const skillBlock = await activateSkills([...this.activeSkillIds])
        if (skillBlock) {
          prompt += `\n\n${skillBlock}`
        }
        const outputGuide = buildOutputGuidePrompt([...this.activeSkillIds])
        if (outputGuide) {
          prompt += `\n\n${outputGuide}`
        }
        const pluginCap = buildPluginCapabilityPrompt([...this.activeSkillIds])
        if (pluginCap) {
          prompt += `\n\n${pluginCap}`
        }
      }
    }

    agent.state.systemPrompt = prompt

    this._lastUserText = text
    this._lastAssistantText = ''

    try {
      let promptText = text
      if (options?.files && options.files.length > 0) {
        const fileSections = options.files.map(f => `--- ${f.name} ---\n${f.content}\n---`).join('\n\n')
        promptText += `\n\n${fileSections}`
      }
      // 使用通用退避重试包装，429/503/529 自动重试
      await retryWithBackoff(async () => {
        if (options?.images && options.images.length > 0) {
          await agent.prompt(promptText, options.images.map(img => ({
            type: 'image' as const,
            data: img.data,
            mimeType: img.mimeType,
          })))
        } else {
          await agent.prompt(promptText)
        }
      })
    } catch (err: any) {
      this._state.isStreaming = false
      console.error('[Agent] prompt() failed:', err)
      const errorDetail = err?.error?.message || err?.message || String(err)
      const statusCode = err?.status || err?.error?.status || ''
      const errorBody = err?.error?.error?.message || err?.error?.body || ''
      const fullDetail = errorBody
        ? `[${statusCode}] ${errorBody}`
        : errorDetail
      this.emit({
        type: 'error',
        error: new Error(`API 请求失败: ${fullDetail}`),
      })
    }
  }

  async steer(text: string): Promise<void> {
    const agent = await this.ensureAgent()
    try {
      agent.steer({ role: 'user', content: text })
    } catch (err: any) {
      this._state.isStreaming = false
      this.emit({ type: 'error', error: new Error(`steer 失败: ${err?.message || String(err)}`) })
    }
  }

  async followUp(text: string): Promise<void> {
    const agent = await this.ensureAgent()
    try {
      agent.followUp({ role: 'user', content: text })
    } catch (err: any) {
      this._state.isStreaming = false
      this.emit({ type: 'error', error: new Error(`followUp 失败: ${err?.message || String(err)}`) })
    }
  }

  async abort(): Promise<void> {
    if (this.agent) {
      // 保存当前对话历史，abort 后 agent 内部锁可能未释放
      const savedMessages = [...(this.agent.state?.messages || [])]
      this.agent.abort()
      // 销毁 agent 以释放内部锁，下次 ensureAgent 会重建
      if (this.unsub) this.unsub()
      this.agent = null
      this.agentInitPromise = null
      // 重建 agent 后恢复对话历史
      try {
        const newAgent = await this.ensureAgent()
        if (savedMessages.length > 0) {
          newAgent.state.messages = savedMessages
        }
      } catch (err) {
        console.warn('[Agent] abort: failed to rebuild agent:', err)
      }
    }
  }

  /**
   * H1.2 新增：清理 PI Agent 内部上下文消息
   *
   * 归档后调用，只清理 Agent 内部 state.messages（释放上下文窗口），
   * 不影响前端 useAgent().messages（用户仍可见完整历史）。
   *
   * @param upToIndex 要移除的消息数（从开头计）
   */
  trimContext(upToIndex: number): void {
    if (!this.agent) {
      console.warn('[Agent] trimContext: agent not initialized')
      return
    }
    if (upToIndex <= 0) return
    const msgs = this.agent.state?.messages
    if (!msgs) return
    if (upToIndex >= msgs.length) {
      this.agent.state.messages = []
    } else {
      this.agent.state.messages = msgs.slice(upToIndex)
    }
    console.log(`[Agent] trimContext: 移除前 ${upToIndex} 条内部消息，剩余 ${this.agent.state.messages.length} 条`)
  }

  async updateModel(provider: string, modelId: string, baseUrl?: string, apiKey?: string, contextWindow?: number, maxTokens?: number, temperature?: number): Promise<void> {
    if (typeof provider !== 'string' || !provider) {
      console.error('[Agent] updateModel: provider is invalid:', typeof provider, provider)
      return
    }
    if (typeof modelId !== 'string' || !modelId) {
      console.error('[Agent] updateModel: modelId is invalid:', typeof modelId, modelId)
      return
    }
    console.log('[Agent] updateModel called:', { provider, modelId, baseUrl: baseUrl?.slice(0, 60), hasApiKey: !!apiKey, contextWindow, maxTokens, temperature })
    let model: any = null
    const isDomestic = ['deepseek', 'zhipu', 'qwen', 'minimax', 'kimi', 'agnes'].includes(provider)
    const isCustomApi = ['openai-compatible', 'anthropic-compatible'].includes(provider)
    if (!isDomestic && !isCustomApi && !baseUrl) {
      try {
        const { getModel } = await import('@earendil-works/pi-ai')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model = getModel(provider as any, modelId)
        if (model) {
          const proxyBase = buildProxyEndpoint(provider)
          if (proxyBase) model.baseUrl = proxyBase
        }
      } catch (err) {
        console.warn('[Agent] updateModel: getModel failed, falling back to custom:', err)
      }
    }
    if (!model) {
      model = this.buildCustomModel(provider, modelId, baseUrl, apiKey)
    }
    if (!model || !model.api) {
      console.error('[Agent] updateModel: built model has no api property:', model)
      return
    }
    console.log('[Agent] updateModel built:', { id: model.id, api: model.api, provider: model.provider, baseUrl: model.baseUrl, headers: model.headers ? Object.keys(model.headers) : [] })
    if (apiKey && !model.headers) {
      model.headers = { 'Authorization': `Bearer ${apiKey}` }
    } else if (apiKey && model.headers) {
      model.headers = { ...model.headers, 'Authorization': `Bearer ${apiKey}` }
    }
    if (contextWindow !== undefined) model.contextWindow = contextWindow
    if (maxTokens !== undefined) model.maxTokens = maxTokens
    if (temperature !== undefined) this._temperature = temperature
    if (maxTokens !== undefined) this._maxTokens = maxTokens
    if (this.agent) {
      this.agent.state.model = model
    } else {
      this.pendingModel = model
    }
    this._state.model = {
      provider,
      modelId,
      displayName: modelId,
      contextWindow: model.contextWindow,
    }
  }

  updateThinkingLevel(level: ThinkingLevel): void {
    if (this.agent) {
      this.agent.state.thinkingLevel = level
    }
    this._state.thinkingLevel = level
  }

  clearHistory(): void {
    if (this.agent) {
      this.agent.state.messages = []
    }
    this._state.messages = []
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    if (this.unsub) this.unsub()
    this.mcpManager.dispose()
    this.listeners.clear()
    this.agent = null
    this.pendingModel = null
  }

  private extractApiKeyFromModel(model: any): string | undefined {
    if (!model?.headers) return undefined
    const auth = model.headers['Authorization'] || model.headers['authorization']
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7)
    }
    const xApiKey = model.headers['x-api-key']
    if (typeof xApiKey === 'string') {
      return xApiKey
    }
    return undefined
  }

  getToolBus(): ToolBus {
    return this.toolBus
  }

  getMCPManager(): MCPManager {
    return this.mcpManager
  }

  async reloadTools(): Promise<void> {
    if (!this.agent) return
    const piTools = this.toolBus.getAll().map(t => this.convertToolToPi(t))
    this.agent.state.tools = piTools
  }
}
