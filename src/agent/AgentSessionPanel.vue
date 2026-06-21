<template>
  <Transition name="ws-slide-up">
    <div
      v-if="show"
      class="session-panel agent-panel"
      :style="panelStyle"
      @mousedown.left="onPanelMouseDown"
    >
      <div class="sp-header" @mousedown.left="onDragStart">
        <span><WsIcon name="manuscript" size="xs" /> 会话管理</span>
        <button @click="$emit('close')">✕</button>
      </div>
      <div class="sp-body">
        <div v-if="showRemind" class="sp-remind">
          <span>{{ remindMessage }}</span>
          <button @click="dismissRemind">✕</button>
        </div>
        <button class="sp-new" @click="onNewSession">+ 新建会话</button>
        <div
          v-for="s in sessions"
          :key="s.id"
          class="sp-item"
          :class="{ active: s.id === currentSessionId, deleting: confirmingDeleteId === s.id }"
          @click="onSwitchSession(s.id)"
        >
          <span class="sp-dot">{{ s.id === currentSessionId ? '●' : '○' }}</span>
          <span class="sp-name">{{ s.name }}</span>
          <button class="sp-pin" :class="{ pinned: s.pinned }" @click.stop="s.pinned ? onUnpin(s.id) : onPin(s.id)">
            <WsIcon :name="s.pinned ? 'star' : 'star-outline'" size="xs" />
          </button>
          <template v-if="confirmingDeleteId === s.id">
            <button class="sp-confirm-btn sp-confirm-yes" @click.stop="onConfirmDelete(s.id)">确认</button>
            <button class="sp-confirm-btn sp-confirm-no" @click.stop="cancelDelete">取消</button>
          </template>
          <button v-else class="sp-delete" @click.stop="onRequestDelete(s.id)"><WsIcon name="delete" size="xs" /></button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import WsIcon from '../ui/WsIcon.vue'
import { listSessions, deleteSession, pinSession, unpinSession } from '@agent/index'
import type { AgentSession } from '@agent/index'
import { useAgent } from './composables/useAgent'
import { useSessionCleanup } from '@worldsmith/entity-core/composables'

const props = defineProps<{ show: boolean; currentSessionId: string | null }>()
const emit = defineEmits<{ close: []; switch: [sessionId: string] }>()

const sessions = ref<AgentSession[]>([])
const confirmingDeleteId = ref<string | null>(null)
const { newSession } = useAgent()

const {
  state: sessionState,
  showRemind,
  remindMessage,
  checkAndRemind,
  enforceLimit,
  requestUnpin,
  dismissRemind,
  SESSION_LIMIT,
} = useSessionCleanup()

const panelX = ref(window.innerWidth - 340)
const panelY = ref(window.innerHeight - 460)
let dragState: { startX: number; startY: number; origX: number; origY: number } | null = null

const panelStyle = ref({
  left: `${panelX.value}px`,
  top: `${panelY.value}px`,
})

async function loadSessions(): Promise<void> {
  sessions.value = await listSessions()
  await checkAndRemind()
}

async function onNewSession(): Promise<void> {
  await enforceLimit()
  await newSession()
  await loadSessions()
  emit('close')
}

function onSwitchSession(id: string): void {
  emit('switch', id)
}

function onRequestDelete(id: string): void {
  confirmingDeleteId.value = id
}

function cancelDelete(): void {
  confirmingDeleteId.value = null
}

async function onConfirmDelete(id: string): Promise<void> {
  confirmingDeleteId.value = null
  // H6.2: 删除会话前归档该会话（避免数据丢失）
  try {
    const { useMemoryArchive } = await import('@/memory-archive/useMemoryArchive')
    await useMemoryArchive().archiveSession(id)
  } catch (err) {
    console.warn('[AgentSessionPanel] 删除前归档失败（不影响删除）:', err)
  }
  const isCurrent = id === props.currentSessionId
  await deleteSession(id)
  await loadSessions()
  if (isCurrent) {
    await newSession()
    await loadSessions()
  }
}

