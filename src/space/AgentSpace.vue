<template>
  <div class="agent-space" :style="cssVars">
    <SpaceNavbar
      :panel-rotation="rotation"
      :panel-session-open="sessionOpen"
      :panel-knowledge-open="knowledgeOpen"
      @toggle-panel-click="onToggleClick"
      @toggle-panel-long-press="onToggleLongPress"
      @toggle-new-session="onToggleNewSession"
      @open-workbench="onOpenWorkbench"
      @switch-to-workbench="onSwitchToWorkbench"
      @open-settings="onOpenSettings"
    />

    <div v-if="sessionOpen || knowledgeOpen" class="panels-backdrop" @click="closeAll"></div>

    <div class="space-body">
      <!-- 单聊模式：左侧侧边栏 -->
      <Transition v-if="spaceStore.mode === 'chat'" name="sidebar-slide">
        <div
          v-if="sessionOpen"
          class="session-sidebar-wrapper"
          :style="{ width: spaceStore.sessionSidebarWidth + 'px' }"
        >
          <SessionSidebar @close="closeSession" />
          <div
            class="resize-handle resize-handle-right"
            @mousedown="onSessionResizeStart"
          ></div>
        </div>
      </Transition>

      <!-- 单聊模式：知识墙面板 -->
      <Transition v-if="spaceStore.mode === 'chat'" name="panel-slide-left">
        <div
          v-if="knowledgeOpen"
          class="space-panel left-panel"
          :style="{
            width: spaceStore.leftPanelWidth + 'px',
            left: (sessionOpen ? spaceStore.sessionSidebarWidth : 0) + 'px',
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
        <GroupChatView v-if="spaceStore.mode === 'group' && spaceStore.groupChatMode === 'meeting'" />
        <CasualChatView v-else-if="spaceStore.mode === 'group'" />
        <SpaceChat v-else />
      </div>

      <Transition name="panel-slide-right">
        <div
          v-if="spaceStore.rightPanel"
          class="space-panel right-panel"
          :style="{
            width: spaceStore.rightPanelWidth + 'px',
            right: spaceStore.planPanelOpen ? spaceStore.planPanelWidth + 'px' : '0px',
          }"
        >
          <div class="right-panel-content">
            <div
              class="resize-handle resize-handle-left"
              @mousedown="onRightResizeStart"
            ></div>
            <MemoryShelf v-if="spaceStore.rightPanel === 'memory' && spaceStore.mode === 'chat'" @close="spaceStore.rightPanel = null" />
            <PersonaMirror v-else-if="spaceStore.rightPanel === 'persona'" @close="spaceStore.rightPanel = null" />
            <SpaceAgentSettingsPanel v-else-if="spaceStore.rightPanel === 'agent-settings' && spaceStore.mode === 'chat'" @close="spaceStore.rightPanel = null" />
            <ActivityLog v-else-if="spaceStore.rightPanel === 'activity'" @close="spaceStore.rightPanel = null" />
          </div>
        </div>
      </Transition>

      <Transition v-if="spaceStore.mode === 'chat'" name="panel-slide-right">
        <div
          v-if="spaceStore.planPanelOpen"
          class="space-panel plan-panel-layer"
          :style="{ width: spaceStore.planPanelWidth + 'px' }"
        >
          <div class="plan-panel-content">
            <div
              class="resize-handle resize-handle-left"
              @mousedown="onPlanResizeStart"
            ></div>
            <PlanPanel @close="spaceStore.planPanelOpen = false" />
          </div>
        </div>
      </Transition>
    </div>

    <WsDrawer
      :show="spaceStore.workspaceDrawerOpen"
      title="工作台"
      placement="right"
      size="lg"
      @close="spaceStore.setWorkspaceDrawerOpen(false)"
    >
      <div class="drawer-shell-wrapper">
        <Shell />
      </div>
    </WsDrawer>

    <SettingsDialog :show="settingsOpen" @close="settingsOpen = false" />
    <DialogContainer />
    <WsConfirmDialog />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSpaceStore } from './stores/space-store'
