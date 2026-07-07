<template>
  <div
    class="agent-panel agent-chat"
    :class="{ minimized: isMinimized, pinned: isPinned }"
    :style="panelStyle"
    @mousedown="onPanelMouseDown"
  >
    <div class="chat-header" @mousedown.left="onDragStart">
      <span class="header-title" :style="{ fontFamily: agentFontFamily || undefined }" @click.stop="sessionDrawerOpen = !sessionDrawerOpen"><WsIcon name="profile" size="sm" /> AI 助手</span>
      <div
        class="context-bar"
        :title="contextBarTitle"
      >
        <div class="context-bar-fill" :style="{ width: contextUsage.pct + '%', background: profile.accentColor }" :class="{ warn: contextUsage.pct > 70, danger: contextUsage.pct > 90 }"></div>
        <!-- H3.3: 归档阈值标记 -->
        <div
          v-if="archiveThresholdPct > 0 && archiveThresholdPct <= 100"
          class="context-bar-marker"
          :style="{ left: archiveThresholdPct + '%' }"
          :title="`归档阈值: ${archiveThreshold.toLocaleString()} tokens`"
        ></div>
        <span class="context-bar-text">{{ Math.round(contextUsage.pct) }}%</span>
      </div>
      <div class="header-actions">
        <button class="header-btn" @click.stop="toggleArchivePanel" title="记忆库"><WsIcon name="notebook" size="xs" /></button>
        <button class="header-btn" :class="{ active: isPinned }" @click.stop="togglePin" :title="isPinned ? '聚焦模式' : '穿透模式'"><WsIcon :name="isPinned ? 'pin' : 'unlock'" size="xs" /></button>
        <button class="header-btn" @click.stop="toggleMinimize" title="最小化"><WsIcon :name="isMinimized ? 'arrow-up' : 'chevron-down'" size="xs" /></button>
        <button class="header-btn" @click.stop="hide" title="关闭"><WsIcon name="close" size="xs" /></button>
      </div>
    </div>

    <template v-if="!isMinimized">
      <AgentSessionDrawer
        :visible="sessionDrawerOpen"
        :sessions="sessions"
        :current-session-id="currentSessionId"
        @close="sessionDrawerOpen = false"
        @select="onDrawerSelect"
        @delete="onDrawerDelete"
        @new-session="onDrawerNewSession"
      />
      <!-- 任务 4 P2：断点恢复横幅（检测到未完成任务时显示） -->
      <div v-if="resumableTasks.length > 0" class="resume-banner">
        <div v-for="task in resumableTasks" :key="task.taskId" class="resume-banner-item">
          <svg class="resume-banner-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>
          </svg>
          <div class="resume-banner-info">
            <div class="resume-banner-title">检测到未完成任务</div>
            <div class="resume-banner-desc">
              第 {{ task.turnCount }} 轮 · 已运行 {{ Math.round((Date.now() - task.startedAt) / 1000) }}s<span v-if="task.currentTool"> · {{ task.currentTool }}</span>
            </div>
          </div>
          <button class="resume-btn resume-btn-primary" @click="resumeTask(task.taskId)">恢复</button>
          <button class="resume-btn resume-btn-secondary" @click="discardTask(task.taskId)">放弃</button>
        </div>
      </div>
      <AgentMessageList
        ref="messageListRef"
        :messages="messages"
        :is-streaming="isStreaming"
        :last-assistant-has-content="lastAssistantHasContent"
        :last-assistant-has-thinking="lastAssistantHasThinking"
        :a2ui-surfaces="a2uiSurfaces"
        :resolve-data-binding="resolveDataBinding"
        :chat-mode="activeChatMode"
        :use-deep-layout="false"
        @a2ui-action="onA2UIAction"
        @copy="copyMessage"
        @retry="retryMessage"
        @block-action="onBlockAction"
        @manuscript-local-action="onManuscriptLocalAction"
        @open-archive-panel="toggleArchivePanel"
      />

      <ManuscriptShelf :messages="messages" />

      <div v-if="subAgentList.length > 0" class="sub-agent-section">
        <div class="sub-agent-toggle" role="button" tabindex="0" @click="subAgentExpanded = !subAgentExpanded" @keydown.enter="subAgentExpanded = !subAgentExpanded" @keydown.space.prevent="subAgentExpanded = !subAgentExpanded">
          <span class="toggle-icon"><WsIcon :name="subAgentExpanded ? 'chevron-down' : 'chevron-right'" size="xs" /></span>
          <span class="toggle-label">子 Agent ({{ subAgentList.length }})</span>
          <span v-if="activeSubAgentCount > 0" class="active-badge">{{ activeSubAgentCount }} 运行中</span>
        </div>
        <Transition name="ws-slide-down">
          <div v-if="subAgentExpanded" class="sub-agent-panels">
            <SubAgentPanel
              v-for="agent in subAgentList"
              :key="agent.id"
              :agent="agent"
              @toggle-visible="toggleSubAgentVisible"
              @remove="removeSubAgent"
            />
          </div>
        </Transition>
      </div>

      <div class="resize-handle" @mousedown.left="onResizeStart"></div>
    </template>
    <!-- 任务 4 P3：长任务进度条（面板底部，仅活跃任务时显示） -->
    <div v-if="hasActiveTask && activeTask" class="long-task-progress">
      <span class="ltp-heartbeat" :class="`ltp-hb-${heartbeatStatus}`" :title="heartbeatTitle"></span>
      <span class="ltp-label">运行中</span>
      <span class="ltp-duration">{{ formatElapsed(elapsedSec) }}</span>
      <!-- 方向 C 改进点 1：plan 进度（有 plan 时显示完成/总步数，让用户看到整体推进） -->
      <template v-if="planProgress.total > 0">
        <span class="ltp-sep">·</span>
        <span class="ltp-plan" :title="`任务进度 ${planProgress.completed}/${planProgress.total} 步（${planProgress.pct}%）`">{{ planProgress.completed }}/{{ planProgress.total }} 步</span>
      </template>
      <span class="ltp-sep">·</span>
      <span class="ltp-turns">第 {{ activeTask.turnCount }} 轮</span>
      <!-- 方向 C 改进点 3：当前 plan 步骤优先显示；无 in_progress 步骤时回退到当前 tool 名 -->
      <template v-if="currentPlanStep">
        <span class="ltp-sep">·</span>
        <span class="ltp-step" :title="`当前步骤: ${currentPlanStep}`">{{ currentPlanStep }}</span>
      </template>
      <template v-else-if="activeTask.currentTool">
        <span class="ltp-sep">·</span>
        <span class="ltp-tool" :title="`正在执行: ${activeTask.currentTool}`">{{ activeTask.currentTool }}</span>
      </template>
      <button class="ltp-cancel" @click="onAbort" title="停止任务">停止</button>
    </div>
  </div>

  <AgentInputBar
    ref="inputBarRef"
    :is-streaming="isStreaming"
    :input-bar-width="inputBarWidth"
    :filtered-commands="filteredCommands"
    :slash-mode="slashMode"
    :slash-index="slashIndex"
    :current-model-id="currentModelId"
    :has-vision-sub-agent="hasVisionSubAgent"
    @send="onInputSend"
    @abort="onAbort"
    @toggle-menu="onToggleSettings"
    @select-slash="selectSlashCommand"
    @slash-up="slashUp"
    @slash-down="slashDown"
  />

  <AgentSettingsPanel
    :visible="settingsOpen"
    :position="settingsPos"
    :dragged="settingsDragged"
    :current-provider="currentProvider"
    :current-model-id="currentModelId"
    :temperature="temperature"
    :max-tokens="maxTokens"
    :context-length="contextLength"
    :max-context-length="maxContextLengthForModel"
    :max-output-tokens="maxOutputTokensForModel"
    :max-temperature="maxTemperatureForModel"
    :persona-preset="personaPreset"
    :thinking-level="thinkingLevel"
    :thinking-levels="THINKING_LEVELS"
    :chat-mode="activeChatMode"
    :chat-modes="CHAT_MODES"
    :locked-chat-mode="lockedChatMode"
    :total-usage="totalUsage"
    :calculated-cost="calculatedCost"
    :cumulative-usage="cumulativeUsage"
    :cache-hit-rate="cacheHitRate"
    :search-engine="searchEngine"
    :search-api-key="searchApiKey"
    :skills="skills"
    :mcp-connections="mcpConnections"
    @close="closeSettings"
    @dragstart="onSettingsDragStart"
    @update:temperature="onTemperatureChange"
    @update:max-tokens="onMaxTokensChange"
    @update:context-length="(v: number) => { contextLength = v; saveAgentSettings() }"
    @update:persona-preset="onPersonaChange"
    @model-change="onModelChange"
    @thinking-level-change="onThinkingLevelChange"
    @chat-mode-change="onChatModeChange"
    @search-engine-change="onSearchEngineChange"
    @search-apikey-change="onSearchApiKeyChange"
    @toggle-skill="onToggleSkill"
    @toggle-mcp="onToggleMcp"
    @add-mcp="onAddMcp"
    @remove-mcp="onRemoveMcp"
    @reset-position="resetPosition"
    @open-terminal="openTerminal"
    @api-key-change="onApiKeyChange"
    @provider-change="onProviderChange"
  />

  <TerminalPanel
    :visible="terminalVisible"
    :pty-id="ptyId"
    :log-bridge="logBridge"
    @close="closeTerminal"
    @pty-input="writePtyInput"
    @pty-resize="resizePty"
  />

  <FontInstallConfirm ref="fontInstallConfirm" />

  <!-- 记忆库管理面板（P3-3-4 新增） -->
  <ArchivePanel
    :visible="archivePanelOpen"
    :position="archivePanelPos"
    :dragged="archivePanelDragged"
    @close="archivePanelOpen = false"
    @dragstart="onArchiveDragStart"
    @open-chunk="onOpenChunk"
  />

  <!-- 记忆片段查看器（P3-3-4 新增） -->
  <ChunkViewer
    :visible="chunkViewerOpen"
    :hook-id="chunkViewerHookId"
    :chunk-id="chunkViewerChunkId"
    :position="chunkViewerPos"
    :dragged="chunkViewerDragged"
    @close="chunkViewerOpen = false"
    @dragstart="onChunkViewerDragStart"
  />

  <!-- 实体卡片小窗：从 BlockEntityCard 详情按钮或消息 mention 触发 -->
  <FloatingPanel
    :visible="miniPanel.visible.value"
    :trigger-rect="miniPanel.triggerRect.value"
    :title="miniPanel.currentState.value?.name || '实体详情'"
    :width="340"
    :height="420"
    panel-id="entity-mini-panel"
    @update:visible="(v: boolean) => !v && miniPanel.close()"
    @close="miniPanel.close()"
  >
    <EntityMiniPanel
      v-if="miniPanel.currentState.value"
      :entity-id="miniPanel.currentState.value.entityId"
    />
  </FloatingPanel>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted, onBeforeUnmount } from 'vue'
