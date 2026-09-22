<template>
  <div class="agent-space">
    <!-- 窗口栏（space 精简变体：拖拽区 + 居中标题 + 窗口控制，2026-08-09 补齐）。
         [A1] 顶栏移除后：左侧栏开关经 space-left 插槽注入窗口栏（Agent空间/工作台 切换右侧） -->
    <TitleBar variant="space" :title="windowBarTitle">
      <template #space-left>
        <PanelToggle :open="sessionOpen" @click="onTogglePanelClick" />
      </template>
    </TitleBar>

    <div id="agent-space-main" tabindex="-1" class="space-body">
      <!-- 单聊模式：左侧侧边栏（会话列表/知识库 双 Tab 共用一个面板，2026-08-12） -->
      <Transition v-if="spaceStore.mode === 'chat'" name="sidebar-slide">
        <div
          v-if="sessionOpen"
          class="session-panel"
          :style="{ width: spaceStore.sessionSidebarWidth + 'px' }"
        >
          <SessionSidebar
            ref="sessionSidebarRef"
            @close="closeSession"
            @open-settings="onOpenSettings"
          />
          <div
            class="resize-handle resize-handle-right"
            @mousedown="onSessionResizeStart"
          ></div>
        </div>
      </Transition>

      <div class="space-main">
        <!-- 单聊/群聊双模式（群聊 UI 骨架 2026-08-09 恢复） -->
        <SpaceChat
          v-if="spaceStore.mode === 'chat'"
          :right-panel-open="spaceStore.rightPanelOpen"
          @toggle-right-panel="onToggleRightPanel"
          @toggle-mode="onToggleMode"
        />
        <GroupChatView
          v-else
          @close="onGroupChatClose"
          @toggle-mode="onToggleMode"
          @open-settings="onOpenSettings"
        />
      </div>

      <!-- [C] 右侧面板工作台式：执行 / 配置 / 创作 / 预览 + 号（会话级记忆上次面板） -->
      <Transition name="panel-slide-right">
        <div
          v-if="spaceStore.rightPanelOpen"
          class="right-panel"
          :style="{ width: rightPanelWidthRendered + 'px' }"
        >
          <div
            class="resize-handle resize-handle-left"
            @mousedown="onExecResizeStart"
          ></div>
          <div class="right-panel-tabs">
            <button
              v-for="p in PANEL_META"
              :key="p.id"
              class="right-tab"
              :class="{ active: rightTab === p.id }"
              @click="setRightTab(p.id)"
              :title="p.title"
            ><WsIcon :name="p.icon" size="sm" />{{ p.label }}</button>
            <!-- Level-1 Tab 栏右侧 + 号（添加面板浮窗）已移除（2026-09-03 二轮反馈）：各面板均有 Tab 直达，浮窗冗余 -->
            <button class="right-panel-close" @click="spaceStore.closeRightPanel()" title="关闭"><WsIcon name="close" size="sm" /></button>
          </div>
          <div class="right-panel-body">
            <!-- 空容器起步：无活跃会话 -->
            <div v-if="!hasActiveSession" class="right-empty">
              <WsIcon name="layout-grid" size="lg" class="right-empty-icon" />
              <p class="right-empty-text">创建或打开一个会话以使用面板</p>
              <button class="right-empty-add" @click="setRightTab('exec')"><WsIcon name="plus" size="sm" />打开执行面板</button>
            </div>
            <template v-else>
              <ExecPanel v-if="rightTab === 'exec'" />
              <template v-else-if="rightTab === 'config'">
                <div class="right-config-subtabs">
                  <button class="right-subtab" :class="{ active: spaceStore.configSubTab === 'memory' }" @click="spaceStore.setConfigSubTab('memory')">记忆</button>
                  <button class="right-subtab" :class="{ active: spaceStore.configSubTab === 'persona' }" @click="spaceStore.setConfigSubTab('persona')">人格</button>
                  <button class="right-subtab" :class="{ active: spaceStore.configSubTab === 'profile' }" @click="spaceStore.setConfigSubTab('profile')">档案</button>
                </div>
                <div class="right-config-body">
                  <template v-if="spaceStore.configSubTab === 'memory'">
                    <!-- A2 戊1：语义检索配置（端点 / 模型 / 维度 / Key + 索引状态与重建） -->
                    <SemanticSearchCard />
                    <MemoryShelf embedded />
                  </template>
                  <PersonaMirror v-else-if="spaceStore.configSubTab === 'persona'" embedded />
                  <!-- [②] 档案占位（不在本次实现） -->
                  <div v-else class="right-profile-placeholder">
                    <WsIcon name="user" size="lg" class="right-profile-icon" />
                    <p class="right-profile-title">档案</p>
                    <p class="right-profile-hint">占位，待实现</p>
                  </div>
                </div>
              </template>
              <CreationPanel v-else-if="rightTab === 'creation'" />
              <PreviewPanel v-else-if="rightTab === 'preview'" />
              <!-- 用量（B 批：从主设置迁入右栏，2026-08-23） -->
              <div v-else-if="rightTab === 'usage'" class="right-usage-body">
                <UsagePanel
                  :total-usage="totalUsage"
                  :calculated-cost="calculatedCost"
                  :cumulative-usage="cumulativeUsage"
                  :cache-hit-rate="cacheHitRate"
                />
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </div>

    <!-- UX-a 历史与分支抽屉（显隐由 useSessionBranch.panelOpen 驱动；SessionSidebar 入口打开） -->
    <SessionBranchPanel />
    <!-- P3-W4 续：SettingsDialog 业务弹窗恢复 -->
    <SettingsDialog :show="settingsOpen" @close="settingsOpen = false" />
    <ShortcutHelpModal :show="shortcutHelpOpen" @close="shortcutHelpOpen = false" />
    <DialogContainer />
    <WsConfirmDialog />
    <WsAskDialog />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount, defineAsyncComponent, nextTick } from 'vue'
