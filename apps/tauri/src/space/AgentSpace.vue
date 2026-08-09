<template>
  <div class="agent-space">
    <!-- 窗口栏（space 精简变体：拖拽区 + 居中标题 + 窗口控制，2026-08-09 补齐） -->
    <TitleBar variant="space" :title="windowBarTitle" />

    <SpaceNavbar
      :panel-rotation="rotation"
      :panel-session-open="sessionOpen"
      :panel-knowledge-open="knowledgeOpen"
      @toggle-panel-click="onToggleClick"
      @toggle-panel-long-press="onToggleLongPress"
      @toggle-new-session="onToggleNewSession"
      @toggle-knowledge="onToggleKnowledge"
      @toggle-mode="onToggleMode"
      @open-workbench="onOpenWorkbench"
      @switch-to-workbench="onSwitchToWorkbench"
      @open-settings="onOpenSettings"
    />

    <div v-if="sessionOpen || knowledgeOpen" class="panels-backdrop" @click="closeAll"></div>

    <div class="space-body">
      <!-- 单聊模式：左侧会话栏（双线分隔独立块） -->
      <Transition v-if="spaceStore.mode === 'chat'" name="sidebar-slide">
        <div
          v-if="sessionOpen"
          class="session-panel"
          :style="{ width: spaceStore.sessionSidebarWidth + 'px' }"
        >
          <SessionSidebar @close="closeSession" />
          <div
            class="resize-handle resize-handle-right"
            @mousedown="onSessionResizeStart"
          ></div>
        </div>
      </Transition>

      <!-- 单聊模式：知识墙面板（临时左浮层） -->
      <Transition v-if="spaceStore.mode === 'chat'" name="panel-slide-left">
        <div
          v-if="knowledgeOpen"
          class="space-panel left-panel"
          :style="{
            width: spaceStore.leftPanelWidth + 'px',
            left: (sessionOpen ? spaceStore.sessionSidebarWidth + 16 : 16) + 'px',
          }"
        >
          <KnowledgeWall
            @add="onAddKnowledge"
            @select="onSelectKnowledge"
            @close="closeKnowledge"
          />
          <div
            class="resize-handle resize-handle-right"
            @mousedown="onLeftResizeStart"
          ></div>
        </div>
      </Transition>

      <div class="space-main">
        <!-- 单聊/群聊双模式（群聊 UI 骨架 2026-08-09 恢复） -->
        <SpaceChat v-if="spaceStore.mode === 'chat'" />
        <GroupChatView v-else @close="onGroupChatClose" />
      </div>

      <!-- 执行面板（常驻 Tab：轨迹/活动/计划，双轨之一） -->
      <Transition name="panel-slide-right">
        <div
          v-if="spaceStore.execPanelOpen"
          class="exec-panel-wrap"
          :style="{ width: spaceStore.execPanelWidth + 'px' }"
        >
          <div
            class="resize-handle resize-handle-left"
            @mousedown="onExecResizeStart"
          ></div>
          <ExecPanel :tab="spaceStore.execTab" @update:tab="spaceStore.setExecTab" />
        </div>
      </Transition>
    </div>

    <!-- 配置抽屉（弹出层：设置/记忆/人格，双轨之二） -->
    <Transition name="config-drawer">
      <div
        v-if="spaceStore.configPanel"
        class="config-drawer"
        :style="{ width: spaceStore.configPanelWidth + 'px' }"
      >
        <MemoryShelf v-if="spaceStore.configPanel === 'memory'" @close="spaceStore.setConfigPanel(null)" />
        <PersonaMirror v-else @close="spaceStore.setConfigPanel(null)" />
      </div>
    </Transition>

    <TuiDrawer
      :show="spaceStore.workspaceDrawerOpen"
      title="工作台"
      placement="right"
      size="lg"
      @close="spaceStore.setWorkspaceDrawerOpen(false)"
    >
      <div class="drawer-shell-wrapper">
        <Shell />
      </div>
    </TuiDrawer>

    <!-- P3-W4 续：SettingsDialog 业务弹窗恢复 -->
    <SettingsDialog :show="settingsOpen" @close="settingsOpen = false" />
    <DialogContainer />
    <WsConfirmDialog />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useSpaceStore } from './stores/space-store'
import { useUIStore } from '@/stores/uiStore'
import TitleBar from '@/ui/layout/TitleBar.vue'
import SpaceNavbar from './SpaceNavbar.vue'
import SessionSidebar from './chat/SessionSidebar.vue'
import SpaceChat from './chat/SpaceChat.vue'
import GroupChatView from './group-chat/components/GroupChatView.vue'
import KnowledgeWall from '@/agent/panels/KnowledgeWall.vue'
import MemoryShelf from './panels/MemoryShelf.vue'
import PersonaMirror from './panels/PersonaMirror.vue'
import ExecPanel from './panels/ExecPanel.vue'
import Shell from '@/ui/layout/Shell.vue'
import TuiDrawer from '@/components/ui/TuiDrawer.vue'
import SettingsDialog from '@/ui/settings/SettingsDialog.vue'
import { DialogContainer } from '@worldsmith/ui-kit'
import WsConfirmDialog from '@/ui/WsConfirmDialog.vue'
import type { KBEntry } from '@agent/kb/kb-store'
import { useAgent } from '@/agent/composables/useAgent'
import { useActivityLog } from '@/agent/composables/useActivityLog'
import { useGenerationProgress } from '@worldsmith/shared-composables/agent/useGenerationProgress'
import { usePlanStore } from '@worldsmith/shared-composables/agent/usePlanStore'

