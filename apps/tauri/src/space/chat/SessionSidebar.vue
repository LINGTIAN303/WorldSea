<template>
  <div class="session-sidebar">
    <!-- [A5][B] 顶部：场景选择器（模式选择器已随三模式移除删除，2026-09-01 补 T15） -->
    <div class="sidebar-top">
      <div class="scene-select" title="Agent 场景（决定身份与工具集，切换将新建对应场景会话）">
        <WsIcon name="globe" size="xs" class="scene-icon" />
        <TuiSelect
          :model-value="currentScenarioId"
          size="sm"
          :options="scenarioOptions"
          @update:model-value="onScenarioChange"
        />
      </div>
    </div>

    <!-- 中部：会话列表（主视图，去 Tab 化） -->
    <div class="sidebar-new-row">
      <button class="new-session-btn" @click="onNewSession" title="新建会话"><WsIcon name="plus" size="xs" /></button>
      <span class="sidebar-section-title">会话</span>
      <button class="sidebar-close-btn" @click="emit('close')" title="关闭"><WsIcon name="close" size="sm" /></button>
    </div>
    <div class="sidebar-search">
      <input
        v-model="searchQuery"
        class="search-input"
        placeholder="搜索会话..."
      />
    </div>

    <div class="sidebar-body">
      <!-- 视图舞台：会话列表树 ⇄ 项目目录树（position:absolute 双 pane 切换） -->
      <div class="sidebar-stage">
        <Transition name="view-swap" mode="out-in">
          <!-- 会话列表视图 -->
          <div v-if="sidebarView === 'sessions'" key="sessions" class="sb-pane">
            <div v-if="loading" class="sidebar-empty">加载中...</div>
            <div v-else-if="filteredItems.length === 0" class="sidebar-empty">
              {{ searchQuery ? '未找到匹配的会话' : '暂无会话' }}
            </div>

            <!-- Phase 3：两级树 —— 外层目录组，内层该组会话条目 -->
            <div v-for="group in sessionGroups" :key="group.workdir" class="session-group">
              <div
                class="tree-group-header"
                role="button"
                :aria-expanded="!group.collapsed.value"
                :tabindex="0"
                title="折叠 / 展开目录"
                @click="toggleGroup(group)"
                @keydown.enter.prevent="toggleGroup(group)"
                @keydown.space.prevent="toggleGroup(group)"
              >
                <WsIcon :name="group.collapsed.value ? 'folder' : 'folder-open'" size="xs" class="tree-group-icon" />
                <span class="tree-group-label">{{ group.label }}</span>
                <span class="tree-group-count">{{ group.sessions.length }}</span>
                <button
                  class="tree-group-files"
                  :class="{ active: activeFilesRoot === (group.workdir || defaultDir) }"
                  title="浏览项目目录"
                  @click.stop="openFiles(group)"
                ><WsIcon name="folder-tree" size="xs" /></button>
                <WsIcon name="chevron-down" size="xs" class="group-caret" :class="{ open: !group.collapsed.value }" />
              </div>
              <!-- 搜索态忽略折叠，扁平展示命中会话；非搜索态按折叠状态显隐 -->
              <div v-show="!group.collapsed.value || !!searchQuery" class="tree-group-sessions">
                <div
                  v-for="s in group.sessions"
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
                  <div v-else class="session-name" @dblclick="startRename(s.id)">
                    <!-- N6 修复：固定会话图钉标识（固定后无任何视觉反馈，用户看不出变化） -->
                    <WsIcon v-if="s.pinned" name="pin" size="xs" class="session-pin" />
                    {{ s.name }}
                  </div>
                  <div class="session-meta">
                    <span class="session-time">{{ formatTime(s.createdAt) }}</span>
                    <span class="session-count">{{ s.messageCount }} 条</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 项目目录树视图 -->
          <div v-else key="files" class="sb-pane">
            <div class="files-view-header">
              <button class="files-back-btn" @click="sidebarView = 'sessions'" title="返回会话列表"><WsIcon name="arrow-left" size="xs" />会话列表</button>
              <span class="files-view-dir" :title="activeFilesRoot ?? ''">{{ activeFilesRoot ? baseNameOf(activeFilesRoot) : '项目目录' }}</span>
            </div>
            <ProjectFilesPanel
              v-if="activeFilesRoot"
              :root-path="activeFilesRoot"
              compact
              preview-mode="external"
              title="项目目录"
              @select="onLeftFileSelect"
            />
          </div>
        </Transition>
      </div>
    </div>

    <!-- [B5] 知识库：独立控件，会话列表下方常驻折叠区块 -->
    <div class="sidebar-kb-section">
      <button class="kb-toggle" :aria-expanded="kbOpen" @click="kbOpen = !kbOpen">
        <WsIcon name="book" size="sm" /><span class="kb-toggle-label">知识库</span>
        <WsIcon name="chevron-down" size="xs" class="kb-caret" :class="{ open: kbOpen }" />
      </button>
      <div v-show="kbOpen" class="kb-body">
        <KnowledgeWall embedded @close="kbOpen = false" />
      </div>
    </div>

    <!-- [A3][A4] 底部：头像信息（Agent 身份/persona）+ 更多菜单（精简：全局设置/关于） -->
    <div class="sidebar-bottom">
      <div class="agent-identity" ref="identityRef">
        <AvatarBadge
          class="agent-avatar"
          brand
          :avatar="spaceStore.persona.avatar"
          :name="agentName"
          :color="profile.accentColor"
          :font-family="fontFamily"
          :size="32"
          @click.stop="togglePersonaPopover"
        />
        <div class="agent-info">
          <span class="agent-name" :style="{ fontFamily: fontStore.prefs.agent.family || fontFamily || undefined }">{{ agentName }}</span>
          <span class="agent-status"><WsIcon v-if="moodIcon" :name="moodIcon" size="xs" /> {{ moodLabel }}</span>
        </div>
      </div>
      <div class="more-wrap" ref="moreWrapRef">
        <button
          class="more-btn"
          :class="{ active: moreMenuOpen }"
          @click.stop="toggleMoreMenu"
          title="更多"
          :aria-label="'更多菜单'"
        ><WsIcon name="more-horizontal" size="sm" /></button>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="popover">
        <div v-if="personaPopoverOpen" class="persona-popover-overlay" @click.self="personaPopoverOpen = false">
          <div class="persona-popover" :style="popoverStyle" @click.stop>
            <PersonaMirror @close="personaPopoverOpen = false" />
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <div v-if="moreMenuOpen" class="more-backdrop" @click="moreMenuOpen = false"></div>
    </Teleport>
    <Teleport to="body">
      <Transition name="dropdown">
        <div v-if="moreMenuOpen" class="more-menu" :style="moreMenuStyle">
          <button class="more-item" @click="onMore('settings')"><WsIcon name="settings" size="sm" /><span>全局设置</span></button>
          <button class="more-item" @click="onMore('about')"><WsIcon name="info" size="sm" /><span>关于</span></button>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="popover">
        <div v-if="aboutOpen" class="about-overlay" @click.self="aboutOpen = false">
          <div class="about-dialog">
            <WorldSmithLogo :size="56" :radius="14" tone="white" class="about-logo" />
            <h3 class="about-title">WorldSmith Agent</h3>
            <p class="about-version">版本 {{ appVersion }}</p>
            <button class="about-close" @click="aboutOpen = false">关闭</button>
          </div>
        </div>
      </Transition>
    </Teleport>

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
import { WsIcon, useConfirm } from '@worldsmith/ui-kit'
import KnowledgeWall from '@/agent/panels/KnowledgeWall.vue'
import { useSpaceStore } from '../stores/space-store'
import { useSessionViewState, LAST_SESSION_KEY } from '@/agent/composables/useSessionViewState'
import { useAgentPersona } from '../composables/useAgentPersona'
import { usePersonaFont } from '../composables/usePersonaFont'
import { useFontStore } from '@/stores/fontStore'
import PersonaMirror from '../panels/PersonaMirror.vue'
import AvatarBadge from '@/ui/AvatarBadge.vue'
import WorldSmithLogo from '@/components/brand/WorldSmithLogo.vue'
import TuiSelect from '@/components/ui/TuiSelect.vue'
import { useSessionTree, type WorkdirRecord } from './useSessionTree'
import { resolveWorkspaceDir } from '../workspace'
import ProjectFilesPanel from '../files/ProjectFilesPanel.vue'
import type { FsNode } from '../files/FileTreeBrowser.vue'
import { setPendingFile } from '../files/pendingOpen'

