<template>
  <div class="space-chat agent-panel">
    <template v-if="spaceStore.mode === 'chat'">
      <div v-if="isRustBackend" class="rust-mode-banner">
        Rust 模式：深度模式/长任务/A2UI/编排状态栏/终端/子 Agent 均已支持
      </div>
      <div class="chat-messages">
        <AgentMessageList
          ref="messageListRef"
          :messages="messages"
          :is-streaming="isStreaming"
          :last-assistant-has-content="lastAssistantHasContent"
          :last-assistant-has-thinking="lastAssistantHasThinking"
          :a2ui-surfaces="a2uiSurfaces"
          :resolve-data-binding="resolveDataBinding"
          :chat-mode="spaceStore.chatMode"
          @a2ui-action="onA2UIAction"
          @copy="copyMessage"
          @retry="retryMessage"
          @block-action="onBlockAction"
        />
      </div>
      <ChatInput @send="onInputSend" />
    </template>
    <GroupChatView v-else @close="spaceStore.setMode('chat')" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, computed } from 'vue'
import ChatInput from './ChatInput.vue'
import AgentMessageList from '../../agent/AgentMessageList.vue'
import GroupChatView from '../group-chat/components/GroupChatView.vue'
import { useAgent } from '../../agent/composables/useAgent'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSpaceStore } from '../stores/space-store'
import { useFileStore } from '@worldsmith/entity-core'
import type { ImageAttachment, FileAttachment } from '@agent/index'

const spaceStore = useSpaceStore()
const settingsStore = useSettingsStore()
const isRustBackend = computed(() => settingsStore.agentBackend === 'rust')
const {
  messages, isStreaming, sendMessage, sendBlockAction,
  lastAssistantHasContent, lastAssistantHasThinking,
  a2uiSurfaces, resolveDataBinding,
} = useAgent()

const messageListRef = ref<InstanceType<typeof AgentMessageList>>()

function copyMessage(msg: { content?: string }): void {
  navigator.clipboard.writeText(msg.content || '').catch(() => {})
}

async function retryMessage(msg: { content?: string }): Promise<void> {
  if (isStreaming.value) return
  await sendMessage(msg.content || '')
  await nextTick()
  messageListRef.value?.scrollToBottom()
}

function onA2UIAction(surfaceId: string, action: { name: string; data?: any }): void {
  const dataStr = action.data ? JSON.stringify(action.data) : ''
  const steerText = dataStr
    ? `[A2UI Action] surface=${surfaceId} action=${action.name} data=${dataStr}`
    : `[A2UI Action] surface=${surfaceId} action=${action.name}`
  void sendBlockAction(steerText, action.name)
}

function onBlockAction(event: { blockId: string; action: string; data?: Record<string, unknown> }): void {
  const dataStr = event.data ? JSON.stringify(event.data) : ''
  const steerText = dataStr
    ? `[Block Action] block=${event.blockId} action=${event.action} data=${dataStr}`
    : `[Block Action] block=${event.blockId} action=${event.action}`
  const displayText = formatBlockActionDisplay(event)
  void sendBlockAction(steerText, displayText)
}

function formatBlockActionDisplay(event: { blockId: string; action: string; data?: Record<string, unknown> }): string {
  if (event.action === 'choice_select' && event.data) {
    const mode = event.data.mode as string
    if (mode === 'multi' && event.data.labels) {
      return `选择了: ${(event.data.labels as string[]).join(', ')}`
    }
    if (mode === 'multi' && event.data.values) {
      return `选择了: ${(event.data.values as string[]).join(', ')}`
    }
    const displayVal = (event.data.label as string) || (event.data.value as string) || ''
    return `选择了: ${displayVal}`
  }
  return event.action
}

async function onInputSend(text: string, rawAttachments: any[]): Promise<void> {
  if (isStreaming.value) return

  const images: ImageAttachment[] = []
  const files: FileAttachment[] = []
  const fileStore = useFileStore()

  for (const att of rawAttachments) {
    if (att.type === 'image') {
      images.push({ data: att.data, mimeType: att.mimeType })
    } else if (att.textContent !== undefined) {
      const path = `/uploads/${att.name}`
      const content = att.textContent
      const size = new Blob([content]).size
      try {
        await fileStore.add(att.name, path, att.mimeType || 'text/plain', size, content)
      } catch (err) {
        console.warn('[SpaceChat] fileStore.add failed:', err)
      }
      files.push({ name: att.name, content })
    }
  }

  const finalText = text || (images.length ? '请描述这张图片' : '')
  await sendMessage(
    finalText,
    images.length ? images : undefined,
    files.length ? files : undefined,
    spaceStore.chatMode,
  )
  await nextTick()
  messageListRef.value?.scrollToBottom()
}
</script>

<style scoped>
.space-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}

.chat-messages {
  flex: 1;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Rust 实验模式提示横幅 */
.rust-mode-banner {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--ws-text-secondary, #888);
  background: var(--ws-bg-secondary, rgba(255, 200, 100, 0.08));
  border-bottom: 1px solid var(--ws-border-light, rgba(255, 200, 100, 0.2));
  text-align: center;
  flex-shrink: 0;
}
</style>