import { useAgent } from './composables/useAgent'
import { usePlanStore } from './composables/usePlanStore'
import type { ChatMode } from './composables/useAgent'
import { useAgentCommands } from './composables/useAgentCommands'
import { usePanelDrag, usePanelResize } from './composables/usePanelDrag'
import type { AgentCommand } from './composables/useAgentCommands'
import type { ImageAttachment, FileAttachment, SkillMeta, ThinkingLevel, MCPConnectionConfig } from '@agent/index'
import WsIcon from '../ui/WsIcon.vue'
import { useFileStore } from '@worldsmith/entity-core'
import { useSettingsStore } from '../stores/settingsStore'
import { getAllSkills, toggleSkill, storeApiKey, loadApiKey, removeApiKey, hasApiKey } from '@agent/index'
import { useMcpConnections } from './composables/useMcpConnections'
import { getModelInfo, calculateCost, getThinkingLevels, modelSupportsVision, getVisionModels } from './modelRegistry'
import { storeImages as storeImagesToBackend } from '@agent/index'
import AgentMessageList from './AgentMessageList.vue'
import AgentInputBar from './AgentInputBar.vue'
import AgentSettingsPanel from './AgentSettingsPanel.vue'
import ArchivePanel from './ArchivePanel.vue'
import ChunkViewer from './ChunkViewer.vue'
import AgentSessionDrawer from './AgentSessionDrawer.vue'
import TerminalPanel from './TerminalPanel.vue'
import SubAgentPanel from './SubAgentPanel.vue'
import ManuscriptShelf from './blocks/ManuscriptShelf.vue'
import EntityMiniPanel from './EntityMiniPanel.vue'
import FloatingPanel from '../ui/layout/FloatingPanel.vue'
import { useEntityMiniPanel } from './composables/useEntityMiniPanel'
import FontInstallConfirm from '../ui/font/FontInstallConfirm.vue'
import { setFontInstallConfirm } from './setFontTool'
import { listSessions, deleteSession } from '@agent/index'
import { useOrchestrator } from './composables/useOrchestrator'
import { usePersonaFont } from '../space/composables/usePersonaFont'
import { useFontStore } from '../stores/fontStore'
import { createDebouncedStorage } from '@worldsmith/perf-kit/io'
import { useMemoryArchive } from '@/memory-archive/useMemoryArchive'

const agentStorage = createDebouncedStorage({ debounce: 100 })