declare const __APP_VERSION__: string
const appVersion = __APP_VERSION__

const emit = defineEmits<{ close: []; 'open-settings': [] }>()

const spaceStore = useSpaceStore()

/** Rust SessionInfo 镜像（useAgentRust 返回 any，显式标注避免类型扩散） */
interface RustSessionInfo {
  id: string
  created_at: number
  message_count: number
  title: string
  pinned: boolean
  /** 会话绑定的工作区根目录（Phase 3 会话树分组依据；缺省=未限定） */
  workdir?: string
}

// useAgentRust：会话列表/切换/删除/重命名/固定均由 Rust 后端管理
const backend = useAgent()
const { currentSessionId, newSession, newDraftSession, draftSessionActive, switchSession, deleteSession, listSessions, listScenarios, sessionTitle, updateSessionTitle, setSessionPinned, loadWorkdirs } = backend
const sessionList = backend.sessionList as unknown as Ref<RustSessionInfo[]>
const workdirs = backend.workdirs as unknown as Ref<WorkdirRecord[]>
/** Phase 5：待激活会话 id（newSession 后延迟展示，首条消息后才展示条目） */
const pendingSessionIds = backend.pendingSessionIds as unknown as Ref<string[]>

interface SidebarItem {
  id: string
  name: string
  messageCount: number
  createdAt: number
  pinned: boolean
  workdir?: string
}

