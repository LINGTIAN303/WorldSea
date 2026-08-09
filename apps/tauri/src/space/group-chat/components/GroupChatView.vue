<template>
  <div class="group-chat-layout">
    <SidebarStrip :active-panel="activePanel" @toggle="onStripToggle" />
    <Transition name="sidebar-expand">
      <div v-if="activePanel === 'groups'" class="sidebar-panel">
        <GroupChatList
          @close="activePanel = null"
          @select-group="onSelectGroup"
          @create-group="onCreateGroup"
        />
      </div>
    </Transition>
    <Transition name="sidebar-expand">
      <div v-if="activePanel === 'friends'" class="sidebar-panel">
        <FriendList @close="activePanel = null" @private-chat="onFriendPrivateChat" />
      </div>
    </Transition>
    <div class="group-main">
      <GroupChatSetup
        v-if="store.state === 'idle' && effectiveGroupMode === 'meeting'"
        @start="onStart"
        @cancel="$emit('close')"
      />

      <CasualChatView
        v-else-if="effectiveGroupMode === 'casual' && store.groupInfo"
      />

      <template v-else-if="effectiveGroupMode === 'meeting' && store.state !== 'idle'">
        <div class="chat-header">
          <div class="header-left">
            <span class="topic-label"><WsIcon name="users" size="xs" /> {{ store.topic }}</span>
            <GroupChatBudgetBar
              :cost-usd="store.costTracker.totalCostUsd"
              :max-cost="store.budget.maxCostUsd"
              :total-input-tokens="store.costTracker.totalInputTokens"
              :total-output-tokens="store.costTracker.totalOutputTokens"
              :is-local="isLocal"
            />
            <span v-if="store.config.parallelCount > 1" class="parallel-badge">
              <WsIcon name="zap" size="xs" />×{{ store.config.parallelCount }}
            </span>
            <span v-if="store.state === 'completed'" class="state-tag completed-tag">已完成</span>
            <span v-else-if="store.state === 'terminated'" class="state-tag terminated-tag"><WsIcon name="square" size="xs" /> 已终止</span>
          </div>
          <div v-if="store.isCompleted" class="header-actions">
            <button class="action-btn new-btn" @click="onNewGroupChat">新建群聊</button>
          </div>
        </div>

        <div class="chat-messages" ref="messagesRef">
          <template v-for="(msg, idx) in store.messages" :key="msg.id">
            <div v-if="shouldShowDivider(msg.timestamp, idx > 0 ? store.messages[idx - 1].timestamp : null)" class="time-divider">
              <span class="divider-text">{{ formatDividerTime(msg.timestamp) }}</span>
            </div>
            <GroupMessageBubble :msg="msg" />
          </template>

          <template v-for="agentId in activeStreamingIds" :key="`streaming-${agentId}`">
            <div class="group-msg streaming-msg">
              <div class="msg-speaker" :style="{ '--speaker-color': getSpeakerColor(agentId) }">
                <div class="speaker-avatar" :style="{ background: getSpeakerColor(agentId) }">
                  <span class="avatar-letter">{{ getSpeakerName(agentId)[0] || '?' }}</span>
                </div>
                <span class="speaker-name">{{ getSpeakerName(agentId) }}</span>
                <span v-if="store.degradedAgents[agentId]" class="degraded-tag">降级</span>
              </div>
              <div class="msg-body" :style="{ borderLeftColor: getSpeakerColor(agentId) }">
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

          <div v-if="waitingSpeakers.length > 0 && !store.isStreaming && !store.isPaused" class="streaming-hint">
            <template v-for="(sid, i) in waitingSpeakers" :key="sid">
              <span v-if="i > 0" class="hint-sep">、</span>
              <span class="streaming-dot">●</span>
              {{ getSpeakerName(sid) }}
            </template>
            思考中...
          </div>
        </div>

        <GroupReviewCheckpoint
          v-if="store.reviewPending"
          :round="store.currentRound"
          :messages="store.messages"
          @continue="onReviewContinue"
          @adjust="onReviewAdjust"
          @terminate="onTerminate"
        />
        <GroupChatControls
          :is-running="store.state === 'running'"
          :is-paused="store.state === 'paused'"
          :is-active="store.isActive"
          :current-round="store.currentRound"
          :max-rounds="store.config.maxRounds"
          :current-speaker-name="currentSpeakerName"
          @pause="pauseChat"
          @resume="resumeChat"
          @terminate="onTerminate"
          @inject="onInject"
        />
      </template>

      <div v-else class="empty-state">
        <div class="empty-icon"><WsIcon name="users" size="lg" /></div>
        <div class="empty-text">选择或创建一个群聊开始</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useGroupChatStore } from '../GroupChatStore'