const { fontFamily, profile } = usePersonaFont()
const fontStore = useFontStore()
const agentFontFamily = computed(() => fontStore.prefs.agent.family || fontFamily.value || '')

const {
  messages, isStreaming, sendMessage, steer, sendBlockAction, abort, hide, newSession,
  isPinned, totalUsage, lastRequestUsage, cumulativeUsage, cacheHitRate, updateThinkingLevel, updateModel, refreshSearchConfig,
  a2uiSurfaces, resolveDataBinding, switchSession, currentSessionId, isInitialized,
  terminalVisible, ptyId, logBridge, openTerminal, closeTerminal, writePtyInput, resizePty,
  ensureInitialized, createSubBackend,
  activeChatMode, lockedChatMode, setChatMode,
  resumableTasks, resumeTask, discardTask,
  activeTask, heartbeatStatus, hasActiveTask,
} = useAgent()
// 方向 C：plan 进度可见性（进度条叠加 plan 完成数 + 当前 in_progress 步骤标题）
const planStore = usePlanStore()
const planProgress = planStore.progress
const currentPlanStep = computed(() => {
  const step = planStore.items.value.find(i => i.status === 'in_progress')
  return step?.title || ''
})
const settingsStore = useSettingsStore()
const { connections: mcpConnections, addConnection, removeConnection, toggleConnection, ensureLoaded: ensureMcpLoaded } = useMcpConnections()
const { commands, settingsOpen, closeSettings, openSettings } = useAgentCommands()
const { subAgents, toggleSubAgentVisible: toggleSubAgentVisible, removeSubAgent: removeSubAgent, registerExecutor, trackSubAgentLongTask, untrackSubAgentLongTask } = useOrchestrator()
const miniPanel = useEntityMiniPanel()

const subAgentList = computed(() => Array.from(subAgents.values()))
const activeSubAgentCount = computed(() => subAgentList.value.filter(a => a.status === 'running').length)
const subAgentExpanded = ref(true)

// 任务 4 P3：长任务进度反馈 — 时长计时器（每秒更新，仅活跃任务时运行）
const longTaskNow = ref(Date.now())
let longTaskTimer: ReturnType<typeof setInterval> | null = null
const elapsedSec = computed(() =>
  activeTask.value ? Math.floor((longTaskNow.value - activeTask.value.startedAt) / 1000) : 0,
)
const heartbeatTitle = computed(() => {
  switch (heartbeatStatus.value) {
    case 'alive': return '心跳正常'
    case 'stale': return '心跳失联（>30s），可能卡顿'
    case 'dead': return '心跳停止（>5min），疑似崩溃'
    default: return '心跳状态'
  }
})
function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}
watch(hasActiveTask, (active) => {
  if (active) {
    longTaskNow.value = Date.now()
    if (!longTaskTimer) {
      longTaskTimer = setInterval(() => { longTaskNow.value = Date.now() }, 1000)
    }
  } else if (longTaskTimer) {
    clearInterval(longTaskTimer)
    longTaskTimer = null
  }
}, { immediate: true })
onUnmounted(() => {
  if (longTaskTimer) { clearInterval(longTaskTimer); longTaskTimer = null }
})

const messageListRef = ref<InstanceType<typeof AgentMessageList>>()
const inputBarRef = ref<InstanceType<typeof AgentInputBar>>()
const fontInstallConfirm = ref<InstanceType<typeof FontInstallConfirm> | null>(null)

setFontInstallConfirm(async (family: string) => {
  if (!fontInstallConfirm.value) return false
  return fontInstallConfirm.value.show(family)
})

const isMinimized = ref(false)
const sessionDrawerOpen = ref(false)
const sessions = ref<Array<{ id: string; name: string; updatedAt: string; modelId?: string }>>([])
const panelX = ref((window.innerWidth - 420) / 2)
const panelY = ref((window.innerHeight - 500 - 80) / 2)
const panelW = ref(420)
const panelH = ref(500)
const INPUT_BAR_HEIGHT = 80

const currentProvider = ref(settingsStore.aiCloudProvider)
const currentModelId = ref(settingsStore.aiCloudModel)

const hasVisionSubAgent = computed(() => {
  const vProvider = settingsStore.visionSubAgentProvider
  const vModel = settingsStore.visionSubAgentModel
  if (vProvider && vModel) return true
  return getVisionModels().length > 0
})

function clampPanelY(y: number) { return Math.max(0, Math.min(window.innerHeight - INPUT_BAR_HEIGHT - 36, y)) }
function clampPanelX(x: number) { return x }
function maxPanelH() { return window.innerHeight - panelY.value - INPUT_BAR_HEIGHT - 36 }

const { onDragStart } = usePanelDrag({
  x: panelX, y: panelY, clampX: clampPanelX, clampY: clampPanelY, onDragEnd: savePanelState,
  excludeSelector: '.header-actions,.header-title'
})
const { onResizeStart } = usePanelResize({
  w: panelW, h: panelH, minW: 320, maxW: 800, minH: 200, maxH: maxPanelH, onResizeEnd: savePanelState
})

const settingsPos = ref({ x: 0, y: 0 })
const settingsDragged = ref(false)
const { onDragStart: onSettingsDragStart } = usePanelDrag({
  x: computed({ get: () => settingsPos.value.x, set: v => settingsPos.value = { ...settingsPos.value, x: v } }),
  y: computed({ get: () => settingsPos.value.y, set: v => settingsPos.value = { ...settingsPos.value, y: v } }),
  onDragEnd: () => { settingsDragged.value = true },
  excludeSelector: '.settings-body,.menu-close-btn'
})

/* ── 记忆库面板状态（P3-3-4 新增）── */
const archivePanelOpen = ref(false)
const archivePanelPos = ref({ x: 0, y: 0 })
const archivePanelDragged = ref(false)
const { onDragStart: onArchiveDragStart } = usePanelDrag({
  x: computed({ get: () => archivePanelPos.value.x, set: v => archivePanelPos.value = { ...archivePanelPos.value, x: v } }),
  y: computed({ get: () => archivePanelPos.value.y, set: v => archivePanelPos.value = { ...archivePanelPos.value, y: v } }),
  onDragEnd: () => { archivePanelDragged.value = true },
  excludeSelector: '.ap-body,.ap-close-btn,.ap-back-btn'
})

