<template>
  <div class="session-sidebar">
    <div class="sidebar-header">
      <h3 class="sidebar-title">会话 <span class="title-count">{{ sessionCount }}</span></h3>
      <button class="new-session-btn" @click="onNewSession" title="新建会话">+</button>
      <button class="sidebar-close-btn" @click="emit('close')" title="关闭">✕</button>
    </div>

    <div class="sidebar-search">
      <input
        v-model="searchQuery"
        class="search-input"
        placeholder="搜索会话..."
      />
    </div>

    <div class="sidebar-body">
      <div v-if="loading" class="sidebar-empty">加载中...</div>
      <div v-else-if="filteredSessions.length === 0" class="sidebar-empty">
        {{ searchQuery ? '未找到匹配的会话' : '暂无会话' }}
      </div>

      <div v-if="pinnedSessions.length > 0" class="session-group">
        <div class="group-label">已固定</div>
        <div
          v-for="s in pinnedSessions"
          :key="s.id"
          class="session-item"
          :class="{ active: s.id === currentSessionId }"
          @click="onSelect(s.id)"
          @contextmenu.prevent="onContextMenu($event, s)"
        >
          <div v-if="renamingId === s.id" class="session-name">
            <input :ref="captureRenameInput" class="session-name-input" :value="s.name" @click.stop @keyup.enter="submitRename(s.id)" @keyup.esc="cancelRename" @blur="submitRename(s.id)" />
          </div>
          <div v-else class="session-name" @dblclick="startRename(s.id)">{{ s.name }}</div>
          <div class="session-meta">
            <span v-if="s.chatMode" class="session-mode-badge" :class="'mode-' + s.chatMode">{{ modeLabel(s.chatMode) }}</span>
            <span class="session-time">{{ formatTime(s.updatedAt) }}</span>
            <span class="session-count">{{ s.messages.length }} 条</span>
          </div>
        </div>
      </div>

      <div v-if="recentSessions.length > 0" class="session-group">
        <div class="group-label">{{ pinnedSessions.length > 0 ? '近期' : '' }}</div>
        <div
          v-for="s in recentSessions"
          :key="s.id"
          class="session-item"
          :class="{ active: s.id === currentSessionId }"
          @click="onSelect(s.id)"
          @contextmenu.prevent="onContextMenu($event, s)"
        >
          <div v-if="renamingId === s.id" class="session-name">
            <input :ref="captureRenameInput" class="session-name-input" :value="s.name" @click.stop @keyup.enter="submitRename(s.id)" @keyup.esc="cancelRename" @blur="submitRename(s.id)" />
          </div>
          <div v-else class="session-name" @dblclick="startRename(s.id)">{{ s.name }}</div>
          <div class="session-meta">
            <span v-if="s.chatMode" class="session-mode-badge" :class="'mode-' + s.chatMode">{{ modeLabel(s.chatMode) }}</span>
            <span class="session-time">{{ formatTime(s.updatedAt) }}</span>
            <span class="session-count">{{ s.messages.length }} 条</span>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="session-ctx-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click="contextMenu.visible = false"
      >
        <button class="ctx-item" @click="onRename">重命名</button>
        <button v-if="!contextMenu.pinned" class="ctx-item" @click="onPin">固定</button>
        <button v-else class="ctx-item" @click="onUnpin">取消固定</button>
        <button class="ctx-item ctx-danger" @click="onDelete">删除</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { listSessions, deleteSession, pinSession, unpinSession, renameSession, countSessions } from '@agent/session/manager'
import type { AgentSession } from '@agent/session/types'
import { useAgent } from '../../agent/composables/useAgent'

const emit = defineEmits<{ close: [] }>()

const { currentSessionId, newSession, switchSession } = useAgent()

const loading = ref(true)
const sessions = ref<AgentSession[]>([])
const searchQuery = ref('')
const sessionCount = ref(0)

const contextMenu = ref<{ visible: boolean; x: number; y: number; sessionId: string; pinned: boolean }>({
  visible: false, x: 0, y: 0, sessionId: '', pinned: false,
})

const filteredSessions = computed(() => {
  if (!searchQuery.value) return sessions.value
  const q = searchQuery.value.toLowerCase()
  return sessions.value.filter(s => s.name.toLowerCase().includes(q))
})

const pinnedSessions = computed(() => filteredSessions.value.filter(s => s.pinned))
const recentSessions = computed(() => filteredSessions.value.filter(s => !s.pinned))