const loading = ref(true)
const searchQuery = ref('')

/** 会话列表：重命名过（title ≠ 新会话）显示 Rust 标题，否则用首条消息生成 */
const items = computed<SidebarItem[]>(() =>
  sessionList.value
    .filter((s) => !pendingSessionIds.value.includes(s.id)) // Phase 5：隐藏待激活会话（延迟展示）
    .map(s => ({
    id: s.id,
    name: s.title !== '新会话' ? s.title : sessionTitle(s.id),
    messageCount: s.message_count,
    createdAt: s.created_at,
    pinned: s.pinned,
    workdir: s.workdir,
  })),
)

const filteredItems = computed(() => {
  if (!searchQuery.value) return items.value
  const q = searchQuery.value.toLowerCase()
  return items.value.filter(s => s.name.toLowerCase().includes(q))
})

// ── Phase 3：默认目录路径（与 workspace.ts resolveWorkspaceDir 默认值一致）──
const defaultDir = ref('')
async function loadDefaultDir(): Promise<void> {
  try {
    defaultDir.value = await resolveWorkspaceDir()
  } catch {}
}

// ── 文件浏览器视图（2026-09-03 方向2 第2项：会话列表树 ⇄ 项目目录树）──
const sidebarView = ref<'sessions' | 'files'>('sessions')
const activeFilesRoot = ref<string | null>(null)

/** 项目组头图标点击：切到该项目目录树视图（未限定目录组兜底默认根） */
async function openFiles(group: { workdir: string }): Promise<void> {
  if (sidebarView.value === 'files' && activeFilesRoot.value === (group.workdir || defaultDir.value)) {
    // 再点已激活组 → 返回会话列表
    sidebarView.value = 'sessions'
    return
  }
  activeFilesRoot.value = group.workdir || defaultDir.value || null
  sidebarView.value = 'files'
}

/** 路径基名（兼容 / 与 \） */
function baseNameOf(p: string): string {
  const segs = p.split(/[\\/]/).filter(Boolean)
  return segs[segs.length - 1] ?? p
}

