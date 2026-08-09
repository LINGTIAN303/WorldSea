import type { IAgentBackend, AgentEvent, AgentMessage, ProviderConfig, IToolContext, CloudProvider, ProviderSlot } from '@agent/index'
import { loadApiKey, buildSharedBaseLayer } from '@agent/index'
import { createOrAttachRustGroupChatBackend } from '../rust/RustGroupChatBackend'
import { useFontLibraryStore } from '@/stores/fontLibraryStore'
import type { GroupMember, GroupChatMessage, GroupChatCostTracker, StreamingAgentState, ContextStrategy, RequestRecord, RequestTrackerSnapshot } from '../types'
import type { IGroupChatEngine } from './IGroupChatEngine'
import type { IChatStrategy, StrategyContext, EngineState } from './IChatStrategy'
import { CostTrackerImpl } from '../CostTracker'
import { ContextManagerImpl } from '../ContextManager'
import { FallbackChainImpl } from '../FallbackChain'
import { ModelHealthChecker } from '../ModelHealthChecker'
import { getModelInfo } from '@worldsmith/agent-runtime'

// 后端模块导入
import { FlowController } from '@agent/group-chat/flow-control'
import { TurnEngine, type TurnResult } from '@agent/group-chat/turn-engine'
import { GroupChatMessageBus, type GroupChatEvent } from '@agent/group-chat/message-bus'
import { createLuckState, updateLuck, type LuckState } from '@agent/group-chat/speaking-desire'
import type { AgentProfile, TurnStrategy } from '@agent/group-chat/types'
import { ProviderPool } from '@agent/group-chat/provider-pool'
import { memberToProfile, casualToBackendMsg } from './TypeBridge'

const PROVIDER_PROXY_PATHS: Record<string, string> = {
  deepseek: '/api/deepseek',
  zhipu: '/api/zhipu/api/paas/v4',
  qwen: '/api/qwen/compatible-mode/v1',
  minimax: '/api/minimax/v1',
  kimi: '/api/kimi/v1',
  anthropic: '/api/anthropic',
  openai: '/api/openai/v1',
  google: '/api/google',
  groq: '/api/groq/openai/v1',
  openrouter: '/api/openrouter/api/v1',
}

export class GroupChatEngine implements IGroupChatEngine {
  private strategy: IChatStrategy
  private agents: Map<string, IAgentBackend> = new Map()
  private messages: GroupChatMessage[] = []
  private costTracker: CostTrackerImpl
  private contextManager: ContextManagerImpl
  private fallbackChain: FallbackChainImpl
  private agentModelMap: Record<string, string> = {}
  private participantApiKeys: Record<string, string> = {}

  // 后端模块
  private flowController: FlowController
  private turnEngine: TurnEngine
  private messageBus: GroupChatMessageBus
  private luckState: LuckState
  private agentProfiles: Map<string, AgentProfile> = new Map()

  // agentId → provider 映射（用于 FlowController 路由）
  private agentProviderMap: Record<string, string> = {}

  // 成员列表（用于查找字体配置等）
  private members: GroupMember[] = []

  // Provider 池（同厂商多 Key 负载均衡）
  private providerPool: ProviderPool

  // 请求追踪
  private requestRecords: RequestRecord[] = []
  private readonly MAX_REQUEST_RECORDS = 200

  // 独立 Moderator Agent
  private moderatorAgent: IAgentBackend | null = null
  private moderatorProviderConfig: ProviderConfig | null = null
  private moderatorToolContext: IToolContext | null = null

  // 群聊会话 id（Dexie session.id / GroupInfo.id），参与者会话持久化映射用
  private groupId: string | null = null

  constructor(strategy: IChatStrategy, budgetMaxCostUsd: number = 1.0, contextWindow: number = 32768) {
    this.strategy = strategy
    this.costTracker = new CostTrackerImpl({ maxCostUsd: budgetMaxCostUsd, warnAtPercent: 80 }, '')
    this.contextManager = new ContextManagerImpl(contextWindow)
    this.fallbackChain = new FallbackChainImpl()

    // 初始化后端模块
    this.luckState = createLuckState()
    this.flowController = new FlowController()
    this.turnEngine = new TurnEngine('speaking-desire', this.luckState, 3)
    this.messageBus = new GroupChatMessageBus()
    this.providerPool = new ProviderPool()
  }

