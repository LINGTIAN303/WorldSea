<template>
  <div class="space-chat agent-panel">
    <template v-if="spaceStore.mode === 'chat'">
      <!-- 读屏直播区：告知 Agent 生成开始/完成（视觉隐藏，WCAG 4.1.3） -->
      <div class="sr-only" role="status" aria-live="polite">{{ srStatus }}</div>
      <div class="chat-messages" :aria-busy="isStreaming">
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
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import ChatInput from './ChatInput.vue'
import AgentMessageList from '@/agent/AgentMessageList.vue'
import { useAgent } from '@/agent/composables/useAgent'
import { useSpaceStore } from '../stores/space-store'
import { useFileStore } from '@worldsmith/entity-core'
import type { ImageAttachment, FileAttachment } from '@agent/index'

const spaceStore = useSpaceStore()
const {
  messages, isStreaming, sendMessage, steer,
  lastAssistantHasContent, lastAssistantHasThinking,
  a2uiSurfaces, resolveDataBinding,
} = useAgent()

// 读屏状态播报：生成开始/完成（视觉隐藏，仅 aria-live 播报）
const srStatus = ref('')
watch(isStreaming, (streaming, wasStreaming) => {
  if (streaming) srStatus.value = 'Agent 正在生成回复'
  else if (wasStreaming) srStatus.value = 'Agent 回复完成'
})

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
  void steer(steerText)
}

function onBlockAction(event: { blockId: string; action: string; data?: Record<string, unknown> }): void {
  const dataStr = event.data ? JSON.stringify(event.data) : ''
  const steerText = dataStr
    ? `[Block Action] block=${event.blockId} action=${event.action} data=${dataStr}`
    : `[Block Action] block=${event.blockId} action=${event.action}`
  void steer(steerText)
}

async function onInputSend(text: string, rawAttachments: any[], references?: { id: string; name: string; type: string }[]): Promise<void> {
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

  // 实体引用：构造结构化上下文块，携带 id/名称/类型供 Agent 读取实体
  const refsBlock = (references || []).length
    ? '\n' + references!.map((r) => `[世界设定引用 ${r.name}（${r.type}，id=${r.id}）]`).join('\n')
    : ''

  const finalText = (text || (images.length ? '请描述这张图片' : '')) + refsBlock
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
</style>
