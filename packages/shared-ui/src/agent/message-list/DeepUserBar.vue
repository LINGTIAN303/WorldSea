<template>
  <!-- 深度模式：右下角用户消息列表，点击可跳转到对应助手回复 -->
  <Transition name="deep-user-bar">
    <div v-if="visible" class="deep-user-bar">
      <div class="deep-user-bar-header">
        <span class="deep-user-bar-label">对话</span>
        <span class="deep-user-bar-count">{{ deepUserMessages.length }}</span>
      </div>
      <div class="deep-user-bar-list">
        <div
          v-for="um in deepUserMessages"
          :key="um.id"
          class="deep-user-bar-item"
          :class="{ active: isDeepUserMsgActive(um.id) }"
          @click="emit('scroll-to-message', um.id)"
        >
          <span class="deep-user-bar-dot"></span>
          <span class="deep-user-bar-text">{{ truncateText(um.content, 40) }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import type { AgentMessage } from '@worldsmith/agent-runtime'
import { findAssistantAfterUserMsg, truncateText } from './utils'

const props = defineProps<{
  /** 是否显示（深度模式且有用户消息时） */
  visible: boolean
  /** 完整消息列表（用于查找用户消息对应的助手回复） */
  messages: AgentMessage[]
  /** 深度模式下的用户消息 */
  deepUserMessages: AgentMessage[]
  /** 当前视口内可见的消息 ID 集合 */
  visibleMsgIds: Set<string>
}>()

const emit = defineEmits<{
  'scroll-to-message': [id: string]
}>()

/** 深度模式下：用户消息项是否高亮（当对应的助手回复在视口中时） */
function isDeepUserMsgActive(userMsgId: string): boolean {
  const assistantId = findAssistantAfterUserMsg(props.messages, userMsgId)
  return assistantId !== null && props.visibleMsgIds.has(assistantId)
}
</script>

<style scoped>
/* 深度模式：右下角用户消息列表 */
.deep-user-bar {
  position: absolute;
  right: 16px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid color-mix(in srgb, var(--agent-primary) 15%, transparent);
  border-radius: 12px;
  max-width: 260px;
  max-height: 240px;
  z-index: 10;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.deep-user-bar-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--agent-primary) 10%, transparent);
}

.deep-user-bar-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--agent-primary);
}

.deep-user-bar-count {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--agent-primary) 12%, transparent);
  color: var(--agent-primary);
}

.deep-user-bar-list {
  overflow-y: auto;
  scrollbar-width: none;
  max-height: 200px;
}

.deep-user-bar-list::-webkit-scrollbar {
  display: none;
}

.deep-user-bar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.deep-user-bar-item:hover {
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
}

.deep-user-bar-item.active {
  background: color-mix(in srgb, var(--agent-primary) 12%, transparent);
}

.deep-user-bar-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.deep-user-bar-item.active .deep-user-bar-dot {
  background: var(--agent-primary);
}

.deep-user-bar-text {
  font-size: 12px;
  color: var(--agent-text-secondary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deep-user-bar-enter-active,
.deep-user-bar-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.deep-user-bar-enter-from,
.deep-user-bar-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