import { useSpaceStore } from '@/space/stores/space-store'
import { useGroupStore } from '../management/GroupStore'
import { GroupChatCoordinator } from '../GroupChatCoordinator'
import { createGroupSession, saveGroupSession, getGroupSession, saveCasualGroupSession } from '../GroupSessionManager'
import { useAgent } from '@/agent/composables/useAgent'
import { useSettingsStore } from '@/stores/settingsStore'
import { useMessageTime } from '../composables/useMessageTime'
import type { GroupMember, GroupChatMode, ToolCallInfo, BaseLayerMode, ToolSource } from '../types'
import { assignAgentColor, getToolLabel } from '../types'
import GroupChatSetup from './GroupChatSetup.vue'
import GroupMessageBubble from './GroupMessageBubble.vue'
import GroupChatControls from './GroupChatControls.vue'
import GroupChatBudgetBar from './GroupChatBudgetBar.vue'
import GroupReviewCheckpoint from './GroupReviewCheckpoint.vue'
import CasualChatView from './CasualChatView.vue'
import GroupChatList from './GroupChatList.vue'
import FriendList from './FriendList.vue'
import SidebarStrip from './SidebarStrip.vue'
import type { PanelType } from './SidebarStrip.vue'
import type { CreateGroupData } from './CreateGroupDialog.vue'
import type { ChatAgent } from '../types'

defineEmits<{ close: [] }>()

const store = useGroupChatStore()
const spaceStore = useSpaceStore()
const groupStore = useGroupStore()

const effectiveGroupMode = computed(() => spaceStore.groupChatMode)
const activePanel = ref<PanelType>(null)

watch(() => spaceStore.groupChatMode, (mode) => {
  store.setGroupMode(mode)
})

const { ensureInitialized, getProviderConfig, getToolContext } = useAgent()
const settingsStore = useSettingsStore()
const { shouldShowDivider, formatDividerTime } = useMessageTime()
const messagesRef = ref<HTMLDivElement>()

let coordinator: GroupChatCoordinator | null = null

const isLocal = computed(() => settingsStore.aiProviderMode === 'local')

const activeStreamingIds = computed(() => Object.keys(store.streamingAgents))

const waitingSpeakers = computed(() => {
  return store.currentSpeakerIds.filter(id => !store.streamingAgents[id])
})

const currentSpeakerName = computed(() => {
  if (store.currentSpeakerIds.length > 1) {
    return store.currentSpeakerIds.map(id => getSpeakerName(id)).join('、')
  }
  if (!store.currentSpeakerId) return ''
  return getSpeakerName(store.currentSpeakerId)
})

function getSpeakerName(agentId: string): string {
  const p = store.participants.find(p => p.id === agentId)
  return p?.name ?? ''
}

function getSpeakerColor(agentId: string): string {
  const p = store.participants.find(p => p.id === agentId)
  return p?.color ?? '#888'
}

function renderStreamingContent(agentId: string): string {
  const state = store.streamingAgents[agentId]
  if (!state) return ''
  return state.content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

function getStreamingToolCalls(agentId: string): ToolCallInfo[] {
  return store.streamingAgents[agentId]?.toolCalls ?? []
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
    mode: data.mode as GroupChatMode,
    createdAt: now,
    updatedAt: now,
  }

  store.setGroupInfo(groupInfo)
  store.setGroupMembers(members)
  store.setGroupMode(data.mode)
  spaceStore.setGroupChatMode(data.mode)

  groupStore.addGroup({
    id: groupId,
    name: data.name,
    avatar: '👥',
    mode: data.mode,
    lastMessage: '',
    lastMessageAt: now,
    unreadCount: 0,
    pinned: false,
    memberCount: members.length,
  })
  groupStore.setActiveGroup(groupId)

  if (data.mode === 'casual') {
    await saveCasualGroupSession({
      info: groupInfo,
      members,
      messages: [],
      desireConfig: { threshold: 0.4, mentionBoost: 0.5, roleRelevanceWeight: 0.3, recentActivityDecay: 0.1 },
      costTracker: { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, perAgentCost: {}, remainingBudget: 0, budgetPercentUsed: 0 },
    })
  }
}

