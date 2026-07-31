<template>
  <!-- 用户消息点状导航：点击/悬停可跳转并预览 -->
  <div class="dot-nav">
    <div
      v-for="um in userMessages"
      :key="um.id"
      class="dot-item"
      role="button"
      tabindex="0"
      @mouseenter="hoveredDot = um.id"
      @mouseleave="hoveredDot = ''"
      @click="emit('scroll-to-message', um.id)"
      @keydown.enter="emit('scroll-to-message', um.id)"
    >
      <div class="dot-point" :class="{ active: visibleMsgIds.has(um.id) }"></div>
      <Transition name="ws-fade">
        <div v-if="hoveredDot === um.id" class="dot-tooltip">
          {{ truncateText(um.content, 50) }}
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { AgentMessage } from '@agent/index'
import { truncateText } from './utils'

defineProps<{
  userMessages: AgentMessage[]
  visibleMsgIds: Set<string>
}>()

const emit = defineEmits<{
  'scroll-to-message': [id: string]
}>()

const hoveredDot = ref('')
</script>

<style scoped>
.dot-nav {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  flex-shrink: 0;
  overflow-y: auto;
  scrollbar-width: none;
  max-height: 60%;
  z-index: 5;
}

.dot-nav::-webkit-scrollbar {
  display: none;
}

.dot-item {
  position: relative;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.dot-point {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--agent-text-tertiary);
  transition: background 0.15s, transform 0.15s;
}

.dot-point.active {
  background: var(--agent-primary);
  transform: scale(1.3);
}

.dot-item:hover .dot-point {
  background: var(--agent-text-secondary);
  transform: scale(1.2);
}

.dot-tooltip {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--agent-bg);
  border: 1px solid var(--agent-border);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: var(--font-size-xs);
  color: var(--agent-text);
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  font-family: var(--agent-font);
}

.ws-fade-enter-active,
.ws-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.ws-fade-enter-from,
.ws-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
