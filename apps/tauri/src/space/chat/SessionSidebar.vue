<template>
  <div class="session-sidebar">
    <div class="sidebar-tabs">
      <button
        class="sidebar-tab"
        :class="{ active: tab === 'session' }"
        @click="tab = 'session'"
        title="会话列表"
      ><WsIcon name="clipboard-list" size="sm" />会话列表</button>
      <button
        class="sidebar-tab"
        :class="{ active: tab === 'knowledge' }"
        @click="tab = 'knowledge'"
        title="知识库"
      ><WsIcon name="book" size="sm" />知识库</button>
      <button class="sidebar-close-btn" @click="emit('close')" title="关闭"><WsIcon name="close" size="sm" /></button>
    </div>

    <template v-if="tab === 'session'">
    <div class="sidebar-new-row">
      <button class="new-session-btn" @click="onNewSession" title="新建会话">+</button>
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
      <div v-else-if="filteredItems.length === 0" class="sidebar-empty">
        {{ searchQuery ? '未找到匹配的会话' : '暂无会话' }}
      </div>

      <div v-if="pinnedItems.length > 0" class="session-group">
        <div class="group-label">已固定</div>
        <div
          v-for="s in pinnedItems"
          :key="s.id"
          class="session-item"
          :class="{ active: s.id === currentSessionId }"
          role="button"
          :tabindex="renamingId === s.id ? -1 : 0"
          :aria-current="s.id === currentSessionId ? 'true' : undefined"
          @click="onSelect(s.id)"
          @keydown.enter.prevent="onSelect(s.id)"
          @keydown.space.prevent="onSelect(s.id)"
          @contextmenu.prevent="onContextMenu($event, s)"
        >
          <div v-if="renamingId === s.id" class="session-name">
            <input :ref="captureRenameInput" class="session-name-input" :value="s.name" @click.stop @keyup.enter="submitRename(s.id)" @keyup.esc="cancelRename" @blur="submitRename(s.id)" />
          </div>
          <div v-else class="session-name" @dblclick="startRename(s.id)">{{ s.name }}</div>
          <div class="session-meta">
            <span class="session-time">{{ formatTime(s.createdAt) }}</span>
            <span class="session-count">{{ s.messageCount }} 条</span>
          </div>
        </div>
      </div>

      <div v-if="recentItems.length > 0" class="session-group">
        <div class="group-label">{{ pinnedItems.length > 0 ? '近期' : '' }}</div>
        <div
          v-for="s in recentItems"
          :key="s.id"
          class="session-item"
          :class="{ active: s.id === currentSessionId }"
          role="button"
          :tabindex="renamingId === s.id ? -1 : 0"
          :aria-current="s.id === currentSessionId ? 'true' : undefined"
          @click="onSelect(s.id)"
          @keydown.enter.prevent="onSelect(s.id)"
          @keydown.space.prevent="onSelect(s.id)"
          @contextmenu.prevent="onContextMenu($event, s)"
        >
          <div v-if="renamingId === s.id" class="session-name">
            <input :ref="captureRenameInput" class="session-name-input" :value="s.name" @click.stop @keyup.enter="submitRename(s.id)" @keyup.esc="cancelRename" @blur="submitRename(s.id)" />
          </div>
          <div v-else class="session-name" @dblclick="startRename(s.id)">{{ s.name }}</div>
          <div class="session-meta">
            <span class="session-time">{{ formatTime(s.createdAt) }}</span>
            <span class="session-count">{{ s.messageCount }} 条</span>
          </div>
        </div>
      </div>
    </div>
    </template>
    <template v-else>
      <!-- 知识库 Tab：KnowledgeWall 嵌入侧边栏（embedded 隐藏其自身标题/关闭，避免与 Tab 重复） -->
      <div class="sidebar-kb">
        <KnowledgeWall embedded @close="tab = 'session'" />
      </div>
    </template>

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
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, type Ref } from 'vue'
import { useAgent } from '@/agent/composables/useAgent'
import { WsIcon } from '@worldsmith/ui-kit'
import KnowledgeWall from '@/agent/panels/KnowledgeWall.vue'
import { useSpaceStore } from '../stores/space-store'

const emit = defineEmits<{ close: [] }>()

// 2026-08-12：会话列表 / 知识库 共用一个侧边栏面板，经 Tab 切换（默认会话列表）
const spaceStore = useSpaceStore()
const tab = computed({
  get: () => spaceStore.sessionSidebarTab,
  set: (v: 'session' | 'knowledge') => spaceStore.setSessionSidebarTab(v),
})

