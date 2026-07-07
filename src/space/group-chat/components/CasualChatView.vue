<template>
  <div class="casual-chat-view">
    <!-- 左侧：双区域窄条 + 展开面板 -->
    <SidebarStrip :active-panel="activePanel" @toggle="onStripToggle" />
    <Transition name="sidebar-expand">
      <div v-if="activePanel === 'groups'" class="sidebar-panel">
        <GroupChatList @close="activePanel = null" @select-group="onSelectGroup" @create-group="onCreateGroup" />
      </div>
    </Transition>
    <Transition name="sidebar-expand">
      <div v-if="activePanel === 'friends'" class="sidebar-panel">
        <FriendList @close="activePanel = null" @private-chat="onFriendPrivateChat" />
      </div>
    </Transition>

    <!-- 右侧：聊天区域 -->
    <div class="chat-area">
      <div class="chat-header">
        <div class="header-left">
          <span class="group-avatar"><WsIcon name="users" size="sm" /></span>
          <span class="group-name">{{ store.groupInfo?.name || '群聊' }}</span>
          <span class="member-count">{{ onlineCount }}/{{ store.groupMembers.length }} 在线</span>
        </div>
        <div class="header-right">
          <button class="header-btn" @click="showInfoPanel = !showInfoPanel" title="群信息"><WsIcon name="info" size="xs" /></button>
        </div>
      </div>

    <div class="chat-messages" ref="messagesRef" @scroll="onMessagesScroll">
      <TransitionGroup name="msg-list">
        <template v-for="(msg, idx) in store.casualMessages" :key="msg.id">
          <div v-if="shouldShowDivider(msg.timestamp, idx > 0 ? store.casualMessages[idx - 1].timestamp : null)" class="time-divider">
            <span class="divider-text">{{ formatDividerTime(msg.timestamp) }}</span>
          </div>
          <CasualMessageBubble
            :msg="msg"
            :all-messages="store.casualMessages"
            :is-grouped="isMsgGrouped(idx)"
            @contextmenu="onMsgContextMenu"
          />
        </template>
      </TransitionGroup>

      <template v-for="agentId in activeStreamingIds" :key="`streaming-${agentId}`">
        <div class="streaming-msg">
          <div class="msg-header">
            <div class="msg-avatar" :style="{ background: getSpeakerColor(agentId) }">
              <span class="avatar-letter">{{ getSpeakerName(agentId)[0] || '?' }}</span>
            </div>
            <span class="msg-name" :style="{ color: getSpeakerColor(agentId) }">{{ getSpeakerName(agentId) }}</span>
          </div>
          <div class="msg-content">
            <!-- Layer 1: 流式工具调用状态指示器 -->
            <div v-if="getStreamingToolCalls(agentId).length > 0" class="streaming-tools">
              <span v-for="tc in getStreamingToolCalls(agentId)" :key="tc.id" class="streaming-tool-tag" :class="tc.status">
                <WsIcon v-if="tc.status === 'running'" name="loader" size="xs" class="tc-spin" />
                <WsIcon v-else-if="tc.status === 'completed'" name="check" size="xs" />
                <WsIcon v-else name="x" size="xs" />
                {{ getToolLabel(tc.name) }}
              </span>
            </div>
            <div class="msg-text">
              <div v-html="renderStreamingContent(agentId)"></div>
              <span v-if="!getStreamingToolCalls(agentId).some(tc => tc.status === 'running')" class="streaming-cursor">●</span>
            </div>
          </div>
        </div>
      </template>

      <div v-if="typingAgentNames.length > 0 && !store.isStreaming" class="typing-hint">
        <span class="typing-dot">●</span>
        {{ typingAgentNames.join('、') }} 正在输入...
      </div>
    </div>

    <Transition name="fade">
      <button v-if="!isAtBottom" class="scroll-to-bottom" @click="scrollToBottom">↓ 回到最新</button>
    </Transition>

    <CasualInputBar
      ref="inputBarRef"
      :reply-target="replyTarget"
      :mention-query="mentionQuery"
      :members="store.groupMembers"
      :sending="isSending"
      @send="onSend"
      @cancel-reply="replyTarget = null"
      @attach-image="onAttachImage"
      @attach-file="onAttachFile"
      @open-mention="onOpenMention"
      @close-mention="onCloseMention"
      @select-mention="onSelectMention"
      @update-mention-query="onUpdateMentionQuery"
    />

    <GroupInfoPanel v-if="showInfoPanel" @close="showInfoPanel = false" @dissolve="onDissolveGroup" @private-chat="onPrivateChat" @mute-action="onMuteAction" />
    </div><!-- /chat-area -->

    <Teleport to="body">
      <div v-if="contextMenu.visible" class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
        <div class="context-menu-item" @click="onContextReply">回复</div>
        <div class="context-menu-item" @click="onContextCopy">复制</div>
      </div>
    </Teleport>

    <input
      ref="imageInputRef"
      type="file"
      accept="image/*"
      style="display: none"
      @change="onImageSelected"
    />
    <input
      ref="fileInputRef"
      type="file"
      style="display: none"
      @change="onFileSelected"
    />
    <Teleport to="body">
      <Transition name="private-slide">
        <div v-if="privateChatAgent" class="private-chat-overlay">
          <AgentPrivateChat :member="privateChatAgent" @close="privateChatAgent = null" />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useGroupChatStore } from '../GroupChatStore'