/* ── 记忆片段查看器状态（P3-3-4 新增）── */
const chunkViewerOpen = ref(false)
const chunkViewerHookId = ref('')
const chunkViewerChunkId = ref('')
const chunkViewerPos = ref({ x: 0, y: 0 })
const chunkViewerDragged = ref(false)
const { onDragStart: onChunkViewerDragStart } = usePanelDrag({
  x: computed({ get: () => chunkViewerPos.value.x, set: v => chunkViewerPos.value = { ...chunkViewerPos.value, x: v } }),
  y: computed({ get: () => chunkViewerPos.value.y, set: v => chunkViewerPos.value = { ...chunkViewerPos.value, y: v } }),
  onDragEnd: () => { chunkViewerDragged.value = true },
  excludeSelector: '.cv-body,.cv-close-btn'
})

const temperature = ref(70)
const maxTokens = ref(8192)
const contextLength = ref(128000)
const personaPreset = ref('default')
const thinkingLevel = ref<ThinkingLevel>('off')
const searchEngine = ref('tavily')
const searchApiKey = ref('')
const skills = ref<SkillMeta[]>(getAllSkills())
const inputBarWidth = ref(520)
const slashMode = ref(false)
const slashIndex = ref(0)

const THINKING_LEVELS = computed(() => getThinkingLevels(currentModelId.value))

const CHAT_MODES = [
  { value: 'normal', icon: 'chat', label: '快问快答', desc: '快答为主，按需调用工具' },
  { value: 'deep', icon: 'brain', label: '深度思考', desc: '深度推理 + 工具验证 + 结构化推理链' },
  { value: 'explore', icon: 'search', label: '知识探索', desc: '知识库 → 联网搜索 → 项目数据 → 模型知识' },
  { value: 'task', icon: 'play', label: '任务执行', desc: '自主规划 + 连续执行 + 验证重试，动手把事做完' },
]

function onChatModeChange(mode: string): void {
  if (lockedChatMode.value !== null) return
  setChatMode(mode as ChatMode)
}

const maxOutputTokensForModel = computed(() => {
  const info = getModelInfo(currentModelId.value)
  if (info) return info.maxOutputTokens
  const isCustom = ['openai-compatible', 'anthropic-compatible'].includes(currentProvider.value)
  return isCustom ? 65536 : 8192
})
const maxContextLengthForModel = computed(() => {
  const info = getModelInfo(currentModelId.value)
  if (info) return info.contextLength
  const isCustom = ['openai-compatible', 'anthropic-compatible'].includes(currentProvider.value)
  return isCustom ? 1048576 : 128000
})
const maxTemperatureForModel = computed(() => {
  const provider = currentProvider.value
  return ['anthropic', 'zhipu', 'minimax'].includes(provider) ? 100 : 200
})

const panelStyle = computed(() => ({
  left: `${panelX.value}px`,
  top: `${panelY.value}px`,
  width: `${panelW.value}px`,
  height: isMinimized.value ? 'auto' : `${panelH.value}px`,
}))

const lastAssistantHasContent = computed(() => {
  const msgs = messages.value
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return (msgs[i].content || '').length > 0
  }
  return false
})

const lastAssistantHasThinking = computed(() => {
  const msgs = messages.value
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return (msgs[i].thinking || '').length > 0
  }
  return false
})

const filteredCommands = computed(() => [...commands.value])

const calculatedCost = computed(() => {
  const breakdown = calculateCost(
    currentModelId.value,
    totalUsage.value.inputTokens,
    totalUsage.value.outputTokens,
    totalUsage.value.cacheReadTokens,
    totalUsage.value.cacheWriteTokens,
  )
  return breakdown
})

const contextUsage = computed(() => {
  const total = contextLength.value
  const used = lastRequestUsage.value.inputTokens + lastRequestUsage.value.cacheReadTokens + lastRequestUsage.value.cacheWriteTokens
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  return { used, total, pct }
})

// H3.3: 归档阈值在进度条上的位置
const archiveThreshold = computed(() => {
  try {
    const memoryArchive = useMemoryArchive()
    if (!memoryArchive.isInitialized.value) return 0
    const config = memoryArchive.getConfig()
    return config.archiveThreshold ?? 0
  } catch {
    return 0
  }
})

const archiveThresholdPct = computed(() => {
  const total = contextLength.value
  if (total <= 0 || archiveThreshold.value <= 0) return 0
  return Math.min(100, (archiveThreshold.value / total) * 100)
})

// H3.3: 增强的 tooltip（含归档阈值提示）
const contextBarTitle = computed(() => {
  const used = contextUsage.value.used.toLocaleString()
  const total = contextUsage.value.total.toLocaleString()
  const pct = Math.round(contextUsage.value.pct)
  let title = `上下文窗口: ${used} / ${total} tokens (${pct}%)`
  if (archiveThreshold.value > 0) {
    title += `\n归档阈值: ${archiveThreshold.value.toLocaleString()} tokens`
    if (contextUsage.value.used >= archiveThreshold.value) {
      title += '\n⚠ 已超过归档阈值，即将触发自动归档'
    }
  }
  return title
})

function onA2UIAction(surfaceId: string, action: { name: string; data?: any }): void {
  const dataStr = action.data ? JSON.stringify(action.data) : ''
  const steerText = dataStr
    ? `[A2UI Action] surface=${surfaceId} action=${action.name} data=${dataStr}`
    : `[A2UI Action] surface=${surfaceId} action=${action.name}`
  sendBlockAction(steerText, action.name)
}

function onBlockAction(event: { blockId: string; action: string; data?: Record<string, unknown> }): void {
  // 实体卡片"详情"按钮：打开实体小窗浮窗（UI 动作，不发送到 Agent）
  if (event.action === 'open-detail' && event.data) {
    const d = event.data as { entityId?: string; entityType?: string; name?: string; triggerRect?: DOMRect }
    if (d.entityId && d.triggerRect) {
      miniPanel.open(d.entityId, d.triggerRect, { entityType: d.entityType, name: d.name })
      return // 不走默认的 sendBlockAction，避免把 UI 动作当成 steer 发回 Agent
    }
  }

  const dataStr = event.data ? JSON.stringify(event.data) : ''
  const steerText = dataStr
    ? `[Block Action] block=${event.blockId} action=${event.action} data=${dataStr}`
    : `[Block Action] block=${event.blockId} action=${event.action}`
  const displayText = formatBlockActionDisplay(event)
  sendBlockAction(steerText, displayText)
}

/** 文境本地操作：仅持久化到 block 数据，不发送到 Agent */
function onManuscriptLocalAction(event: { blockId: string; action: string; data?: Record<string, unknown> }): void {
  if (event.action === 'resize' && event.data) {
    persistManuscriptResize(event.blockId, event.data)
  } else if (event.action === 'layout_change' && event.data) {
    persistManuscriptLayout(event.blockId, event.data)
  } else if (event.action === 'shadow_cycle' && event.data) {
    persistManuscriptShadow(event.blockId, event.data)
  } else if (event.action === 'animation_cycle' && event.data) {
    persistManuscriptAnimation(event.blockId, event.data)
  }
}

