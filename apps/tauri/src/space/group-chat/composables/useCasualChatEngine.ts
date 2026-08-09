import { ref } from 'vue'
import { useGroupChatStore } from '../GroupChatStore'
import { useSpaceStore } from '@/space/stores/space-store'
import { useAgent } from '@/agent/composables/useAgent'
import { GroupChatEngine } from '../engine/GroupChatEngine'
import { CasualStrategy } from '../engine/CasualStrategy'
import type { GroupChatMessage, GroupMember, GroupChatMode, ToolCallInfo, BaseLayerMode, ToolSource } from '../types'
import { assignAgentColor, isWorldChangeTool } from '../types'
import type { CreateGroupData } from '../components/CreateGroupDialog.vue'
import { saveCasualGroupSession, getCasualGroupSession, deleteCasualGroupSession } from '../GroupSessionManager'
import { useGroupStore } from '../management/GroupStore'
import { useAgentProfileStore } from '@/stores/agentProfileStore'

const IDLE_TIMEOUT = 30_000
const MAX_PROACTIVE_PER_SESSION = 3

/** 主动发言完成后的回调（用于清理 UI 状态，如回复目标） */
export interface CasualChatEngineOptions {
  onProactiveSpeakComplete?: () => void
}

/**
 * 休闲聊天引擎 composable
 *
 * 封装核心聊天引擎生命周期管理、Agent 调用、对话循环、
 * 主动发言、会话持久化等业务逻辑。
 *
 * 注意：engine / engineInitPromise / saveTimer / idleTimer / proactiveCount
 * 是非响应式的内部状态，通过方法暴露给外部使用。
 */