/** Rust SessionInfo 镜像（useAgentRust 返回 any，显式标注避免类型扩散） */
interface RustSessionInfo {
  id: string
  created_at: number
  message_count: number
  title: string
  pinned: boolean
}

// useAgentRust：会话列表/切换/删除/重命名/固定均由 Rust 后端管理
const backend = useAgent()
const { currentSessionId, newSession, switchSession, deleteSession, listSessions, sessionTitle, updateSessionTitle, setSessionPinned } = backend
const sessionList = backend.sessionList as unknown as Ref<RustSessionInfo[]>

interface SidebarItem {
  id: string
  name: string
  messageCount: number
  createdAt: number
  pinned: boolean
}

const loading = ref(true)
const searchQuery = ref('')

/** 会话列表：重命名过（title ≠ 新会话）显示 Rust 标题，否则用首条消息生成 */
const items = computed<SidebarItem[]>(() =>
  sessionList.value.map(s => ({
    id: s.id,
    name: s.title !== '新会话' ? s.title : sessionTitle(s.id),
    messageCount: s.message_count,
    createdAt: s.created_at,
    pinned: s.pinned,
  })),
)

const filteredItems = computed(() => {
  if (!searchQuery.value) return items.value
  const q = searchQuery.value.toLowerCase()
  return items.value.filter(s => s.name.toLowerCase().includes(q))
})

/** 固定会话在前，其余在后（各按创建时间倒序） */
const pinnedItems = computed(() => filteredItems.value.filter(s => s.pinned))
const recentItems = computed(() => filteredItems.value.filter(s => !s.pinned))

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return `今天 ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
}

async function refresh() {
  try {
    await listSessions()
  } catch {}
  loading.value = false
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

const contextMenu = ref<{ visible: boolean; x: number; y: number; sessionId: string; pinned: boolean }>({
  visible: false, x: 0, y: 0, sessionId: '', pinned: false,
})

function onContextMenu(e: MouseEvent, s: SidebarItem) {
  const menuW = 160
  const menuH = 80
  const x = e.clientX + menuW > window.innerWidth ? e.clientX - menuW : e.clientX
  const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY
  contextMenu.value = { visible: true, x, y, sessionId: s.id, pinned: s.pinned }
}

// ── 重命名（内联输入）──
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
    try {
      await updateSessionTitle(id, val)
      await refresh()
    } catch {}
  }
}

function cancelRename() {
  renamingId.value = null
}

function onRename() {
  startRename(contextMenu.value.sessionId)
  contextMenu.value.visible = false
}

// ── 固定 / 取消固定 ──
async function onPin() {
  await setSessionPinned(contextMenu.value.sessionId, true)
  contextMenu.value.visible = false
  await refresh()
}

async function onUnpin() {
  await setSessionPinned(contextMenu.value.sessionId, false)
  contextMenu.value.visible = false
  await refresh()
}

async function onDelete() {
  const id = contextMenu.value.sessionId
  contextMenu.value.visible = false
  await deleteSession(id)
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
  /* 与其他大区域面板同色：背景交给外层 .session-panel（--color-surface-elevated），
     移除原先的半透明毛玻璃，避免会话栏颜色与其他面板不一致（2026-08-12） */
}

/* 侧边栏 Tab（2026-08-12）：会话列表 / 知识库 共用一个面板，面板内切换 */
.sidebar-tabs {
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 6px 10px 0;
  border-bottom: 1px solid var(--color-border);
}
.sidebar-tabs .sidebar-close-btn {
  align-self: center;
  margin-left: auto;
}
.sidebar-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  transition: color 0.15s;
  /* 贴住下边框，让指示条与分割线对齐 */
  margin-bottom: -1px;
}
.sidebar-tab:hover {
  color: var(--color-text);
}
.sidebar-tab.active {
  color: var(--color-primary);
  font-weight: 600;
}
/* 底部指示条：2px 主色线，克制地标示当前 Tab */
.sidebar-tab::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 0;
  height: 2px;
  border-radius: 1px;
  background: transparent;
  transition: background 0.15s;
}
.sidebar-tab.active::after {
  background: var(--color-primary);
}
.sidebar-new-row {
  display: flex;
  justify-content: flex-end;
  padding: 6px 10px;
}
.sidebar-kb {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-xs);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-mid);
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
  border-radius: var(--radius-xs);
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
  border-radius: var(--radius-2xs);
  font-size: var(--fs-2xs);
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
  border-radius: var(--radius-mid);
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
  border-radius: var(--radius-sm);
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
  color: var(--on-accent);
}
</style>