function persistManuscriptResize(blockId: string, data: Record<string, unknown>): void {
  for (const msg of messages.value) {
    if (!msg.blocks) continue
    const block = msg.blocks.find(b => b.id === blockId && b.type === 'manuscript')
    if (block && block.type === 'manuscript') {
      if (typeof data.width === 'number') block.width = data.width
      if (typeof data.height === 'number') block.height = data.height
      break
    }
  }
}

function persistManuscriptLayout(blockId: string, data: Record<string, unknown>): void {
  for (const msg of messages.value) {
    if (!msg.blocks) continue
    const block = msg.blocks.find(b => b.id === blockId && b.type === 'manuscript')
    if (block && block.type === 'manuscript') {
      if (typeof data.layout === 'string') block.layout = data.layout as 'horizontal' | 'vertical'
      break
    }
  }
}

function persistManuscriptShadow(blockId: string, data: Record<string, unknown>): void {
  for (const msg of messages.value) {
    if (!msg.blocks) continue
    const block = msg.blocks.find(b => b.id === blockId && b.type === 'manuscript')
    if (block && block.type === 'manuscript') {
      if (typeof data.shadow === 'string') block.shadow = data.shadow as 'sunlight' | 'soft' | 'none'
      break
    }
  }
}

function persistManuscriptAnimation(blockId: string, data: Record<string, unknown>): void {
  for (const msg of messages.value) {
    if (!msg.blocks) continue
    const block = msg.blocks.find(b => b.id === blockId && b.type === 'manuscript')
    if (block && block.type === 'manuscript') {
      if (typeof data.animation === 'string') block.animation = data.animation as 'ink-drop' | 'brush-stroke' | 'fade-in' | 'float-up'
      break
    }
  }
}

function formatBlockActionDisplay(event: { blockId: string; action: string; data?: Record<string, unknown> }): string {
  if (event.action === 'choice_select' && event.data) {
    const mode = event.data.mode as string
    if (mode === 'multi' && event.data.labels) {
      return `选择了: ${(event.data.labels as string[]).join(', ')}`
    }
    if (mode === 'multi' && event.data.values) {
      return `选择了: ${(event.data.values as string[]).join(', ')}`
    }
    const displayVal = (event.data.label as string) || (event.data.value as string) || ''
    return `选择了: ${displayVal}`
  }
  return event.action
}

function copyMessage(msg: { content?: string }): void {
  navigator.clipboard.writeText(msg.content || '').catch(() => {})
}

async function retryMessage(msg: { content?: string }): Promise<void> {
  if (isStreaming.value) return
  await sendMessage(msg.content || '')
  await nextTick()
  messageListRef.value?.scrollToBottom()
}

async function onInputSend(text: string, rawAttachments: any[]): Promise<void> {
  if (isStreaming.value) return
  const images: ImageAttachment[] = []
  const files: FileAttachment[] = []
  const fileStore = useFileStore()

  for (const att of rawAttachments) {
    if (att.type === 'image') {
      images.push({ data: att.data, mimeType: att.mimeType })
    } else if (att.textContent) {
      const path = `/uploads/${att.name}`
      const content = att.textContent
      const size = new Blob([content]).size
      await fileStore.add(att.name, path, att.mimeType || 'text/plain', size, content)
      files.push({ name: att.name, content })
    }
  }

  if (images.length > 0 && !modelSupportsVision(currentModelId.value)) {
    const imageId = storeImagesToBackend(images.map(img => ({ data: img.data, mimeType: img.mimeType })))
    const userText = text || '请分析这些图片'
    const visionHint = `用户发送了 ${images.length} 张图片（图片批次 ID: ${imageId}，30分钟内有效）。请使用 vision_analyze 工具来查看和分析这些图片，然后根据分析结果回答用户的问题。\n\n用户消息：${userText}`
    await sendMessage(visionHint, images, files.length ? files : undefined)
    await nextTick()
    messageListRef.value?.scrollToBottom()
    return
  }

  await sendMessage(text || (images.length ? '请描述这张图片' : ''), images.length ? images : undefined, files.length ? files : undefined, activeChatMode.value)
  await nextTick()
  messageListRef.value?.scrollToBottom()
}

async function onAbort(): Promise<void> { await abort() }

function selectSlashCommand(cmd: AgentCommand): void {
  slashMode.value = false
  cmd.handler()
}

function slashUp(): void {
  if (!slashMode.value) return
  slashIndex.value = Math.max(0, slashIndex.value - 1)
}

function slashDown(): void {
  if (!slashMode.value) return
  slashIndex.value = Math.min(filteredCommands.value.length - 1, slashIndex.value + 1)
}

function togglePin(): void { isPinned.value = !isPinned.value }

function toggleMinimize(): void {
  const wasMinimized = isMinimized.value
  isMinimized.value = !isMinimized.value

  if (wasMinimized && !isMinimized.value) {
    const midY = window.innerHeight / 2
    if (panelY.value > midY) {
      const newTop = panelY.value - panelH.value
      panelY.value = clampPanelY(Math.max(0, newTop))
    }
  }

  if (!isMinimized.value) {
    panelY.value = clampPanelY(panelY.value)
  }
}

function onPanelMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (target.closest('.chat-header') || target.closest('.resize-handle')) return
}

function onTemperatureChange(val: number) {
  temperature.value = val
  updateModel(currentProvider.value, currentModelId.value, undefined, undefined, val, maxTokens.value, contextLength.value)
  saveAgentSettings()
}
function onMaxTokensChange(val: number) {
  maxTokens.value = val
  updateModel(currentProvider.value, currentModelId.value, undefined, undefined, temperature.value, val, contextLength.value)
  saveAgentSettings()
}
function onPersonaChange(val: string) { personaPreset.value = val; saveAgentSettings() }