import { useSpaceStore } from '../../stores/space-store'
import { useAgent } from '../../../agent/composables/useAgent'
import { GroupChatEngine } from '../engine/GroupChatEngine'
import { CasualStrategy } from '../engine/CasualStrategy'
import type { GroupChatMessage, GroupMember, GroupChatMode, ToolCallInfo, ToolSource, BaseLayerMode } from '../types'
import { assignAgentColor, isWorldChangeTool, getToolLabel } from '../types'
import type { CreateGroupData } from './CreateGroupDialog.vue'
import { saveCasualGroupSession, getCasualGroupSession, deleteCasualGroupSession } from '../GroupSessionManager'
import { useGroupStore } from '../management/GroupStore'
import { useMessageTime } from '../composables/useMessageTime'
import CasualMessageBubble from './CasualMessageBubble.vue'
import CasualInputBar from './CasualInputBar.vue'
import GroupInfoPanel from './GroupInfoPanel.vue'
import GroupChatList from './GroupChatList.vue'
import FriendList from './FriendList.vue'
import SidebarStrip from './SidebarStrip.vue'
import type { PanelType } from './SidebarStrip.vue'
import AgentPrivateChat from './AgentPrivateChat.vue'
import WsIcon from '../../../ui/WsIcon.vue'
import type { ChatAgent } from '../types'
import { useAgentProfileStore } from '../../../stores/agentProfileStore'

const store = useGroupChatStore()
const spaceStore = useSpaceStore()
const groupStore = useGroupStore()
const profileStore = useAgentProfileStore()
const { ensureInitialized, getProviderConfig, getToolContext } = useAgent()
const { shouldShowDivider, formatDividerTime } = useMessageTime()
const messagesRef = ref<HTMLDivElement>()
const showInfoPanel = ref(false)
const activePanel = ref<PanelType>(null)
const privateChatAgent = ref<GroupMember | null>(null)
const replyTarget = ref<{ messageId: string; name: string; text: string } | null>(null)
const mentionQuery = ref<string | null>(null)
const imageInputRef = ref<HTMLInputElement>()
const fileInputRef = ref<HTMLInputElement>()
const pendingMentions = ref<string[]>([])
const isAtBottom = ref(true)
const inputBarRef = ref<InstanceType<typeof CasualInputBar>>()
const contextMenu = ref<{ visible: boolean; x: number; y: number; msg: GroupChatMessage | null }>({
  visible: false, x: 0, y: 0, msg: null,
})

let engine: GroupChatEngine | null = null
let engineInitPromise: Promise<GroupChatEngine | null> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const IDLE_TIMEOUT = 30_000
const MAX_PROACTIVE_PER_SESSION = 3
let proactiveCount = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
const isSending = ref(false)

watch(() => store.groupInfo?.id, (newId, oldId) => {
  if (newId !== oldId && oldId !== undefined) {
    store.setOfflineBatch(store.groupMembers.map(m => m.id))
    engine?.disposeAgents()
    engine = null
    engineInitPromise = null
    proactiveCount = 0
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  }
})

const activeStreamingIds = computed(() => Object.keys(store.streamingAgents))

const typingAgentNames = computed(() => {
  return Object.keys(store.typingAgents)
    .map(id => store.groupMembers.find(m => m.id === id)?.name)
    .filter(Boolean) as string[]
})

const onlineCount = computed(() => store.onlineAgentIds.size)

function getSpeakerName(agentId: string): string {
  return store.groupMembers.find(m => m.id === agentId)?.name ?? ''
}

function getSpeakerColor(agentId: string): string {
  return store.groupMembers.find(m => m.id === agentId)?.color ?? '#888'
}

function renderStreamingContent(agentId: string): string {
  const state = store.streamingAgents[agentId]
  if (!state) return ''
  return state.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
}

function getStreamingToolCalls(agentId: string): ToolCallInfo[] {
  return store.streamingAgents[agentId]?.toolCalls ?? []
}

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

  replyTarget.value = null
  resetIdleTimer(eng)
}

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