import { useSpaceStore } from './stores/space-store'
import { useUserProfileStore } from './stores/user-profile-store'
import TitleBar from '@/ui/layout/TitleBar.vue'
import PanelToggle from './PanelToggle.vue'
import SessionSidebar from './chat/SessionSidebar.vue'
import { SCENE_SLIDER_OPTIONS } from './chat/scenes'
import SpaceChat from './chat/SpaceChat.vue'
import GroupChatView from './group-chat/components/GroupChatView.vue'
import MemoryShelf from './panels/MemoryShelf.vue'
import SemanticSearchCard from './panels/SemanticSearchCard.vue'
import PersonaMirror from './panels/PersonaMirror.vue'
import ExecPanel from './panels/ExecPanel.vue'
import SessionBranchPanel from '@/agent/panels/SessionBranchPanel.vue'
import CreationPanel from './panels/CreationPanel.vue'
import PreviewPanel from './panels/PreviewPanel.vue'
import SettingsDialog from '@/ui/settings/SettingsDialog.vue'
import { DialogContainer, WsIcon, useGlobalEvents, useShortcuts, type ShortcutDef } from '@worldsea/ui-kit'
/** 快捷键帮助弹窗：与 Shell 各挂一份（壳感知，见下方 ws-open-shortcut-help 监听） */
const ShortcutHelpModal = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.ShortcutHelpModal))
import WsConfirmDialog from '@/ui/WsConfirmDialog.vue'
import WsAskDialog from '@/ui/WsAskDialog.vue'
import { useAgent } from '@/agent/composables/useAgent'
import UsagePanel from '@/agent/panels/UsagePanel.vue'
import { useSettingsStore } from '@/stores/settingsStore'
import { calculateCost } from '@worldsea/agent-runtime'
import { useGenerationProgress } from '@worldsea/shared-composables/agent/useGenerationProgress'
import { useSessionViewState } from '@/agent/composables/useSessionViewState'
import { provideMessageSpeakerContext } from '@worldsea/shared-composables/agent/useMessageSpeaker'
import { usePersonaFont } from './composables/usePersonaFont'
import { useUIStore } from '@worldsea/entity-core'
import type { RightTab } from './stores/space-store'

