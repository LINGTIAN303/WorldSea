<template>
  <Transition name="ws-drawer-right">
    <div v-if="visible" class="session-drawer">
      <div class="drawer-header">
        <span class="drawer-title">会话列表</span>
        <button class="drawer-new-btn" @click="emit('new-session')">＋ 新建</button>
      </div>
      <div class="drawer-list">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="session-item"
          :class="{ active: s.id === currentSessionId }"
          role="button"
          tabindex="0"
          @click="emit('select', s.id)"
          @keydown.enter="emit('select', s.id)"
          @keydown.space.prevent="emit('select', s.id)"
        >
          <div class="si-name">{{ s.name }}</div>
          <div class="si-meta">{{ formatTime(s.updatedAt) }}</div>
          <button class="si-delete" @click.stop="emit('delete', s.id)" title="删除"><WsIcon name="delete" size="xs" /></button>
        </div>
        <WsEmpty v-if="!sessions.length" preset="no-data" title="暂无会话" />
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'
import { WsEmpty } from '@worldsmith/ui-kit'

defineProps<{
  visible: boolean
  sessions: Array<{ id: string; name: string; updatedAt: string; modelId?: string }>
  currentSessionId: string | null
}>()

const emit = defineEmits<{
  close: []
  select: [sessionId: string]
  delete: [sessionId: string]
  'new-session': []
}>()

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  if (isToday) return `今天 ${time}`
  if (isYesterday) return `昨天 ${time}`
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
}
</script>

<style scoped>
.session-drawer {
  flex-shrink: 0;
  background: var(--agent-bg, rgba(26, 26, 46, 0.92));
  backdrop-filter: blur(var(--agent-blur, 16px));
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  max-height: 240px;
  overflow-y: auto;
  transform-origin: top;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
}

.drawer-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--agent-text-secondary, #888);
  font-family: var(--agent-font, sans-serif);
}

.drawer-new-btn {
  background: none;
  border: 1px dashed var(--agent-border-color, #444);
  border-radius: 4px;
  color: var(--agent-text, #e0e0e0);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  transition: border-color 0.15s;
}

.drawer-new-btn:hover {
  border-color: var(--agent-primary, #6c5ce7);
}

.drawer-list {
  padding: 4px 0;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.session-item:hover {
  background: var(--agent-hover-bg, rgba(255,255,255,0.06));
}

.session-item.active {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15));
}

.si-name {
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--agent-text, #e0e0e0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--agent-font, sans-serif);
}

.si-meta {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary, #666);
  flex-shrink: 0;
  font-family: var(--agent-font, sans-serif);
}

.si-delete {
  background: none;
  border: none;
  color: var(--agent-text-tertiary, #666);
  cursor: pointer;
  font-size: var(--font-size-sm);
  opacity: 0;
  transition: opacity 0.15s;
  padding: 0 2px;
}

.session-item:hover .si-delete {
  opacity: 1;
}

.si-delete:hover {
  color: var(--danger, #e74c3c);
}


</style>