const spaceStore = useSpaceStore()
const uiStore = useUIStore()
const { addLog } = useActivityLog()
const { hasActive } = useGenerationProgress()
const planStore = usePlanStore()
const { newSession } = useAgent()

// 窗口栏标题（space 变体，2026-08-09）：随单聊/群聊模式动态显示
const windowBarTitle = computed(() =>
  spaceStore.mode === 'group' ? 'WorldSmith — 群聊空间' : 'WorldSmith — Agent 空间',
)

// PanelToggle state machine
const rotation = ref<'session' | 'knowledge'>('session')
const sessionOpen = ref(false)
const knowledgeOpen = ref(false)
const settingsOpen = ref(false)

function onToggleClick() {
  if (sessionOpen.value && knowledgeOpen.value) {
    knowledgeOpen.value = false
    spaceStore.leftPanel = null
    rotation.value = 'session'
    spaceStore.setSessionSidebarOpen(true)
    return
  }
  if (rotation.value === 'session') {
    if (!sessionOpen.value) {
      sessionOpen.value = true
      spaceStore.setSessionSidebarOpen(true)
    } else {
      sessionOpen.value = false
      knowledgeOpen.value = true
      spaceStore.leftPanel = 'knowledge'
      spaceStore.setSessionSidebarOpen(false)
      rotation.value = 'knowledge'
    }
  } else {
    if (!knowledgeOpen.value) {
      knowledgeOpen.value = true
      spaceStore.leftPanel = 'knowledge'
    } else {
      knowledgeOpen.value = false
      sessionOpen.value = true
      spaceStore.leftPanel = null
      spaceStore.setSessionSidebarOpen(true)
      rotation.value = 'session'
    }
  }
}

function onToggleLongPress() {
  sessionOpen.value = true
  knowledgeOpen.value = true
  spaceStore.setSessionSidebarOpen(true)
  spaceStore.leftPanel = 'knowledge'
}

function closeSession() {
  sessionOpen.value = false
  spaceStore.setSessionSidebarOpen(false)
  if (knowledgeOpen.value) {
    rotation.value = 'knowledge'
  }
}

function closeKnowledge() {
  knowledgeOpen.value = false
  spaceStore.leftPanel = null
  if (sessionOpen.value) {
    rotation.value = 'session'
  }
}

function closeAll() {
  sessionOpen.value = false
  knowledgeOpen.value = false
  spaceStore.setSessionSidebarOpen(false)
  spaceStore.leftPanel = null
}

function onToggleNewSession() {
  sessionOpen.value = true
  spaceStore.setSessionSidebarOpen(true)
  rotation.value = 'session'
  knowledgeOpen.value = false
  spaceStore.leftPanel = null
  newSession()
}

// 生成任务活跃时自动打开执行面板（活动 Tab）
watch(hasActive, (active) => {
  if (active) {
    spaceStore.openExecPanel()
    spaceStore.setExecTab('activity')
    spaceStore.activityPinned = true
  } else {
    spaceStore.activityPinned = false
  }
})

// Plan 创建时自动打开执行面板（计划 Tab）
watch(() => planStore.hasPlan, (has) => {
  if (has) {
    spaceStore.openExecPanel()
    spaceStore.setExecTab('plan')
  }
})

function onOpenWorkbench() {
  spaceStore.setWorkspaceDrawerOpen(true)
}

function onSwitchToWorkbench() {
  spaceStore.setWorkspaceDrawerOpen(false)
  uiStore.setShell('workbench')
}

// 知识墙入口（顶栏图标，2026-08-09）：打开左侧知识墙面板
function onToggleKnowledge() {
  if (sessionOpen.value) {
    sessionOpen.value = false
    spaceStore.setSessionSidebarOpen(false)
  }
  knowledgeOpen.value = !knowledgeOpen.value
  spaceStore.leftPanel = knowledgeOpen.value ? 'knowledge' : null
}

// Agent 设置已迁入主设置弹窗（2026-08-09）
function onOpenSettings() {
  settingsOpen.value = true
}

// 单聊 ⇄ 群聊 模式切换（顶栏 mode-switch，群聊 UI 骨架 2026-08-09）
function onToggleMode() {
  spaceStore.setMode(spaceStore.mode === 'chat' ? 'group' : 'chat')
  if (spaceStore.mode === 'group') {
    // 群聊模式下关闭单聊专属左栏（会话栏/知识墙）
    closeAll()
  }
}

