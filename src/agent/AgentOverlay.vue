<template>
  <Teleport to="body">
    <div v-if="isVisible" class="agent-outer-wrap">
      <Transition name="ws-fade">
        <div
          class="agent-overlay agent-panel"
          :class="{ focused: isPinned }"
          @keydown.escape="hide"
        >
          <AgentChat />
          <AgentPreview :show="isVisible" />
          <AgentSessionPanel
            :show="sessionsOpen"
            :current-session-id="currentSessionId"
            @close="closeSessions"
            @switch="onSwitchSession"
          />
          <div v-if="initError" class="agent-init-error" @click="dismissInitError">
            <span><WsIcon name="warning" size="xs" /> {{ initError }}</span>
            <button class="error-close">✕</button>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import WsIcon from '../ui/WsIcon.vue'
import { useAgent } from './composables/useAgent'
import { useAgentCommands } from './composables/useAgentCommands'
import { useShortcuts } from '@worldsmith/ui-kit'
import AgentChat from './AgentChat.vue'
import AgentPreview from './AgentPreview.vue'
import AgentSessionPanel from './AgentSessionPanel.vue'

const { isVisible, show, hide, currentSessionId, switchSession, initError, clearInitError, isPinned, detectAndOfferResume } = useAgent()
const { sessionsOpen, closeSessions } = useAgentCommands()
const { register, unregister } = useShortcuts()

function onToggle(): void {
  if (isVisible.value) {
    hide()
  } else {
    show()
  }
}

function onSwitchSession(sessionId: string): void {
  switchSession(sessionId)
  closeSessions()
}

function dismissInitError(): void {
  clearInitError()
}

function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isVisible.value) {
    e.preventDefault()
    hide()
  }
}

function onPluginAction(): void {
  if (!isVisible.value) show()
}

onMounted(() => {
  // 任务 4 P2：应用启动时检测可恢复的未完成任务（刷新/崩溃后）
  detectAndOfferResume()
  register({
    id: 'agent.toggle',
    keys: ['f1'],
    description: '唤起/隐藏 AI 助手',
    scope: 'global',
    handler: onToggle,
    preventDefault: true,
  })
  document.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('worldsmith:agent:plugin-action', onPluginAction)
})

onBeforeUnmount(() => {
  unregister('agent.toggle')
  document.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('worldsmith:agent:plugin-action', onPluginAction)
})
</script>

<style scoped>
.agent-overlay {
  outline: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 9997;
  pointer-events: none;
}

.agent-outer-wrap {
  position: static;
}

.agent-overlay.focused {
  pointer-events: auto;
}



.agent-init-error {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 480px;
  padding: 10px 16px;
  background: rgba(231, 76, 60, 0.9);
  backdrop-filter: blur(12px);
  border-radius: 10px;
  color: #fff;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  z-index: 10002;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  animation: errorIn 0.25s ease;
}

@keyframes errorIn {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}



.error-close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: color-mix(in srgb, var(--color-text-inverse) 70%, transparent);
  cursor: pointer;
  font-size: var(--font-size-base);
}
</style>