/** [C] 右侧面板工作台式：四类面板元数据（Tab 栏 + +号浮窗共用） */
const PANEL_META: { id: RightTab; label: string; icon: string; title: string }[] = [
  { id: 'exec', label: '执行', icon: 'chart', title: '执行（轨迹/活动/计划）' },
  { id: 'config', label: '配置', icon: 'settings', title: '配置（记忆/人格）' },
  { id: 'creation', label: '创作', icon: 'palette', title: '创作（芽创作视图）' },
  { id: 'preview', label: '文件', icon: 'files', title: '文件（浏览器 + 内联预览）' },
  { id: 'usage', label: '用量', icon: 'dashboard', title: '用量（请求/token/费用）' },
]

const spaceStore = useSpaceStore()
const userProfileStore = useUserProfileStore()
const { hasActive } = useGenerationProgress()
const { restoreLastSession, totalUsage } = useAgent()
const personaFont = usePersonaFont()

// ── B 批：用量数据（右栏「用量」tab） ──
const settingsStore = useSettingsStore()
const usageModelId = computed(() =>
  settingsStore.aiProviderMode === 'cloud' ? settingsStore.aiCloudModel : settingsStore.aiCustomModel,
)
const calculatedCost = computed(() =>
  calculateCost(
    usageModelId.value,
    totalUsage.value.inputTokens,
    totalUsage.value.outputTokens,
    totalUsage.value.cacheReadTokens,
    totalUsage.value.cacheWriteTokens,
  ),
)
const cumulativeUsage = computed(() => totalUsage.value)
const cacheHitRate = computed(() => 0)

// [D] 注入 SpeakerContext：单聊/群聊消息身份显示前提（NormalMessageBubble 依赖；此前未在任何入口提供，导致 user 气泡渲染中断）
const persona = computed(() => spaceStore.persona)
const agentFont = computed(() => ({
  fontFamily: personaFont.fontFamily.value || undefined,
  accentColor: personaFont.profile.value.accentColor,
}))
const userProfile = computed(() => ({
  nickname: userProfileStore.profile.nickname,
  avatar: userProfileStore.profile.avatar || null,
  statusColor: userProfileStore.statusColor,
}))
provideMessageSpeakerContext({
  persona: computed(() => ({ name: persona.value.name, avatar: persona.value.avatar || null })),
  userProfile,
  agentFont,
  defaultAgentColor: personaFont.profile.value.accentColor,
})

// 会话级视图状态（viewState 权威：rightPanel / openExecSections 等）
const sessionView = useSessionViewState()

// [C] 右侧面板 Level-1 会话级记忆：rightPanel 由 viewState 权威；无活跃会话时空容器
const hasActiveSession = computed(() => !!sessionView.activeSessionId.value)
const rightTab = computed<RightTab>(() => sessionView.activeState.value?.rightPanel ?? 'exec')

/** [1] 右栏目标宽（不含左栏）：默认 70vw（未自定义）→ 目标=70vw；自定义 → 目标=存储宽。
      store.rightPanelWidth 恒为该目标宽；实际呈现宽 = 目标宽 - 左栏宽（computed rightPanelWidthRendered），
      使左栏开启时右栏真正收缩、内容随左栏变化，且不压缩主对话区（主区 min-width:30% 兜底）。
      右缘不出界（2026-09-03 修复二）：上限按「可用横向空间 - 主区保底 30% - 左栏占用」计算，
      仅钳到视口宽不够——左栏+主区最小宽也占空间，三者总和会超视口导致右栏右侧被裁。 */