  async createAgents(participants: GroupMember[], providerConfig: ProviderConfig, toolContext: IToolContext, groupId?: string): Promise<void> {
    this.agents.clear()
    this.participantApiKeys = {}
    this.agentModelMap = {}
    this.agentProfiles.clear()
    this.agentProviderMap = {}
    this.members = participants
    this.groupId = groupId || null

    // 保存 Moderator 配置
    this.moderatorProviderConfig = providerConfig
    this.moderatorToolContext = toolContext

    // 注册 AgentProfile 到 TurnEngine + MessageBus
    for (const p of participants) {
      const profile = memberToProfile(p)
      this.agentProfiles.set(p.id, profile)
    }

    // 注册 FlowController 插槽（按 provider 分组）+ 构建 agentId→provider 映射
    const registeredSlots = new Set<string>()
    for (const p of participants) {
      const modelId = p.modelId || providerConfig.modelId || ''
      this.agentModelMap[p.id] = modelId
      if (!modelId) continue

      const info = getModelInfo(modelId)
      if (!info) {
        this.costTracker.registerAgentModel(p.id, modelId)
        this.contextManager.registerAgentModel(p.id, modelId)
        continue
      }

      const provider = info.provider
      // 构建 agentId → provider 映射
      this.agentProviderMap[p.id] = provider

      const apiKey = await loadApiKey(provider as any).catch(() => null as string | null)
      if (apiKey) this.participantApiKeys[p.id] = apiKey

      // 注册 FlowController 插槽（按 provider 分组）
      if (!registeredSlots.has(provider)) {
        this.flowController.registerSlot(provider)
        registeredSlots.add(provider)
      }

      if (!p.providerConfig) {
        const proxyPath = PROVIDER_PROXY_PATHS[provider]
        const resolvedBaseUrl = proxyPath ? `${window.location.origin}${proxyPath}` : undefined
        p.providerConfig = {
          mode: 'cloud',
          provider: provider as CloudProvider,
          modelId,
          apiKey: apiKey || ('apiKey' in providerConfig ? providerConfig.apiKey : undefined) || '',
          baseUrl: resolvedBaseUrl,
          supportsVision: info.supportsVision,
          contextWindow: info.contextLength,
          maxTokens: info.maxOutputTokens,
        } as ProviderConfig
      }

      this.costTracker.registerAgentModel(p.id, modelId)
      this.contextManager.registerAgentModel(p.id, modelId)
    }

    for (const p of participants) {
      // 构建群聊 Agent 的独立系统提示词
      const groupSystemPrompt = this.buildGroupAgentSystemPrompt(p, toolContext)

      // 解析 providerConfig：优先使用 ProviderSlot（多 Key 负载均衡），其次用 Agent 自带配置
      let resolvedProviderConfig: ProviderConfig
      if (p.providerSlotId) {
        try {
          resolvedProviderConfig = await this.providerPool.resolve(p.providerSlotId)
        } catch {
          resolvedProviderConfig = p.providerConfig || providerConfig
        }
      } else {
        resolvedProviderConfig = p.providerConfig || providerConfig
      }

      const agent = await createOrAttachRustGroupChatBackend({
        participantId: p.id,
        name: p.name,
        groupId: this.groupId || undefined,
        systemPrompt: groupSystemPrompt,
        providerConfig: resolvedProviderConfig as any,
        modelId: p.modelId || providerConfig.modelId || '',
      })

      const modelId = p.modelId || providerConfig.modelId || ''
      if (modelId) {
        const info = getModelInfo(modelId)
        const apiKey = this.participantApiKeys[p.id]
        if (info) {
          try {
            await agent.updateModel(
              info.provider,
              modelId,
              undefined,
              apiKey || undefined,
              info.contextLength,
              info.maxOutputTokens,
            )
          } catch (err) {
            console.warn(`[GroupChatEngine] Failed to set model for ${p.name}:`, err)
          }
        }
      }

      this.agents.set(p.id, agent)
    }
  }