async function onSelectGroup(payload: { id: string; mode: GroupChatMode }): Promise<void> {
  store.setGroupMode(payload.mode)

  // meeting 模式恢复：从列表点进旧会话（loadSession 已填 store，state='completed'），
  // 重建 coordinator 并 start——createOrAttach 会按持久化映射 attach 复用既有 Rust 会话（历史上下文延续），
  // 实现「可继续发言」。casual 模式由 CasualChatView 惰性 ensureEngine（已传 groupInfo.id）覆盖。
  if (payload.mode === 'meeting' && store.state === 'completed' && store.currentSessionId && store.participants.length > 0) {
    const ok = await ensureInitialized()
    if (!ok) return
    const providerConfig = getProviderConfig()
    const toolContext = getToolContext()
    if (!providerConfig || !toolContext) return

    coordinator?.dispose()
    coordinator = new GroupChatCoordinator(
      { maxRounds: store.config.maxRounds, parallelCount: store.config.parallelCount, autoDegradation: store.config.autoDegradation },
      { maxCostUsd: store.budget.maxCostUsd },
    )
    coordinator.onRoundEnd = () => { saveCurrentSession() }
    coordinator.onComplete = () => { saveCurrentSession() }
    // groupId 由 coordinator 内部从 store.currentSessionId 取（createOrAttach 持久化映射）
    await coordinator.start(store.topic, store.participants, providerConfig, toolContext)
  }
}

function onStripToggle(panel: PanelType): void {
  if (activePanel.value === panel) {
    activePanel.value = null
  } else {
    activePanel.value = panel
  }
}

function onFriendPrivateChat(_agent: ChatAgent): void {
  // 会议模式下暂不支持私聊，后续可扩展
}

async function onStart(config: {
  topic: string
  participants: Array<{ name: string; role: string; color: string; modelId: string }>
  maxRounds: number
  maxCostUsd: number
  parallelCount: number
  autoDegradation: boolean
}): Promise<void> {
  const ok = await ensureInitialized()
  if (!ok) return

  store.reset()
  store.topic = config.topic
  store.config.maxRounds = config.maxRounds
  store.budget.maxCostUsd = config.maxCostUsd
  store.config.parallelCount = config.parallelCount
  store.config.autoDegradation = config.autoDegradation

  const participantList = config.participants.map((p, i) => ({
    id: `agent-${i}`,
    name: p.name,
    avatar: p.name[0],
    color: p.color,
    role: p.role,
    systemPrompt: '',
    modelId: p.modelId,
    speakCount: 0,
    lastSpokeAt: 0,
  }))
  store.setParticipants(participantList)

  coordinator = new GroupChatCoordinator(
    { maxRounds: config.maxRounds, parallelCount: config.parallelCount, autoDegradation: config.autoDegradation },
    { maxCostUsd: config.maxCostUsd },
  )

  const providerConfig = getProviderConfig()
  const toolContext = getToolContext()

  if (!providerConfig || !toolContext) return

  const session = await createGroupSession(
    config.topic,
    participantList.map(p => ({ ...p })),
    { ...store.config },
    { ...store.budget },
  )
  store.currentSessionId = session.id

  coordinator.onRoundEnd = () => { saveCurrentSession() }
  coordinator.onComplete = () => { saveCurrentSession() }

  await coordinator.start(
    config.topic,
    participantList,
    providerConfig,
    toolContext,
  )
}

function pauseChat(): void { coordinator?.pause() }
function resumeChat(): void { coordinator?.resume() }

function onTerminate(): void {
  coordinator?.terminate()
}

function onInject(text: string): void {
  coordinator?.injectMessage(text)
}

function onReviewContinue(): void {
  store.setReviewPending(false)
  coordinator?.resumeReview()
}

function onReviewAdjust(direction: string): void {
  store.setReviewPending(false)
  coordinator?.resumeReview(direction)
}

function scrollToBottom(): void {
  const el = messagesRef.value
  if (el) el.scrollTop = el.scrollHeight
}

let scrollTimer: ReturnType<typeof setTimeout> | null = null

watch(() => store.messages.length, () => {
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => nextTick(scrollToBottom), 50)
})

watch(() => store.currentSpeakerIds.length, () => {
  nextTick(scrollToBottom)
})

watch(() => store.streamingAgents, () => {
  nextTick(scrollToBottom)
}, { deep: true })