const MIN_RIGHT_PANEL = 240
/** 视口尺寸 tick：窗口 resize 时自增，驱动右栏宽度计算重算（window 非响应式） */
const viewportTick = ref(0)
/** 右栏呈现宽上限（已左栏/主区保底扣除）：返回右栏可用的最大呈现宽 */
function calcRightPanelCap(): number {
  const leftW = spaceStore.sessionSidebarOpen ? spaceStore.sessionSidebarWidth : 0
  const avail = Math.floor(window.innerWidth) - 24 // 16 = space-body 左右 padding，8 = main 与 right 间隙
  const mainMin = Math.floor(avail * 0.3) // 主对话区保底 30% 内容宽
  return Math.max(MIN_RIGHT_PANEL, avail - mainMin - leftW)
}
const rightPanelWidthRendered = computed(() => {
  const leftW = spaceStore.sessionSidebarOpen ? spaceStore.sessionSidebarWidth : 0
  const target = Math.max(MIN_RIGHT_PANEL, spaceStore.rightPanelWidth - leftW)
  void viewportTick.value // 依赖：窗口 resize 时重算
  return Math.min(calcRightPanelCap(), target)
})

/** 打开右栏/左栏变化时，将 store.rightPanelWidth（目标宽）重置为 70vw 或保持自定义存储宽 */
function applyRightPanelWidth() {
  if (!spaceStore.rightPanelWidthCustom) {
    const base = Math.max(MIN_RIGHT_PANEL, Math.floor(window.innerWidth * 0.7))
    spaceStore.setRightPanelWidth(base)
  }
}
function setRightTab(t: RightTab) {
  spaceStore.openRightPanel(t)
  applyRightPanelWidth()
  sessionView.setRightPanel(t)
}

/** [1] 主对话区右上角右栏开关：打开时同样触发 70% 主导 */
function onToggleRightPanel() {
  spaceStore.toggleRightPanel()
  if (spaceStore.rightPanelOpen) applyRightPanelWidth()
}

// [C] Level-1 Tab 栏右侧 + 号浮窗已移除（2026-09-03 二轮反馈）：各面板 Tab 直达，浮窗冗余

// 窗口栏标题（space 变体，2026-08-09）：随单聊/群聊模式动态显示
const windowBarTitle = computed(() =>
  spaceStore.mode === 'group' ? 'WorldSea — 群聊空间' : 'WorldSea — Agent 空间',
)

const sessionOpen = ref(false)
const settingsOpen = ref(false)
const shortcutHelpOpen = ref(false)
const uiStore = useUIStore()

// 壳感知弹窗事件（2026-09-06）：设置/帮助的快捷键（Shell 注册处）与托盘菜单统一 dispatch
// 全局事件，Shell 与本组件各监听同名事件、仅在自己壳激活时打开——修复「Agent 空间按
// ? / Ctrl+, 弹窗开在隐藏的 Shell 壳里」（按键看似无反应）。
const { on: onSpaceGlobalEvent } = useGlobalEvents()
onSpaceGlobalEvent('ws-open-settings', () => { if (uiStore.currentShell === 'space') settingsOpen.value = true })
onSpaceGlobalEvent('ws-open-shortcut-help', () => { if (uiStore.currentShell === 'space') shortcutHelpOpen.value = true })

// ── Agent 空间命令层（space scope，批B 2026-09-06，键位总表见 docs/details/架构/快捷键系统.md §4）──
// 仅 Agent 空间壳激活时生效（useShortcuts 按 setAgentSpaceActive 过滤，App.vue 注入）；
// 输入框焦点时注册表自动跳过（聊天框打字按 1-5 为正常输入）。
const sessionSidebarRef = ref<InstanceType<typeof SessionSidebar> | null>(null)

/** 左栏依赖的快捷键统一入口：群聊模式无左栏 → 空转；左栏关闭时先开再等挂载（v-if 条件渲染） */
function withSidebar(fn: (sb: { focusSearch(): void; newSession(): void; switchScenario(id: string): void }) => void) {
  if (spaceStore.mode !== 'chat') return
  if (!sessionOpen.value) {
    sessionOpen.value = true
    spaceStore.setSessionSidebarOpen(true)
  }
  nextTick(() => { if (sessionSidebarRef.value) fn(sessionSidebarRef.value) })
}