  /** 构建群聊 Agent 独立系统提示词（人格层+基础层 baseLayerMode 分层注入），详细见 docs/details/注释/web/space/group-chat/engine/GroupChatEngine.md */
  private buildGroupAgentSystemPrompt(member: GroupMember, toolContext: IToolContext): string {
    const parts: string[] = []

    // 独立人格层：Agent 自定义系统提示词（核心身份）
    if (member.systemPrompt) {
      parts.push(member.systemPrompt)
    } else {
      parts.push(`你是群聊成员「${member.name}」，角色是「${member.role}」。`)
    }

    // 基础层：按 baseLayerMode 决定注入内容
    const mode = member.baseLayerMode || 'empty'
    if (mode === 'shared') {
      const fontLibrary = useFontLibraryStore()
      parts.push(buildSharedBaseLayer({
        projectName: 'WorldSmith-GroupChat',
        entityTypes: toolContext.projectInfo.entityTypes,
        relationTypes: toolContext.projectInfo.relationTypes,
        platform: toolContext.platform,
        availableFontFamilies: fontLibrary.entries.map(e => e.family),
      }))
    } else if (mode === 'custom' && member.customBaseLayer) {
      parts.push(member.customBaseLayer)
    }
    // mode === 'empty' 时不注入任何基础层

    // 技能/工具声明（仅自定义模式下按用户选择声明，共享模式由基础层覆盖，空模式无工具）
    if (mode === 'custom') {
      if (member.enabledSkills && member.enabledSkills.length > 0) {
        parts.push(`你擅长：${member.enabledSkills.join('、')}。相关话题时主动展示专业见解。`)
      }
      if (member.enabledTools && member.enabledTools.length > 0) {
        parts.push(`你可以使用工具：${member.enabledTools.join('、')}。需要时主动调用。`)
      }
    }

    return parts.join('\n\n')
  }

  /** 创建独立的 Moderator Agent（真正的 Agent，有完整工具能力） */
  private async ensureModeratorAgent(): Promise<IAgentBackend | null> {
    if (this.moderatorAgent) return this.moderatorAgent
    if (!this.moderatorProviderConfig || !this.moderatorToolContext) return null

    try {
      // Moderator 是真正的 Agent，拥有完整的工具和对话能力
      this.moderatorAgent = await createOrAttachRustGroupChatBackend({
        participantId: 'moderator',
        name: 'Moderator',
        groupId: this.groupId || undefined,
        systemPrompt: '你是群聊主持人（Moderator），负责总结讨论并做出决策。',
        providerConfig: this.moderatorProviderConfig as any,
      })
      return this.moderatorAgent
    } catch (err) {
      console.warn('[GroupChatEngine] 创建 Moderator Agent 失败:', err)
      return null
    }
  }

  disposeAgents(): void {
    for (const agent of this.agents.values()) {
      agent.dispose()
    }
    this.agents.clear()
    this.messages = []
    this.agentProfiles.clear()
    this.agentProviderMap = {}
    this.members = []
    this.contextManager.reset()
    this.fallbackChain.reset()
    this.messageBus.clearHistory()

    // 清理 Moderator Agent
    if (this.moderatorAgent) {
      this.moderatorAgent.dispose()
      this.moderatorAgent = null
    }
  }

  subscribeAgent(agentId: string, callback: (event: AgentEvent) => void): () => void {
    const agent = this.agents.get(agentId)
    if (!agent) return () => {}
    return agent.subscribe(callback)
  }

  getStreamingState(_agentId: string): StreamingAgentState | null {
    return null
  }

  recordUsage(agentId: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): void {
    this.costTracker.recordUsage(agentId, usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens)
  }

  getCostSnapshot(): GroupChatCostTracker {
    return this.costTracker.getSnapshot()
  }

  getPreparedMessages(_agentId: string): AgentMessage[] {
    const systemPromptTokens = 800
    const strategy = this.contextManager.getStrategy(this.messages, systemPromptTokens, 0)
    return this.contextManager.applyStrategy(this.messages, strategy) as unknown as AgentMessage[]
  }

  getPreparedCasualMessages(_agentId: string): GroupChatMessage[] {
    const systemPromptTokens = 800
    const strategy = this.contextManager.getStrategy(
      this.messages, systemPromptTokens, 0, { summaryEnabled: false },
    )
    const prepared = this.contextManager.applyStrategy(this.messages, strategy)
    return prepared.map(m => this.agentMessageToCasual(m as unknown as AgentMessage))
  }

