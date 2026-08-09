import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AgentMessage } from '@agent/index'
import type {
  GroupChatConfig,
  GroupChatBudget,
  GroupParticipant,
  GroupChatState,
  GroupChatCostTracker,
  GroupSession,
  ModelHealthResult,
  DegradedAgentInfo,
  StreamingAgentState,
  GroupChatMode,
  GroupInfo,
  GroupMember,
  GroupChatMessage,
  DesireConfig,
  RequestTrackerSnapshot,
  ToolCallInfo,
  WorldEvent,
} from './types'
import { DEFAULT_GROUP_CHAT_CONFIG, DEFAULT_GROUP_CHAT_BUDGET, DEFAULT_DESIRE_CONFIG, assignAgentColor } from './types'

import type { TurnStrategy } from '@agent/group-chat/types'

export const useGroupChatStore = defineStore('group-chat', () => {
  const state = ref<GroupChatState>('idle')
  const topic = ref('')
  const participants = ref<GroupParticipant[]>([])
  const messages = ref<AgentMessage[]>([])
  const casualMessages = ref<GroupChatMessage[]>([])
  const config = ref<GroupChatConfig>({ ...DEFAULT_GROUP_CHAT_CONFIG })
  const budget = ref<GroupChatBudget>({ ...DEFAULT_GROUP_CHAT_BUDGET })
  const costTracker = ref<GroupChatCostTracker>({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    perAgentCost: {},
    remainingBudget: budget.value.maxCostUsd,
    budgetPercentUsed: 0,
  })
  const currentRound = ref(0)
  const currentSpeakerId = ref<string | null>(null)
  const currentSpeakerIds = ref<string[]>([])
  const isPaused = ref(false)
  const nextSpeakerOverride = ref<string | null>(null)
  const currentSessionId = ref<string | null>(null)
  const reviewPending = ref(false)

  const streamingAgents = ref<Record<string, StreamingAgentState>>({})
  const healthStatus = ref<Record<string, ModelHealthResult>>({})
  const degradedAgents = ref<Record<string, DegradedAgentInfo>>({})

  const groupMode = ref<GroupChatMode>('casual')
  const groupInfo = ref<GroupInfo | null>(null)
  const groupMembers = ref<GroupMember[]>([])
  const allMuted = ref(false)
  const typingAgents = ref<Record<string, boolean>>({})
  const onlineAgentIds = ref<Set<string>>(new Set())
  const desireConfig = ref<DesireConfig>({ ...DEFAULT_DESIRE_CONFIG })

  // 后端模块集成状态
  const turnStrategy = ref<TurnStrategy>('speaking-desire')
  const flowStats = ref<{ globalPending: number; slots: Record<string, number> }>({ globalPending: 0, slots: {} })
  const requestSnapshot = ref<RequestTrackerSnapshot | null>(null)
  const syncMode = ref(false)

  // 世界事件（Layer 3：修改共享世界状态的操作）
  const worldEvents = ref<WorldEvent[]>([])

  const isStreaming = computed(() => Object.keys(streamingAgents.value).length > 0)
  const streamingContent = computed(() => {
    const keys = Object.keys(streamingAgents.value)
    if (keys.length === 0) return ''
    if (keys.length === 1) return streamingAgents.value[keys[0]].content
    return keys.map(k => streamingAgents.value[k].content).join('\n---\n')
  })
  const streamingThinking = computed(() => {
    const keys = Object.keys(streamingAgents.value)
    if (keys.length === 0) return ''
    if (keys.length === 1) return streamingAgents.value[keys[0]].thinking
    return ''
  })

  const isActive = computed(() => state.value === 'running' || state.value === 'paused')
  const isCompleted = computed(() => state.value === 'completed' || state.value === 'terminated')

  function setParticipants(list: Array<Omit<GroupParticipant, 'speakCount' | 'lastSpokeAt'>>): void {
    participants.value = list.map((p, i) => ({
      ...p,
      color: p.color || assignAgentColor(i),
      speakCount: 0,
      lastSpokeAt: 0,
    }))
  }

  function addMessage(msg: AgentMessage): void {
    messages.value = [...messages.value, msg]
  }

  function addCasualMessage(msg: GroupChatMessage): void {
    casualMessages.value = [...casualMessages.value, msg]
  }

  function updateParticipant(agentId: string, patch: Partial<GroupParticipant>): void {
    const idx = participants.value.findIndex(p => p.id === agentId)
    if (idx !== -1) {
      participants.value[idx] = { ...participants.value[idx], ...patch }
    }
  }

  function updateCostTracker(tracker: GroupChatCostTracker): void {
    costTracker.value = tracker
  }

  function setState(s: GroupChatState): void {
    state.value = s
  }

  function incrementRound(): void {
    currentRound.value++
  }

  function setCurrentSpeaker(id: string | null): void {
    currentSpeakerId.value = id
  }

  function setCurrentSpeakers(ids: string[]): void {
    currentSpeakerIds.value = ids
    currentSpeakerId.value = ids.length === 1 ? ids[0] : null
  }

  function setPaused(p: boolean): void {
    isPaused.value = p
  }

  function setNextSpeakerOverride(id: string | null): void {
    nextSpeakerOverride.value = id
  }

  function setReviewPending(p: boolean): void {
    reviewPending.value = p
  }

  function setStreaming(agentId: string, content: string, thinking: string, toolCalls?: ToolCallInfo[]): void {
    streamingAgents.value = {
      ...streamingAgents.value,
      [agentId]: { content, thinking, toolCalls: toolCalls ?? streamingAgents.value[agentId]?.toolCalls ?? [] },
    }
  }

  function clearStreaming(agentId?: string): void {
    if (agentId) {
      const next = { ...streamingAgents.value }
      delete next[agentId]
      streamingAgents.value = next
    } else {
      streamingAgents.value = {}
    }
  }

  function setHealthStatus(agentId: string, result: ModelHealthResult): void {
    healthStatus.value = {
      ...healthStatus.value,
      [agentId]: result,
    }
  }

  function clearHealthStatus(): void {
    healthStatus.value = {}
  }

  function setDegradedAgent(info: DegradedAgentInfo): void {
    degradedAgents.value = {
      ...degradedAgents.value,
      [info.agentId]: info,
    }
  }

  function clearDegradedAgent(agentId: string): void {
    const next = { ...degradedAgents.value }
    delete next[agentId]
    degradedAgents.value = next
  }

  function setGroupMode(mode: GroupChatMode) { groupMode.value = mode }
  function setGroupInfo(info: GroupInfo) { groupInfo.value = info }
  function setGroupMembers(members: GroupMember[]) { groupMembers.value = members }
  function updateGroupMember(agentId: string, patch: Partial<GroupMember>) {
    const idx = groupMembers.value.findIndex(m => m.id === agentId)
    if (idx !== -1) groupMembers.value[idx] = { ...groupMembers.value[idx], ...patch }
  }
  function setAllMuted(v: boolean) { allMuted.value = v }
  function setTyping(agentId: string): void {
    typingAgents.value = { ...typingAgents.value, [agentId]: true }
  }
  function clearTyping(agentId?: string): void {
    if (agentId) {
      const next = { ...typingAgents.value }
      delete next[agentId]
      typingAgents.value = next
    } else {
      typingAgents.value = {}
    }
  }
  function setOnline(agentId: string): void {
    const s = onlineAgentIds.value
    if (s.has(agentId)) return
    onlineAgentIds.value = new Set([...s, agentId])
  }
  function setOffline(agentId: string): void {
    const s = onlineAgentIds.value
    if (!s.has(agentId)) return
    const next = new Set(s)
    next.delete(agentId)
    onlineAgentIds.value = next
  }
  function setOnlineBatch(agentIds: string[]): void {
    const s = onlineAgentIds.value
    let changed = false
    for (const id of agentIds) {
      if (!s.has(id)) { changed = true; break }
    }
    if (!changed) return
    onlineAgentIds.value = new Set([...s, ...agentIds])
  }
  function setOfflineBatch(agentIds: string[]): void {
    const s = onlineAgentIds.value
    let changed = false
    for (const id of agentIds) {
      if (s.has(id)) { changed = true; break }
    }
    if (!changed) return
    const next = new Set(s)
    for (const id of agentIds) next.delete(id)
    onlineAgentIds.value = next
  }
  function setDesireConfig(config: DesireConfig): void {
    desireConfig.value = config
  }
  function setTurnStrategy(s: TurnStrategy): void {
    turnStrategy.value = s
  }
  function setFlowStats(stats: { globalPending: number; slots: Record<string, number> }): void {
    flowStats.value = stats
  }
  function setRequestSnapshot(snapshot: RequestTrackerSnapshot): void {
    requestSnapshot.value = snapshot
  }
  function clearRequestSnapshot(): void {
    requestSnapshot.value = null
  }
  function setSyncMode(v: boolean): void {
    syncMode.value = v
  }

  /** 更新指定 Agent 的流式工具调用状态 */
  function setStreamingToolCalls(agentId: string, toolCalls: ToolCallInfo[]): void {
    const current = streamingAgents.value[agentId]
    if (current) {
      streamingAgents.value = {
        ...streamingAgents.value,
        [agentId]: { ...current, toolCalls },
      }
    }
  }

  /** 添加世界事件 */
  function addWorldEvent(event: WorldEvent): void {
    worldEvents.value = [...worldEvents.value, event]
  }

  /** 清空世界事件 */
  function clearWorldEvents(): void {
    worldEvents.value = []
  }

  function reset(): void {
    state.value = 'idle'
    topic.value = ''
    participants.value = []
    messages.value = []
    config.value = { ...DEFAULT_GROUP_CHAT_CONFIG }
    budget.value = { ...DEFAULT_GROUP_CHAT_BUDGET }
    costTracker.value = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      perAgentCost: {},
      remainingBudget: budget.value.maxCostUsd,
      budgetPercentUsed: 0,
    }
    currentRound.value = 0
    currentSpeakerId.value = null
    currentSpeakerIds.value = []
    isPaused.value = false
    nextSpeakerOverride.value = null
    currentSessionId.value = null
    reviewPending.value = false
    streamingAgents.value = {}
    healthStatus.value = {}
    degradedAgents.value = {}
    groupMode.value = 'casual'
    groupInfo.value = null
    groupMembers.value = []
    allMuted.value = false
    typingAgents.value = {}
    onlineAgentIds.value = new Set()
    casualMessages.value = []
    desireConfig.value = { ...DEFAULT_DESIRE_CONFIG }
    turnStrategy.value = 'speaking-desire'
    flowStats.value = { globalPending: 0, slots: {} }
    requestSnapshot.value = null
    worldEvents.value = []
  }

  function loadSession(session: GroupSession): void {
    state.value = 'completed'
    topic.value = session.topic
    participants.value = session.participants
    messages.value = session.messages
    config.value = session.config
    budget.value = session.budget
    costTracker.value = session.costTracker
    currentRound.value = session.currentRound
    currentSessionId.value = session.id
    currentSpeakerId.value = null
    currentSpeakerIds.value = []
    isPaused.value = false
    nextSpeakerOverride.value = null
    reviewPending.value = false
    streamingAgents.value = {}
    healthStatus.value = {}
    degradedAgents.value = {}
    // 重置 casual 专属字段，避免从闲聊切换到会议时残留旧数据
    groupMode.value = 'meeting'
    groupInfo.value = null
    groupMembers.value = []
    casualMessages.value = []
    typingAgents.value = {}
    onlineAgentIds.value = new Set()
    desireConfig.value = { ...DEFAULT_DESIRE_CONFIG }
    allMuted.value = false
  }

  return {
    state, topic, participants, messages, config, budget, costTracker,
    currentRound, currentSpeakerId, currentSpeakerIds, isPaused, nextSpeakerOverride,
    currentSessionId, reviewPending, streamingAgents, streamingContent, streamingThinking,
    isStreaming, isActive, isCompleted, healthStatus, degradedAgents,
    groupMode, groupInfo, groupMembers, allMuted, casualMessages, desireConfig,
    setParticipants, addMessage, addCasualMessage, updateParticipant, updateCostTracker,
    setState, incrementRound, setCurrentSpeaker, setCurrentSpeakers, setPaused,
    setNextSpeakerOverride, setReviewPending, setStreaming, clearStreaming, reset,
    setHealthStatus, clearHealthStatus, setDegradedAgent, clearDegradedAgent,
    loadSession,
    setGroupMode, setGroupInfo, setGroupMembers, updateGroupMember, setAllMuted,
    typingAgents, setTyping, clearTyping,
    onlineAgentIds, setOnline, setOffline, setOnlineBatch, setOfflineBatch, setDesireConfig,
    turnStrategy, flowStats, setTurnStrategy, setFlowStats,
    requestSnapshot, setRequestSnapshot, clearRequestSnapshot,
    syncMode, setSyncMode,
    worldEvents, setStreamingToolCalls, addWorldEvent, clearWorldEvents,
  }
})