/** 左栏目录树点击文件（external 模式）：打开右栏「文件」面板并在其中预览（T14） */
function onLeftFileSelect(node: FsNode): void {
  // 0) 先写 pending（PreviewPanel 未挂载时挂载后兜底消费）
  setPendingFile(node)
  // 1) 打开右栏文件面板（切 preview tab + 持久化）
  spaceStore.openRightPanel('preview')
  sessionView.setRightPanel('preview')
  // 2) 广播选中文件 → PreviewPanel 监听并驱动预览
  window.dispatchEvent(new CustomEvent('ws-open-file-preview', { detail: node }))
}

// ── Phase 3：目录组 → 会话两级树（固定会话并入对应组内置顶）──
const { sessionGroups, toggleGroup } = useSessionTree(filteredItems, workdirs, defaultDir)

function formatTime(ts: number): string {
  // L1 修复：Rust created_at 为 epoch 秒，前端 Date 按毫秒解析需 ×1000
  const d = new Date(ts * 1000)
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
    const list = await listSessions()
    // Phase 3：同步刷新目录实体 + 默认目录路径（会话树分组标签/归属判断）
    await loadWorkdirs()
    await loadDefaultDir()
    // 启动恢复：首载无活跃会话时，回到上次活跃会话（若仍存在），水合其会话级视图状态
    // L3：草稿态跳过自动恢复（点「+」进入草稿后不应被切回旧会话）
    if (currentSessionId.value == null && !draftSessionActive.value && list.length > 0) {
      const lastId = localStorage.getItem(LAST_SESSION_KEY)
      const target = lastId && list.some((s: { id: string }) => s.id === lastId) ? lastId : list[0].id
      await switchSession(target)
    }
  } catch {}
  loading.value = false
}

async function onNewSession() {
  // L3 懒创建：点「+ 会话」仅进入草稿态（不创建后端会话），首条消息发送时才创建；
  // 未产生对话不生产会话条目，消除「孤儿空会话」「切走无入口可回」
  await newDraftSession()
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
  const pinned = contextMenu.value.pinned
  contextMenu.value.visible = false
  // N7 修复：删除二次确认（消息不可恢复）；固定会话跳过确认（用户明确要删）
  if (!pinned) {
    const { confirm } = useConfirm()
    const ok = await confirm({
      type: 'danger',
      title: '删除会话',
      description: '删除后该会话的全部对话记录将不可恢复，确定删除？',
    })
    if (!ok) return
  }
  await deleteSession(id)
}

// ── [A5] 场景（会话级，自 SpaceNavbar 移入；模式选择器已随三模式移除删除，2026-09-01 补 T15）──
const sessionView = useSessionViewState()

/** 可用场景列表（源自 Rust list_scenarios） */
const scenarioOptions = ref<{ value: string; label: string }[]>([])
/** 当前会话场景 ID（会话级，缺省 worldbuilding） */
const currentScenarioId = computed(() => sessionView.activeState.value?.sceneId ?? 'worldbuilding')

async function loadScenarios() {
  try {
    const list: { id: string; display_name: string }[] = await listScenarios()
    scenarioOptions.value = list.map((s) => ({ value: s.id, label: s.display_name }))
  } catch (err) {
    console.warn('[scenario] 加载场景失败，保持默认 worldbuilding:', err)
  }
}

async function onScenarioChange(scenarioId: string) {
  try {
    await newSession('新会话', undefined, scenarioId)
    const label = scenarioOptions.value.find((o) => o.value === scenarioId)?.label ?? scenarioId
    window.dispatchEvent(new CustomEvent('ws-scenario-changed', { detail: { id: scenarioId, label } }))
  } catch (err) {
    console.warn('[scenario] 切换场景失败:', err)
  }
}

// ── [A3] 头像 / persona 弹窗 ──
const { agentName, moodIcon, moodLabel } = useAgentPersona()
const { fontFamily, profile } = usePersonaFont()
const fontStore = useFontStore()

const personaPopoverOpen = ref(false)
const identityRef = ref<HTMLElement>()
const popoverStyle = ref<Record<string, string>>({ top: '56px', left: '16px' })