  private agentMessageToCasual(m: AgentMessage): GroupChatMessage {
    const member = this.members.find(mem => mem.id === m.speakerId)
    return {
      id: m.id,
      role: m.role as GroupChatMessage['role'],
      content: m.content ?? '',
      thinking: m.thinking,
      timestamp: m.timestamp,
      speakerId: m.speakerId,
      speakerName: m.speakerName,
      speakerAvatar: m.speakerAvatar,
      speakerColor: m.speakerColor,
      speakerFontFamily: member?.fontFamily,
      speakerFontWeight: member?.fontWeight,
      speakerFontStyle: member?.fontStyle,
      type: 'text',
      replyTo: m.metadata?.replyTo as string | undefined,
      mentions: m.metadata?.mentions as string[] | undefined,
    }
  }

  getContextStrategy(): ContextStrategy {
    return this.contextManager.getStrategy(this.messages, 800, 0)
  }

  async tryFallback(agentId: string): Promise<boolean> {
    const currentModelId = this.agentModelMap[agentId]
    const fallbackModelId = this.fallbackChain.getFallback(currentModelId, agentId)
    if (!fallbackModelId) return false

    const agent = this.agents.get(agentId)
    if (!agent) return false

    const provider = this.fallbackChain.getProviderForModel(currentModelId)
    if (!provider) return false

    const fallbackInfo = getModelInfo(fallbackModelId)
    try {
      await agent.updateModel(
        provider,
        fallbackModelId,
        undefined,
        this.participantApiKeys[agentId],
        fallbackInfo?.contextLength,
        fallbackInfo?.maxOutputTokens,
      )
      this.fallbackChain.recordDegradation(agentId)
      this.agentModelMap[agentId] = fallbackModelId
      this.costTracker.registerAgentModel(agentId, fallbackModelId)
      this.contextManager.registerAgentModel(agentId, fallbackModelId)
      return true
    } catch (err) {
      console.warn(`[GroupChatEngine] Fallback 失败: agent=${agentId} 尝试切换到 ${fallbackModelId}`, err)
      return false
    }
  }

  async preflightHealthCheck(participants: GroupMember[], providerConfig: ProviderConfig): Promise<void> {
    const configs = participants.map(p => ({
      providerConfig: p.providerConfig || providerConfig,
      modelId: p.modelId || providerConfig.modelId || '',
      agentId: p.id,
    }))
    await ModelHealthChecker.checkMultiple(configs)
  }

  addMessage(msg: GroupChatMessage): void {
    if (!msg.id || !msg.content?.trim()) return
    if (this.messages.some(m => m.id === msg.id)) return
    this.messages.push(msg)

    // 同步到 MessageBus
    this.messageBus.appendMessage(casualToBackendMsg(msg))
  }

  getMessages(): GroupChatMessage[] {
    return this.messages
  }

  setStrategy(strategy: IChatStrategy): void {
    this.strategy = strategy
  }

  getStrategy(): IChatStrategy {
    return this.strategy
  }

  getAgent(agentId: string): IAgentBackend | undefined {
    return this.agents.get(agentId)
  }

  buildStrategyContext(topic?: string, round: number = 0, userMessage?: GroupChatMessage, mentionedAgentIds: string[] = []): StrategyContext {
    return { topic, currentRound: round, userMessage, mentionedAgentIds }
  }

  getEngineState(round: number, startTime: number, maxCostUsd: number): EngineState {
    const snapshot = this.costTracker.getSnapshot()
    return {
      round,
      startTime,
      messageCount: this.messages.length,
      costUsd: snapshot.totalCostUsd,
      maxCostUsd,
    }
  }

  // ─── 后端模块集成实现 ─────────────────────────────────────────────

  async resolveTurn(userMessage: string, mentions: string[], members: GroupMember[]): Promise<TurnResult> {
    const profiles = members.map(m => {
      const existing = this.agentProfiles.get(m.id)
      return existing || memberToProfile(m)
    })

    // 更新运气状态
    this.luckState = updateLuck(this.luckState, 5, 20)
    this.turnEngine.updateLuckState(this.luckState)

    // 构建对话上下文（供 Moderator 使用）
    const conversationContext = this.messageBus.buildConversationContext(20)

    // 获取独立 Moderator Agent（如果策略是 moderator）
    let moderatorBackend: IAgentBackend | undefined
    if (this.turnEngine['strategy'] === 'moderator') {
      moderatorBackend = (await this.ensureModeratorAgent()) ?? undefined
    }

    const result = await this.turnEngine.resolveTurn(
      userMessage,
      mentions,
      profiles,
      conversationContext,
      moderatorBackend,
    )

    // 广播 TurnEngine 决策到 MessageBus
    this.messageBus.emit({
      type: 'moderator_decision',
      nextSpeakers: result.agentIds,
      reason: result.reason ?? '',
    })

    return result
  }

