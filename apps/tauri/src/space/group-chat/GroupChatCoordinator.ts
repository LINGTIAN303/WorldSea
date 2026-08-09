import type { IAgentBackend, AgentEvent, AgentMessage } from '@agent/index'
import { loadApiKey } from '@agent/index'
import { createOrAttachRustGroupChatBackend } from './rust/RustGroupChatBackend'
import { buildContextInjection } from '@agent/context/builder'
import type { GroupChatConfig, GroupParticipant, GroupChatBudget } from './types'
import { DEFAULT_GROUP_CHAT_CONFIG, DEFAULT_GROUP_CHAT_BUDGET } from './types'
import { TerminationDetectorImpl } from './TerminationDetector'
import { ContextManagerImpl } from './ContextManager'
import { CostTrackerImpl } from './CostTracker'
import { SpeakerSelectorImpl } from './SpeakerSelector'
import { TopicTrackerImpl } from './TopicTracker'
import { buildParticipantSystemPrompt } from './HallucinationGuard'
import { FallbackChainImpl } from './FallbackChain'
import { ModelHealthChecker } from './ModelHealthChecker'
import { getModelInfo } from '@worldsmith/agent-runtime'
import { useGroupChatStore } from './GroupChatStore'

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

interface ParallelResult {
  participant: GroupParticipant
  content: string
  thinking: string
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
  error?: string
  degraded?: boolean
}

export class GroupChatCoordinator {
  private config: GroupChatConfig
  private budget: GroupChatBudget
  private agents: Map<string, IAgentBackend> = new Map()
  private messages: AgentMessage[] = []
  private round: number = 0
  private startTime: number = 0
  private state: 'idle' | 'running' | 'paused' | 'terminated' | 'completed' = 'idle'
  private terminationDetector: TerminationDetectorImpl
  private contextManager: ContextManagerImpl
  private costTracker: CostTrackerImpl
  private speakerSelector: SpeakerSelectorImpl
  private topicTracker: TopicTrackerImpl
  private pauseResolve: (() => void) | null = null
  private reviewResolve: (() => void) | null = null
  private nextSpeakerOverride: string | null = null
  private lastReviewRound: number = -1
  private abortController: AbortController | null = null
  private consecutiveFailures: Record<string, number> = {}
  private skipNotified: Set<string> = new Set()
  private fallbackChain: FallbackChainImpl
  private agentModelMap: Record<string, string> = {}
  private participantApiKeys: Record<string, string> = {}
  private static readonly MAX_CONSECUTIVE_FAILURES = 3
  onRoundEnd?: () => void
  onComplete?: () => void
  onTerminate?: () => void

  constructor(
    config?: Partial<GroupChatConfig>,
    budget?: Partial<GroupChatBudget>,
    contextWindow: number = 32768,
  ) {
    this.config = { ...DEFAULT_GROUP_CHAT_CONFIG, ...config }
    this.budget = { ...DEFAULT_GROUP_CHAT_BUDGET, ...budget }
    this.terminationDetector = new TerminationDetectorImpl()
    this.contextManager = new ContextManagerImpl(contextWindow)
    this.costTracker = new CostTrackerImpl(this.budget, '')
    this.speakerSelector = new SpeakerSelectorImpl([], this.config.maxRounds)
    this.topicTracker = new TopicTrackerImpl('')
    this.fallbackChain = new FallbackChainImpl()
  }

  async start(
    topic: string,
    participants: GroupParticipant[],
    providerConfig: any,
    toolContext: any,
  ): Promise<void> {
    try {
      await this._startInner(topic, participants, providerConfig, toolContext)
    } catch (err) {
      console.error('[GroupChatCoordinator] start failed:', err)
      if (this.state === 'running' || this.state === 'paused') {
        this.terminate('启动失败')
      }
    }
  }

