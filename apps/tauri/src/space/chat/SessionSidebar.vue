<template>
  <div class="session-sidebar">
    <!-- [A5][B] 顶部：场景滑块（2026-09-03 UI 视觉改造：下拉→分段滑块；世界=默认，后四项占位） -->
    <div class="sidebar-top">
      <div
        class="scene-slider"
        role="tablist"
        aria-label="Agent 场景（决定身份与工具集，切换将新建对应场景会话）"
      >
        <div class="scene-slider-thumb" :style="sceneThumbStyle" aria-hidden="true"></div>
        <button
          v-for="(s, i) in SCENE_SLIDER_OPTIONS"
          :key="s.id"
          class="scene-slider-item"
          :class="{ active: i === activeSceneIndex }"
          role="tab"
          :aria-selected="i === activeSceneIndex"
          :title="s.placeholder ? `${s.label}（占位：能力暂同默认场景）` : s.label"
          :data-ws-tip-keys="`Ctrl+${i + 1}`"
          @click="onSceneSlide(s.id)"
        >{{ s.label }}</button>
      </div>
    </div>

    <!-- 中部：列表卡（2026-09-06 三批层级：左栏浅灰底 → 列表卡(另一种颜色) → 白色入口卡内嵌；
         列表卡全宽贴右缘、顶部小圆角、底部无缝贴身份条） -->
    <div class="sidebar-body">
      <!-- 入口卡：白底内嵌，左圆角、右缘贴边（与列表卡同语言） -->
      <div class="sidebar-entries">
        <div class="sidebar-new-row">
          <button class="new-session-bar" @click="onNewSession" title="新建会话" data-ws-tip-keys="Ctrl+N">
            <WsIcon name="chat-plus" size="sm" />
            <span>新建会话</span>
            <kbd class="new-session-kbd">Ctrl+N</kbd>
          </button>
        </div>

        <!-- [B5] 知识库入口行 -->
        <div class="sidebar-kb-row">
          <button
            class="kb-entry-btn"
            :class="{ active: sidebarView === 'kb' }"
            :aria-expanded="sidebarView === 'kb'"
            title="打开知识库"
            @click="toggleKbView"
          >
            <WsIcon name="book" size="sm" />
            <span class="kb-entry-label">知识库</span>
          </button>
        </div>
        <div class="sidebar-search">
          <div class="search-box">
            <WsIcon name="search" size="sm" class="search-icon" />
            <input
              v-model="searchQuery"
              ref="searchInputRef"
              class="search-input"
              placeholder="搜索会话..."
            />
          </div>
        </div>
      </div>

      <!-- 视图舞台：会话列表树 ⇄ 项目目录树 ⇄ 知识库（2026-09-06 由 abspos 改流式 flex:1，
           入口卡得以纳入同一卡片；三 pane 切换动画不变） -->
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
                <button
                  class="tree-group-files"
                  :class="{ active: activeFilesRoot === (group.workdir || defaultDir) }"
                  title="浏览项目目录"
                  @click.stop="openFiles(group)"
                ><WsIcon name="folder-tree" size="xs" /></button>
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
                  <!-- 删除行内确认（2026-09-03 UI 改造：弹窗→条目右侧 确认/取消） -->
                  <div v-if="confirmingDeleteId === s.id" class="session-confirm" @click.stop>
                    <button class="confirm-btn confirm-yes" title="确认删除（不可恢复）" @click.stop="confirmDelete(s.id)"><WsIcon name="check" size="xs" /></button>
                    <button class="confirm-btn confirm-no" title="取消" @click.stop="confirmingDeleteId = null"><WsIcon name="close" size="xs" /></button>
                  </div>
                  <div v-else class="session-meta">
                    <span class="session-time">{{ formatTime(s.createdAt) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 项目目录树视图 -->
          <div v-else-if="sidebarView === 'files'" key="files" class="sb-pane">
            <div class="files-view-header">
              <button class="files-back-btn" @click="sidebarView = 'sessions'" title="返回会话列表"><WsIcon name="arrow-left" size="xs" />会话列表</button>
              <span class="files-view-dir" :title="activeFilesRoot ?? ''">{{ activeFilesRoot ? baseNameOf(activeFilesRoot) : '项目目录' }}</span>
            </div>
            <!-- 左栏目录树面板（2026-09-07 从 ProjectFilesPanel 拆开）：纯树展示，
                 点击文件经 ws-open-file-preview 事件从右栏展示，左栏不显示内容 -->
            <FileTreeBrowser
              v-if="activeFilesRoot"
              :root-path="activeFilesRoot"
              compact
              title="项目目录"
              @select="onLeftFileSelect"
            />
          </div>

          <!-- 知识库视图（2026-09-03 UI 视觉改造：由底部折叠区块升级为主体视图） -->
          <div v-else key="kb" class="sb-pane sb-pane-flex">
            <div class="files-view-header">
              <button class="files-back-btn" @click="sidebarView = 'sessions'" title="返回会话列表"><WsIcon name="arrow-left" size="xs" />会话列表</button>
              <span class="files-view-dir">知识库</span>
            </div>
            <div class="kb-view-body">
              <KnowledgeWall embedded @close="sidebarView = 'sessions'" />
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- [A3][A4] 底部：头像+名称+状态 整体可点击（2026-09-06：原仅头像可点，整行扩为身份区入口）+ 全局设置直开按钮（图标放大 18） -->
    <div class="sidebar-bottom">
      <div
        class="agent-identity"
        ref="identityRef"
        role="button"
        tabindex="0"
        title="Agent 人格"
        aria-label="Agent 人格"
        @click.stop="togglePersonaPopover"
        @keydown.enter.prevent="togglePersonaPopover"
        @keydown.space.prevent="togglePersonaPopover"
      >
        <AvatarBadge
          class="agent-avatar"
          brand
          :avatar="spaceStore.persona.avatar"
          :name="agentName"
          :color="profile.accentColor"
          :font-family="fontFamily"
          :size="32"
        />
        <div class="agent-info">
          <span class="agent-name" :style="{ fontFamily: fontStore.prefs.agent.family || fontFamily || undefined }">{{ agentName }}</span>
          <span class="agent-status"><WsIcon v-if="moodIcon" :name="moodIcon" size="xs" /> {{ moodLabel }}</span>
        </div>
      </div>
      <div class="more-wrap">
        <button
          class="more-btn"
          @click.stop="emit('open-settings')"
          title="全局设置"
          aria-label="全局设置"
        ><IconSettings :size="18" :stroke-width="1.5" /></button>
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
      <div
        v-if="contextMenu.visible"
        class="session-ctx-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click="contextMenu.visible = false"
      >
        <button class="ctx-item" @click="onRename">重命名</button>
        <button v-if="!contextMenu.pinned" class="ctx-item" @click="onPin">固定</button>
        <button v-else class="ctx-item" @click="onUnpin">取消固定</button>
        <button class="ctx-item ctx-danger" @click.stop="onDelete($event)">删除</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, type Ref } from 'vue'
import { IconSettings } from '@tabler/icons-vue'
import { useAgent } from '@/agent/composables/useAgent'
import { WsIcon } from '@worldsmith/ui-kit'
import KnowledgeWall from '@/agent/panels/KnowledgeWall.vue'
import { useSpaceStore } from '../stores/space-store'
import { useSessionViewState, LAST_SESSION_KEY } from '@/agent/composables/useSessionViewState'
import { useAgentPersona } from '../composables/useAgentPersona'
import { usePersonaFont } from '../composables/usePersonaFont'
import { useFontStore } from '@/stores/fontStore'
import PersonaMirror from '../panels/PersonaMirror.vue'
import AvatarBadge from '@/ui/AvatarBadge.vue'
import { useSessionTree, type WorkdirRecord } from './useSessionTree'
import { resolveWorkspaceDir } from '../workspace'
import FileTreeBrowser from '../files/FileTreeBrowser.vue'
import type { FsNode } from '../files/FileTreeBrowser.vue'
import { setPendingFile } from '../files/pendingOpen'

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
const { currentSessionId, newSession, newDraftSession, draftSessionActive, switchSession, deleteSession, listSessions, sessionTitle, updateSessionTitle, setSessionPinned, loadWorkdirs } = backend
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

// ── 文件浏览器 / 知识库视图（2026-09-03：会话列表树 ⇄ 项目目录树 ⇄ 知识库）──
// 视图状态持久化（2026-09-07）：左栏折叠重挂后停在收起时的视图（「收起时什么样，展开时就什么样」）
const SIDEBAR_VIEW_KEY = 'ws:sidebar-view'
const sidebarView = ref<'sessions' | 'files' | 'kb'>(
  ((): 'sessions' | 'files' | 'kb' => {
    try {
      const v = localStorage.getItem(SIDEBAR_VIEW_KEY)
      if (v === 'sessions' || v === 'files' || v === 'kb') return v
    } catch { /* 存储不可用走默认 */ }
    return 'sessions'
  })(),
)
watch(sidebarView, (v) => {
  try { localStorage.setItem(SIDEBAR_VIEW_KEY, v) } catch { /* 忽略 */ }
})
const activeFilesRoot = ref<string | null>(null)

/** 文件视图根持久化（2026-09-07）：左栏折叠重挂后 activeFilesRoot 不丢——
 *  丢了会导致「项目目录视图停留但树不渲染」（v-if=activeFilesRoot 恒空） */
const FILES_ROOT_KEY = 'ws:files-root'
try {
  const saved = localStorage.getItem(FILES_ROOT_KEY)
  if (saved) activeFilesRoot.value = saved
} catch { /* 存储不可用走默认 */ }
watch(activeFilesRoot, (v) => {
  try {
    if (v) localStorage.setItem(FILES_ROOT_KEY, v)
    else localStorage.removeItem(FILES_ROOT_KEY)
  } catch { /* 忽略 */
  }
})

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

// ── 快捷键入口（space scope，批B 2026-09-06）──
// AgentSpace 注册 Ctrl+N / Ctrl+F 时经 defineExpose 调用；左栏开合由 AgentSpace 处理。
const searchInputRef = ref<HTMLInputElement | null>(null)
/** space.session.search：确保处于会话视图并聚焦搜索框 */
function focusSearch() {
  sidebarView.value = 'sessions'
  nextTick(() => searchInputRef.value?.focus())
}
defineExpose({ focusSearch, newSession: onNewSession, switchScenario: onSceneSlide })

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

// ── 删除（2026-09-03 UI 改造：弹窗确认→条目右侧行内确认；点面板其他处取消）──
/** 待确认删除的会话 id（非空时该条目右侧显示 确认/取消 UI） */
const confirmingDeleteId = ref<string | null>(null)

function onDelete(e: MouseEvent) {
  // stopPropagation：同一此点击若冒泡到 document 的 onClickOutside，会立刻清空确认态（bug 修复）
  e.stopPropagation()
  confirmingDeleteId.value = contextMenu.value.sessionId
  contextMenu.value.visible = false
}

/** 行内确认删除（消息不可恢复；列表刷新由 deleteSession 内部处理） */
async function confirmDelete(id: string) {
  confirmingDeleteId.value = null
  await deleteSession(id)
}

// ── [A5] 场景（2026-09-03 UI 视觉改造：下拉→分段滑块，固定 5 段；世界=默认，后四项占位）──
const sessionView = useSessionViewState()

/** 场景滑块固定选项。占位四项尚无专属场景插件：Rust resolve_scenario 对未知 id
 *  回退默认场景（worldbuilding），故选中占位项可正常新建会话、能力暂同默认 */
const SCENE_SLIDER_OPTIONS: { id: string; label: string; placeholder?: boolean }[] = [
  { id: 'worldbuilding', label: '世界' },
  { id: 'novel', label: '小说', placeholder: true },
  { id: 'general', label: '通用', placeholder: true },
  { id: 'coding', label: '编程', placeholder: true },
  { id: 'design', label: '设计', placeholder: true },
]

/** 当前会话场景 ID（会话级，缺省 worldbuilding） */
const currentScenarioId = computed(() => sessionView.activeState.value?.sceneId ?? 'worldbuilding')

/** 滑块选中段 index（未知场景 id 归位默认段） */
const activeSceneIndex = computed(() => {
  const i = SCENE_SLIDER_OPTIONS.findIndex((s) => s.id === currentScenarioId.value)
  return i >= 0 ? i : 0
})

/** 滑块 thumb：等宽分段（扣除轨道左右内边距 4px），按选中 index 平移整数段 */
const sceneThumbStyle = computed(() => ({
  width: `calc((100% - 4px) / ${SCENE_SLIDER_OPTIONS.length})`,
  transform: `translateX(${activeSceneIndex.value * 100}%)`,
}))

async function onSceneSlide(scenarioId: string) {
  if (scenarioId === currentScenarioId.value) return
  try {
    await newSession('新会话', undefined, scenarioId)
    const label = SCENE_SLIDER_OPTIONS.find((o) => o.id === scenarioId)?.label ?? scenarioId
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
  if (personaPopoverOpen.value) updatePopoverPosition()
}

// ── [B5] 知识库（2026-09-03 改造：底部折叠区块→主体视图，入口行在搜索框上方）──
function toggleKbView() {
  sidebarView.value = sidebarView.value === 'kb' ? 'sessions' : 'kb'
}

function onClickOutside() {
  contextMenu.value.visible = false
  personaPopoverOpen.value = false
  confirmingDeleteId.value = null
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
  min-height: 0;
  /* 2026-09-06：左栏底色较 bg-muted 再深一档（color-mix 向黑混 6%，明暗主题各自微深），分层更清晰 */
  background: color-mix(in srgb, var(--bg-muted) 94%, #000);
}

/* [A5] 顶部：场景滑块（2026-09-03 改造：下拉→分段滑块，iOS segmented 风）；2026-09-06 去底部分割线（下方入口卡边缘替代） */
.sidebar-top {
  padding: 10px 10px 8px;
  flex-shrink: 0;
}
.scene-slider {
  position: relative;
  display: flex;
  width: 100%;
  padding: 2px;
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}
/* 滑块 thumb：绝对定位色块（灰底浮于白色轨道上，与浅色面板层级区分） */
.scene-slider-thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  background: var(--bg-muted);
  border-radius: calc(var(--radius-sm) - 2px);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.scene-slider-item {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  padding: 4px 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
  border-radius: calc(var(--radius-sm) - 2px);
  cursor: pointer;
  transition: color 0.15s;
}
.scene-slider-item:hover {
  color: var(--color-text);
}
.scene-slider-item.active {
  color: var(--color-text);
  font-weight: 600;
}

/* ── 左栏卡片层级（2026-09-06 四轮）：面板灰 → 列表卡白（全宽贴边、radius 12px 四角、底部无缝贴身份条）
   → 入口卡白底+框线（radius 12px 四角，靠框线与列表卡区分）。
   ⚠️ surface 与 surface-elevated 同映射 bg-surface（勿当两色用）；白卡上 hover 翻 bg-muted 灰才可见 ── */
.sidebar-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin: 4px 0 0;
  background: var(--color-surface);
  border-radius: 12px;
  position: relative;
}
/* 入口卡：白底+框线（与列表卡靠框线区分），四角 12px 圆角 */
.sidebar-entries {
  margin: 0 0 6px;
  padding: 2px 0 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
}
/* 新建行：透明块（hover 浮现），图标+文字左对齐；
   行左缩进 16（入口卡贴列表卡边缘 + 16 + 按钮内 8 = 图标 24px，与组头同列） */
.sidebar-new-row {
  display: flex;
  align-items: center;
  padding: 10px 10px 0 16px;
  flex-shrink: 0;
}
.new-session-bar {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-size: var(--font-size-base);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.new-session-bar:hover {
  background: var(--bg-muted);
  color: var(--color-text);
}
/* 快捷键标注（space.session.new 的 Ctrl+N，2026-09-06）：右端弱化小字 */
.new-session-kbd {
  margin-left: auto;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--color-text-tertiary, var(--text-tertiary));
  font-family: inherit;
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

/* [B5] 知识库入口行：图标+文字左对齐（与新建会话同语言） */
.sidebar-kb-row {
  padding: 6px 10px 0 16px;
  flex-shrink: 0;
}
.kb-entry-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--color-text);
  font-size: var(--font-size-base);
  font-weight: 500;
  transition: background 0.12s, color 0.12s;
}
.kb-entry-btn:hover {
  background: var(--bg-muted);
  color: var(--color-text);
}
.kb-entry-btn.active {
  color: var(--color-primary);
}

/* 搜索：下横线，图标+输入文字左对齐（与上两行同起点缩进） */
.sidebar-search {
  padding: 6px 10px 4px 16px;
  flex-shrink: 0;
}
/* 搜索：下横线从输入框元素起笔（缩进对齐"搜索会话"首字=48px），不再压在图标下方 */
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
}
.search-icon {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}
.search-input {
  flex: 1;
  min-width: 0;
  padding: 0 0 3px;
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  font-size: var(--font-size-base);
  font-weight: 500;
  outline: none;
  transition: border-color 0.15s;
}
.search-input:focus {
  border-bottom-color: var(--color-primary);
}
/* 局部豁免全局聚焦光环（theme.css 全局兜底）：全局选择器带 3 个 :not(属性) 特异性达 (0,4,1)，
   普通类规则 (.search-input:focus = 0,2,0) 压不过，须镜像同款 :not 结构拉到 (0,5,0) 才能覆盖；
   聚焦反馈由下横线变色（.search-box:focus-within）承担 */
