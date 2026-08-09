<template>
  <div class="review-checkpoint">
    <div class="review-header">
      <span class="review-icon"><WsIcon name="clipboard-list" size="xs" /></span>
      <span class="review-title">阶段性回顾（第 {{ round }} 轮）</span>
    </div>
    <div class="review-summary">
      <div v-for="msg in recentDecisions" :key="msg.id" class="review-item">
        <span class="review-dot confirmed"><WsIcon name="check" size="xs" /></span>
        <span>{{ msg.content.slice(0, 100) }}</span>
      </div>
      <div v-for="msg in uncertainItems" :key="msg.id" class="review-item">
        <span class="review-dot uncertain"><WsIcon name="alert" size="xs" /></span>
        <span>{{ msg.content.slice(0, 100) }}</span>
      </div>
    </div>
    <div v-if="showDirectionInput" class="direction-input-area">
      <textarea
        v-model="directionText"
        class="direction-input"
        placeholder="输入你希望讨论调整的方向..."
        rows="2"
        @keydown.enter.exact="onConfirmDirection"
      ></textarea>
      <div class="direction-actions">
        <button class="review-btn confirm-dir-btn" :disabled="!directionText.trim()" @click="onConfirmDirection()">确认方向</button>
        <button class="review-btn cancel-dir-btn" @click="showDirectionInput = false; directionText = ''">取消</button>
      </div>
    </div>
    <div v-else class="review-actions">
      <button class="review-btn continue-btn" @click="$emit('continue')">继续讨论</button>
      <button class="review-btn adjust-btn" @click="showDirectionInput = true">调整方向</button>
      <button class="review-btn stop-btn" @click="$emit('terminate')">终止讨论</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { AgentMessage } from '@agent/index'
import { hasUncertaintyMarkers } from '../HallucinationGuard'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  round: number
  messages: AgentMessage[]
}>()

const emit = defineEmits<{
  continue: []
  adjust: [direction: string]
  terminate: []
}>()

const showDirectionInput = ref(false)
const directionText = ref('')

const recentDecisions = computed(() =>
  props.messages
    .filter(m => m.role === 'assistant' && !hasUncertaintyMarkers(m.content ?? ''))
    .slice(-5)
)

const uncertainItems = computed(() =>
  props.messages
    .filter(m => m.role === 'assistant' && hasUncertaintyMarkers(m.content ?? ''))
    .slice(-3)
)

function onConfirmDirection(e?: KeyboardEvent) {
  if (e && e.shiftKey) return
  if (e) e.preventDefault()
  const text = directionText.value.trim()
  if (!text) return
  emit('adjust', text)
  directionText.value = ''
  showDirectionInput.value = false
}
</script>

<style scoped>
.review-checkpoint {
  padding: 16px;
  background: var(--color-surface-elevated);
  border-radius: 12px;
  margin: 12px 16px;
  border: 1px solid var(--color-border);
}

.review-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.review-icon {
  font-size: 18px;
}

.review-title {
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--color-text);
}

.review-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.review-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.review-dot {
  flex-shrink: 0;
}

.review-actions {
  display: flex;
  gap: 8px;
}

.review-btn {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.continue-btn {
  background: var(--color-primary);
  color: var(--on-accent);
  border-color: var(--color-primary);
}

.stop-btn {
  border-color: #ef4444;
  color: #ef4444;
}

.direction-input-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.direction-input {
  resize: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: var(--font-size-sm);
  font-family: inherit;
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
}

.direction-input:focus {
  border-color: var(--color-primary);
}

.direction-actions {
  display: flex;
  gap: 8px;
}

.confirm-dir-btn {
  background: var(--color-primary);
  color: var(--on-accent);
  border-color: var(--color-primary);
}

.confirm-dir-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cancel-dir-btn {
  border-color: var(--color-border);
}
</style>