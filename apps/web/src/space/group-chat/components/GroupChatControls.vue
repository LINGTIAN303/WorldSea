<template>
  <div class="chat-controls">
    <template v-if="isActive">
      <div class="controls-left">
        <span class="round-info">轮次 {{ currentRound }}/{{ maxRounds }}</span>
        <span v-if="currentSpeakerName" class="speaker-hint">
          {{ currentSpeakerName }} 发言中...
        </span>
      </div>
      <div class="controls-right">
        <button v-if="isRunning" class="ctrl-btn pause-btn" @click="$emit('pause')">
          <WsIcon name="pause" size="xs" /> 暂停
        </button>
        <button v-if="isPaused" class="ctrl-btn resume-btn" @click="$emit('resume')">
          <WsIcon name="play" size="xs" /> 继续
        </button>
        <button class="ctrl-btn stop-btn" @click="$emit('terminate')">
          <WsIcon name="square" size="xs" /> 终止
        </button>
        <button v-if="isRunning || isPaused" class="ctrl-btn inject-btn" @click="showInject = true">
          插话
        </button>
      </div>
      <Transition name="ws-fade">
        <div v-if="showInject" class="inject-area">
          <textarea
            v-model="injectText"
            class="inject-input"
            placeholder="输入你想说的话..."
            rows="2"
            @keydown.enter.exact="onInject"
          ></textarea>
          <button class="ctrl-btn send-btn" :disabled="!injectText.trim()" @click="onInject()">发送</button>
          <button class="ctrl-btn cancel-btn" @click="showInject = false; injectText = ''">取消</button>
        </div>
      </Transition>
    </template>
    <template v-else>
      <div class="controls-left">
        <span class="round-info">轮次 {{ currentRound }}/{{ maxRounds }}</span>
        <span class="ended-hint">讨论已结束</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

defineProps<{
  isRunning: boolean
  isPaused: boolean
  isActive: boolean
  currentRound: number
  maxRounds: number
  currentSpeakerName: string
}>()

const emit = defineEmits<{
  pause: []
  resume: []
  terminate: []
  inject: [text: string]
}>()

const showInject = ref(false)
const injectText = ref('')

function onInject(e?: KeyboardEvent) {
  if (e && e.shiftKey) return
  if (e) e.preventDefault()
  const text = injectText.value.trim()
  if (!text) return
  emit('inject', text)
  injectText.value = ''
  showInject.value = false
}
</script>

<style scoped>
.chat-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  flex-wrap: wrap;
  gap: 8px;
}

.controls-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.round-info {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  font-weight: 600;
}

.speaker-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.ended-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  font-style: italic;
}

.controls-right {
  display: flex;
  gap: 6px;
}

.ctrl-btn {
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: var(--font-size-xs);
  cursor: pointer;
  background: var(--color-surface-elevated);
  color: var(--color-text);
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.ctrl-btn:hover {
  background: var(--color-surface);
}

.stop-btn {
  border-color: #ef4444;
  color: #ef4444;
}

.stop-btn:hover {
  background: rgba(239, 68, 68, 0.1);
}

.inject-area {
  width: 100%;
  display: flex;
  gap: 6px;
  align-items: flex-end;
}

.inject-input {
  flex: 1;
  resize: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: var(--font-size-sm);
  font-family: inherit;
  background: var(--color-surface-elevated);
  color: var(--color-text);
  outline: none;
}

.send-btn {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.send-btn:disabled {
  opacity: 0.4;
}

.ws-fade-enter-active, .ws-fade-leave-active {
  transition: opacity 0.2s;
}
.ws-fade-enter-from, .ws-fade-leave-to {
  opacity: 0;
}
</style>