const spaceShortcutIds: string[] = []
onMounted(() => {
  const { register } = useShortcuts()
  const reg = (def: ShortcutDef) => { register(def); spaceShortcutIds.push(def.id) }
  reg({ id: 'space.session.new', keys: ['ctrl', 'n'], description: '新建会话', scope: 'space', preventDefault: true, handler: () => withSidebar(sb => sb.newSession()) })
  reg({ id: 'space.session.search', keys: ['ctrl', 'f'], description: '聚焦会话搜索', scope: 'space', preventDefault: true, handler: () => withSidebar(sb => sb.focusSearch()) })
  // 左栏 Ctrl+B / 右栏 Ctrl+Shift+B（2026-09-06 用户反馈调换）：space 层优先于 global，
  // Agent 空间下 Ctrl+B 消费掉 workbench 侧栏开关（两壳互斥同键两义）
  reg({ id: 'space.sidebar.toggle', keys: ['ctrl', 'b'], description: '左栏开合', scope: 'space', preventDefault: true, handler: () => { if (spaceStore.mode === 'chat') onTogglePanelClick() } })
  reg({ id: 'space.right.toggle', keys: ['ctrl', 'shift', 'b'], description: '右栏开合', scope: 'space', preventDefault: true, handler: () => onToggleRightPanel() })
  // 单聊 ⇄ 群聊（Ctrl+T；PREVENT_DEFAULT 表已有 ctrl+t 兜底）
  reg({ id: 'space.mode.toggle', keys: ['ctrl', 't'], description: '切换单聊/群聊', scope: 'space', preventDefault: true, handler: () => onToggleMode() })
  // 右栏五 Tab = 数字 1-5（PANEL_META 顺序同源）；space 层优先于 global，
  // 消费掉数字键，不再触发 workbench 的视图切换
  PANEL_META.forEach((m, i) => {
    reg({ id: `space.tab.${m.id}`, keys: [String(i + 1)], description: `右栏切到「${m.label}」`, scope: 'space', handler: () => setRightTab(m.id) })
  })
  // 场景切换 = 新建对应场景会话（Ctrl+1-5；选项与 SessionSidebar 滑块同源：space/chat/scenes.ts，
  // 2026-09-10 同源化消除两处硬编码漂移；世界场景 id 已改名 worldbuilding→world）
  SCENE_SLIDER_OPTIONS.forEach((s, i) => {
    reg({ id: `space.scene.${s.id}`, keys: ['ctrl', String(i + 1)], description: `切换到「${s.label}」场景`, scope: 'space', preventDefault: true, handler: () => withSidebar(sb => sb.switchScenario(s.id)) })
  })
  // 聊天发送/换行（2026-09-06 用户反馈开放改键）：注册表仅作键位存储与设置面板展示，
  // 真正匹配在 ChatInput 组件内（textarea 输入焦点下注册表分发被 isInput 跳过，
  // handler 不会经分发器执行，故 no-op）；AgentSpace 常驻注册保证面板不缺条目。
  reg({ id: 'chat.send', keys: ['enter'], description: '发送消息', scope: 'space', handler: () => {} })
  reg({ id: 'chat.newline', keys: ['shift', 'enter'], description: '输入框换行', scope: 'space', handler: () => {} })
  // 文件编辑保存（2026-09-06 编辑器内核一期）：同 §2-9 模式——CM6 contentEditable 焦点下
  // 注册表分发跳过非 modal 层，焦点在编辑器内时保存由 CodeEditor keymap 匹配执行；
  // 焦点在编辑器外时经此 handler 走事件总线触达（FilePreview 监听 ws-file-editor-save，
  // 先例 ws-open-settings）。Agent 空间内此键优先于 global 层「导出到文件夹」。
  reg({
    id: 'space.fileEditor.save',
    keys: ['ctrl', 's'],
    description: '保存文件（编辑器内）',
    scope: 'space',
    handler: () => window.dispatchEvent(new CustomEvent('ws-file-editor-save')),
  })
})
onBeforeUnmount(() => {
  const { unregister } = useShortcuts()
  spaceShortcutIds.forEach(unregister)
})