  private async _startInner(
    topic: string,
    participants: GroupParticipant[],
    providerConfig: any,
    toolContext: any,
  ): Promise<void> {
    console.log('[GroupChatCoordinator] _startInner called, participants:', participants.length)
    this.topicTracker = new TopicTrackerImpl(topic)
    this.messages = []
    this.round = 0
    this.startTime = Date.now()
    this.state = 'running'
    this.abortController = new AbortController()
    this.fallbackChain.reset()
    this.consecutiveFailures = {}
    this.skipNotified = new Set()
    this.lastReviewRound = -1
    this.agentModelMap = {}

    const store = useGroupChatStore()
    store.setState('running')
    store.topic = topic

    this.agents.clear()
    this.participantApiKeys = {}
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
      const apiKey = await loadApiKey(provider as any).catch(() => null as string | null)

      if (apiKey) {
        this.participantApiKeys[p.id] = apiKey
      }

      if (!p.providerConfig) {
        const proxyPath = PROVIDER_PROXY_PATHS[provider]
        const resolvedBaseUrl = proxyPath ? `${window.location.origin}${proxyPath}` : undefined
        ;(p as any).providerConfig = {
          mode: 'cloud',
          provider,
          modelId,
          apiKey: apiKey || (providerConfig as any).apiKey,
          baseUrl: resolvedBaseUrl,
          supportsVision: info.supportsVision,
          contextWindow: info.contextLength,
          maxTokens: info.maxOutputTokens,
        }
      }

      this.costTracker.registerAgentModel(p.id, modelId)
      this.contextManager.registerAgentModel(p.id, modelId)
    }

    for (const p of participants) {
      console.log('[GroupChatCoordinator] Creating agent for:', p.name, 'modelId:', p.modelId, 'provider:', (p.providerConfig as any)?.provider)
      const agent = await createOrAttachRustGroupChatBackend({
        participantId: p.id,
        name: p.name,
        groupId: store.currentSessionId || undefined,
        systemPrompt: p.systemPrompt || buildParticipantSystemPrompt(p, topic),
        providerConfig: (p.providerConfig as any) || providerConfig,
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
            console.warn(`[GroupChatCoordinator] Failed to set model for ${p.name}:`, err)
          }
        }
      }