async function onSend(text: string): Promise<void> {
  if (isSending.value) return
  isSending.value = true

  const userMsg: GroupChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: text,
    type: 'text',
    timestamp: Date.now(),
    mentions: pendingMentions.value.length > 0 ? [...pendingMentions.value] : undefined,
    replyTo: replyTarget.value?.messageId || undefined,
    speakerId: 'user',
    speakerName: '你',
  }
  store.addCasualMessage(userMsg)
  pendingMentions.value = []

  const eng = await ensureEngine()

  if (eng) {
    eng.addMessage(userMsg)
    await conversationLoop(eng, userMsg)
  }

  resetIdleTimer(eng)
  scheduleSave()
  isSending.value = false
  inputBarRef.value?.focusInput()
}

function onAttachImage(): void {
  imageInputRef.value?.click()
}

function onAttachFile(): void {
  fileInputRef.value?.click()
}

function onImageSelected(e: Event): void {
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

function onOpenMention(): void {
  mentionQuery.value = ''
}

function onCloseMention(): void {
  mentionQuery.value = null
}

function onUpdateMentionQuery(query: string): void {
  mentionQuery.value = query
}

function onSelectMention(member: GroupMember): void {
  pendingMentions.value = [...pendingMentions.value, member.id]
  mentionQuery.value = null
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveCurrentSession(), 1000)
}

function onPrivateChat(memberId: string): void {
  showInfoPanel.value = false
  const member = store.groupMembers.find(m => m.id === memberId)
  if (!member) return
  privateChatAgent.value = member
}

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

function onFriendPrivateChat(agent: ChatAgent): void {
  const member: GroupMember = {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    color: agent.color,
    avatar: agent.avatar,
    systemPrompt: agent.systemPrompt,
    modelId: agent.modelId,
    groupRole: 'member',
    joinedAt: Date.now(),
    muted: false,
    lastActiveAt: Date.now(),
    speakCount: 0,
    lastSpokeAt: 0,
    enabledTools: agent.enabledTools,
    enabledSkills: agent.enabledSkills,
    baseLayerMode: agent.baseLayerMode || 'empty',
    customBaseLayer: agent.customBaseLayer,
    toolSource: agent.toolSource || 'derived',
    providerSlotId: agent.providerSlotId,
  }
  privateChatAgent.value = member
}

function onStripToggle(panel: PanelType): void {
  if (activePanel.value === panel) {
    activePanel.value = null
  } else {
    activePanel.value = panel
  }
}

async function onSelectGroup(payload: { id: string; mode: GroupChatMode }): Promise<void> {
  if (payload.mode === 'meeting') {
    spaceStore.setGroupChatMode('meeting')
    return
  }
  // 闲聊模式：加载群会话
  await loadSession(payload.id)
  groupStore.setActiveGroup(payload.id)
  activePanel.value = null
}

