<template>
  <Transition name="ws-slide-up">
    <div
      v-if="agent.visible"
      class="sub-agent-panel"
      :style="{ height: panelHeight + 'px' }"
    >
      <div class="panel-header" @mousedown.prevent="startResize">
        <span class="panel-icon">{{ agent.icon }}</span>
        <span class="panel-name">{{ agent.name }}</span>
        <span class="panel-status" :class="statusClass">{{ statusText }}</span>
        <div class="panel-actions">
          <button class="panel-btn" @click.stop="toggleVisible" aria-label="最小化" title="最小化">─</button>
          <button class="panel-btn" @click.stop="remove" aria-label="关闭" title="关闭">✕</button>
        </div>
      </div>
      <div class="panel-body" ref="bodyRef">
        <div class="message-list">
          <div
            v-for="(msg, i) in agent.messages"
            :key="i"
            class="message-item"
            :class="msg.role"
          >
            <span class="msg-role"><WsIcon :name="msg.role === 'user' ? 'character' : 'profile'" size="xs" /></span>
            <span class="msg-content">{{ msg.content || msg.text || JSON.stringify(msg) }}</span>
          </div>
          <div v-if="agent.status === 'running'" class="message-item assistant">
            <span class="msg-role"><WsIcon name="profile" size="xs" /></span>
            <span class="msg-content typing">思考中...</span>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import WsIcon from '../ui/WsIcon.vue'
import type { SubAgentState } from './composables/useOrchestrator'

const props = defineProps<{
  agent: SubAgentState
}>()

const emit = defineEmits<{
  (e: 'toggle-visible', id: string): void
  (e: 'remove', id: string): void
}>()

const panelHeight = ref(200)
let resizing = false
let startY = 0
let startHeight = 0

const statusClass = computed(() => {
  const map: Record<string, string> = {
    pending: 'status-pending',
    running: 'status-running',
    completed: 'status-completed',
    failed: 'status-failed',
    timeout: 'status-timeout',
    cancelled: 'status-cancelled',
  }
  return map[props.agent.status] || ''
})

const statusText = computed(() => {
  const map: Record<string, string> = {
    pending: '等待中',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    timeout: '超时',
    cancelled: '已取消',
  }
  return map[props.agent.status] || props.agent.status
})

function toggleVisible() {
  emit('toggle-visible', props.agent.id)
}

function remove() {
  emit('remove', props.agent.id)
}

function startResize(e: MouseEvent) {
  resizing = true
  startY = e.clientY
  startHeight = panelHeight.value
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

function onResize(e: MouseEvent) {
  if (!resizing) return
  const delta = startY - e.clientY
  panelHeight.value = Math.max(100, Math.min(600, startHeight + delta))
}

function stopResize() {
  resizing = false
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
}

onBeforeUnmount(() => {
  if (resizing) stopResize()
})
</script>

<style scoped>
.sub-agent-panel {
  border-top: 1px solid var(--border, #2a2a3a);
  background: var(--bg2, #12121a);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg3, #1a1a28);
  cursor: ns-resize;
  user-select: none;
  border-bottom: 1px solid var(--border, #2a2a3a);
  font-size: 0.8rem;
}

.panel-icon { font-size: var(--font-size-base); }
.panel-name { font-weight: var(--font-weight-semibold); color: var(--text, #e0e0e8); }
.panel-status {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: auto;
}
.status-pending { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
.status-running { background: rgba(99,102,241,0.15); color: #6366f1; animation: ws-pulse 1.5s infinite; }
.status-completed { background: rgba(16,185,129,0.15); color: #10b981; }
.status-failed { background: rgba(239,68,68,0.15); color: #ef4444; }
.status-timeout { background: rgba(245,158,11,0.15); color: #f59e0b; }
.status-cancelled { background: color-mix(in srgb, var(--color-text-tertiary) 15%, transparent); color: var(--color-text-tertiary); }



.panel-actions { display: flex; gap: 4px; margin-left: 8px; }
.panel-btn {
  background: none;
  border: none;
  color: var(--text2, #8888a0);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 2px 4px;
  border-radius: 3px;
}
.panel-btn:hover { background: var(--bg, #0a0a0f); color: var(--text, #e0e0e8); }

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-item {
  display: flex;
  gap: 6px;
  font-size: 0.75rem;
  line-height: 1.5;
}
.msg-role { flex-shrink: 0; }
.msg-content {
  color: var(--text2, #8888a0);
  white-space: pre-wrap;
  word-break: break-word;
}
.message-item.user .msg-content { color: var(--text, #e0e0e8); }
.message-item.assistant .msg-content { color: var(--text2, #8888a0); }
.typing { animation: ws-pulse 1.5s infinite; }


</style>