.search-input:focus:not([type='checkbox']):not([type='radio']):not([type='range']) {
  box-shadow: none;
}
.search-input::placeholder {
  color: var(--color-text-secondary);
}

/* 视图舞台：2026-09-06 由 abspos inset:0 改为流式 flex:1（入口卡纳入列表卡文档流）；
   三 pane 仍 absolute 填充舞台做切换动画 */
.sidebar-stage {
  position: relative;
  flex: 1;
  min-height: 0;
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
  background: var(--color-surface-elevated);
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
/* files 视图提升（2026-09-03，scoped deep 仅侧栏生效）：header 已示目录名，隐藏树内重复大标题 */
.sb-pane :deep(.ftb-title) {
  display: none;
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

/* Phase 3：目录组（两级树外层条目）——图标对齐入口卡图标。
   舞台流式布局，坐标基准=列表卡内容盒：组头 padding-left 24 → 图标 24px；
   入口卡图标 = 行内缩进 16 + 按钮内 8 = 24px 同列 */
.tree-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 5px 24px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}
.tree-group-header:hover {
  background: var(--bg-muted);
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
.tree-group-sessions {
  /* 会话条目文本对齐项目名首字：0 + 30 + margin 6 + padding 8 = 44px（= 图标24 + 图标14 + gap 6） */
  padding-left: 30px;
}
.session-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s;
}
.session-item:hover {
  background: var(--bg-muted);
}
.session-item.active {
  background: var(--color-primary-muted);
}
/* active 左缘指示条：主色细条强化当前会话定位 */
.session-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 60%;
  border-radius: 1px;
  background: var(--color-primary);
}
.session-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-sm);
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
  font-size: var(--font-size-sm);
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