function updatePopoverPosition() {
  const el = identityRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const PW = 340
  const PH = Math.min(window.innerHeight * 0.7, window.innerHeight - 16)
  // [B] 视口边缘检测：left/top 越界回拉，确保浮窗不溢出视口
  let left = rect.left
  let top = rect.top - 8
  if (left + PW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - PW - 8)
  if (top + PH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - PH - 8)
  popoverStyle.value = { top: `${top}px`, left: `${Math.max(8, left)}px` }
}

function togglePersonaPopover() {
  personaPopoverOpen.value = !personaPopoverOpen.value
  moreMenuOpen.value = false
  if (personaPopoverOpen.value) updatePopoverPosition()
}

// ── [A4] 更多菜单（精简：全局设置/关于）──
const moreMenuOpen = ref(false)
const moreWrapRef = ref<HTMLElement>()
const moreMenuStyle = ref<Record<string, string>>({ bottom: '8px', left: '16px' })

function toggleMoreMenu() {
  moreMenuOpen.value = !moreMenuOpen.value
  personaPopoverOpen.value = false
  if (moreMenuOpen.value) {
    const el = moreWrapRef.value
    if (el) {
      const rect = el.getBoundingClientRect()
      moreMenuStyle.value = {
        bottom: `${Math.max(8, window.innerHeight - rect.top + 6)}px`,
        left: `${Math.max(8, rect.left)}px`,
      }
    }
  }
}

function onMore(action: 'settings' | 'about') {
  moreMenuOpen.value = false
  if (action === 'settings') emit('open-settings')
  else aboutOpen.value = true
}

// ── [B5] 知识库常驻折叠区块 ──
const kbOpen = ref(false)

// ── 关于弹窗 ──
const aboutOpen = ref(false)

function onClickOutside() {
  contextMenu.value.visible = false
  moreMenuOpen.value = false
  personaPopoverOpen.value = false
}

onMounted(() => {
  refresh()
  document.addEventListener('click', onClickOutside)
  window.addEventListener('ws-session-title-updated', refresh)
  loadScenarios()
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
  min-height: 0;
  /* 与其他大区域面板同色：背景交给外层 .session-panel（--color-surface-elevated） */
}

/* [A5] 顶部：场景（模式选择器已随三模式移除删除，2026-09-01 补 T15） */
.sidebar-top {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 6px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.scene-select {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.scene-icon {
  color: var(--color-text-secondary);
}

/* 新建行 */
.sidebar-new-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 0;
  flex-shrink: 0;
}
.new-session-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  padding: 0;
}
.new-session-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.sidebar-section-title {
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--color-text-tertiary);
  letter-spacing: 0.04em;
}
.sidebar-close-btn {
  align-self: center;
  margin-left: auto;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sidebar-close-btn:hover {
  background: var(--color-surface-elevated);
  color: var(--color-text);
}

/* 搜索 */
.sidebar-search {
  padding: 6px 10px 4px;
  flex-shrink: 0;
}
.search-input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  outline: none;
}
.search-input:focus {
  border-color: var(--color-primary);
}

/* 会话列表主体（滚动） */
.sidebar-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 4px 8px 8px;
  position: relative;
}
/* 视图舞台：sessions/files 双 pane 绝对定位切换 */
.sidebar-stage {
  position: absolute;
  inset: 0;
}
.sb-pane {
  position: absolute;
  inset: 0;
  overflow-y: auto;
}
/* 视图切换动画：会话左移隐藏（-24%），目录树从右（+24%）进入 */
.view-swap-enter-active,
.view-swap-leave-active {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s ease;
}
.view-swap-enter-from {
  transform: translateX(24%);
  opacity: 0;
}
.view-swap-leave-to {
  transform: translateX(-24%);
  opacity: 0;
}
:root[data-anim-panels='off'] .view-swap-enter-from,
:root[data-anim-panels='off'] .view-swap-leave-to {
  transform: none;
}

