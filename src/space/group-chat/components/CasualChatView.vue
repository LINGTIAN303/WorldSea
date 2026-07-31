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

      <!-- 流式消息列表（Layer 1: 工具调用状态 + 流式文本） -->
      <StreamingMessageList />

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

    <!-- 右键菜单（Teleport 到 body） -->
    <ContextMenu
      :context-menu="contextMenu"
      @reply="onContextReply"
      @copy="onContextCopy"
    />

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
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useGroupChatStore } from '../GroupChatStore'
import type { GroupMember, GroupChatMode, ChatAgent } from '../types'
import type { CreateGroupData } from './CreateGroupDialog.vue'
import { useMessageTime } from '../composables/useMessageTime'
import { useCasualChatEngine } from '../composables/useCasualChatEngine'
import { useStreamingMessages } from '../composables/useStreamingMessages'
import { useCasualContextMenu } from '../composables/useCasualContextMenu'
import { useMessageScroll } from '../composables/useMessageScroll'
import CasualMessageBubble from './CasualMessageBubble.vue'
import CasualInputBar from './CasualInputBar.vue'
import GroupInfoPanel from './GroupInfoPanel.vue'
import GroupChatList from './GroupChatList.vue'
import FriendList from './FriendList.vue'
import SidebarStrip from './SidebarStrip.vue'
import type { PanelType } from './SidebarStrip.vue'
import AgentPrivateChat from './AgentPrivateChat.vue'
import WsIcon from '../../../ui/WsIcon.vue'
import StreamingMessageList from './casual/StreamingMessageList.vue'
import ContextMenu from './casual/ContextMenu.vue'

const store = useGroupChatStore()
const { shouldShowDivider, formatDividerTime } = useMessageTime()

// UI 状态
const showInfoPanel = ref(false)
const activePanel = ref<PanelType>(null)
const privateChatAgent = ref<GroupMember | null>(null)
const replyTarget = ref<{ messageId: string; name: string; text: string } | null>(null)
const mentionQuery = ref<string | null>(null)
const pendingMentions = ref<string[]>([])
const inputBarRef = ref<InstanceType<typeof CasualInputBar>>()
const imageInputRef = ref<HTMLInputElement>()
const fileInputRef = ref<HTMLInputElement>()

// 核心引擎逻辑（注入 replyTarget 清理回调）
const engine = useCasualChatEngine({
  onProactiveSpeakComplete: () => { replyTarget.value = null },
})
const { isSending } = engine

// 流式消息显示（typingAgentNames 用于输入提示，其余由 StreamingMessageList 子组件消费）
const { typingAgentNames } = useStreamingMessages()

// 右键菜单（注入 setReplyTarget 回调）
const { contextMenu, onMsgContextMenu, onContextReply, onContextCopy } = useCasualContextMenu({
  setReplyTarget: (target) => { replyTarget.value = target },
})

// 消息列表滚动
const { messagesRef, isAtBottom, scrollToBottom, onMessagesScroll } = useMessageScroll()

const onlineCount = computed(() => store.onlineAgentIds.size)

// 群信息变化时清理旧引擎状态
watch(() => store.groupInfo?.id, (newId, oldId) => {
  engine.handleGroupInfoChange(newId, oldId)
})

/** 发送消息：调用引擎 + 完成后聚焦输入框 */
async function onSend(text: string): Promise<void> {
  await engine.onSend(text, pendingMentions.value, replyTarget.value)
  inputBarRef.value?.focusInput()
}

function onAttachImage(): void {
  imageInputRef.value?.click()
}

function onAttachFile(): void {
  fileInputRef.value?.click()
}

/** 图片选择事件：转发给引擎处理 */
function onImageSelected(e: Event): void {
  engine.onImageSelected(e)
}

/** 文件选择事件：转发给引擎处理 */
function onFileSelected(e: Event): void {
  engine.onFileSelected(e)
}

/** 禁言动作：转发给引擎处理 */
function onMuteAction(memberId: string, muted: boolean, duration: number | null): void {
  engine.onMuteAction(memberId, muted, duration)
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

function onPrivateChat(memberId: string): void {
  showInfoPanel.value = false
  const member = store.groupMembers.find(m => m.id === memberId)
  if (!member) return
  privateChatAgent.value = member
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
  await engine.onSelectGroup(payload)
  activePanel.value = null
}

async function onCreateGroup(data: CreateGroupData): Promise<void> {
  await engine.onCreateGroup(data)
  activePanel.value = null
}

async function onDissolveGroup(): Promise<void> {
  await engine.onDissolveGroup()
  showInfoPanel.value = false
}

/** 判断消息是否与上一条分组（同一发言人连续消息） */
function isMsgGrouped(idx: number): boolean {
  if (idx === 0) return false
  const cur = store.casualMessages[idx]
  const prev = store.casualMessages[idx - 1]
  return cur.speakerId === prev.speakerId && cur.role === prev.role && cur.role !== 'system'
}

// 组件卸载：清理引擎资源（右键菜单的全局监听已在 composable 内部处理）
onBeforeUnmount(() => {
  engine.dispose()
})
</script>

<style scoped>
.casual-chat-view { display: flex; height: 100%; position: relative; }

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