      this.agents.set(p.id, agent)
    }
    console.log('[GroupChatCoordinator] All agents created, count:', this.agents.size)

    this.speakerSelector = new SpeakerSelectorImpl(participants, this.config.maxRounds)
    this.costTracker.updateDefaultModel(providerConfig.modelId || '')
    this.contextManager.reset()

    if (this.config.autoDegradation) {
      await this.preflightHealthCheck(participants, providerConfig, store)
    }

    this.messages.push({
      id: crypto.randomUUID(),
      role: 'system',
      content: `讨论话题：${topic}\n请各位围绕这个话题展开讨论。`,
      timestamp: Date.now(),
    })
    store.addMessage(this.messages[this.messages.length - 1])

    await this.runLoop(participants, providerConfig, toolContext)
  }

  private async preflightHealthCheck(
    participants: GroupParticipant[],
    providerConfig: any,
    store: ReturnType<typeof useGroupChatStore>,
  ): Promise<void> {
    const configs = participants.map(p => ({
      providerConfig: p.providerConfig || providerConfig,
      modelId: p.modelId || providerConfig.modelId || '',
      agentId: p.id,
    }))

    const results = await ModelHealthChecker.checkMultiple(configs)

    for (const [agentId, result] of Object.entries(results)) {
      store.setHealthStatus(agentId, result)
    }

    const unreachable = participants.filter(p => {
      const r = results[p.id]
      return r && r.status === 'unreachable'
    })

    if (unreachable.length > 0) {
      const names = unreachable.map(p => p.name).join('、')
      this.messages.push({
        id: crypto.randomUUID(),
        role: 'system',
        content: `健康检测：${names} 的模型可能不可达，将尝试自动降级`,
        timestamp: Date.now(),
      })
      store.addMessage(this.messages[this.messages.length - 1])
    }
  }

  private async runLoop(participants: GroupParticipant[], providerConfig: any, toolContext: any): Promise<void> {
    console.log('[GroupChatCoordinator] runLoop entered, state:', this.state)
    const store = useGroupChatStore()
    const parallelCount = Math.min(this.config.parallelCount, participants.length)

    while (this.state === 'running' || this.state === 'paused') {
      if (this.state === 'paused') {
        await new Promise<void>(resolve => {
          this.pauseResolve = resolve
        })
        // After await, state may have changed via resume()/terminate().
        // Re-check the while-loop condition instead of comparing narrowed type.
        continue
      }

      if (store.reviewPending) {
        await new Promise<void>(resolve => {
          this.reviewResolve = resolve
        })
        if (this.state !== 'running') break
        store.setReviewPending(false)
      }

      if (this.shouldHardTerminate()) break

      const smartTerm = this.terminationDetector.checkAll(this.messages)
      if (smartTerm.shouldTerminate && smartTerm.confidence > 0.7) {
        store.setReviewPending(true)
        await new Promise<void>(resolve => {
          this.reviewResolve = resolve
        })
        if (this.state !== 'running') break
        store.setReviewPending(false)
        continue
      }

      if (this.contextManager.isOverflow(this.messages, this.estimateSystemPromptTokens(), 0)) {
        this.terminate('上下文窗口溢出')
        break
      }

      let selectedParticipants: GroupParticipant[]

      if (this.nextSpeakerOverride) {
        const override = participants.find(p => p.id === this.nextSpeakerOverride)
        this.nextSpeakerOverride = null
        selectedParticipants = override ? [override] : [this.speakerSelector.selectNext(this.messages, this.round)]
      } else if (parallelCount > 1) {
        selectedParticipants = this.speakerSelector.selectMultiple(this.messages, this.round, parallelCount)
      } else {
        selectedParticipants = [this.speakerSelector.selectNext(this.messages, this.round)]
      }

      selectedParticipants = selectedParticipants.filter(p => {
        if ((this.consecutiveFailures[p.id] || 0) >= GroupChatCoordinator.MAX_CONSECUTIVE_FAILURES) {
          if (!this.skipNotified.has(p.id)) {
            this.skipNotified.add(p.id)
            this.messages.push({
              id: crypto.randomUUID(),
              role: 'system',
              content: `⏭ ${p.name} 因连续失败被跳过`,
              timestamp: Date.now(),
            })
            store.addMessage(this.messages[this.messages.length - 1])
          }
          return false
        }
        return true
      })

      if (selectedParticipants.length === 0) {
        this.round++
        store.incrementRound()
        store.setCurrentSpeakers([])
        continue
      }

      store.setCurrentSpeakers(selectedParticipants.map(p => p.id))

      if (this.topicTracker.shouldInjectReminder(this.messages)) {
        const reminder = this.topicTracker.getReminderMessage(store.topic)
        this.messages.push({
          id: crypto.randomUUID(),
          role: 'system',
          content: reminder,
          timestamp: Date.now(),
        })
        store.addMessage(this.messages[this.messages.length - 1])
      }

      if (parallelCount > 1 && selectedParticipants.length > 1) {
        const results = await this.executeParallel(selectedParticipants, providerConfig, toolContext, store)
        this.processParallelResults(results, store)
      } else {
        const p = selectedParticipants[0]
        const result = await this.executeSingle(p, providerConfig, toolContext, store)
        this.processSingleResult(result, p, store)
      }

      this.round++
      store.incrementRound()
      this.onRoundEnd?.()
      store.setCurrentSpeakers([])

      if (this.round > 0 && this.round % this.config.reviewInterval === 0 && this.round !== this.lastReviewRound) {
        this.lastReviewRound = this.round
        store.setReviewPending(true)
        await new Promise<void>(resolve => {
          this.reviewResolve = resolve
        })
        if (this.state !== 'running') break
        store.setReviewPending(false)
      }
    }

    if (this.state === 'running') {
      this.state = 'completed'
      store.setState('completed')
      this.onComplete?.()
    }
  }

  private async executeSingle(
    participant: GroupParticipant,
    providerConfig: any,
    toolContext: any,
    store: ReturnType<typeof useGroupChatStore>,
  ): Promise<ParallelResult> {
    console.log('[GroupChatCoordinator] executeSingle for:', participant.name)
    const agent = this.agents.get(participant.id)
    if (!agent) {
      return { participant, content: '', thinking: '', error: 'Agent 不存在' }
    }

    const contextInjection = toolContext ? await buildContextInjection(toolContext) : ''
    const systemPromptTokens = this.estimateSystemPromptTokens()
    const strategy = this.contextManager.getStrategy(this.messages, systemPromptTokens, this.contextManager.estimateTokens(contextInjection))
    const preparedMessages = this.contextManager.applyStrategy(this.messages, strategy)

    const conversationContext = preparedMessages
      .map(m => {
        if (m.role === 'system') return `[系统] ${m.content}`
        if (m.role === 'user') return `[用户] ${m.content}`
        if (m.speakerName) return `[${m.speakerName}] ${m.content}`
        return `[助手] ${m.content}`
      })
      .join('\n\n')

    const systemPrompt = buildParticipantSystemPrompt(participant, store.topic)
    const promptText = `${systemPrompt}\n\n以下是之前的讨论：\n\n${conversationContext}\n\n请继续讨论，表达你的观点。`

    let currentContent = ''
    let currentThinking = ''
    let usage: any = undefined
    let unsub: (() => void) | null = null
    let apiError: string | null = null

    try {
      unsub = agent.subscribe((event: AgentEvent) => {
        switch (event.type) {
          case 'message_update':
            if (event.content) currentContent = event.content
            if (event.thinking) currentThinking = event.thinking
            store.setStreaming(participant.id, currentContent, currentThinking)
            break
          case 'usage':
            if (event.usage) {
              usage = event.usage
              this.costTracker.recordUsage(
                participant.id,
                event.usage.inputTokens,
                event.usage.outputTokens,
                event.usage.cacheReadTokens,
                event.usage.cacheWriteTokens,
              )
              store.updateCostTracker(this.costTracker.getSnapshot())
            }
            break
          case 'error':
            apiError = event.error?.message || 'API 请求失败'
            break
        }
      })

      console.log('[GroupChatCoordinator] Calling agent.prompt() for:', participant.name, 'promptLen:', promptText.length)
      await agent.prompt(promptText, { contextOverride: contextInjection, chatMode: 'group-chat' })
      console.log('[GroupChatCoordinator] agent.prompt() completed for:', participant.name, 'contentLen:', currentContent.length, 'apiError:', apiError)

      if (apiError) {
        throw new Error(apiError)
      }

      this.consecutiveFailures[participant.id] = 0
      store.clearStreaming(participant.id)

      return {
        participant,
        content: currentContent,
        thinking: currentThinking,
        usage: usage ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
        } : undefined,
      }
    } catch (err: any) {
      store.clearStreaming(participant.id)

      if (this.config.autoDegradation) {
        const degraded = await this.tryFallback(participant, agent, providerConfig, promptText, contextInjection, store)
        if (degraded) return degraded
      }

      this.consecutiveFailures[participant.id] = (this.consecutiveFailures[participant.id] || 0) + 1
      const failCount = this.consecutiveFailures[participant.id]
      const hint = failCount >= GroupChatCoordinator.MAX_CONSECUTIVE_FAILURES
        ? '（已达最大重试次数，将被跳过）'
        : `（第${failCount}次失败）`

      return {
        participant,
        content: '',
        thinking: '',
        error: `${participant.name} 发言失败${hint}`,
      }
    } finally {
      unsub?.()
    }
  }

  private async executeParallel(
    participants: GroupParticipant[],
    providerConfig: any,
    toolContext: any,
    store: ReturnType<typeof useGroupChatStore>,
  ): Promise<ParallelResult[]> {
    const promises = participants.map(p =>
      this.executeSingle(p, providerConfig, toolContext, store)
        .catch((err: any) => ({
          participant: p,
          content: '',
          thinking: '',
          error: err.message || '并行执行失败',
        } as ParallelResult))
    )

    const settled = await Promise.allSettled(promises)
    return settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      return {
        participant: participants[i],
        content: '',
        thinking: '',
        error: '执行异常',
      }
    })
  }

  private async tryFallback(
    participant: GroupParticipant,
    agent: IAgentBackend,
    providerConfig: any,
    promptText: string,
    contextInjection: string,
    store: ReturnType<typeof useGroupChatStore>,
  ): Promise<ParallelResult | null> {
    const currentModelId = this.agentModelMap[participant.id]
    const fallbackModelId = this.fallbackChain.getFallback(currentModelId, participant.id)

    if (!fallbackModelId) return null

    const provider = this.fallbackChain.getProviderForModel(currentModelId)
    if (!provider) return null

    const fallbackInfo = getModelInfo(fallbackModelId)
    const currentInfo = getModelInfo(currentModelId)

    const effectiveApiKey = (participant.providerConfig as any)?.apiKey
      || this.participantApiKeys[participant.id]
      || (providerConfig as any).apiKey

    try {
      await agent.updateModel(
        provider,
        fallbackModelId,
        undefined,
        effectiveApiKey,
        fallbackInfo?.contextLength,
        fallbackInfo?.maxOutputTokens,
      )

      this.fallbackChain.recordDegradation(participant.id)
      this.agentModelMap[participant.id] = fallbackModelId
      this.costTracker.registerAgentModel(participant.id, fallbackModelId)
      this.contextManager.registerAgentModel(participant.id, fallbackModelId)

      const proxyPath = PROVIDER_PROXY_PATHS[provider]
      const resolvedBaseUrl = proxyPath ? `${window.location.origin}${proxyPath}` : undefined
      ;(participant as any).providerConfig = {
        mode: 'cloud',
        provider,
        modelId: fallbackModelId,
        apiKey: effectiveApiKey,
        baseUrl: resolvedBaseUrl,
        supportsVision: fallbackInfo?.supportsVision,
        contextWindow: fallbackInfo?.contextLength,
        maxTokens: fallbackInfo?.maxOutputTokens,
      }

      store.setDegradedAgent({
        agentId: participant.id,
        agentName: participant.name,
        fromModelId: currentModelId,
        fromModelName: currentInfo?.name || currentModelId,
        toModelId: fallbackModelId,
        toModelName: fallbackInfo?.name || fallbackModelId,
        reason: '发言失败，自动降级',
        degradedAt: Date.now(),
      })

      this.messages.push({
        id: crypto.randomUUID(),
        role: 'system',
        content: `${participant.name} 从 ${currentInfo?.name || currentModelId} 降级到 ${fallbackInfo?.name || fallbackModelId}`,
        timestamp: Date.now(),
      })
      store.addMessage(this.messages[this.messages.length - 1])

      let currentContent = ''
      let currentThinking = ''
      let usage: any = undefined
      let unsub: (() => void) | null = null
      let fallbackApiError: string | null = null

      try {
        unsub = agent.subscribe((event: AgentEvent) => {
          switch (event.type) {
            case 'message_update':
              if (event.content) currentContent = event.content
              if (event.thinking) currentThinking = event.thinking
              store.setStreaming(participant.id, currentContent, currentThinking)
              break
            case 'usage':
              if (event.usage) {
                usage = event.usage
                this.costTracker.recordUsage(
                  participant.id,
                  event.usage.inputTokens,
                  event.usage.outputTokens,
                  event.usage.cacheReadTokens,
                  event.usage.cacheWriteTokens,
                )
                store.updateCostTracker(this.costTracker.getSnapshot())
              }
              break
            case 'error':
              fallbackApiError = event.error?.message || 'API 请求失败'
              break
          }
        })

        await agent.prompt(promptText, { contextOverride: contextInjection, chatMode: 'group-chat' })

        if (fallbackApiError) {
          throw new Error(fallbackApiError)
        }

        this.consecutiveFailures[participant.id] = 0
        store.clearStreaming(participant.id)

        return {
          participant,
          content: currentContent,
          thinking: currentThinking,
          usage: usage ? {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
          } : undefined,
          degraded: true,
        }
      } catch (err) {
        console.warn(`[GroupChatCoordinator] 参与者 ${participant.id} 降级重试失败`, err)
        store.clearStreaming(participant.id)
        return null
      } finally {
        unsub?.()
      }
    } catch (err) {
      console.warn(`[GroupChatCoordinator] 参与者 ${participant.id} Fallback 流程异常`, err)
      return null
    }
  }

  private processSingleResult(
    result: ParallelResult,
    participant: GroupParticipant,
    store: ReturnType<typeof useGroupChatStore>,
  ): void {
    if (result.error) {
      this.messages.push({
        id: crypto.randomUUID(),
        role: 'system',
        content: `${result.error}`,
        timestamp: Date.now(),
      })
      store.addMessage(this.messages[this.messages.length - 1])
    } else if (result.content) {
      const msg: AgentMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.content,
        thinking: result.thinking || undefined,
        timestamp: Date.now(),
        speakerId: participant.id,
        speakerName: participant.name,
        speakerAvatar: participant.avatar,
        speakerColor: participant.color,
      }
      this.messages.push(msg)
      store.addMessage(msg)

      participant.speakCount++
      participant.lastSpokeAt = this.messages.length
      store.updateParticipant(participant.id, {
        speakCount: participant.speakCount,
        lastSpokeAt: participant.lastSpokeAt,
      })
    } else {
      this.messages.push({
        id: crypto.randomUUID(),
        role: 'system',
        content: `${participant.name} 返回了空回复`,
        timestamp: Date.now(),
      })
      store.addMessage(this.messages[this.messages.length - 1])
    }
  }

  private processParallelResults(
    results: ParallelResult[],
    store: ReturnType<typeof useGroupChatStore>,
  ): void {
    for (const result of results) {
      this.processSingleResult(result, result.participant, store)
    }
  }

  private estimateSystemPromptTokens(): number {
    return 800
  }

  private shouldHardTerminate(): boolean {
    if (this.round >= this.config.maxRounds) {
      this.terminate('达到最大轮次')
      return true
    }
    if (this.messages.length >= this.config.maxTotalMessages) {
      this.terminate('达到最大消息数')
      return true
    }
    if (Date.now() - this.startTime >= this.config.maxDurationMs) {
      this.terminate('达到最大持续时间')
      return true
    }
    if (this.costTracker.isBudgetExceeded()) {
      this.terminate('费用预算耗尽')
      return true
    }
    if (this.abortController?.signal.aborted) {
      this.terminate('用户终止')
      return true
    }
    return false
  }

  pause(): void {
    if (this.state !== 'running') return
    this.state = 'paused'
    const store = useGroupChatStore()
    store.setState('paused')
    store.setPaused(true)
    this.messages.push({
      id: crypto.randomUUID(),
      role: 'system',
      content: '⏸ 讨论已暂停',
      timestamp: Date.now(),
    })
    store.addMessage(this.messages[this.messages.length - 1])
  }

  resume(): void {
    if (this.state !== 'paused') return
    this.state = 'running'
    const store = useGroupChatStore()
    store.setState('running')
    store.setPaused(false)
    this.messages.push({
      id: crypto.randomUUID(),
      role: 'system',
      content: '▶ 讨论已继续',
      timestamp: Date.now(),
    })
    store.addMessage(this.messages[this.messages.length - 1])
    if (this.pauseResolve) {
      this.pauseResolve()
      this.pauseResolve = null
    }
  }

  resumeReview(direction?: string): void {
    if (direction && direction.trim()) {
      const store = useGroupChatStore()
      const msg: AgentMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `🧭 方向调整：${direction.trim()}`,
        timestamp: Date.now(),
      }
      this.messages.push(msg)
      store.addMessage(msg)
    }
    if (this.reviewResolve) {
      this.reviewResolve()
      this.reviewResolve = null
    }
  }

  terminate(reason?: string): void {
    this.state = 'terminated'
    this.abortController?.abort()
    if (this.pauseResolve) {
      this.pauseResolve()
      this.pauseResolve = null
    }
    if (this.reviewResolve) {
      this.reviewResolve()
      this.reviewResolve = null
    }
    const store = useGroupChatStore()
    store.setState('terminated')
    this.onTerminate?.()
    store.setCurrentSpeaker(null)
    store.setCurrentSpeakers([])
    store.setReviewPending(false)
    this.messages.push({
      id: crypto.randomUUID(),
      role: 'system',
      content: reason ? `⏹ 讨论已终止：${reason}` : '⏹ 讨论已终止',
      timestamp: Date.now(),
    })
    store.addMessage(this.messages[this.messages.length - 1])
  }

  injectMessage(text: string): void {
    const store = useGroupChatStore()
    const msg: AgentMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    this.messages.push(msg)
    store.addMessage(msg)
  }

  setNextSpeaker(agentId: string): void {
    this.nextSpeakerOverride = agentId
  }

  dispose(): void {
    this.state = 'idle'
    this.abortController?.abort()
    for (const agent of this.agents.values()) {
      agent.dispose()
    }
    this.agents.clear()
    if (this.pauseResolve) {
      this.pauseResolve()
      this.pauseResolve = null
    }
    if (this.reviewResolve) {
      this.reviewResolve()
      this.reviewResolve = null
    }
  }
}