async function onCreateGroup(data: CreateGroupData): Promise<void> {
  const groupId = crypto.randomUUID()
  const now = Date.now()

  const members: GroupMember[] = data.members.map((m, i) => ({
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

  activePanel.value = null
}

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
  showInfoPanel.value = false
}

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

function scrollToBottom(): void {
  const el = messagesRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function onMessagesScroll(): void {
  const el = messagesRef.value
  if (!el) return
  isAtBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 50
}

function isMsgGrouped(idx: number): boolean {
  if (idx === 0) return false
  const cur = store.casualMessages[idx]
  const prev = store.casualMessages[idx - 1]
  return cur.speakerId === prev.speakerId && cur.role === prev.role && cur.role !== 'system'
}

function onMsgContextMenu(payload: { event: MouseEvent; msg: GroupChatMessage }): void {
  payload.event.preventDefault()
  contextMenu.value = {
    visible: true,
    x: Math.min(payload.event.clientX, window.innerWidth - 160),
    y: Math.min(payload.event.clientY, window.innerHeight - 80),
    msg: payload.msg,
  }
}

function closeContextMenu(): void {
  contextMenu.value.visible = false
}

function onContextReply(): void {
  const msg = contextMenu.value.msg
  if (msg) {
    replyTarget.value = {
      messageId: msg.id,
      name: msg.speakerName || '用户',
      text: msg.content.slice(0, 60),
    }
  }
  closeContextMenu()
}

async function onContextCopy(): Promise<void> {
  const msg = contextMenu.value.msg
  if (msg) {
    await navigator.clipboard.writeText(msg.content)
  }
  closeContextMenu()
}

watch(() => store.casualMessages.length, () => {
  if (isAtBottom.value) {
    nextTick(scrollToBottom)
  }
})

watch(() => store.streamingAgents, () => {
  if (isAtBottom.value) {
    nextTick(scrollToBottom)
  }
}, { deep: true })

onMounted(() => {
  document.addEventListener('click', closeContextMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeContextMenu)
  store.setOfflineBatch(store.groupMembers.map(m => m.id))
  store.clearTyping()
  engine?.disposeAgents()
  engine = null
  if (saveTimer) clearTimeout(saveTimer)
  if (idleTimer) clearTimeout(idleTimer)
  saveCurrentSession()
})
</script>

<style scoped>
.casual-chat-view { display: flex; height: 100%; position: relative; }

/* 展开面板 */

/* 展开面板 */
.sidebar-panel {
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  overflow: hidden;
  contain: layout paint style;
}

.sidebar-panel > * {
  width: 260px;
}

.sidebar-expand-enter-active { transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.sidebar-expand-leave-active { transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.sidebar-expand-enter-from, .sidebar-expand-leave-to { width: 0; }

/* 右侧聊天区域 */
.chat-area { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; }

.chat-header { padding: 8px 16px; border-bottom: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between; }
.header-left { display: flex; align-items: center; gap: 8px; }
.group-avatar { font-size: 20px; }
.group-name { font-size: 14px; font-weight: 600; }
.member-count { font-size: 11px; color: var(--color-text-tertiary); }
.header-btn { width: 28px; height: 28px; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-size: 14px; }
.header-btn:hover { background: var(--color-surface); }

.chat-messages { flex: 1; overflow-y: auto; padding: 8px 0; position: relative; }

.streaming-msg { padding: 4px 16px; margin-bottom: 2px; }
.streaming-msg .msg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.streaming-msg .msg-avatar { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.streaming-msg .avatar-letter { color: white; font-weight: 700; font-size: 11px; }
.streaming-msg .msg-name { font-size: 12px; font-weight: 600; }
.streaming-msg .msg-content { margin-left: 36px; max-width: 75%; }
.streaming-msg .msg-text { padding: 8px 12px; background: var(--color-surface-elevated); border-radius: 2px 12px 12px 12px; font-size: 13px; line-height: 1.5; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
.streaming-cursor { color: var(--color-primary); animation: pulse 1s infinite; font-size: 10px; margin-left: 2px; }

/* Layer 1: 流式工具调用状态指示器 */
.streaming-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.streaming-tool-tag {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 4px; font-size: 11px;
  background: var(--color-surface-elevated); border: 1px solid var(--color-border);
  color: var(--color-text-secondary); transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s, opacity 0.2s, filter 0.2s;
}
.streaming-tool-tag.running { border-color: var(--color-primary); color: var(--color-primary); }
.streaming-tool-tag.completed { border-color: rgba(16, 185, 129, 0.3); color: #10b981; }
.streaming-tool-tag.failed { border-color: rgba(239, 68, 68, 0.3); color: #ef4444; }
.tc-spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.typing-hint { padding: 6px 16px; font-size: 11px; color: var(--color-text-tertiary); display: flex; align-items: center; gap: 4px; }
.typing-dot { color: var(--color-primary); animation: pulse 1.5s infinite; font-size: 8px; }

@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }

.time-divider { display: flex; align-items: center; padding: 8px 16px; }
.time-divider::before, .time-divider::after { content: ''; flex: 1; height: 1px; background: var(--color-border); }
.divider-text { font-size: 11px; color: var(--color-text-tertiary); padding: 0 12px; white-space: nowrap; }

.scroll-to-bottom { position: absolute; bottom: 68px; right: 16px; padding: 6px 14px; border: 1px solid var(--color-border); border-radius: 20px; background: var(--color-surface-elevated); box-shadow: 0 2px 8px rgba(0,0,0,0.12); cursor: pointer; font-size: 12px; color: var(--color-text); z-index: 10; transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s, opacity 0.2s, filter 0.2s; backdrop-filter: blur(8px); opacity: 0.85; }
.scroll-to-bottom:hover { background: var(--color-surface); box-shadow: 0 4px 12px rgba(0,0,0,0.18); }

.msg-list-enter-active { transition: background 0.2s ease-out, border-color 0.2s ease-out, color 0.2s ease-out, box-shadow 0.2s ease-out, transform 0.2s ease-out, opacity 0.2s ease-out, filter 0.2s ease-out; }
.msg-list-enter-from { opacity: 0; transform: translateY(8px); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.context-menu { position: fixed; background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 4px; min-width: 120px; z-index: 10000; }
.context-menu-item { padding: 8px 12px; font-size: 12px; cursor: pointer; border-radius: 4px; color: var(--color-text); }
.context-menu-item:hover { background: var(--color-surface); }

.private-chat-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  z-index: 9998;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.3);
}
.private-slide-enter-active, .private-slide-leave-active { transition: transform 0.25s ease; }
.private-slide-enter-from, .private-slide-leave-to { transform: translateX(100%); }
</style>