async function onModelChange(provider: string, modelId: string): Promise<void> {
  const oldModelId = currentModelId.value
  currentProvider.value = provider
  currentModelId.value = modelId
  settingsStore.aiCloudProvider = provider as any
  settingsStore.aiCloudModel = modelId
  if (settingsStore.aiProviderMode !== 'cloud') {
    settingsStore.aiProviderMode = 'cloud'
  }
  const info = getModelInfo(modelId)
  const prevInfo = getModelInfo(oldModelId)
  const isCustom = ['openai-compatible', 'anthropic-compatible'].includes(provider)
  let contextWindow = isCustom ? 1048576 : 128000
  let maxOut = isCustom ? 65536 : 8192
  if (info) {
    contextWindow = info.contextLength
    maxOut = info.maxOutputTokens
    // 如果当前 contextLength 等于旧模型上限（用户未手动调低），则跟随新模型上限
    const oldMax = prevInfo?.contextLength || 128000
    if (contextLength.value >= oldMax) {
      contextLength.value = info.contextLength
    } else {
      contextLength.value = Math.min(contextLength.value, info.contextLength)
    }
    const oldMaxOut = prevInfo?.maxOutputTokens || 8192
    if (maxTokens.value >= oldMaxOut) {
      maxTokens.value = info.maxOutputTokens
    } else {
      maxTokens.value = Math.min(maxTokens.value, info.maxOutputTokens)
    }
    const maxTemp = ['anthropic', 'zhipu', 'minimax'].includes(provider) ? 100 : 200
    temperature.value = Math.min(temperature.value, maxTemp)
    const validLevels = getThinkingLevels(modelId)
    if (!validLevels.some(l => l.value === thinkingLevel.value)) {
      thinkingLevel.value = 'off'
      updateThinkingLevel('off')
      try { agentStorage.set('agent_thinking_level', 'off') } catch {}
    }
  }
  const apiKey = await loadApiKey(provider)
  if (!apiKey) {
    const { toastWarn } = await import('../composables/useToast')
    const providerNames: Record<string, string> = {
      anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google',
      deepseek: 'DeepSeek', groq: 'Groq', openrouter: 'OpenRouter',
      zhipu: '智谱', qwen: '通义千问', minimax: 'MiniMax', kimi: 'Kimi',
    }
    toastWarn(`${providerNames[provider] || provider} 尚未配置 API Key，请在供应商面板中填入`)
  }
  await updateModel(provider, modelId, undefined, apiKey || undefined, temperature.value, maxTokens.value, contextWindow, maxOut)
  try {
    agentStorage.set('agent_current_model', { provider, modelId, contextLength: contextLength.value })
  } catch {}
  saveAgentSettings()
}

function onThinkingLevelChange(level: string): void {
  thinkingLevel.value = level as ThinkingLevel
  updateThinkingLevel(level as ThinkingLevel)
  try {
    agentStorage.set('agent_thinking_level', level)
  } catch {}
}

async function onSearchEngineChange(engine: string): Promise<void> {
  const oldEngine = searchEngine.value

  if (searchApiKey.value) {
    await storeApiKey('search_' + oldEngine, searchApiKey.value)
  } else {
    await removeApiKey('search_' + oldEngine)
  }

  searchEngine.value = engine

  const newKey = await loadApiKey('search_' + engine)
  searchApiKey.value = newKey || ''

  try {
    agentStorage.set('agent_search_config', { engine })
  } catch {}

  await refreshSearchConfig()
}

function onSearchApiKeyChange(key: string): void {
  searchApiKey.value = key
  saveSearchConfig()
}

async function onApiKeyChange(provider: string, apiKey: string): Promise<void> {
  if (provider === 'custom') {
    if (settingsStore.aiProviderMode === 'custom') {
      await updateModel(
        settingsStore.aiCustomType,
        settingsStore.aiCustomModel,
        settingsStore.aiCustomBaseUrl,
        apiKey || undefined,
        temperature.value,
        maxTokens.value,
        contextLength.value,
      )
    }
  } else {
    if (settingsStore.aiProviderMode === 'cloud' && settingsStore.aiCloudProvider === provider) {
      await updateModel(
        provider,
        currentModelId.value,
        undefined,
        apiKey || undefined,
        temperature.value,
        maxTokens.value,
      )
    }
  }
}

async function onProviderChange(provider: string, modelId: string): Promise<void> {
  await onModelChange(provider, modelId)
}

function onToggleSkill(skillId: string): void {
  toggleSkill(skillId)
  skills.value = getAllSkills()
}

