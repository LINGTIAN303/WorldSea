<template>
  <div class="ai-assistant-renderer">
    <div class="aa-header">
      <span class="aa-icon"><WsIcon name="profile" size="md" /></span>
      <span class="aa-title">{{ config.title || 'AI 助手' }}</span>
    </div>
    <div class="aa-messages" ref="messagesRef">
      <div v-for="(msg, idx) in messages" :key="idx" class="aa-msg" :class="msg.role">
        <span class="aa-msg-role"><WsIcon :name="msg.role === 'user' ? 'character' : 'profile'" size="xs" /></span>
        <span class="aa-msg-text">{{ msg.content }}</span>
      </div>
      <div v-if="messages.length === 0" class="aa-empty">向 AI 助手提问</div>
    </div>
    <div class="aa-input-area">
      <input
        class="aa-input"
        v-model="inputText"
        placeholder="输入消息..."
        @keyup.enter="sendMessage"
      />
      <button class="aa-send" @click="sendMessage" :disabled="!inputText.trim()">发送</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onBeforeUnmount, inject } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const inputText = ref('')
const messagesRef = ref<HTMLDivElement>()

interface ChatMessage { role: 'user' | 'assistant'; content: string }
const messages = ref<ChatMessage[]>([])

function sendMessage() {
  const text = inputText.value.trim()
  if (!text) return
  messages.value.push({ role: 'user', content: text })
  inputText.value = ''
  ctx?.emit('ai:request', { componentId: props.componentId, prompt: text, messages: [...messages.value] })
  nextTick(() => {
    if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  })
}

function handleAiResponse(payload: unknown) {
  const p = payload as { componentId?: string; content: string }
  if (p.componentId && p.componentId !== props.componentId) return
  messages.value.push({ role: 'assistant', content: p.content })
  nextTick(() => {
    if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  })
}

ctx?.on('ai:response', handleAiResponse)

onBeforeUnmount(() => {
  ctx?.off('ai:response', handleAiResponse)
})
</script>

<style scoped>
.ai-assistant-renderer { display: flex; flex-direction: column; height: 100%; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; background: var(--bg); }
.aa-header { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); }
.aa-icon { font-size: var(--font-size-lg); }
.aa-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-color); }
.aa-messages { flex: 1; overflow-y: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
.aa-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); font-size: var(--font-size-sm); }
.aa-msg { display: flex; gap: 6px; font-size: var(--font-size-sm); }
.aa-msg.user { flex-direction: row-reverse; }
.aa-msg-role { font-size: var(--font-size-lg); flex-shrink: 0; }
.aa-msg-text { padding: 6px 10px; border-radius: 8px; max-width: 80%; word-break: break-word; }
.aa-msg.user .aa-msg-text { background: var(--primary); color: white; }
.aa-msg.assistant .aa-msg-text { background: var(--bg-secondary); color: var(--text-color); }
.aa-input-area { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--border-color); }
.aa-input { flex: 1; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: var(--font-size-sm); background: var(--bg); color: var(--text-color); outline: none; }
.aa-input:focus { border-color: var(--primary); }
.aa-send { padding: 6px 14px; background: var(--primary); color: white; border: none; border-radius: var(--radius-sm); font-size: var(--font-size-sm); cursor: pointer; }
.aa-send:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