  /**
   * 获取流控许可
   *
   * 修复：将 agentId 映射到 provider slot，正确路由到 FlowController
   */
  async acquireFlowSlot(agentId: string): Promise<() => void> {
    const providerSlot = this.agentProviderMap[agentId] || agentId
    return this.flowController.acquire(providerSlot)
  }

  subscribeBus(listener: (event: GroupChatEvent) => void): () => void {
    return this.messageBus.subscribe(listener)
  }

  setTurnStrategy(strategy: TurnStrategy): void {
    this.turnEngine.setStrategy(strategy)
  }

  getTurnStrategy(): TurnStrategy {
    return this.turnEngine['strategy']
  }

  recordSpeaking(agentId: string): void {
    this.turnEngine.recordSpeaking(agentId)
  }

  getFlowStats(): { globalPending: number; slots: Record<string, number> } {
    return this.flowController.getStats()
  }

  // ─── Provider 池管理 ─────────────────────────────────────────────

  registerProviderSlot(slot: ProviderSlot): void {
    this.providerPool.register(slot)
  }

  unregisterProviderSlot(slotId: string): void {
    this.providerPool.unregister(slotId)
  }

  updateProviderSlot(slot: ProviderSlot): void {
    this.providerPool.update(slot)
  }

  async resolveProviderConfig(slotId: string): Promise<ProviderConfig> {
    return this.providerPool.resolve(slotId)
  }

  // ─── 请求追踪 ─────────────────────────────────────────────────

  /** 开始追踪一次请求 */
  startRequestTrace(agentId: string, agentName: string, protocol?: string): string {
    const id = crypto.randomUUID()
    const record: RequestRecord = {
      id,
      agentId,
      agentName,
      startTime: Date.now(),
      status: 'pending',
      protocol,
    }
    this.requestRecords.push(record)
    // 限制记录数量
    if (this.requestRecords.length > this.MAX_REQUEST_RECORDS) {
      this.requestRecords = this.requestRecords.slice(-this.MAX_REQUEST_RECORDS)
    }
    return id
  }

  /** 结束追踪一次请求（成功） */
  endRequestTrace(requestId: string, inputTokens?: number, outputTokens?: number): void {
    const record = this.requestRecords.find(r => r.id === requestId)
    if (!record) return
    record.endTime = Date.now()
    record.status = 'success'
    record.latencyMs = record.endTime - record.startTime
    record.inputTokens = inputTokens
    record.outputTokens = outputTokens
  }

  /** 结束追踪一次请求（失败） */
  failRequestTrace(requestId: string, error: string): void {
    const record = this.requestRecords.find(r => r.id === requestId)
    if (!record) return
    record.endTime = Date.now()
    record.status = 'error'
    record.latencyMs = record.endTime - record.startTime
    record.error = error
  }

  /** 获取请求追踪快照 */
  getRequestSnapshot(): RequestTrackerSnapshot {
    const perAgent: RequestTrackerSnapshot['perAgent'] = {}
    for (const r of this.requestRecords) {
      if (!perAgent[r.agentId]) {
        perAgent[r.agentId] = { total: 0, success: 0, errors: 0, avgLatencyMs: 0 }
      }
      const stats = perAgent[r.agentId]
      stats.total++
      if (r.status === 'success') stats.success++
      if (r.status === 'error') {
        stats.errors++
        stats.lastError = r.error
      }
    }
    // 计算平均延迟
    for (const agentId of Object.keys(perAgent)) {
      const completed = this.requestRecords.filter(r => r.agentId === agentId && r.latencyMs != null && r.status !== 'pending')
      if (completed.length > 0) {
        perAgent[agentId].avgLatencyMs = Math.round(completed.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0) / completed.length)
      }
    }
    return { records: [...this.requestRecords], perAgent }
  }

  /** 清空请求记录 */
  clearRequestRecords(): void {
    this.requestRecords = []
  }

  decayRecentCounts(): void {
    this.turnEngine.decayRecentCounts()
  }

  reset(): void {
    this.messages = []
    this.agentProfiles.clear()
    this.agentProviderMap = {}
    this.members = []
    this.contextManager.reset()
    this.fallbackChain.reset()
    this.messageBus.clearHistory()
  }
}