/* 文件浏览器视图头部 */
.files-view-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px 8px;
  flex-shrink: 0;
}
.files-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s;
}
.files-back-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.files-view-dir {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}
.sidebar-empty {
  padding: 16px 8px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.session-group {
  margin-bottom: 4px;
}
.group-label {
  padding: 6px 8px 2px;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Phase 3：目录组（两级树外层条目） */
.tree-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}
.tree-group-header:hover {
  background: var(--color-surface);
}
.tree-group-icon {
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
.tree-group-label {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tree-group-count {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}
/* 项目组头右端「浏览项目目录」图标（2026-09-03 方向2 第2项） */
.tree-group-files {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  opacity: 0;
  transition: opacity 0.12s, color 0.12s, background 0.12s;
}
.tree-group-header:hover .tree-group-files {
  opacity: 1;
}
.tree-group-files:hover,
.tree-group-files.active {
  color: var(--color-primary);
  background: var(--color-primary-muted);
  opacity: 1;
}
.group-caret {
  transition: transform 0.2s;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}
.group-caret.open {
  transform: rotate(180deg);
}
.tree-group-sessions {
  padding-left: 10px;
}
.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s;
}
.session-item:hover {
  background: var(--color-surface);
}
.session-item.active {
  background: var(--color-primary-muted);
}
.session-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* N6：固定会话图钉图标（弱化色调，与标题同排） */
.session-pin {
  color: var(--color-primary);
  margin-right: 4px;
  flex-shrink: 0;
  vertical-align: -1px;
}
.session-name-input {
  width: 100%;
  padding: 2px 4px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-xs);
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
}
.session-meta {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
}

/* [B5] 知识库常驻折叠区块 */
.sidebar-kb-section {
  flex-shrink: 0;
  border-top: 1px solid var(--color-border);
  max-height: 40%;
  display: flex;
  flex-direction: column;
}
.kb-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  transition: background 0.12s, color 0.12s;
}
.kb-toggle:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.kb-toggle-label {
  flex: 1;
  text-align: left;
}
.kb-caret {
  transition: transform 0.2s;
  color: var(--color-text-tertiary);
}
.kb-caret.open {
  transform: rotate(180deg);
}
.kb-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--color-border);
}

/* [A3][A4] 底部：头像 + 更多 */
.sidebar-bottom {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}
.agent-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px;
  border-radius: var(--radius-mid);
  flex: 1;
  min-width: 0;
}
.agent-avatar {
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.agent-avatar:hover {
  transform: scale(1.08);
  box-shadow: 0 0 0 3px var(--color-primary-muted);
}
.agent-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.agent-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-status {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
.more-wrap {
  position: relative;
  flex-shrink: 0;
}
.more-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.more-btn:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
}
.more-btn.active {
  background: var(--color-primary-muted);
  color: var(--color-text-primary);
}

/* 浮层 */
.more-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
}
.more-menu {
  position: fixed;
  min-width: 160px;
  background: var(--color-surface-elevated);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 4px;
  z-index: 10001;
}
.more-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-mid);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  transition: background 0.12s;
}
.more-item:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.persona-popover-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}
.persona-popover {
  position: fixed;
  width: 340px;
  max-height: 70vh;
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow-y: auto;
  z-index: 10000;
}

.about-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
}
.about-dialog {
  min-width: 240px;
  padding: 20px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  text-align: center;
}
.about-title {
  margin: 12px 0 8px;
  font-size: var(--font-size-base);
  color: var(--color-text);
}
.about-logo {
  display: block;
  margin: 0 auto;
}
.about-version {
  margin: 0 0 16px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
.about-close {
  padding: 6px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.about-close:hover {
  border-color: var(--color-primary);
  color: var(--color-text-primary);
}

.popover-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.popover-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}
.popover-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}
.popover-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.99);
}

.dropdown-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

/* 右键菜单 */
.session-ctx-menu {
  position: fixed;
  min-width: 140px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 4px;
  z-index: 10002;
}
.ctx-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-mid);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  transition: background 0.12s;
}
.ctx-item:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.ctx-danger {
  color: var(--danger, #ef4444);
}
.ctx-danger:hover {
  background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
  color: var(--danger, #ef4444);
}

:root[data-anim-panels='off'] .agent-avatar,
:root[data-anim-panels='off'] .agent-avatar:hover {
  transform: none;
}
:root[data-anim-panels='off'] .kb-caret,
:root[data-anim-panels='off'] .group-caret {
  transition: none;
}
</style>
