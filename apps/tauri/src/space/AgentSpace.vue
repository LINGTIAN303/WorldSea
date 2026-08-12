<template>
  <div class="agent-space">
    <!-- 窗口栏（space 精简变体：拖拽区 + 居中标题 + 窗口控制，2026-08-09 补齐） -->
    <TitleBar variant="space" :title="windowBarTitle" />

    <SpaceNavbar
      :panel-session-open="sessionOpen"
      @toggle-panel-click="onTogglePanelClick"
      @toggle-new-session="onToggleNewSession"
      @toggle-mode="onToggleMode"
      @open-settings="onOpenSettings"
    />

    <div id="agent-space-main" tabindex="-1" class="space-body">
      <!-- 单聊模式：左侧侧边栏（会话列表/知识库 双 Tab 共用一个面板，2026-08-12） -->
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

      <div class="space-main">
        <!-- 单聊/群聊双模式（群聊 UI 骨架 2026-08-09 恢复） -->
        <SpaceChat v-if="spaceStore.mode === 'chat'" />
        <GroupChatView v-else @close="onGroupChatClose" />
      </div>

      <!-- 右侧面板（执行 / 配置 合并为一个面板，Level-1 Tab 切换，2026-08-12） -->
      <Transition name="panel-slide-right">
        <div
          v-if="spaceStore.rightPanelOpen"
          class="right-panel"
          :style="{ width: spaceStore.rightPanelWidth + 'px' }"
        >
          <div
            class="resize-handle resize-handle-left"
            @mousedown="onExecResizeStart"
          ></div>
          <div class="right-panel-tabs">
            <button
              class="right-tab"
              :class="{ active: spaceStore.rightTab === 'exec' }"
              @click="spaceStore.setRightTab('exec')"
              title="执行（轨迹/活动/计划）"
            ><WsIcon name="chart" size="sm" />执行</button>
            <button
              class="right-tab"
              :class="{ active: spaceStore.rightTab === 'config' }"
              @click="spaceStore.setRightTab('config')"
              title="配置（记忆/人格）"
            ><WsIcon name="settings" size="sm" />配置</button>
            <button class="right-panel-close" @click="spaceStore.closeRightPanel()" title="关闭"><WsIcon name="close" size="sm" /></button>
          </div>
          <div class="right-panel-body">
            <template v-if="spaceStore.rightTab === 'exec'">
              <ExecPanel :tab="spaceStore.execTab" @update:tab="spaceStore.setExecTab" />
            </template>
            <template v-else>
              <div class="right-config-subtabs">
                <button class="right-subtab" :class="{ active: spaceStore.configSubTab === 'memory' }" @click="spaceStore.setConfigSubTab('memory')">记忆</button>
                <button class="right-subtab" :class="{ active: spaceStore.configSubTab === 'persona' }" @click="spaceStore.setConfigSubTab('persona')">人格</button>
              </div>
              <div class="right-config-body">
                <MemoryShelf v-if="spaceStore.configSubTab === 'memory'" embedded />
                <PersonaMirror v-else embedded />
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </div>

    <!-- P3-W4 续：SettingsDialog 业务弹窗恢复 -->
    <SettingsDialog :show="settingsOpen" @close="settingsOpen = false" />
    <DialogContainer />
    <WsConfirmDialog />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useSpaceStore } from './stores/space-store'
import TitleBar from '@/ui/layout/TitleBar.vue'
import SpaceNavbar from './SpaceNavbar.vue'
import SessionSidebar from './chat/SessionSidebar.vue'
import SpaceChat from './chat/SpaceChat.vue'
import GroupChatView from './group-chat/components/GroupChatView.vue'
import MemoryShelf from './panels/MemoryShelf.vue'
import PersonaMirror from './panels/PersonaMirror.vue'
import ExecPanel from './panels/ExecPanel.vue'
import SettingsDialog from '@/ui/settings/SettingsDialog.vue'
import { DialogContainer, WsIcon } from '@worldsmith/ui-kit'
import WsConfirmDialog from '@/ui/WsConfirmDialog.vue'
import { useAgent } from '@/agent/composables/useAgent'
import { useGenerationProgress } from '@worldsmith/shared-composables/agent/useGenerationProgress'
import { usePlanStore } from '@worldsmith/shared-composables/agent/usePlanStore'

const spaceStore = useSpaceStore()
const { hasActive } = useGenerationProgress()
const planStore = usePlanStore()
const { newSession } = useAgent()

// 窗口栏标题（space 变体，2026-08-09）：随单聊/群聊模式动态显示
const windowBarTitle = computed(() =>
  spaceStore.mode === 'group' ? 'WorldSmith — 群聊空间' : 'WorldSmith — Agent 空间',
)