// 顶栏左端「侧边栏」按钮：开关侧边栏（2026-08-12 由 会话/知识墙 轮转简化为单一开关）
function onTogglePanelClick() {
  sessionOpen.value = !sessionOpen.value
  spaceStore.setSessionSidebarOpen(sessionOpen.value)
}

function closeSession() {
  sessionOpen.value = false
  spaceStore.setSessionSidebarOpen(false)
}

// 生成任务活跃时自动打开右侧面板（执行 Tab · 活动区，新增式）
watch(hasActive, (active) => {
  if (active) {
    setRightTab('exec')
    sessionView.addExecSection('activity')
    spaceStore.activityPinned = true
  } else {
    spaceStore.activityPinned = false
  }
})

// [1] 左栏开合/变宽时，若右栏展开则重算右栏宽，使其内容随左栏真正收缩（非 overflow 裁剪）。
//     默认(未自定义)按 70% 占比；自定义时保持存储宽。右栏实际宽 = 目标宽 - 左栏宽。
watch(
  () => [spaceStore.sessionSidebarOpen, spaceStore.sessionSidebarWidth] as const,
  () => {
    if (spaceStore.rightPanelOpen) applyRightPanelWidth()
  },
)

// 进入空间即恢复上次会话（chat 模式），使右侧执行面板 tab 加载后立即可用
onMounted(() => {
  if (spaceStore.mode === 'chat') restoreLastSession()
  window.addEventListener('resize', onViewportResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportResize)
})

/** 窗口尺寸变化：自增 tick，驱动右栏宽度/浮层位置重算 */
function onViewportResize(): void {
  viewportTick.value++
}

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
  onEnd?: () => void,
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
    onEnd?.()
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
  startResize(e, spaceStore.rightPanelWidth, ev => e.clientX - ev.clientX, w => {
    // 拖拽上限（2026-09-03 修复二）：目标宽容忍左栏占用后，呈现宽仍 ≤ calcRightPanelCap
    const cap =
      calcRightPanelCap() + (spaceStore.sessionSidebarOpen ? spaceStore.sessionSidebarWidth : 0)
    spaceStore.setRightPanelWidth(Math.min(cap, w))
  }, () => {
    // [3] 用户拖拽右栏结束：标记为自定义宽度，持久保持、不再被默认 70% 弹回
    spaceStore.markRightPanelWidthCustom()
  })
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

/* [②] 档案占位 */
.right-profile-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  text-align: center;
}
.right-profile-icon {
  color: var(--color-text-tertiary);
  opacity: 0.5;
}
.right-profile-title {
  margin: 0;
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text);
}
.right-profile-hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

/* [C] 空容器起步 */
.right-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 10px;
  padding: 20px;
  text-align: center;
}
.right-empty-icon {
  color: var(--color-text-tertiary);
  opacity: 0.4;
}
.right-empty-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.right-empty-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s;
}
.right-empty-add:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

/* [C] 面板 Tab 栏：横向滚动 +  + 号按钮 */
.right-panel-tabs {
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 6px 10px 0;
  border-bottom: 1px solid var(--color-border);
  overflow-x: auto;
  scrollbar-width: none;
}
.right-panel-tabs::-webkit-scrollbar {
  display: none;
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
  /* [1] 主对话区最低宽度 30%：右栏 70% 主导时聊天保底 30%，左栏展开只挤压右栏、不压缩聊天 */
  min-width: 30%;
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

/* 减弱动态偏好：面板滑入/滑出归零位移（位移距离不进集中 reduced-motion，此处 scoped 兜底） */
:root[data-anim-panels='off'] .sidebar-slide-enter-from,
:root[data-anim-panels='off'] .sidebar-slide-leave-to,
:root[data-anim-panels='off'] .panel-slide-right-enter-from,
:root[data-anim-panels='off'] .panel-slide-right-leave-to {
  transform: none;
}
</style>