async function refresh() {
  try {
    sessions.value = await listSessions()
    sessionCount.value = await countSessions()
  } catch {}
  loading.value = false
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return `今天 ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
}

function modeLabel(mode: string): string {
  const map: Record<string, string> = { normal: '快问', deep: '深度', explore: '探索' }
  return map[mode] || mode
}

async function onNewSession() {
  await newSession()
  await refresh()
}

async function onSelect(id: string) {
  if (id === currentSessionId.value) return
  await switchSession(id)
  await refresh()
}

function onContextMenu(e: MouseEvent, s: AgentSession) {
  const menuW = 160
  const menuH = 80
  const x = e.clientX + menuW > window.innerWidth ? e.clientX - menuW : e.clientX
  const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY
  contextMenu.value = {
    visible: true,
    x,
    y,
    sessionId: s.id,
    pinned: !!s.pinned,
  }
}

const renamingId = ref<string | null>(null)
const renameInputEl = ref<HTMLInputElement | null>(null)

function captureRenameInput(el: any) {
  if (el) renameInputEl.value = el as HTMLInputElement
}

function startRename(id: string) {
  renamingId.value = id
  nextTick(() => {
    renameInputEl.value?.focus()
    renameInputEl.value?.select()
  })
}

async function submitRename(id: string) {
  if (!renamingId.value) return
  const val = renameInputEl.value?.value?.trim()
  renamingId.value = null
  if (val) {
    await renameSession(id, val)
    await refresh()
  }
}

function cancelRename() {
  renamingId.value = null
}

function onRename() {
  startRename(contextMenu.value.sessionId)
  contextMenu.value.visible = false
}

async function onPin() {
  await pinSession(contextMenu.value.sessionId)
  await refresh()
}

async function onUnpin() {
  await unpinSession(contextMenu.value.sessionId)
  await refresh()
}

async function onDelete() {
  const id = contextMenu.value.sessionId
  // H6.2: 删除会话前归档该会话（避免数据丢失）
  try {
    const { useMemoryArchive } = await import('@/memory-archive/useMemoryArchive')
    await useMemoryArchive().archiveSession(id)
  } catch (err) {
    console.warn('[SessionSidebar] 删除前归档失败（不影响删除）:', err)
  }
  if (id === currentSessionId.value) {
    await newSession()
  }
  await deleteSession(id)
  await refresh()
}

function onClickOutside() {
  contextMenu.value.visible = false
}

onMounted(() => {
  refresh()
  document.addEventListener('click', onClickOutside)
  window.addEventListener('ws-session-title-updated', refresh)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener('ws-session-title-updated', refresh)
})

watch(currentSessionId, () => {
  refresh()
})
</script>

<style scoped>
.session-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-right: 1px solid var(--color-border);
}

.sidebar-header {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
  gap: 8px;
}

.sidebar-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  margin: 0;
  flex: 1;
}

.title-count {
  font-size: var(--font-size-2xs);
  font-weight: 500;
  color: var(--color-text-tertiary);
  margin-left: 4px;
}

.new-session-btn {
  width: 28px;
  height: 28px;
  border: 1px dashed var(--color-border);
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-lg);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.new-session-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-muted);
}

.sidebar-close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sidebar-close-btn:hover {
  background: var(--color-surface-elevated);
  color: var(--color-text);
}

.sidebar-search {
  padding: 8px 14px;
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: var(--font-size-xs);
  background: var(--color-surface-elevated);
  color: var(--color-text);
}
.search-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.sidebar-empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 24px;
  font-size: var(--font-size-xs);
}

.session-group {
  margin-bottom: 8px;
}

.group-label {
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 6px 8px 4px;
}

.session-item {
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.15s;
}
.session-item:hover {
  background: var(--color-surface-elevated);
}
.session-item.active {
  background: var(--color-primary-muted);
}

.session-name {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-name-input {
  width: 100%;
  padding: 2px 4px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  font-size: var(--font-size-xs);
  font-weight: 500;
  background: var(--color-surface-elevated);
  color: var(--color-text);
  outline: none;
}

.session-meta {
  display: flex;
  gap: 8px;
  margin-top: 3px;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
}

.session-count {
  margin-left: auto;
}

.session-mode-badge {
  display: inline-block;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.3px;
}
.session-mode-badge.mode-normal {
  background: rgba(100, 160, 255, 0.15);
  color: #6ea8fe;
}
.session-mode-badge.mode-deep {
  background: rgba(180, 120, 255, 0.15);
  color: #b478ff;
}
.session-mode-badge.mode-explore {
  background: rgba(80, 200, 160, 0.15);
  color: #50c8a0;
}
</style>

<style>
.session-ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 140px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  padding: 4px;
}

.session-ctx-menu .ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  transition: background 0.1s;
}
.session-ctx-menu .ctx-item:hover {
  background: var(--color-surface);
}
.session-ctx-menu .ctx-danger {
  color: var(--color-danger, #e53e3e);
}
.session-ctx-menu .ctx-danger:hover {
  background: var(--color-danger, #e53e3e);
  color: #fff;
}
</style>