const sessionOpen = ref(false)
const settingsOpen = ref(false)

// 顶栏左端「侧边栏」按钮：开关侧边栏（2026-08-12 由 会话/知识墙 轮转简化为单一开关）
function onTogglePanelClick() {
  sessionOpen.value = !sessionOpen.value
  spaceStore.setSessionSidebarOpen(sessionOpen.value)
}

function closeSession() {
  sessionOpen.value = false
  spaceStore.setSessionSidebarOpen(false)
}

function onToggleNewSession() {
  sessionOpen.value = true
  spaceStore.setSessionSidebarOpen(true)
  newSession()
}

// 生成任务活跃时自动打开右侧面板（执行 Tab · 活动）
watch(hasActive, (active) => {
  if (active) {
    spaceStore.openRightPanel('exec')
    spaceStore.setExecTab('activity')
    spaceStore.activityPinned = true
  } else {
    spaceStore.activityPinned = false
  }
})

// Plan 创建时自动打开右侧面板（执行 Tab · 计划）
watch(() => planStore.hasPlan, (has) => {
  if (has) {
    spaceStore.openRightPanel('exec')
    spaceStore.setExecTab('plan')
  }
})

// Agent 设置已迁入主设置弹窗（2026-08-09）
function onOpenSettings() {
  settingsOpen.value = true
}

// 单聊 ⇄ 群聊 模式切换（顶栏 mode-switch，群聊 UI 骨架 2026-08-09）
function onToggleMode() {
  const next = spaceStore.mode === 'chat' ? 'group' : 'chat'
  spaceStore.setMode(next)
  if (next === 'group') {
    // 群聊模式下关闭单聊专属侧边栏
    sessionOpen.value = false
    spaceStore.setSessionSidebarOpen(false)
  }
}

// 群聊返回单聊（GroupChatView 关闭，如 GroupChatSetup 取消）
function onGroupChatClose() {
  spaceStore.setMode('chat')
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

function onExecResizeStart(e: MouseEvent) {
  startResize(e, spaceStore.rightPanelWidth, ev => e.clientX - ev.clientX, spaceStore.setRightPanelWidth)
}
</script>

<style scoped>
/* 灰阶分区（2026-08-12）：顶栏带 + 区域间缝隙同用 bg-muted（深灰），
   大区域色块（会话栏/主区/面板）用 bg-surface（中黑），形成包裹感 */
.agent-space {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-muted);
}

.space-body {
  display: flex;
  gap: 8px;
  padding: 8px;
  flex: 1;
  overflow: hidden;
  position: relative;
  background: var(--bg-muted);
}

/* 侧边栏：双线分隔独立块（会话列表/知识库 双 Tab 共用一个面板） */
.session-panel {
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 10px);
  background: var(--color-surface-elevated);
  overflow: hidden;
}

/* 右侧面板（执行/配置 合并）：双线分隔独立块 */
.right-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 10px);
  background: var(--color-surface-elevated);
  overflow: hidden;
  contain: layout paint style;
  will-change: transform;
}

/* 右侧面板 Level-1 Tab（执行 / 配置，2026-08-12）：下划线指示风格，与左侧 Tab 一致 */
.right-panel-tabs {
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 6px 10px 0;
  border-bottom: 1px solid var(--color-border);
}
.right-tab {
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
.right-tab:hover {
  color: var(--color-text);
}
.right-tab.active {
  color: var(--color-primary);
  font-weight: 600;
}
/* 底部指示条：2px 主色线，克制地标示当前 Tab */
.right-tab::after {
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
.right-tab.active::after {
  background: var(--color-primary);
}
.right-panel-close {
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
.right-panel-close:hover {
  background: var(--color-surface-elevated);
  color: var(--color-text);
}

/* 右侧面板内容区：填充剩余高度（ExecPanel / 配置内容） */
.right-panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.right-config-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 配置内子切换（记忆 / 人格）：次级下划线，字号更小以区分层级 */
.right-config-subtabs {
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 6px 10px 0;
  border-bottom: 1px solid var(--color-border);
}
.right-subtab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  transition: color 0.15s;
  margin-bottom: -1px;
}
.right-subtab:hover {
  color: var(--color-text-secondary);
}
.right-subtab.active {
  color: var(--color-primary);
  font-weight: 600;
}
.right-subtab::after {
  content: '';
  position: absolute;
  left: 5px;
  right: 5px;
  bottom: 0;
  height: 2px;
  border-radius: 1px;
  background: transparent;
  transition: background 0.15s;
}
.right-subtab.active::after {
  background: var(--color-primary);
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

.panel-slide-right-enter-active,
.panel-slide-right-leave-active {
  /* 性能优化:transform + opacity 只触发合成层,不重排 */
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.25s ease;
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