/* 删除行内确认（2026-09-03 改造：弹窗→条目右侧 确认/取消） */
.session-confirm {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.confirm-btn {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.12s, color 0.12s;
}
.confirm-yes {
  background: color-mix(in srgb, var(--danger, #ef4444) 14%, transparent);
  color: var(--danger, #ef4444);
}
.confirm-yes:hover {
  background: var(--danger, #ef4444);
  color: #fff;
}
.confirm-no {
  background: var(--bg-muted);
  color: var(--color-text-tertiary);
}
.confirm-no:hover {
  background: var(--bg-muted);
  color: var(--color-text);
}

/* [B5] 知识库视图（主体三视图之一，2026-09-03）：header 复用 files-view-header，本体由 KnowledgeWall 自滚动 */
.sb-pane-flex {
  display: flex;
  flex-direction: column;
}
.kb-view-body {
  flex: 1;
  min-height: 0;
}

/* [A3][A4] 底部：头像+名称+状态 + 全局设置；2026-09-06 去顶部分割线（列表卡底缘无缝贴本区） */
.sidebar-bottom {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  flex-shrink: 0;
}
/* 身份区整体可点击（2026-09-06）：hover 浮现 surface 底，与列表行语言一致 */
.agent-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px;
  border-radius: var(--radius-mid);
  flex: 1;
  min-width: 0;
  cursor: pointer;
  border: none;
  background: transparent;
  text-align: left;
  transition: background 0.12s;
}
.agent-identity:hover {
  background: var(--color-surface);
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

/* 浮层：persona popover（全局设置已改底部直开，菜单浮层移除 2026-09-05） */
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
:root[data-anim-panels='off'] .scene-slider-thumb {
  transition: none;
}
</style>