import { useUIStore } from '../stores/uiStore'
import SpaceNavbar from './SpaceNavbar.vue'
import SessionSidebar from './chat/SessionSidebar.vue'
import { useGroupChatStore } from './group-chat/GroupChatStore'
import SpaceChat from './chat/SpaceChat.vue'
import CasualChatView from './group-chat/components/CasualChatView.vue'
import GroupChatView from './group-chat/components/GroupChatView.vue'
import KnowledgeWall from './panels/KnowledgeWall.vue'
import MemoryShelf from './panels/MemoryShelf.vue'
import PersonaMirror from './panels/PersonaMirror.vue'
import SpaceAgentSettingsPanel from './panels/SpaceAgentSettingsPanel.vue'
import ActivityLog from './panels/ActivityLog.vue'
import PlanPanel from './panels/PlanPanel.vue'
import Shell from '../ui/layout/Shell.vue'
import WsDrawer from '../ui/WsDrawer.vue'
import SettingsDialog from '../ui/settings/SettingsDialog.vue'
import DialogContainer from '../ui/layout/DialogContainer.vue'
import WsConfirmDialog from '../ui/WsConfirmDialog.vue'
import type { KBEntry } from '@agent/kb/kb-store'
import { useAgent } from '../agent/composables/useAgent'
import { useActivityLog } from './composables/useActivityLog'
import { useGenerationProgress } from '../agent/composables/useGenerationProgress'
import { usePlanStore } from '../agent/composables/usePlanStore'

const spaceStore = useSpaceStore()
const uiStore = useUIStore()
const settingsOpen = ref(false)
const { addLog } = useActivityLog()
const { hasActive } = useGenerationProgress()
const planStore = usePlanStore()
const { newSession } = useAgent()

// PanelToggle state machine
const rotation = ref<'session' | 'knowledge'>('session')
const sessionOpen = ref(false)
const knowledgeOpen = ref(false)

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
  if (spaceStore.mode === 'group') {
    groupChatStore.reset()
  } else {
    newSession()
  }
}

const cssVars = computed(() => ({
  '--right-panel-offset': spaceStore.rightPanel ? `${spaceStore.rightPanelWidth}px` : '0px',
}))

// 生成任务活跃时自动固定打开活动日志面板
watch(hasActive, (active) => {
  if (active) {
    spaceStore.rightPanel = 'activity'
    spaceStore.activityPinned = true
  } else {
    spaceStore.activityPinned = false
  }
})

// Plan 创建时自动打开 Plan 面板
watch(() => planStore.hasPlan, (has) => {
  if (has) {
    spaceStore.planPanelOpen = true
  }
})

function onOpenWorkbench() {
  spaceStore.setWorkspaceDrawerOpen(true)
}

function onSwitchToWorkbench() {
  spaceStore.setWorkspaceDrawerOpen(false)
  uiStore.setShell('workbench')
}

function onOpenSettings() {
  settingsOpen.value = true
}

function onAddKnowledge() {
  addLog('knowledge', '打开新增知识对话框')
}

const groupChatStore = useGroupChatStore()

// 切换到群聊模式时关闭不适用的面板
watch(() => spaceStore.mode, (mode) => {
  if (mode === 'group') {
    if (spaceStore.rightPanel === 'memory' || spaceStore.rightPanel === 'agent-settings') {
      spaceStore.rightPanel = null
    }
    if (spaceStore.planPanelOpen) {
      spaceStore.planPanelOpen = false
    }
    knowledgeOpen.value = false
    spaceStore.leftPanel = null
  }
})

function onNewGroupChat() {
  groupChatStore.reset()
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
  const startX = e.clientX

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

function onRightResizeStart(e: MouseEvent) {
  startResize(e, spaceStore.rightPanelWidth, ev => e.clientX - ev.clientX, spaceStore.setRightPanelWidth)
}

function onPlanResizeStart(e: MouseEvent) {
  startResize(e, spaceStore.planPanelWidth, ev => e.clientX - ev.clientX, spaceStore.setPlanPanelWidth)
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
  flex: 1;
  overflow: hidden;
  position: relative;
}

.panels-backdrop {
  position: fixed;
  inset: 0;
  z-index: 15;
}

.session-sidebar-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 20;
  box-shadow: 4px 0 12px -2px rgba(0, 0, 0, 0.12);
}

.space-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--color-surface-elevated);
  overflow: hidden;
  z-index: 20;
}

.left-panel {
  left: 0;
  box-shadow: 4px 0 12px -2px rgba(0, 0, 0, 0.15);
  transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.right-panel {
  right: 0;
  box-shadow: -4px 0 12px -2px rgba(0, 0, 0, 0.15);
  transition: right 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  contain: layout paint style;
}

.right-panel-content {
  width: 100%;
  height: 100%;
  contain: layout paint style;
}

.plan-panel-layer {
  right: 0;
  box-shadow: -4px 0 12px -2px rgba(0, 0, 0, 0.15);
  contain: layout paint style;
}

.plan-panel-content {
  width: 100%;
  height: 100%;
  contain: layout paint style;
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
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.panel-slide-right-enter-from {
  width: 0;
}
.panel-slide-right-leave-to {
  width: 0;
}
</style>