// 群聊返回单聊（GroupChatView 关闭，如 GroupChatSetup 取消）
function onGroupChatClose() {
  spaceStore.setMode('chat')
}

function onAddKnowledge() {
  addLog('knowledge', '打开新增知识对话框')
}

function onSelectKnowledge(entry: KBEntry) {
  addLog('knowledge', `查看知识: ${entry.path}`)
}

function startResize(
  e: MouseEvent,
  startWidth: number,
  calcDelta: (ev: MouseEvent) => number,
  setter: (w: number) => void,
) {
  e.preventDefault()

  let rafId: number | null = null
  let latestEv: MouseEvent | null = null

  function onMove(ev: MouseEvent) {
    latestEv = ev
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (latestEv) setter(startWidth + calcDelta(latestEv))
    })
  }

  function onUp() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onSessionResizeStart(e: MouseEvent) {
  startResize(e, spaceStore.sessionSidebarWidth, ev => ev.clientX - e.clientX, w => {
    if (w < 180) return spaceStore.setSessionSidebarOpen(false)
    spaceStore.sessionSidebarWidth = Math.min(400, Math.max(200, w))
  })
}

function onLeftResizeStart(e: MouseEvent) {
  startResize(e, spaceStore.leftPanelWidth, ev => ev.clientX - e.clientX, spaceStore.setLeftPanelWidth)
}

function onExecResizeStart(e: MouseEvent) {
  startResize(e, spaceStore.execPanelWidth, ev => e.clientX - ev.clientX, spaceStore.setExecPanelWidth)
}


</script>

<style scoped>
.agent-space {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: var(--color-surface);
}

.space-body {
  display: flex;
  gap: 8px;
  padding: 8px;
  flex: 1;
  overflow: hidden;
  position: relative;
  background: var(--color-surface);
}

.panels-backdrop {
  position: fixed;
  inset: 0;
  z-index: 15;
}

/* 会话栏：双线分隔独立块 */
.session-panel {
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 10px);
  background: var(--color-surface-elevated);
  overflow: hidden;
}

.space-panel {
  position: absolute;
  top: 8px;
  bottom: 8px;
  background: var(--color-surface-elevated);
  overflow: hidden;
  z-index: 20;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 10px);
}

.left-panel {
  box-shadow: 4px 0 12px -2px rgba(0, 0, 0, 0.15);
  transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 执行面板：双线分隔独立块 */
.exec-panel-wrap {
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 10px);
  background: var(--color-surface-elevated);
  overflow: hidden;
  contain: layout paint style;
  will-change: transform;
}

/* 配置抽屉：弹出浮层（双线分隔：独立边框 + 阴影与主区分离） */
.config-drawer {
  position: absolute;
  top: 8px;
  right: 8px;
  bottom: 8px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 10px);
  box-shadow: -12px 0 32px -8px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  z-index: 24;
  contain: layout paint style;
  will-change: transform;
}

.config-drawer-enter-active,
.config-drawer-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
}
.config-drawer-enter-from,
.config-drawer-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  z-index: 10;
  cursor: col-resize;
  transition: background 0.15s;
}

.resize-handle:hover,
.resize-handle:active {
  background: var(--color-primary);
  opacity: 0.35;
}

.resize-handle-right {
  right: 0;
}

.resize-handle-left {
  left: 0;
}

.drawer-shell-wrapper {
  height: 100%;
  overflow: hidden;
}

.space-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  /* 双线分隔独立块 */
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 10px);
  background: var(--color-surface-elevated);
}

.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
}
.sidebar-slide-enter-from {
  transform: translateX(-20px);
  opacity: 0;
}
.sidebar-slide-leave-to {
  transform: translateX(-20px);
  opacity: 0;
}

.panel-slide-left-enter-active,
.panel-slide-left-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
}
.panel-slide-left-enter-from {
  transform: translateX(-20px);
  opacity: 0;
}
.panel-slide-left-leave-to {
  transform: translateX(-20px);
  opacity: 0;
}

.panel-slide-right-enter-active,
.panel-slide-right-leave-active {
  /* 性能优化:transform + opacity 只触发合成层,不重排 */
  /* 替代原 transition: width 0.25s(每帧触发 layout) */
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.25s ease;
  /* 动画期间临时禁用 backdrop-filter,避免大区域 blur 每帧重新光栅化 */
  /* backdrop-filter 是动画期间的性能负担,动画结束后自动恢复 */
}
.panel-slide-right-enter-from {
  transform: translateX(100%);
  opacity: 0;
}
.panel-slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
/* 动画期间禁用子元素 backdrop-filter,大幅降低 GPU 合成压力 */
.panel-slide-right-enter-active .right-panel-content,
.panel-slide-right-leave-active .right-panel-content,
.panel-slide-right-enter-active .plan-panel-content,
.panel-slide-right-leave-active .plan-panel-content {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
</style>