export function useCasualChatEngine(options?: CasualChatEngineOptions) {
  const store = useGroupChatStore()
  const spaceStore = useSpaceStore()
  const groupStore = useGroupStore()
  const profileStore = useAgentProfileStore()
  const { ensureInitialized, getProviderConfig, getToolContext } = useAgent()

  const isSending = ref(false)

  // 内部非响应式状态（不暴露给外部直接访问）
  let engine: GroupChatEngine | null = null
  let engineInitPromise: Promise<GroupChatEngine | null> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let proactiveCount = 0

  /** 构建对话文本（用于 Agent prompt 输入） */
  function buildConversationText(msgs: GroupChatMessage[]): string {
    return msgs.map(m => {
      let content = m.content
      if (m.replyTo) {
        const repliedMsg = msgs.find(r => r.id === m.replyTo)
          ?? store.casualMessages.find(r => r.id === m.replyTo)
        if (repliedMsg) {
          content = `[回复消息#${m.replyTo.slice(0, 8)} ${repliedMsg.speakerName || '用户'}：${repliedMsg.content.slice(0, 100)}]\n${content}`
        } else {
          content = `[回复消息#${m.replyTo.slice(0, 8)}]\n${content}`
        }
      }
      if (m.role === 'system') return `[系统] ${content}`
      if (m.role === 'user') return `[用户 #${m.id.slice(0, 8)}] ${content}`
      if (m.speakerName) return `[${m.speakerName} #${m.id.slice(0, 8)}] ${content}`
      return `[助手 #${m.id.slice(0, 8)}] ${content}`
    }).join('\n')
  }

  /** 更新群列表中的最后消息预览 */
  function updateGroupPreview(): void {
    if (store.groupInfo) {
      const lastMsg = store.casualMessages[store.casualMessages.length - 1]
      if (lastMsg) {
        const preview = lastMsg.content.length > 30
          ? lastMsg.content.slice(0, 30) + '...'
          : lastMsg.content
        groupStore.updateGroupPreview(store.groupInfo.id, preview, lastMsg.timestamp)
      }
    }
  }

  /** 根据 Agent 的 providerConfig 推断 API 协议 */
  function resolveProtocol(member: GroupMember): string {
    const cfg = member.providerConfig as any
    if (!cfg) return 'openai-completions'
    if (cfg.mode === 'cloud') {
      if (cfg.provider === 'anthropic') return 'anthropic-messages'
      if (cfg.provider === 'google') return 'google-generative-ai'
      return 'openai-completions'
    }
    if (cfg.mode === 'custom') {
      if (cfg.apiType === 'anthropic-compatible') return 'anthropic-messages'
      return 'openai-completions'
    }
    return 'openai-completions'
  }

  /** 从工具名推断世界事件动作类型 */
  function inferWorldAction(toolName: string): 'create' | 'update' | 'delete' {
    if (toolName.includes('_create') || toolName.includes('_import') || toolName.includes('_store')) return 'create'
    if (toolName.includes('_delete') || toolName.includes('_remove')) return 'delete'
    return 'update'
  }

  /** 从工具名推断目标对象类型 */
  function inferTargetType(toolName: string): string {
    if (toolName.startsWith('entity_')) return '实体'
    if (toolName.startsWith('relation_')) return '关系'
    if (toolName.startsWith('memory_')) return '记忆'
    if (toolName.startsWith('project_')) return '项目'
    return '对象'
  }

  /** 从工具执行结束事件中提取目标名称 */
  function inferTargetName(event: any): string {
    // 尝试从结果中提取名称
    const result = event.result
    if (result) {
      if (typeof result === 'string') {
        // 尝试解析 JSON
        try {
          const parsed = JSON.parse(result)
          if (parsed.name) return parsed.name
          if (parsed.entityName) return parsed.entityName
        } catch {
          // 非JSON，取前30字符
          return result.slice(0, 30)
        }
      }
      if (typeof result === 'object' && result.name) return result.name
    }
    // 回退：从参数中提取
    const args = event.args || event.toolCall?.args
    if (args) {
      try {
        const parsed = typeof args === 'string' ? JSON.parse(args) : args
        if (parsed.name) return parsed.name
        if (parsed.entityName) return parsed.entityName
      } catch { /* ignore */ }
    }
    return '未知'
  }

  /** 调用单个 Agent 生成回复（核心方法） */
  async function promptAgent(
    eng: GroupChatEngine,
    member: GroupMember,
    context: any,
    onMessage?: (msg: GroupChatMessage) => void,
  ): Promise<GroupChatMessage | null> {
    const agent = eng.getAgent(member.id)
    if (!agent) return null

    store.setTyping(member.id)

    const strategy = eng.getStrategy() as CasualStrategy
    const preparedMsgs = eng.getPreparedCasualMessages(member.id)
    // 系统提示词已在 Agent 创建时通过 systemPromptOverride 隔离设置
    // contextOverride 仅包含对话级动态上下文（@mention、话题等）
    const dynamicContext = strategy.buildDynamicContext(member, context)
    const conversationText = buildConversationText(preparedMsgs)

    const promptText = conversationText
      ? `${conversationText}\n\n请根据以上群聊内容回复：`
      : '请开始群聊对话。'

    let currentContent = ''
    let currentThinking = ''
    let lastError: string | null = null
    let unsub: (() => void) | null = null
    let traceId = ''
    let traceInputTokens = 0
    let traceOutputTokens = 0
    const toolCallsMap = new Map<string, ToolCallInfo>()

    try {
      // 开始请求追踪
      const protocol = resolveProtocol(member)
      traceId = eng.startRequestTrace(member.id, member.name, protocol)

      if (store.syncMode) {
        // 同步模式：不订阅事件流，等待完成后直接读取结果
        await agent.prompt(promptText, { contextOverride: dynamicContext, chatMode: 'group-chat' })
        const state = agent.state
        const lastMsg = state.messages[state.messages.length - 1]
        currentContent = lastMsg?.content || ''
        currentThinking = lastMsg?.thinking || ''
      } else {
        // 流式模式：订阅事件流，实时更新 UI
        unsub = agent.subscribe((event: any) => {
          switch (event.type) {
            case 'message_update':
              if (event.content !== undefined) currentContent = event.content
              if (event.thinking !== undefined) currentThinking = event.thinking
              store.clearTyping(member.id)
              store.setStreaming(member.id, currentContent, currentThinking)
              break
            case 'tool_execution_start': {
              const tc: ToolCallInfo = {
                id: event.toolCall.id,
                name: event.toolCall.name,
                status: 'running',
              }
              toolCallsMap.set(tc.id, tc)
              store.setStreamingToolCalls(member.id, Array.from(toolCallsMap.values()))
              break
            }
            case 'tool_execution_update': {
              const existing = toolCallsMap.get(event.toolCallId)
              if (existing && event.status === 'error') {
                existing.status = 'failed'
                store.setStreamingToolCalls(member.id, Array.from(toolCallsMap.values()))
              }
              break
            }
            case 'tool_execution_end': {
              const existing = toolCallsMap.get(event.toolCallId)
              if (existing) {
                existing.status = event.success ? 'completed' : 'failed'
                store.setStreamingToolCalls(member.id, Array.from(toolCallsMap.values()))

                // 世界变更类工具完成后，生成为世界事件（Layer 3）
                if (event.success && isWorldChangeTool(existing.name)) {
                  const worldEvent = {
                    id: crypto.randomUUID(),
                    agentId: member.id,
                    agentName: member.name,
                    action: inferWorldAction(existing.name),
                    targetType: inferTargetType(existing.name),
                    targetName: inferTargetName(event),
                    toolCallId: existing.id,
                    timestamp: Date.now(),
                  }
                  store.addWorldEvent(worldEvent)

                  // 同时作为 world-event 消息插入对话流
                  const actionLabel = worldEvent.action === 'create' ? '创建了'
                    : worldEvent.action === 'delete' ? '删除了' : '更新了'
                  const eventMsg: GroupChatMessage = {
                    id: `we-${worldEvent.id}`,
                    role: 'system',
                    content: `${member.name} ${actionLabel}${worldEvent.targetType}「${worldEvent.targetName}」`,
                    type: 'world-event',
                    timestamp: Date.now(),
                  }
                  store.addCasualMessage(eventMsg)
                }
              }
              break
            }
            case 'usage':
              if (event.usage) {
                eng.recordUsage(member.id, event.usage)
                store.updateCostTracker(eng.getCostSnapshot())
                traceInputTokens += event.usage.inputTokens || 0
                traceOutputTokens += event.usage.outputTokens || 0
              }
              break
            case 'error':
              lastError = event.error?.message || String(event.error)
              console.error(`[CasualChat] Agent ${member.name} error:`, lastError)
              store.clearTyping(member.id)
              break
          }
        })

        await agent.prompt(promptText, { contextOverride: dynamicContext, chatMode: 'group-chat' })
        store.clearStreaming(member.id)

        if (lastError) {
          console.warn(`[CasualChat] Agent ${member.name} had error, skipping:`, lastError)
          eng.failRequestTrace(traceId, lastError)
          store.setRequestSnapshot(eng.getRequestSnapshot())
          return null
        }
      }

      // 结束请求追踪（成功）
      eng.endRequestTrace(traceId, traceInputTokens, traceOutputTokens)
      store.setRequestSnapshot(eng.getRequestSnapshot())

      if (currentContent) {
        const msg: GroupChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: currentContent,
          thinking: currentThinking || undefined,
          type: 'text',
          timestamp: Date.now(),
          speakerId: member.id,
          speakerName: member.name,
          speakerAvatar: member.avatar,
          speakerColor: member.color,
          speakerFontFamily: member.fontFamily,
          speakerFontWeight: member.fontWeight,
          speakerFontStyle: member.fontStyle,
          toolCalls: toolCallsMap.size > 0 ? Array.from(toolCallsMap.values()) : undefined,
        }
        // 即时回调：并行模式下消息一完成就添加到 store
        onMessage?.(msg)
        return msg
      }
      return null
    } catch (err) {
      if (traceId) {
        eng.failRequestTrace(traceId, err instanceof Error ? err.message : String(err))
        store.setRequestSnapshot(eng.getRequestSnapshot())
      }
      store.clearStreaming(member.id)
      store.clearTyping(member.id)
      return null
    } finally {
      unsub?.()
    }
  }

  /** 对话循环：解析发言人并依次/并行调用 Agent */
  async function conversationLoop(
    eng: GroupChatEngine,
    triggerMsg: GroupChatMessage,
    maxChainRounds: number = 5,
  ): Promise<void> {
    let currentTrigger = triggerMsg
    let chainRound = 0

    while (chainRound < maxChainRounds) {
      // 使用 TurnEngine 解析本轮发言人
      const turnResult = await eng.resolveTurn(
        currentTrigger.content,
        currentTrigger.mentions || [],
        store.groupMembers,
      )

      if (turnResult.agentIds.length === 0) break

      // 过滤掉触发者自身
      const filteredIds = turnResult.agentIds.filter(id => id !== currentTrigger.speakerId)
      if (filteredIds.length === 0) break

      store.setCurrentSpeakers(filteredIds)

      if (filteredIds.length > 1) {
        // 多发言人：并行执行（同时流式输出）
        // 每个 Agent 完成后立即将消息添加到 store，不等其他 Agent
        const completedMsgs: GroupChatMessage[] = []

        await Promise.all(
          filteredIds.map(async (agentId) => {
            const release = await eng.acquireFlowSlot(agentId)
            try {
              const member = store.groupMembers.find(m => m.id === agentId)
              if (!member) return
              const context = eng.buildStrategyContext(
                store.groupInfo?.name, chainRound, currentTrigger, currentTrigger.mentions || [],
              )
              const agentMsg = await promptAgent(eng, member, context, (msg) => {
                // 即时添加：Agent 一完成就显示消息
                store.addCasualMessage(msg)
                eng.addMessage(msg)
                eng.recordSpeaking(msg.speakerId!)
                completedMsgs.push(msg)
              })
              // 如果 onMessage 没被调用（不应该发生），兜底添加
              if (agentMsg && !completedMsgs.includes(agentMsg)) {
                store.addCasualMessage(agentMsg)
                eng.addMessage(agentMsg)
                eng.recordSpeaking(agentMsg.speakerId!)
                completedMsgs.push(agentMsg)
              }
            } finally {
              release()
            }
          }),
        )

        // 更新 currentTrigger 为最后一个完成的消息
        if (completedMsgs.length > 0) {
          currentTrigger = completedMsgs[completedMsgs.length - 1]
        }
      } else {
        // 单发言人：串行执行
        const agentId = filteredIds[0]
        const release = await eng.acquireFlowSlot(agentId)
        try {
          const member = store.groupMembers.find(m => m.id === agentId)
          if (member) {
            const context = eng.buildStrategyContext(
              store.groupInfo?.name, chainRound, currentTrigger, currentTrigger.mentions || [],
            )
            const agentMsg = await promptAgent(eng, member, context)
            if (agentMsg) {
              store.addCasualMessage(agentMsg)
              eng.addMessage(agentMsg)
              eng.recordSpeaking(agentMsg.speakerId!)
              currentTrigger = agentMsg
            }
          }
        } finally {
          release()
        }
      }

      // 衰减近期发言计数
      eng.decayRecentCounts()
      // 更新流控统计
      store.setFlowStats(eng.getFlowStats())

      chainRound++
    }

    store.setCurrentSpeakers([])
    updateGroupPreview()
    scheduleSave()
  }

  function resetIdleTimer(eng: GroupChatEngine | null): void {
    if (idleTimer) clearTimeout(idleTimer)
    if (!eng || proactiveCount >= MAX_PROACTIVE_PER_SESSION) return

    idleTimer = setTimeout(async () => {
      await tryProactiveSpeak(eng)
    }, IDLE_TIMEOUT)
  }

  /** 主动发言：空闲一段时间后由 Agent 自发说话 */
  async function tryProactiveSpeak(eng: GroupChatEngine): Promise<void> {
    // 使用 TurnEngine 解析主动发言
    const lastMsg = store.casualMessages[store.casualMessages.length - 1]
    const lastContent = lastMsg?.content ?? ''

    const turnResult = await eng.resolveTurn(
      lastContent,
      [],
      store.groupMembers,
    )

    // 主动发言只取第一个发言人
    if (turnResult.agentIds.length === 0) {
      resetIdleTimer(eng)
      return
    }

    const agentId = turnResult.agentIds[0]
    const member = store.groupMembers.find(m => m.id === agentId)
    if (!member || member.muted) {
      resetIdleTimer(eng)
      return
    }

    proactiveCount++
    const context = eng.buildStrategyContext(store.groupInfo?.name, 0, lastMsg, [])

    const agentMsg = await promptAgent(eng, member, context)
    if (agentMsg) {
      store.addCasualMessage(agentMsg)
      eng.addMessage(agentMsg)
      eng.recordSpeaking(agentMsg.speakerId!)
      updateGroupPreview()
      scheduleSave()
    }

    // 主动发言完成后通知外部清理 UI 状态（如回复目标）
    options?.onProactiveSpeakComplete?.()
    resetIdleTimer(eng)
  }

  /** 确保引擎已初始化（惰性创建，单例） */
  async function ensureEngine(): Promise<GroupChatEngine | null> {
    if (engine) return engine
    if (engineInitPromise) return engineInitPromise

    engineInitPromise = (async () => {
      const ok = await ensureInitialized()
      if (!ok) return null

      const providerConfig = getProviderConfig()
      const toolContext = getToolContext()
      if (!providerConfig || !toolContext) return null

      const strategy = new CasualStrategy()
      const eng = new GroupChatEngine(strategy)

      // 注册 Provider 池（从 agentProfileStore 读取，与顶栏 ProviderSlotEditor 同源）
      for (const slot of profileStore.slots) {
        eng.registerProviderSlot(slot)
      }

      if (store.groupMembers.length > 0) {
        await eng.createAgents(store.groupMembers, providerConfig, toolContext)
        store.setOnlineBatch(store.groupMembers.map(m => m.id))

        for (const m of store.groupMembers) {
          const keywords = m.systemPrompt
            ? m.systemPrompt.split(/[,，、\s]+/).filter(w => w.length > 1).slice(0, 10)
            : []
          strategy.registerRoleKeywords(m.id, keywords)
        }
      }

      // 同步发言策略
      eng.setTurnStrategy(store.turnStrategy)

      engine = eng
      return eng
    })()

    try {
      return await engineInitPromise
    } finally {
      engineInitPromise = null
    }
  }

  /** 发送用户消息并触发对话循环 */
  async function onSend(
    text: string,
    pendingMentions: string[],
    replyTarget: { messageId: string; name: string; text: string } | null,
  ): Promise<void> {
    if (isSending.value) return
    isSending.value = true

    const userMsg: GroupChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      type: 'text',
      timestamp: Date.now(),
      mentions: pendingMentions.length > 0 ? [...pendingMentions] : undefined,
      replyTo: replyTarget?.messageId || undefined,
      speakerId: 'user',
      speakerName: '你',
    }
    store.addCasualMessage(userMsg)

    const eng = await ensureEngine()

    if (eng) {
      eng.addMessage(userMsg)
      await conversationLoop(eng, userMsg)
    }

    resetIdleTimer(eng)
    scheduleSave()
    isSending.value = false
  }

  /** 处理图片选择事件 */
  async function onImageSelected(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async () => {
      if (isSending.value) return
      isSending.value = true

      const dataUrl = reader.result as string
      const msg: GroupChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: file.name,
        type: 'image',
        timestamp: Date.now(),
        imageUrl: dataUrl,
        speakerId: 'user',
        speakerName: '你',
      }
      store.addCasualMessage(msg)
      const eng = await ensureEngine()
      if (eng) {
        eng.addMessage(msg)
        await conversationLoop(eng, msg)
      }
      scheduleSave()
      isSending.value = false
    }
    reader.readAsDataURL(file)
    ;(e.target as HTMLInputElement).value = ''
  }

  /** 处理文件选择事件 */
  async function onFileSelected(e: Event): Promise<void> {
    if (isSending.value) return
    isSending.value = true

    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) { isSending.value = false; return }

    const url = URL.createObjectURL(file)
    const msg: GroupChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: file.name,
      type: 'file',
      timestamp: Date.now(),
      fileName: file.name,
      fileUrl: url,
      speakerId: 'user',
      speakerName: '你',
    }
    store.addCasualMessage(msg)
    const eng = await ensureEngine()
    if (eng) {
      eng.addMessage(msg)
      await conversationLoop(eng, msg)
    }
    scheduleSave()
    ;(e.target as HTMLInputElement).value = ''
    isSending.value = false
  }

  /** 调度会话保存（防抖 1s） */
  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveCurrentSession(), 1000)
  }

  /** 禁言动作：插入系统消息并保存 */
  function onMuteAction(memberId: string, muted: boolean, duration: number | null): void {
    const member = store.groupMembers.find(m => m.id === memberId)
    if (!member) return

    let content: string
    if (muted) {
      if (duration === null) {
        content = `${member.name} 已被永久禁言`
      } else {
        const minutes = Math.round(duration / 60000)
        content = minutes >= 60
          ? `${member.name} 已被禁言 ${Math.round(minutes / 60)} 小时`
          : `${member.name} 已被禁言 ${minutes} 分钟`
      }
    } else {
      content = `${member.name} 已被解除禁言`
    }

    const sysMsg: GroupChatMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content,
      type: 'action',
      timestamp: Date.now(),
    }
    store.addCasualMessage(sysMsg)
    scheduleSave()
  }

  /** 选择群组：切换模式或加载会话 */
  async function onSelectGroup(payload: { id: string; mode: GroupChatMode }): Promise<void> {
    if (payload.mode === 'meeting') {
      spaceStore.setGroupChatMode('meeting')
      return
    }
    // 闲聊模式：加载群会话
    await loadSession(payload.id)
    groupStore.setActiveGroup(payload.id)
  }

  /** 创建新群组 */
  async function onCreateGroup(data: CreateGroupData): Promise<void> {
    const groupId = crypto.randomUUID()
    const now = Date.now()

    const members: GroupMember[] = (data.members as GroupMember[]).map((m: GroupMember, i: number) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      color: m.color || assignAgentColor(i),
      avatar: m.avatar || m.name[0],
      systemPrompt: m.systemPrompt || '',
      modelId: m.modelId,
      groupRole: i === 0 ? 'owner' as const : 'member' as const,
      joinedAt: now,
      muted: false,
      lastActiveAt: now,
      speakCount: 0,
      lastSpokeAt: 0,
      enabledTools: m.enabledTools || [],
      enabledSkills: m.enabledSkills || [],
      baseLayerMode: (m.baseLayerMode || 'empty') as BaseLayerMode,
      customBaseLayer: m.customBaseLayer,
      toolSource: (m.toolSource || 'derived') as ToolSource,
    }))

    const groupInfo = {
      id: groupId,
      name: data.name,
      avatar: '👥',
      mode: 'casual' as GroupChatMode,
      createdAt: now,
      updatedAt: now,
    }

    store.setGroupInfo(groupInfo)
    store.setGroupMembers(members)
    store.setGroupMode('casual')

    groupStore.addGroup({
      id: groupId,
      name: data.name,
      avatar: '👥',
      mode: 'casual',
      lastMessage: '',
      lastMessageAt: now,
      unreadCount: 0,
      pinned: false,
      memberCount: members.length,
    })
    groupStore.setActiveGroup(groupId)

    await saveCasualGroupSession({
      info: groupInfo,
      members,
      messages: [],
      desireConfig: { threshold: 0.4, mentionBoost: 0.5, roleRelevanceWeight: 0.3, recentActivityDecay: 0.1 },
      costTracker: { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, perAgentCost: {}, remainingBudget: 0, budgetPercentUsed: 0 },
    })
  }

  /** 解散群组：清理资源并删除会话 */
  async function onDissolveGroup(): Promise<void> {
    if (!store.groupInfo) return
    const groupId = store.groupInfo.id
    store.setOfflineBatch(store.groupMembers.map(m => m.id))
    store.clearTyping()
    engine?.disposeAgents()
    engine = null
    store.reset()
    groupStore.removeGroup(groupId)
    await deleteCasualGroupSession(groupId)
  }

  /** 保存当前会话到持久化存储 */
  async function saveCurrentSession(): Promise<void> {
    if (!store.groupInfo) return
    await saveCasualGroupSession({
      info: { ...store.groupInfo, updatedAt: Date.now() },
      members: [...store.groupMembers],
      messages: [...store.casualMessages],
      desireConfig: { ...store.desireConfig },
      costTracker: { ...store.costTracker },
    })
  }

  /** 加载指定群会话 */
  async function loadSession(groupId: string): Promise<void> {
    const session = await getCasualGroupSession(groupId)
    if (!session) return
    store.setGroupInfo(session.info)
    store.setGroupMembers(session.members)
    store.setDesireConfig(session.desireConfig)
    if (session.costTracker) {
      store.updateCostTracker(session.costTracker)
    }
    for (const msg of session.messages) {
      store.addCasualMessage(msg)
    }
  }

  /** 处理 groupInfo.id 变化：清理旧引擎状态 */
  function handleGroupInfoChange(newId: string | undefined, oldId: string | undefined): void {
    if (newId !== oldId && oldId !== undefined) {
      store.setOfflineBatch(store.groupMembers.map(m => m.id))
      engine?.disposeAgents()
      engine = null
      engineInitPromise = null
      proactiveCount = 0
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  /** 组件卸载时清理所有资源 */
  function dispose(): void {
    store.setOfflineBatch(store.groupMembers.map(m => m.id))
    store.clearTyping()
    engine?.disposeAgents()
    engine = null
    if (saveTimer) clearTimeout(saveTimer)
    if (idleTimer) clearTimeout(idleTimer)
    saveCurrentSession()
  }

  return {
    isSending,
    ensureEngine,
    onSend,
    onImageSelected,
    onFileSelected,
    scheduleSave,
    onMuteAction,
    onSelectGroup,
    onCreateGroup,
    onDissolveGroup,
    saveCurrentSession,
    loadSession,
    handleGroupInfoChange,
    dispose,
    resetIdleTimer,
  }
}