async function saveCurrentSession(): Promise<void> {
  if (!store.currentSessionId) return
  const existing = await getGroupSession(store.currentSessionId)
  await saveGroupSession({
    id: store.currentSessionId,
    name: store.topic,
    topic: store.topic,
    participants: store.participants,
    messages: store.messages,
    config: store.config,
    budget: store.budget,
    costTracker: store.costTracker,
    state: store.state as any,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: '',
    currentRound: store.currentRound,
    startedAt: existing?.startedAt ?? (store.state === 'running' || store.state === 'paused' ? Date.now() : null),
  })
}

async function onNewGroupChat(): Promise<void> {
  await saveCurrentSession()
  coordinator?.dispose()
  coordinator = null
  store.reset()
}

onBeforeUnmount(() => {
  coordinator?.dispose()
  coordinator = null
})
</script>

<style scoped>
.group-chat-layout { display: flex; height: 100%; }

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

.group-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.group-chat-view { display: flex; flex-direction: column; height: 100%; }

.chat-header { padding: 8px 16px; border-bottom: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between; }
.header-left { display: flex; align-items: center; gap: 12px; }
.topic-label { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text); }
.parallel-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(108, 92, 231, 0.12); color: var(--color-primary); font-weight: 600; }

.chat-messages { flex: 1; overflow-y: auto; padding: 8px 0; }
.time-divider { display: flex; align-items: center; padding: 8px 16px; }
.time-divider::before, .time-divider::after { content: ''; flex: 1; height: 1px; background: var(--color-border); }
.divider-text { font-size: var(--font-size-2xs); color: var(--color-text-tertiary); padding: 0 12px; white-space: nowrap; }

.streaming-hint { padding: 8px 16px; font-size: var(--font-size-xs); color: var(--color-text-tertiary); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.hint-sep { color: var(--color-text-tertiary); }
.streaming-dot { color: var(--color-primary); animation: pulse 1.5s infinite; }

@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }

.streaming-msg { padding: 8px 16px; display: flex; flex-direction: column; gap: 4px; }
.streaming-msg .msg-speaker { display: flex; align-items: center; gap: 8px; }
.streaming-msg .speaker-avatar { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
.streaming-msg .avatar-letter { color: white; font-weight: 700; font-size: var(--font-size-sm); }
.streaming-msg .speaker-name { font-size: var(--font-size-sm); font-weight: 600; color: var(--speaker-color); }
.degraded-tag { font-size: 10px; padding: 1px 5px; border-radius: 3px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 600; }
.streaming-msg .msg-body { margin-left: 36px; padding: 8px 12px; border-radius: 0 12px 12px 12px; background: var(--color-surface-elevated); border-left: 3px solid var(--color-border); max-width: 85%; }
.streaming-msg .msg-text { font-size: var(--font-size-sm); line-height: 1.6; color: var(--color-text); }
.streaming-cursor { color: var(--color-primary); animation: pulse 1s infinite; font-size: 10px; margin-left: 2px; }

/* Layer 1: 流式工具调用状态指示器 */
.streaming-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.streaming-tool-tag {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 4px; font-size: 11px;
  background: var(--color-surface); border: 1px solid var(--color-border);
  color: var(--color-text-secondary); transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s, opacity 0.2s, filter 0.2s;
}
.streaming-tool-tag.running { border-color: var(--color-primary); color: var(--color-primary); }
.streaming-tool-tag.completed { border-color: rgba(16, 185, 129, 0.3); color: #10b981; }
.streaming-tool-tag.failed { border-color: rgba(239, 68, 68, 0.3); color: #ef4444; }
.tc-spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.header-actions { display: flex; gap: 6px; }
.action-btn { padding: 3px 10px; border: 1px solid var(--color-border); border-radius: 6px; font-size: var(--font-size-2xs); cursor: pointer; background: var(--color-surface-elevated); color: var(--color-text); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.new-btn { border-color: var(--color-primary); color: var(--color-primary); }
.new-btn:hover { background: var(--color-primary); color: white; }

.state-tag { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
.completed-tag { background: rgba(16, 185, 129, 0.12); color: #10b981; }
.terminated-tag { background: rgba(239, 68, 68, 0.12); color: #ef4444; }

.empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--color-text-tertiary); }
.empty-icon { font-size: 48px; opacity: 0.4; }
.empty-text { font-size: 14px; }
</style>