async function onPin(id: string): Promise<void> {
  await pinSession(id)
  await loadSessions()
}

async function onUnpin(id: string): Promise<boolean> {
  const ok = await requestUnpin(id)
  if (ok) await loadSessions()
  return ok
}

function onPanelMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (target.closest('.sp-header') || target.closest('.sp-body')) return
}

function onDragStart(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('button')) return
  dragState = { startX: e.clientX, startY: e.clientY, origX: panelX.value, origY: panelY.value }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
  e.preventDefault()
}

function onDragMove(e: MouseEvent): void {
  if (!dragState) return
  const dx = e.clientX - dragState.startX
  const dy = e.clientY - dragState.startY
  panelX.value = Math.max(0, Math.min(window.innerWidth - 100, dragState.origX + dx))
  panelY.value = Math.max(0, Math.min(window.innerHeight - 60, dragState.origY + dy))
  panelStyle.value = { left: `${panelX.value}px`, top: `${panelY.value}px` }
}

function onDragEnd(): void {
  dragState = null
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

onMounted(loadSessions)
</script>

<style scoped>
.session-panel {
  position: fixed;
  width: 300px;
  max-height: 400px;
  background: var(--agent-bg, rgba(26, 26, 46, 0.92));
  backdrop-filter: blur(var(--agent-blur, 16px));
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  border-radius: var(--agent-radius, 14px);
  box-shadow: var(--agent-shadow, 0 4px 16px rgba(0,0,0,0.3));
  z-index: 10001;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--agent-border-color, rgba(58, 58, 106, 0.3));
  font-size: var(--font-size-base);
  color: var(--agent-text, #e0e0e0);
  cursor: grab;
  user-select: none;
}
.sp-header:active { cursor: grabbing }
.sp-header button {
  background: none;
  border: none;
  color: var(--agent-text-secondary, #888);
  cursor: pointer;
  font-size: var(--font-size-base);
}
.sp-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.sp-new {
  width: 100%;
  padding: 8px;
  border: 1px dashed var(--agent-border-color, #444);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--agent-text, #e0e0e0);
  cursor: pointer;
  font-size: var(--font-size-sm);
  margin-bottom: 8px;
}
.sp-new:hover {
  border-color: var(--agent-primary, #6c5ce7);
}
.sp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--agent-text, #e0e0e0);
  transition: background 0.1s;
}
.sp-item:hover {
  background: var(--agent-hover-bg, rgba(255,255,255,0.06));
}
.sp-item.active {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15));
}
.sp-item.deleting {
  background: color-mix(in srgb, var(--color-danger, #e74c3c) 10%, transparent);
}
.sp-dot { font-size: var(--text-micro-font-size); }
.sp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-delete {
  background: none;
  border: none;
  color: var(--agent-text-tertiary, #888);
  cursor: pointer;
  font-size: var(--font-size-sm);
  opacity: 0;
  transition: opacity 0.15s;
}
.sp-item:hover .sp-delete { opacity: 1 }
.sp-confirm-btn {
  background: none;
  border: 1px solid;
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  transition: opacity 0.15s;
}
.sp-confirm-yes {
  border-color: var(--color-danger, #e74c3c);
  color: var(--color-danger, #e74c3c);
}
.sp-confirm-yes:hover { background: color-mix(in srgb, var(--color-danger, #e74c3c) 15%, transparent) }
.sp-confirm-no {
  border-color: var(--agent-text-tertiary, #888);
  color: var(--agent-text-tertiary, #888);
}
.sp-confirm-no:hover { background: var(--agent-hover-bg, rgba(255,255,255,0.06)) }
.sp-pin {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-tertiary);
  padding: 2px;
  display: flex;
  align-items: center;
}
.sp-pin.pinned {
  color: var(--color-primary);
}
.sp-remind {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--color-primary-subtle);
  border-radius: var(--radius-md);
  font-size: var(--font-size-body-sm);
  color: var(--color-primary);
}
.sp-remind button {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-primary);
}

</style>