async function onAddMcp(config: MCPConnectionConfig): Promise<void> {
  try {
    await addConnection(config)
    const conn = mcpConnections.value.find(c => c.id === config.id)
    if (conn?.status === 'error') {
      const { toastWarn } = await import('../composables/useToast')
      toastWarn(`MCP 连接失败: ${conn.error || '未知错误'}`)
    }
  } catch (err) {
    const { toastWarn } = await import('../composables/useToast')
    toastWarn(`MCP 添加失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function onToggleMcp(serverId: string): Promise<void> {
  await toggleConnection(serverId)
}

async function onRemoveMcp(serverId: string): Promise<void> {
  await removeConnection(serverId)
}

async function saveSearchConfig(): Promise<void> {
  try {
    agentStorage.set('agent_search_config', {
      engine: searchEngine.value,
    })
  } catch {}
  if (searchApiKey.value) {
    await storeApiKey('search_' + searchEngine.value, searchApiKey.value)
  } else {
    await removeApiKey('search_' + searchEngine.value)
  }
  await refreshSearchConfig()
}

async function loadSearchConfig(): Promise<void> {
  try {
    const raw = localStorage.getItem('agent_search_config')
    if (raw) {
      const cfg = JSON.parse(raw)
      searchEngine.value = cfg.engine || 'tavily'
    }
    const key = await loadApiKey('search_' + searchEngine.value)
    searchApiKey.value = key || ''
  } catch {}
}

function loadThinkingLevel(): void {
  try {
    const saved = localStorage.getItem('agent_thinking_level') as ThinkingLevel | null
    if (saved && getThinkingLevels(currentModelId.value).some(l => l.value === saved)) {
      thinkingLevel.value = saved
      updateThinkingLevel(saved)
    }
  } catch {}
}

function saveAgentSettings(): void {
  try {
    agentStorage.set('agent_settings', {
      temperature: temperature.value,
      maxTokens: maxTokens.value,
      contextLength: contextLength.value,
      personaPreset: personaPreset.value,
    })
  } catch {}
}

function loadAgentSettings(): void {
  try {
    const raw = localStorage.getItem('agent_settings')
    if (raw) {
      const s = JSON.parse(raw)
      if (s.temperature !== undefined) temperature.value = s.temperature
      if (s.maxTokens !== undefined) maxTokens.value = s.maxTokens
      if (s.contextLength !== undefined) contextLength.value = s.contextLength
      if (s.personaPreset !== undefined) personaPreset.value = s.personaPreset
    }
  } catch {}
}

async function loadCurrentModel(): Promise<void> {
  try {
    const raw = localStorage.getItem('agent_current_model')
    if (raw) {
      const cfg = JSON.parse(raw)
      currentProvider.value = cfg.provider || 'deepseek'
      currentModelId.value = cfg.modelId || 'deepseek-chat'
      if (cfg.contextLength) contextLength.value = cfg.contextLength
    }
    const info = getModelInfo(currentModelId.value)
    if (info && !localStorage.getItem('agent_current_model')) {
      contextLength.value = info.contextLength
    }
  } catch {}
}

function savePanelState(): void {
  try {
    agentStorage.set('agent_panel', {
      x: panelX.value, y: panelY.value, w: panelW.value, h: panelH.value,
    })
  } catch {}
}

function loadPanelState(): void {
  try {
    const raw = localStorage.getItem('agent_panel')
    if (raw) {
      const s = JSON.parse(raw)
      panelX.value = s.x ?? window.innerWidth - 440
      panelY.value = s.y ?? 60
      panelW.value = s.w ?? 420
      panelH.value = s.h ?? 500
    }
  } catch {}
}

function resetPosition(): void {
  panelW.value = 420
  panelH.value = 500
  panelX.value = (window.innerWidth - panelW.value) / 2
  panelY.value = (window.innerHeight - panelH.value - INPUT_BAR_HEIGHT) / 2
  isMinimized.value = false
  savePanelState()
}

function updateSettingsPosition(): void {
  const bar = inputBarRef.value
  if (!bar) return
  const btn = bar.menuBtnRef
  if (!btn) return
  const rect = btn.getBoundingClientRect()
  settingsPos.value = {
    x: rect.left,
    y: window.innerHeight - rect.top + 8,
  }
  settingsDragged.value = false
}

function onToggleSettings(): void {
  if (settingsOpen.value) {
    closeSettings()
  } else {
    openSettings()
    nextTick(updateSettingsPosition)
  }
}

/* ── 记忆库面板事件处理（P3-3-4 新增）── */

function updateArchivePanelPosition(): void {
  // 定位到面板右侧偏上位置
  const panelEl = document.querySelector('.agent-chat') as HTMLElement | null
  if (panelEl) {
    const rect = panelEl.getBoundingClientRect()
    archivePanelPos.value = {
      x: rect.right + 8,
      y: Math.max(8, rect.top),
    }
  } else {
    archivePanelPos.value = { x: window.innerWidth - 440, y: 80 }
  }
  archivePanelDragged.value = false
}

function toggleArchivePanel(): void {
  if (archivePanelOpen.value) {
    archivePanelOpen.value = false
  } else {
    archivePanelOpen.value = true
    nextTick(updateArchivePanelPosition)
  }
}

function onOpenChunk(hookId: string, chunkId: string): void {
  chunkViewerHookId.value = hookId
  chunkViewerChunkId.value = chunkId
  // 片段查看器定位在记忆库面板右侧
  chunkViewerPos.value = {
    x: archivePanelPos.value.x + 440,
    y: archivePanelPos.value.y,
  }
  chunkViewerDragged.value = false
  chunkViewerOpen.value = true
}

async function loadDrawerSessions(): Promise<void> {
  try {
    sessions.value = await listSessions()
  } catch {}
}

async function onDrawerSelect(sessionId: string): Promise<void> {
  sessionDrawerOpen.value = false
  await switchSession(sessionId)
}

async function onDrawerDelete(sessionId: string): Promise<void> {
  try {
    // H6.2: 删除会话前归档该会话（避免数据丢失）
    try {
      const { useMemoryArchive } = await import('@/memory-archive/useMemoryArchive')
      await useMemoryArchive().archiveSession(sessionId)
    } catch (err) {
      console.warn('[AgentChat] 删除前归档失败（不影响删除）:', err)
    }
    const isCurrent = sessionId === currentSessionId.value
    await deleteSession(sessionId)
    // 级联删除：移除所有从该会话复制的文境副本
    cascadeDeleteManuscriptClones(sessionId)
    await loadDrawerSessions()
    if (isCurrent) {
      await newSession()
      await loadDrawerSessions()
    }
  } catch {}
}

/** 级联删除：源会话删除时，移除当前会话中从该会话复制的文境副本 */
function cascadeDeleteManuscriptClone(sourceSessionId: string): void {
  for (const msg of messages.value) {
    if (!msg.blocks) continue
    const hadClone = msg.blocks.some(b => b.type === 'manuscript' && (b as any).sourceSessionId === sourceSessionId)
    if (hadClone) {
      msg.blocks = msg.blocks.filter(b => !(b.type === 'manuscript' && (b as any).sourceSessionId === sourceSessionId))
    }
  }
}

function cascadeDeleteManuscriptClones(sourceSessionId: string): void {
  cascadeDeleteManuscriptClone(sourceSessionId)
}

async function onDrawerNewSession(): Promise<void> {
  sessionDrawerOpen.value = false
  await newSession()
  await loadDrawerSessions()
}

watch(settingsOpen, (open) => { if (open) nextTick(updateSettingsPosition) })
watch(sessionDrawerOpen, (open) => { if (open) loadDrawerSessions() })
watch(() => isInitialized.value, async (v) => {
  if (v) await ensureMcpLoaded()
})

function onSessionTitleUpdated(): void {
  loadDrawerSessions()
}

onMounted(async () => {
  loadPanelState()
  await loadSearchConfig()
  loadThinkingLevel()
  await loadCurrentModel()
  loadAgentSettings()
  window.addEventListener('ws-session-title-updated', onSessionTitleUpdated)

  registerExecutor(async (task) => {
    const ok = await ensureInitialized()
    if (!ok) {
      return { success: false, output: '主 Agent 未初始化，无法创建子 Agent', duration: 0 }
    }

    try {
      let visionProviderConfig: any = undefined
      if (task.images && task.images.length > 0 && !modelSupportsVision(currentModelId.value)) {
        const vProvider = settingsStore.visionSubAgentProvider
        const vModel = settingsStore.visionSubAgentModel
        let provider = vProvider
        let modelId = vModel
        if (!provider || !modelId) {
          const visionModels = getVisionModels()
          if (visionModels.length > 0) {
            provider = visionModels[0].provider
            modelId = visionModels[0].id
          }
        }
        if (provider && modelId) {
          const apiKey = await loadApiKey(provider)
          if (apiKey) {
            const info = getModelInfo(modelId)
            visionProviderConfig = {
              mode: 'cloud',
              provider,
              modelId,
              apiKey,
              supportsVision: true,
              contextWindow: info?.contextLength,
              maxTokens: info ? Math.min(info.maxOutputTokens, 4096) : 4096,
            }
          }
        }
      }

      const subBackend = await createSubBackend(task.skillIds, visionProviderConfig)

      // 任务 4 P4：子 Agent 长任务跟踪（checkpoint + 心跳，复用 longTaskStore 持久层）
      trackSubAgentLongTask(task.id, subBackend, task.prompt, task.type)

      const startTime = Date.now()
      const promptOptions: any = {}
      if (task.images && task.images.length > 0) {
        promptOptions.images = task.images
      }
      const result = await subBackend.prompt(task.prompt, promptOptions)
      const duration = Date.now() - startTime

      await untrackSubAgentLongTask(task.id, 'completed')
      subBackend.dispose()

      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result),
        duration,
      }
    } catch (err) {
      // 任务 4 P4：失败时标记子 Agent 长任务为 failed（track 未调用时 updateTask 静默 warn，无副作用）
      await untrackSubAgentLongTask(task.id, 'failed').catch(() => {})
      return {
        success: false,
        output: err instanceof Error ? err.message : String(err),
        duration: 0,
      }
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('ws-session-title-updated', onSessionTitleUpdated)
})
</script>

<style scoped>
.agent-chat {
  position: fixed;
  z-index: 9998;
  display: flex;
  flex-direction: column;
  border-radius: var(--agent-radius);
  background: transparent;
  border: none;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 2px 12px rgba(0,0,0,0.2);
  overflow: clip;
  transition: box-shadow var(--agent-transition);
  pointer-events: auto;
}

.agent-chat:hover {
  box-shadow: 0 0 0 1px rgba(255,255,255,0.1), 0 4px 20px rgba(0,0,0,0.3);
}

/* 任务 4 P2：断点恢复横幅 */
.resume-banner {
  padding: 6px 10px;
  background: rgba(99, 102, 241, 0.12);
  border-bottom: 1px solid rgba(99, 102, 241, 0.25);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.resume-banner-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.resume-banner-icon {
  color: rgb(129, 140, 248);
  flex-shrink: 0;
}
.resume-banner-info {
  flex: 1;
  min-width: 0;
}
.resume-banner-title {
  font-size: 12px;
  font-weight: 600;
  color: rgb(199, 210, 254);
}
.resume-banner-desc {
  font-size: 11px;
  color: rgba(199, 210, 254, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.resume-btn {
  flex-shrink: 0;
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}
.resume-btn-primary {
  background: rgb(99, 102, 241);
  color: white;
}
.resume-btn-primary:hover {
  background: rgb(79, 70, 229);
}
.resume-btn-secondary {
  background: transparent;
  color: rgba(199, 210, 254, 0.8);
  border: 1px solid rgba(199, 210, 254, 0.3);
}
.resume-btn-secondary:hover {
  background: rgba(199, 210, 254, 0.1);
}

/* 任务 4 P3：长任务进度条（面板底部，输入框上方） */
.long-task-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 24px 5px 12px; /* 右侧留白避开 resize-handle 角标 */
  background: rgba(16, 185, 129, 0.08);
  border-top: 1px solid rgba(16, 185, 129, 0.2);
  font-size: 11px;
  color: rgba(209, 250, 229, 0.85);
  flex-shrink: 0;
}
.ltp-heartbeat {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ltp-hb-alive {
  background: rgb(52, 211, 153);
  animation: ltp-blink 1.5s ease-in-out infinite;
}
.ltp-hb-stale {
  background: rgb(251, 191, 36);
  animation: ltp-blink 2.5s ease-in-out infinite;
}
.ltp-hb-dead {
  background: rgb(248, 113, 113);
}
@keyframes ltp-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.ltp-label {
  font-weight: 600;
  color: rgb(167, 243, 208);
}
.ltp-duration { font-variant-numeric: tabular-nums; }
.ltp-sep { color: rgba(209, 250, 229, 0.35); }
.ltp-tool {
  color: rgba(209, 250, 229, 0.65);
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 方向 C：plan 进度数 + 当前步骤标题 */
.ltp-plan {
  font-variant-numeric: tabular-nums;
  color: rgb(167, 243, 208);
  font-weight: 600;
  flex-shrink: 0;
}
.ltp-step {
  color: rgba(209, 250, 229, 0.85);
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltp-cancel {
  margin-left: auto;
  flex-shrink: 0;
  padding: 2px 10px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: transparent;
  color: rgb(252, 165, 165);
  cursor: pointer;
  transition: background 0.15s;
}
.ltp-cancel:hover {
  background: rgba(248, 113, 113, 0.15);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: grab;
  user-select: none;
  border-bottom: 1px solid var(--agent-border);
  background: var(--agent-bg);
  backdrop-filter: blur(var(--agent-blur));
  flex-shrink: 0;
}

.chat-header:active { cursor: grabbing }

.header-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--agent-text);
  font-family: var(--agent-font);
  cursor: pointer;
  user-select: none;
  transition: color 0.15s;
}

.header-title:hover {
  color: var(--agent-primary);
}

.header-actions {
  display: flex;
  gap: 4px;
}

.header-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  padding: 2px 6px;
  border-radius: 6px;
  color: var(--agent-text-secondary);
  transition: background 0.15s, color 0.15s;
}

.header-btn:hover {
  background: var(--agent-hover-bg);
  color: var(--agent-text);
}

.header-btn.active {
  color: var(--agent-primary);
}

.resize-handle {
  position: absolute;
  right: 0; bottom: 0;
  width: 16px; height: 16px;
  cursor: nwse-resize;
  opacity: 0.3;
  z-index: 1;
}
.resize-handle::after {
  content: '';
  position: absolute;
  right: 3px; bottom: 3px;
  width: 8px; height: 8px;
  border-right: 2px solid var(--agent-text-secondary);
  border-bottom: 2px solid var(--agent-text-secondary);
}

.minimized .chat-header { border-bottom: none }

.context-bar {
  flex: 1;
  max-width: 120px;
  height: 4px;
  background: var(--agent-bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
  position: relative;
  align-self: center;
  margin: 0 8px;
}
.context-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--agent-primary);
  transition: width 0.3s ease, background 0.3s ease;
}
.context-bar-fill.warn {
  background: var(--color-warning);
}
.context-bar-fill.danger {
  background: var(--color-danger);
}
.context-bar-text {
  position: absolute;
  top: -14px;
  right: 0;
  font-size: var(--text-micro-font-size);
  color: var(--agent-text-tertiary);
  line-height: 1;
}

/* H3.3: 归档阈值标记 */
.context-bar-marker {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--agent-warning, #f39c12);
  opacity: 0.7;
  pointer-events: none;
  z-index: 1;
}

.sub-agent-section {
  flex-shrink: 0;
  border-top: 1px solid var(--agent-border);
  background: var(--agent-bg);
}

.sub-agent-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  transition: color 0.15s, background 0.15s;
}

.sub-agent-toggle:hover {
  color: var(--agent-text);
  background: var(--agent-hover-bg);
}

.toggle-icon {
  font-size: var(--font-size-xs);
  transition: transform 0.2s;
}

.toggle-label {
  font-weight: var(--font-weight-medium);
  font-family: var(--agent-font);
}

.active-badge {
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
  color: var(--agent-primary);
  animation: ws-pulse 1.5s infinite;
}

.sub-agent-panels {
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid var(--agent-border);
}


</style>
