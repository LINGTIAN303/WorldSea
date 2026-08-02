<template>
  <div
    class="agent-panel agent-chat"
    :class="{ minimized: isMinimized, pinned: isPinned }"
    :style="panelStyle"
    @mousedown="onPanelMouseDown"
  >
    <ChatHeader
      :agent-font-family="agentFontFamily"
      :context-bar-title="contextBarTitle"
      :context-usage="contextUsage"
      :archive-threshold="archiveThreshold"
      :archive-threshold-pct="archiveThresholdPct"
      :accent-color="profile.accentColor"
      :is-pinned="isPinned"
      :is-minimized="isMinimized"
      @click-title="sessionDrawerOpen = !sessionDrawerOpen"
      @toggle-archive="toggleArchivePanel"
      @toggle-pin="togglePin"
      @toggle-minimize="toggleMinimize"
      @hide="hide"
      @header-drag-start="onDragStart"
    />

    <div v-if="!isMinimized && isRustBackend" class="rust-mode-banner">
      Rust 实验模式：仅支持核心对话，深度模式/长任务/A2UI/终端/子 Agent 等高级功能暂不可用
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
      <ResumeBanner
        :tasks="resumableTasks"
        @resume="resumeTask"
        @discard="discardTask"
      />
      <AgentMessageList
        ref="messageListRef"
        :messages="messages"
        :is-streaming="isStreaming"
        :last-assistant-has-content="lastAssistantHasContent"
        :last-assistant-has-thinking="lastAssistantHasThinking"
        :a2ui-surfaces="a2uiSurfaces"
        :resolve-data-binding="resolveDataBinding"
        :chat-mode="activeChatMode"
        :use-deep-layout="activeChatMode === 'deep'"
        @a2ui-action="onA2UIAction"
        @copy="copyMessage"
        @retry="retryMessage"
        @block-action="onBlockAction"
        @manuscript-local-action="onManuscriptLocalAction"
        @open-archive-panel="toggleArchivePanel"
      />

      <ManuscriptShelf :messages="messages" />

      <SubAgentSection
        :agents="subAgentList"
        :expanded="subAgentExpanded"
        :active-count="activeSubAgentCount"
        @update:expanded="subAgentExpanded = $event"
        @toggle-visible="toggleSubAgentVisible"
        @remove="removeSubAgent"
      />

      <div class="resize-handle" @mousedown.left="onResizeStart"></div>
    </template>
    <!-- 任务 4 P3：长任务进度条（面板底部，仅活跃任务时显示） -->
    <LongTaskProgressBar
      v-if="hasActiveTask && activeTask"
      :heartbeat-status="heartbeatStatus"
      :heartbeat-title="heartbeatTitle"
      :elapsed-sec="elapsedSec"
      :plan-progress="planProgress"
      :turn-count="activeTask.turnCount"
      :current-plan-step="currentPlanStep"
      :current-tool="activeTask.currentTool"
      @abort="onAbort"
    />
    <!-- Loop Engineering 批次4：Loop Control 状态面板（仅 Rust 后端显示）
         生命周期由本组件 watch activeTask.taskId 管理：任务出现时 create，结束时 destroy。
         LoopControlStatusBar 内部 v-if="taskId && taskState" 控制实际渲染。 -->
    <LoopControlStatusBar
      v-if="isRustBackend"
      :task-id="loopControlTaskId"
    />
    <!-- ToT 批次4：Tree of Thoughts 状态面板（仅 Rust 后端 + 激活 ToT 会话时显示）
         生命周期由 /tot 命令触发 create，会话切换/组件卸载时 destroy。
         ToTStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。 -->
    <ToTStatusBar
      v-if="isRustBackend && totSessionId"
      :session-id="totSessionId"
    />
    <!-- GoT 批次4：Graph of Thoughts 状态面板（仅 Rust 后端 + 激活 GoT 会话时显示）
         生命周期由 /got 命令触发 create，会话切换/组件卸载时 destroy。
         GoTStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。 -->
    <GoTStatusBar
      v-if="isRustBackend && gotSessionId"
      :session-id="gotSessionId"
    />
    <!-- Multi-Agent 批次4：多智能体协作状态面板（仅 Rust 后端 + 激活 MA 会话时显示）
         生命周期由 /ma 命令触发 create，会话切换/组件卸载时 destroy。
         MultiAgentStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。 -->
    <MultiAgentStatusBar
      v-if="isRustBackend && maSessionId"
      :session-id="maSessionId"
    />
    <!-- Supervisor 批次4：中心化调度状态面板（仅 Rust 后端 + 激活 SUP 会话时显示）
         生命周期由 /supervisor 命令触发 create，会话切换/组件卸载时 destroy。
         SupervisorStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。 -->
    <SupervisorStatusBar
      v-if="isRustBackend && supSessionId"
      :session-id="supSessionId"
    />
    <!-- Router 批次4：路由决策状态面板（仅 Rust 后端 + 激活 RTR 会话时显示）
         生命周期由 /router 命令触发 create，会话切换/组件卸载时 destroy。
         RouterStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
         Router 是纯决策节点：LLM 根据输入选择目标分支，不执行子 Agent。 -->
    <RouterStatusBar
      v-if="isRustBackend && routerSessionId"
      :session-id="routerSessionId"
    />
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
    @skills-changed="onSkillsChanged"
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
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useAgent } from './composables/useAgent'
import { usePlanStore } from './composables/usePlanStore'
import { useAgentCommands } from './composables/useAgentCommands'
import type { AgentCommand } from './composables/useAgentCommands'
import type { ImageAttachment, FileAttachment } from '@agent/index'
import { useFileStore } from '@worldsmith/entity-core'
import { storeImages as storeImagesToBackend } from '@agent/index'
import AgentMessageList from './AgentMessageList.vue'
import AgentInputBar from './AgentInputBar.vue'
import AgentSettingsPanel from './AgentSettingsPanel.vue'
import ArchivePanel from './ArchivePanel.vue'
import ChunkViewer from './ChunkViewer.vue'
import AgentSessionDrawer from './AgentSessionDrawer.vue'
import TerminalPanel from './TerminalPanel.vue'
import ManuscriptShelf from './blocks/ManuscriptShelf.vue'
import EntityMiniPanel from './EntityMiniPanel.vue'
import { FloatingPanel } from '@worldsmith/ui-kit'
import { useEntityMiniPanel } from './composables/useEntityMiniPanel'
import FontInstallConfirm from '../ui/font/FontInstallConfirm.vue'
import { setFontInstallConfirm } from './setFontTool'
import { useOrchestrator } from './composables/useOrchestrator'
import { usePersonaFont } from '../space/composables/usePersonaFont'
import { useFontStore } from '../stores/fontStore'
import { modelSupportsVision, getVisionModels, getModelInfo } from '@worldsmith/agent-runtime'
import { loadApiKey } from '@agent/index'

// 拆分后的子组件
import ChatHeader from './chat/ChatHeader.vue'
import ResumeBanner from './chat/ResumeBanner.vue'
import LongTaskProgressBar from './chat/LongTaskProgressBar.vue'
import LoopControlStatusBar from './chat/LoopControlStatusBar.vue'
import ToTStatusBar from './chat/ToTStatusBar.vue'
import GoTStatusBar from './chat/GoTStatusBar.vue'
import MultiAgentStatusBar from './chat/MultiAgentStatusBar.vue'
import SupervisorStatusBar from './chat/SupervisorStatusBar.vue'
import RouterStatusBar from './chat/RouterStatusBar.vue'
import SubAgentSection from './chat/SubAgentSection.vue'

// 拆分后的 composables
import { useChatPanel } from './chat/useChatPanel'
import { useChatSettings } from './chat/useChatSettings'
import { useChatMetrics } from './chat/useChatMetrics'
import { useArchivePanel } from './chat/useArchivePanel'
import { useChatSession } from './chat/useChatSession'
import { useManuscriptActions, formatBlockActionDisplay } from './chat/useManuscriptActions'
import { useLongTaskProgress } from './chat/useLongTaskProgress'
import { useSettingsPanel } from './chat/useSettingsPanel'
import { useLoopControlRust } from './composables/useLoopControlRust'
import { useToTRust } from './composables/useToTRust'
import { useGoTRust } from './composables/useGoTRust'
import { useMultiAgentRust } from './composables/useMultiAgentRust'
import { useSupervisorRust } from './composables/useSupervisorRust'
import { useRouterRust } from './composables/useRouterRust'
// 以下 import 原位于 <script lang="ts"> 块，因组件逻辑移入 setup 块而合并至此
import { useMcpConnections } from './composables/useMcpConnections'
import { useSettingsStore } from '../stores/settingsStore'
import { trackSubAgentLongTask, untrackSubAgentLongTask } from './composables/useOrchestrator'

/* ── 字体 / persona ── */
const { fontFamily, profile } = usePersonaFont()
const fontStore = useFontStore()
const agentFontFamily = computed(() => fontStore.prefs.agent.family || fontFamily.value || '')

/* ── useAgent 解构 ── */
const {
  messages, isStreaming, sendMessage, sendBlockAction, abort, hide, newSession,
  isPinned, totalUsage, lastRequestUsage, cumulativeUsage, cacheHitRate, updateThinkingLevel, updateModel, refreshSearchConfig,
  a2uiSurfaces, resolveDataBinding, switchSession, currentSessionId, isInitialized,
  terminalVisible, ptyId, logBridge, openTerminal, closeTerminal, writePtyInput, resizePty,
  ensureInitialized, createSubBackend,
  activeChatMode, lockedChatMode, setChatMode,
  resumableTasks, resumeTask, discardTask,
  activeTask, heartbeatStatus, hasActiveTask,
  // 批次4 UI 集成：ToT 创建需要 RustProviderConfig，从 useAgentRustAdapter 透传
  getProviderConfig: rustGetProviderConfig,
} = useAgent()

/* ── plan 进度（进度条叠加 plan 完成数 + 当前 in_progress 步骤标题） ── */
const planStore = usePlanStore()
const planProgress = planStore.progress
const currentPlanStep = computed(() => {
  const step = planStore.items.value.find(i => i.status === 'in_progress')
  return step?.title || ''
})

/* ── useMcpConnections / useAgentCommands / useOrchestrator / miniPanel ── */
const { connections: mcpConnections, addConnection, removeConnection, toggleConnection, ensureLoaded: ensureMcpLoaded } = useMcpConnections()
const { commands, settingsOpen, closeSettings, openSettings, register } = useAgentCommands()
const { subAgents, toggleSubAgentVisible: toggleSubAgentVisible, removeSubAgent: removeSubAgent, registerExecutor } = useOrchestrator()
const miniPanel = useEntityMiniPanel()

const subAgentList = computed(() => Array.from(subAgents.values()))
const activeSubAgentCount = computed(() => subAgentList.value.filter(a => a.status === 'running').length)
const subAgentExpanded = ref(true)

/* ── 长任务进度计时器 ── */
const { elapsedSec, heartbeatTitle } = useLongTaskProgress({
  activeTask, heartbeatStatus, hasActiveTask,
})

/* ── 面板状态（位置/大小/最小化/pin/drag/resize） ── */
const {
  isMinimized, sessionDrawerOpen, sessions,
  panelStyle, onDragStart, onResizeStart,
  togglePin, toggleMinimize, onPanelMouseDown,
  loadPanelState, resetPosition,
} = useChatPanel({ isPinned })

/* ── 设置（模型/温度/persona/thinking/search/skills/mcp + save/load） ── */
const {
  currentProvider, currentModelId,
  temperature, maxTokens, contextLength, personaPreset, thinkingLevel,
  searchEngine, searchApiKey, skills,
  THINKING_LEVELS, CHAT_MODES,
  maxOutputTokensForModel, maxContextLengthForModel, maxTemperatureForModel,
  onChatModeChange,
  onTemperatureChange, onMaxTokensChange, onPersonaChange,
  onModelChange, onThinkingLevelChange,
  onSearchEngineChange, onSearchApiKeyChange, onApiKeyChange, onProviderChange,
  onToggleSkill, onSkillsChanged,
  onAddMcp, onToggleMcp, onRemoveMcp,
  loadSearchConfig, loadThinkingLevel, saveAgentSettings, loadAgentSettings, loadCurrentModel,
} = useChatSettings({
  updateThinkingLevel, updateModel, refreshSearchConfig,
  activeChatMode, lockedChatMode, setChatMode,
  mcpConnections, addConnection, removeConnection, toggleConnection,
})

/* ── 上下文用量 / 成本 / 归档阈值 / 视觉子 Agent ── */
const {
  hasVisionSubAgent, calculatedCost, contextUsage,
  archiveThreshold, archiveThresholdPct, contextBarTitle,
} = useChatMetrics({
  currentModelId, currentProvider, contextLength, lastRequestUsage, totalUsage,
})

/* ── 设置浮窗（位置/拖拽/开关） ── */
const messageListRef = ref<InstanceType<typeof AgentMessageList>>()
const inputBarRef = ref<InstanceType<typeof AgentInputBar>>()
const fontInstallConfirm = ref<InstanceType<typeof FontInstallConfirm> | null>(null)

setFontInstallConfirm(async (family: string) => {
  if (!fontInstallConfirm.value) return false
  return fontInstallConfirm.value.show(family)
})

const inputBarWidth = ref(520)
const slashMode = ref(false)
const slashIndex = ref(0)
const filteredCommands = computed(() => [...commands.value])

const {
  settingsPos, settingsDragged, onSettingsDragStart,
  updateSettingsPosition, onToggleSettings,
} = useSettingsPanel({ settingsOpen, openSettings, closeSettings, inputBarRef })

/* ── 记忆库面板 + 片段查看器 ── */
const {
  archivePanelOpen, archivePanelPos, archivePanelDragged, onArchiveDragStart,
  chunkViewerOpen, chunkViewerHookId, chunkViewerChunkId, chunkViewerPos, chunkViewerDragged,
  onChunkViewerDragStart,
  toggleArchivePanel, onOpenChunk,
} = useArchivePanel()

/* ── 文境本地操作 ── */
const { onManuscriptLocalAction, cascadeDeleteManuscriptClones } = useManuscriptActions({ messages })

/* ── 会话 drawer ── */
const {
  loadDrawerSessions, onDrawerSelect, onDrawerDelete, onDrawerNewSession, onSessionTitleUpdated,
} = useChatSession({
  sessions, sessionDrawerOpen,
  switchSession, newSession, currentSessionId,
  cascadeDeleteManuscriptClones,
})

/* ── 消息相关 computed / 方法 ── */
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

function onA2UIAction(surfaceId: string, action: { name: string; data?: unknown }): void {
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

function copyMessage(msg: { content?: string }): void {
  navigator.clipboard.writeText(msg.content || '').catch(() => {})
}

async function retryMessage(msg: { content?: string }): Promise<void> {
  if (isStreaming.value) return
  await sendMessage(msg.content || '')
  await nextTick()
  messageListRef.value?.scrollToBottom()
}

async function onInputSend(text: string, rawAttachments: unknown[]): Promise<void> {
  if (isStreaming.value) return
  const images: ImageAttachment[] = []
  const files: FileAttachment[] = []
  const fileStore = useFileStore()

  for (const att of rawAttachments) {
    const a = att as { type?: string; data?: string; mimeType?: string; name?: string; textContent?: string }
    if (a.type === 'image' && a.data && a.mimeType) {
      images.push({ data: a.data, mimeType: a.mimeType })
    } else if (a.textContent) {
      const name = a.name || 'file'
      const path = `/uploads/${name}`
      const content = a.textContent
      const size = new Blob([content]).size
      await fileStore.add(name, path, a.mimeType || 'text/plain', size, content)
      files.push({ name, content })
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

/* ── watch ── */
watch(settingsOpen, (open) => { if (open) nextTick(updateSettingsPosition) })
watch(sessionDrawerOpen, (open) => { if (open) loadDrawerSessions() })
watch(() => isInitialized.value, async (v) => {
  if (v) await ensureMcpLoaded()
})

/* ── onMounted / onUnmounted ── */
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
      let visionProviderConfig: {
        mode: string; provider: string; modelId: string; apiKey: string;
        supportsVision: boolean; contextWindow?: number; maxTokens: number;
      } | undefined = undefined
      if (task.images && task.images.length > 0 && !modelSupportsVision(currentModelId.value)) {
        const vProvider = settingsStoreLocal.visionSubAgentProvider
        const vModel = settingsStoreLocal.visionSubAgentModel
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
      const promptOptions: { images?: { data: string; mimeType: string }[] } = {}
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

/* ── 以下代码原位于 <script lang="ts"> 块，因需访问 setup 中的响应式变量而合并至此 ── */
const settingsStoreLocal = useSettingsStore()
const isRustBackend = computed(() => settingsStoreLocal.agentBackend === 'rust')

/* ── Loop Engineering：LoopController 生命周期管理（批次4） ──
 *
 * 监听 activeTask.taskId 变化，自动 create/destroy LoopController：
 *   - 新任务出现 → create(taskId)，并设置 loopControlTaskId 驱动 UI 挂载
 *   - 任务切换   → 先 destroy 旧 taskId，再 create 新 taskId
 *   - 任务结束   → destroy(taskId)，loopControlTaskId 置 null
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * 组件卸载时清理残留 LoopController，避免 Rust 端 registry 泄漏。
 *
 * 注意：create/destroy 为异步，可能产生竞态（用户快速切换任务）。
 * 当前采用顺序 await，简单可靠；若未来出现性能问题可引入 AbortController。
 */
const { create: lcCreate, destroy: lcDestroy } = useLoopControlRust()
const loopControlTaskId = ref<string | null>(null)

watch(
  () => activeTask.value?.taskId ?? null,
  async (newTaskId, oldTaskId) => {
    // 非 Rust 后端：跳过 Loop Control（TS 后端无此能力）
    if (!isRustBackend.value) {
      loopControlTaskId.value = null
      return
    }

    // 任务切换或结束：先销毁旧任务的 LoopController
    if (oldTaskId && oldTaskId !== newTaskId) {
      try {
        await lcDestroy(oldTaskId)
      } catch (err) {
        console.warn(`[AgentChat] LoopControl destroy 旧任务 ${oldTaskId} 失败:`, err)
      }
    }

    // 新任务出现：创建 LoopController（使用默认配置）
    if (newTaskId && newTaskId !== oldTaskId) {
      try {
        await lcCreate(newTaskId)
        loopControlTaskId.value = newTaskId
      } catch (err) {
        console.error(`[AgentChat] LoopControl create 新任务 ${newTaskId} 失败:`, err)
        loopControlTaskId.value = null
      }
    } else if (!newTaskId) {
      // 任务结束且无新任务
      loopControlTaskId.value = null
    }
  },
  { immediate: false },
)

onUnmounted(() => {
  // 组件卸载时清理残留的 LoopController，避免 Rust 端 registry 泄漏
  const tid = loopControlTaskId.value
  if (tid) {
    lcDestroy(tid).catch((err) => {
      console.warn(`[AgentChat] LoopControl destroy on unmount 失败:`, err)
    })
    loopControlTaskId.value = null
  }
})

/* ── Tree of Thoughts：ToT 会话生命周期管理（批次4 UI 集成） ──
 *
 * /tot 命令触发 ToT 会话创建并执行思维树探索：
 *   - 用户输入 `/tot <task>` → handleTotCommand → create + run
 *   - 会话切换 → destroy 旧会话（避免跨会话残留）
 *   - 组件卸载 → destroy 残留会话
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * ToTStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
 *
 * 与 LoopControl 的差异：
 * - LoopControl 监听 activeTask.taskId 变化被动驱动
 * - ToT 由 /tot 命令主动驱动，不依赖 activeTask
 */
const { create: totCreate, run: totRun, destroy: totDestroy, generateSessionId: totGenerateSessionId } = useToTRust()
const totSessionId = ref<string | null>(null)

/**
 * 处理 /tot 命令：从输入框解析 `/tot <task>` 并启动 ToT 探索
 *
 * # 流程
 * 1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
 * 2. 若已有 ToT 会话，先销毁（保证单会话）
 * 3. create(sessionId, providerConfig) → totSessionId 赋值
 * 4. 清空输入框
 * 5. 异步 run(sessionId, task)，事件流推送思维节点状态
 *
 * # 错误处理
 * - 非 Rust 后端：warn 并返回
 * - 任务为空：warn 并返回
 * - ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
 * - create 失败：error 并返回（totSessionId 保持 null）
 * - run 失败：error 但不重置 totSessionId（保留会话供查看错误状态）
 */
async function handleTotCommand(): Promise<void> {
  if (!isRustBackend.value) {
    console.warn('[AgentChat] ToT 命令仅在 Rust 后端可用')
    return
  }

  // 从输入框读取完整文本（/tot <task>）并去除命令前缀
  const raw = inputBarRef.value?.getInputText() ?? ''
  const task = raw.replace(/^\/tot\s*/, '').trim()
  if (!task) {
    console.warn('[AgentChat] /tot 命令缺少任务描述')
    return
  }

  // 获取 RustProviderConfig（必须在 ensureInitialized 后才可用）
  const providerConfig = rustGetProviderConfig()
  if (!providerConfig) {
    console.error('[AgentChat] ToT 创建失败：未获取到 RustProviderConfig（请先初始化主 Agent）')
    return
  }

  // 若已有 ToT 会话，先销毁（保证单会话）
  if (totSessionId.value) {
    await totDestroy(totSessionId.value).catch((err) => {
      console.warn('[AgentChat] 旧 ToT 会话销毁失败:', err)
    })
    totSessionId.value = null
  }

  // 创建新 ToT 会话并启动思维树探索
  const sessionId = totGenerateSessionId()
  try {
    await totCreate(sessionId, providerConfig)
    totSessionId.value = sessionId
    // 清空输入框
    inputBarRef.value?.setInputText('')
    // 启动思维树探索（异步执行，事件流会推送思维节点状态）
    void totRun(sessionId, task).catch((err) => {
      console.error(`[AgentChat] ToT 运行失败 session=${sessionId}:`, err)
    })
  } catch (err) {
    console.error('[AgentChat] ToT 创建失败:', err)
  }
}

// 注册 /tot 命令（与 skill/session/settings 同级，category=action）
onMounted(() => {
  register({
    id: 'tot',
    label: 'Tree of Thoughts',
    icon: 'git-branch',
    description: '使用树状思维探索解决复杂问题（/tot <task>）',
    category: 'action',
    handler: handleTotCommand,
  })
})

// 会话切换时清理 ToT 会话（避免跨会话残留）
watch(
  () => currentSessionId.value,
  async (newId, oldId) => {
    if (oldId && newId !== oldId && totSessionId.value) {
      await totDestroy(totSessionId.value).catch((err) => {
        console.warn('[AgentChat] ToT 会话切换清理失败:', err)
      })
      totSessionId.value = null
    }
  },
)

// 组件卸载时清理 ToT 会话，避免 Rust 端 registry 泄漏
onUnmounted(() => {
  if (totSessionId.value) {
    totDestroy(totSessionId.value).catch((err) => {
      console.warn('[AgentChat] ToT 会话卸载清理失败:', err)
    })
    totSessionId.value = null
  }
})

/* ── Graph of Thoughts：GoT 会话生命周期管理（批次4 UI 集成） ──
 *
 * /got 命令触发 GoT 会话创建并执行思维图探索（支持多父聚合的图结构）：
 *   - 用户输入 `/got <task>` → handleGotCommand → create + run
 *   - 会话切换 → destroy 旧会话（避免跨会话残留）
 *   - 组件卸载 → destroy 残留会话
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * GoTStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
 *
 * 与 ToT 的差异：
 * - GoT 节点支持多父聚合（parents 字段非空时为聚合节点）
 * - 每层扩展后增加聚合阶段（ThoughtsAggregated 事件）
 * - 配置参数扩展 4 个聚合参数（aggregationEnabled / aggregationThreshold 等）
 */
const {
  create: gotCreate,
  run: gotRun,
  destroy: gotDestroy,
  generateSessionId: gotGenerateSessionId,
} = useGoTRust()
const gotSessionId = ref<string | null>(null)

/**
 * 处理 /got 命令：从输入框解析 `/got <task>` 并启动 GoT 探索
 *
 * # 流程
 * 1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
 * 2. 若已有 GoT 会话，先销毁（保证单会话）
 * 3. create(sessionId, providerConfig) → gotSessionId 赋值
 * 4. 清空输入框
 * 5. 异步 run(sessionId, task)，事件流推送思维节点/聚合状态
 *
 * # 错误处理
 * - 非 Rust 后端：warn 并返回
 * - 任务为空：warn 并返回
 * - ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
 * - create 失败：error 并返回（gotSessionId 保持 null）
 * - run 失败：error 但不重置 gotSessionId（保留会话供查看错误状态）
 */
async function handleGotCommand(): Promise<void> {
  if (!isRustBackend.value) {
    console.warn('[AgentChat] GoT 命令仅在 Rust 后端可用')
    return
  }

  // 从输入框读取完整文本（/got <task>）并去除命令前缀
  const raw = inputBarRef.value?.getInputText() ?? ''
  const task = raw.replace(/^\/got\s*/, '').trim()
  if (!task) {
    console.warn('[AgentChat] /got 命令缺少任务描述')
    return
  }

  // 获取 RustProviderConfig（必须在 ensureInitialized 后才可用）
  const providerConfig = rustGetProviderConfig()
  if (!providerConfig) {
    console.error('[AgentChat] GoT 创建失败：未获取到 RustProviderConfig（请先初始化主 Agent）')
    return
  }

  // 若已有 GoT 会话，先销毁（保证单会话）
  if (gotSessionId.value) {
    await gotDestroy(gotSessionId.value).catch((err) => {
      console.warn('[AgentChat] 旧 GoT 会话销毁失败:', err)
    })
    gotSessionId.value = null
  }

  // 创建新 GoT 会话并启动思维图探索
  const sessionId = gotGenerateSessionId()
  try {
    await gotCreate(sessionId, providerConfig)
    gotSessionId.value = sessionId
    // 清空输入框
    inputBarRef.value?.setInputText('')
    // 启动思维图探索（异步执行，事件流会推送思维节点/聚合状态）
    void gotRun(sessionId, task).catch((err) => {
      console.error(`[AgentChat] GoT 运行失败 session=${sessionId}:`, err)
    })
  } catch (err) {
    console.error('[AgentChat] GoT 创建失败:', err)
  }
}

// 注册 /got 命令（与 /tot 同级，category=action）
onMounted(() => {
  register({
    id: 'got',
    label: 'Graph of Thoughts',
    icon: 'git-merge',
    description: '使用图状思维探索解决复杂问题（支持多父聚合，/got <task>）',
    category: 'action',
    handler: handleGotCommand,
  })
})

// 会话切换时清理 GoT 会话（避免跨会话残留）
watch(
  () => currentSessionId.value,
  async (newId, oldId) => {
    if (oldId && newId !== oldId && gotSessionId.value) {
      await gotDestroy(gotSessionId.value).catch((err) => {
        console.warn('[AgentChat] GoT 会话切换清理失败:', err)
      })
      gotSessionId.value = null
    }
  },
)

// 组件卸载时清理 GoT 会话，避免 Rust 端 registry 泄漏
onUnmounted(() => {
  if (gotSessionId.value) {
    gotDestroy(gotSessionId.value).catch((err) => {
      console.warn('[AgentChat] GoT 会话卸载清理失败:', err)
    })
    gotSessionId.value = null
  }
})

/* ── Multi-Agent：多智能体协作会话生命周期管理（批次4 UI 集成） ──
 *
 * /ma 命令触发 Multi-Agent 会话创建并执行多智能体协作：
 *   - 用户输入 `/ma <task>` → handleMultiAgentCommand → create + run
 *   - 会话切换 → destroy 旧会话（避免跨会话残留）
 *   - 组件卸载 → destroy 残留会话
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * MultiAgentStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
 *
 * 与 ToT/GoT 的差异：
 * - Multi-Agent 需传入 specs（Agent 规格列表），此处使用预设 3 Agent 配置
 *   （coordinator + researcher + critic），用户无需手动定义
 * - 去中心化协作（Mesh 拓扑 + Hybrid 收敛），无中心调度者
 * - 事件聚焦于协作过程（轮次/消息/黑板更新），而非思维节点
 */
const {
  create: maCreate,
  run: maRun,
  destroy: maDestroy,
  generateSessionId: maGenerateSessionId,
} = useMultiAgentRust()
const maSessionId = ref<string | null>(null)

/**
 * 构建默认 Agent specs（3 Agent Mesh 协作）
 *
 * - coordinator：协调者，分解任务并综合结果
 * - researcher：研究员，负责信息检索与分析
 * - critic：评审员，负责评审其他 Agent 的输出
 *
 * 使用 Mesh 拓扑 + Hybrid 收敛（goal_check + max_rounds=10）。
 */
function buildDefaultAgentSpecs(task: string) {
  return [
    {
      id: 'coordinator',
      name: '协调者',
      role: 'coordinator' as const,
      description: '负责分解任务、调度其他 Agent 并综合最终结果',
      system_prompt:
        '你是一个任务协调者。你的职责是：\n' +
        '1. 理解用户任务并分解为可执行的子任务\n' +
        '2. 与研究员和评审员协作，分配子任务\n' +
        '3. 综合所有 Agent 的输出，形成最终答案\n\n' +
        '请保持简洁、结构化的输出风格。',
      tools_whitelist: null,
      max_iterations: null,
      initial_message: task,
    },
    {
      id: 'researcher',
      name: '研究员',
      role: 'researcher' as const,
      description: '负责信息检索、分析与事实核查',
      system_prompt:
        '你是一个研究专家。你的职责是：\n' +
        '1. 接收协调者分配的子任务\n' +
        '2. 进行深入分析与信息检索\n' +
        '3. 将研究结果写入共享黑板供其他 Agent 使用\n\n' +
        '请提供有依据、可验证的分析结论。',
      tools_whitelist: null,
      max_iterations: null,
      initial_message: null,
    },
    {
      id: 'critic',
      name: '评审员',
      role: 'critic' as const,
      description: '负责评审其他 Agent 的输出质量与逻辑严谨性',
      system_prompt:
        '你是一个严谨的评审者。你的职责是：\n' +
        '1. 审查研究员与协调者的输出\n' +
        '2. 指出潜在问题、逻辑漏洞或事实错误\n' +
        '3. 提出改进建议\n\n' +
        '请保持建设性、客观的评审态度。',
      tools_whitelist: null,
      max_iterations: null,
      initial_message: null,
    },
  ]
}

/**
 * 处理 /ma 命令：从输入框解析 `/ma <task>` 并启动 Multi-Agent 协作
 *
 * # 流程
 * 1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
 * 2. 若已有 MA 会话，先销毁（保证单会话）
 * 3. 构建 specs（3 Agent Mesh 协作）并 create
 * 4. 清空输入框
 * 5. 异步 run(sessionId, task)，事件流推送轮次/消息/黑板/收敛状态
 *
 * # 错误处理
 * - 非 Rust 后端：warn 并返回
 * - 任务为空：warn 并返回
 * - ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
 * - create 失败：error 并返回（maSessionId 保持 null）
 * - run 失败：error 但不重置 maSessionId（保留会话供查看错误状态）
 */
async function handleMultiAgentCommand(): Promise<void> {
  if (!isRustBackend.value) {
    console.warn('[AgentChat] Multi-Agent 命令仅在 Rust 后端可用')
    return
  }

  // 从输入框读取完整文本（/ma <task>）并去除命令前缀
  const raw = inputBarRef.value?.getInputText() ?? ''
  const task = raw.replace(/^\/ma\s*/, '').trim()
  if (!task) {
    console.warn('[AgentChat] /ma 命令缺少任务描述')
    return
  }

  // 获取 RustProviderConfig（必须在 ensureInitialized 后才可用）
  const providerConfig = rustGetProviderConfig()
  if (!providerConfig) {
    console.error('[AgentChat] Multi-Agent 创建失败：未获取到 RustProviderConfig（请先初始化主 Agent）')
    return
  }

  // 若已有 MA 会话，先销毁（保证单会话）
  if (maSessionId.value) {
    await maDestroy(maSessionId.value).catch((err) => {
      console.warn('[AgentChat] 旧 MA 会话销毁失败:', err)
    })
    maSessionId.value = null
  }

  // 创建新 Multi-Agent 会话并启动协作
  const sessionId = maGenerateSessionId()
  const specs = buildDefaultAgentSpecs(task)
  try {
    await maCreate(sessionId, providerConfig, specs, {
      maxRounds: 10,
      topology: { kind: 'mesh' },
      convergenceStrategy: { kind: 'hybrid', goal_check: true, max_rounds: 10 },
    })
    maSessionId.value = sessionId
    // 清空输入框
    inputBarRef.value?.setInputText('')
    // 启动协作（异步执行，事件流会推送轮次/消息/黑板/收敛状态）
    void maRun(sessionId, task).catch((err) => {
      console.error(`[AgentChat] Multi-Agent 运行失败 session=${sessionId}:`, err)
    })
  } catch (err) {
    console.error('[AgentChat] Multi-Agent 创建失败:', err)
  }
}

// 注册 /ma 命令（与 /tot /got 同级，category=action）
onMounted(() => {
  register({
    id: 'ma',
    label: 'Multi-Agent',
    icon: 'users',
    description: '启动多智能体协作解决复杂任务（3 Agent Mesh 协作，/ma <task>）',
    category: 'action',
    handler: handleMultiAgentCommand,
  })
})

// 会话切换时清理 MA 会话（避免跨会话残留）
watch(
  () => currentSessionId.value,
  async (newId, oldId) => {
    if (oldId && newId !== oldId && maSessionId.value) {
      await maDestroy(maSessionId.value).catch((err) => {
        console.warn('[AgentChat] Multi-Agent 会话切换清理失败:', err)
      })
      maSessionId.value = null
    }
  },
)

// 组件卸载时清理 MA 会话，避免 Rust 端 registry 泄漏
onUnmounted(() => {
  if (maSessionId.value) {
    maDestroy(maSessionId.value).catch((err) => {
      console.warn('[AgentChat] Multi-Agent 会话卸载清理失败:', err)
    })
    maSessionId.value = null
  }
})

/* ── Supervisor：中心化调度会话生命周期管理（批次4 UI 集成） ──
 *
 * /supervisor 命令触发 Supervisor 会话创建并执行中心化任务调度：
 *   - 用户输入 `/supervisor <task>` → handleSupervisorCommand → create + run
 *   - 会话切换 → destroy 旧会话（避免跨会话残留）
 *   - 组件卸载 → destroy 残留会话
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * SupervisorStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
 *
 * 与 Multi-Agent 的差异：
 * - 中心化调度：LLM 充当 Supervisor，决定将任务分配给哪个子 Agent
 * - 单轮执行（阶段 2.1）：仅执行一轮任务分配 + 子 Agent run + 汇总
 * - 无拓扑/收敛策略：所有子 Agent 由 Supervisor 直接调用
 * - 事件聚焦于任务分配与子 Agent 执行（assigned/started/completed）
 */
const {
  create: supCreate,
  run: supRun,
  destroy: supDestroy,
  generateSessionId: supGenerateSessionId,
} = useSupervisorRust()
const supSessionId = ref<string | null>(null)

/**
 * 构建默认 SubAgent specs（2 子 Agent：代码 + 文档）
 *
 * - coder：代码专家，处理代码编写、调试、重构任务
 * - writer：文档专家，处理文档撰写、翻译、润色任务
 *
 * Supervisor 会根据任务描述自动选择一个子 Agent 执行（LLM 决策）。
 */
function buildDefaultSubAgentSpecs() {
  return [
    {
      id: 'coder',
      name: '代码专家',
      description: '处理代码编写、调试、重构、算法实现等编程任务',
      system_prompt:
        '你是一个专业的代码工程师。你的职责是：\n' +
        '1. 理解分配给你的编程任务\n' +
        '2. 编写高质量、可维护的代码\n' +
        '3. 提供必要的代码注释与说明\n\n' +
        '请保持代码简洁、结构清晰。',
    },
    {
      id: 'writer',
      name: '文档专家',
      description: '处理文档撰写、翻译、润色、说明等文字任务',
      system_prompt:
        '你是一个专业的技术文档工程师。你的职责是：\n' +
        '1. 理解分配给你的文档任务\n' +
        '2. 撰写清晰、结构化的文档\n' +
        '3. 保持专业、准确的文风\n\n' +
        '请使用 Markdown 格式输出。',
    },
  ]
}

/**
 * 处理 /supervisor 命令：从输入框解析 `/supervisor <task>` 并启动 Supervisor 编排
 *
 * # 流程
 * 1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
 * 2. 若已有 SUP 会话，先销毁（保证单会话）
 * 3. 构建 specs（2 子 Agent：coder + writer）并 create
 * 4. 清空输入框
 * 5. 异步 run(sessionId, task)，事件流推送任务分配/子 Agent 执行/汇总结果
 *
 * # 错误处理
 * - 非 Rust 后端：warn 并返回
 * - 任务为空：warn 并返回
 * - ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
 * - create 失败：error 并返回（supSessionId 保持 null）
 * - run 失败：error 但不重置 supSessionId（保留会话供查看错误状态）
 */
async function handleSupervisorCommand(): Promise<void> {
  if (!isRustBackend.value) {
    console.warn('[AgentChat] Supervisor 命令仅在 Rust 后端可用')
    return
  }

  // 从输入框读取完整文本（/supervisor <task>）并去除命令前缀
  const raw = inputBarRef.value?.getInputText() ?? ''
  const task = raw.replace(/^\/supervisor\s*/, '').trim()
  if (!task) {
    console.warn('[AgentChat] /supervisor 命令缺少任务描述')
    return
  }

  // 获取 RustProviderConfig（必须在 ensureInitialized 后才可用）
  const providerConfig = rustGetProviderConfig()
  if (!providerConfig) {
    console.error('[AgentChat] Supervisor 创建失败：未获取到 RustProviderConfig（请先初始化主 Agent）')
    return
  }

  // 若已有 SUP 会话，先销毁（保证单会话）
  if (supSessionId.value) {
    await supDestroy(supSessionId.value).catch((err) => {
      console.warn('[AgentChat] 旧 SUP 会话销毁失败:', err)
    })
    supSessionId.value = null
  }

  // 创建新 Supervisor 会话并启动编排
  const sessionId = supGenerateSessionId()
  const specs = buildDefaultSubAgentSpecs()
  try {
    await supCreate(sessionId, providerConfig, specs, {
      maxRounds: 5,
      requireSummary: true,
    })
    supSessionId.value = sessionId
    // 清空输入框
    inputBarRef.value?.setInputText('')
    // 启动编排（异步执行，事件流会推送任务分配/子 Agent 执行/汇总结果）
    void supRun(sessionId, task).catch((err) => {
      console.error(`[AgentChat] Supervisor 运行失败 session=${sessionId}:`, err)
    })
  } catch (err) {
    console.error('[AgentChat] Supervisor 创建失败:', err)
  }
}

// 注册 /supervisor 命令（与 /tot /got /ma 同级，category=action）
onMounted(() => {
  register({
    id: 'supervisor',
    label: 'Supervisor',
    icon: 'workflow',
    description: '启动中心化调度解决任务（Supervisor 自动选 coder/writer 子 Agent，/supervisor <task>）',
    category: 'action',
    handler: handleSupervisorCommand,
  })
})

// 会话切换时清理 SUP 会话（避免跨会话残留）
watch(
  () => currentSessionId.value,
  async (newId, oldId) => {
    if (oldId && newId !== oldId && supSessionId.value) {
      await supDestroy(supSessionId.value).catch((err) => {
        console.warn('[AgentChat] Supervisor 会话切换清理失败:', err)
      })
      supSessionId.value = null
    }
  },
)

// 组件卸载时清理 SUP 会话，避免 Rust 端 registry 泄漏
onUnmounted(() => {
  if (supSessionId.value) {
    supDestroy(supSessionId.value).catch((err) => {
      console.warn('[AgentChat] Supervisor 会话卸载清理失败:', err)
    })
    supSessionId.value = null
  }
})

/* ── Router：路由决策会话生命周期管理（批次4 UI 集成） ──
 *
 * /router 命令触发 Router 会话创建并执行路由决策：
 *   - 用户输入 `/router <task>` → handleRouterCommand → create + run
 *   - 会话切换 → destroy 旧会话（避免跨会话残留）
 *   - 组件卸载 → destroy 残留会话
 *
 * 仅在 Rust 后端启用时执行（isRustBackend=true）；TS 后端跳过。
 * RouterStatusBar 内部 v-if="sessionId && sessionState" 控制实际渲染。
 *
 * 与 Supervisor 的差异：
 * - 纯决策节点：Router 不执行子 Agent，只输出 `nextNodeId` 供 Orchestrator 调度
 * - 无 tool_bus / agent_pool：仅有 getTargets 命令用于查询分支配置
 * - 事件聚焦于决策结果（decisionMade / noMatch / error）
 * - 路由策略可选：LLM 决策（默认）或关键词匹配
 * - Fallback 机制：无匹配时可走 fallbackTargetId（触发 isFallback=true）
 */
const {
  create: rtrCreate,
  run: rtrRun,
  destroy: rtrDestroy,
  generateSessionId: rtrGenerateSessionId,
} = useRouterRust()
const routerSessionId = ref<string | null>(null)

/**
 * 构建默认 RouteTarget 列表（2 分支：代码 + 文档）
 *
 * - coder：代码专家分支，处理代码编写、调试、重构任务
 * - writer：文档专家分支，处理文档撰写、翻译、润色任务
 *
 * Router 会根据输入文本和路由策略（LLM 决策或关键词匹配）选择一个分支。
 * 默认策略为 'llm'，fallback 为 'writer'（无匹配时走文档专家）。
 */
function buildDefaultRouteTargets() {
  return [
    {
      id: 'coder',
      name: '代码专家',
      description: '处理代码编写、调试、重构、算法实现等编程任务',
      keywords: ['代码', '函数', 'bug', '重构', '算法', '编程', 'code'],
    },
    {
      id: 'writer',
      name: '文档专家',
      description: '处理文档撰写、翻译、润色、说明等文字任务',
      keywords: ['文档', '翻译', '润色', '说明', 'doc', 'write'],
    },
  ]
}

/**
 * 处理 /router 命令：从输入框解析 `/router <task>` 并启动 Router 路由决策
 *
 * # 流程
 * 1. 校验 Rust 后端 + 任务描述非空 + RustProviderConfig 可用
 * 2. 若已有 RTR 会话，先销毁（保证单会话）
 * 3. 构建 targets（2 分支：coder + writer）并 create（含 fallbackTargetId: 'writer'）
 * 4. 清空输入框
 * 5. 异步 run(sessionId, task)，事件流推送决策结果（decisionMade/noMatch/error）
 *
 * # 错误处理
 * - 非 Rust 后端：warn 并返回
 * - 任务为空：warn 并返回
 * - ProviderConfig 不可用：error 并返回（需先初始化主 Agent）
 * - create 失败：error 并返回（routerSessionId 保持 null）
 * - run 失败：error 但不重置 routerSessionId（保留会话供查看错误状态）
 */
async function handleRouterCommand(): Promise<void> {
  if (!isRustBackend.value) {
    console.warn('[AgentChat] Router 命令仅在 Rust 后端可用')
    return
  }

  // 从输入框读取完整文本（/router <task>）并去除命令前缀
  const raw = inputBarRef.value?.getInputText() ?? ''
  const task = raw.replace(/^\/router\s*/, '').trim()
  if (!task) {
    console.warn('[AgentChat] /router 命令缺少任务描述')
    return
  }

  // 获取 RustProviderConfig（必须在 ensureInitialized 后才可用）
  const providerConfig = rustGetProviderConfig()
  if (!providerConfig) {
    console.error('[AgentChat] Router 创建失败：未获取到 RustProviderConfig（请先初始化主 Agent）')
    return
  }

  // 若已有 RTR 会话，先销毁（保证单会话）
  if (routerSessionId.value) {
    await rtrDestroy(routerSessionId.value).catch((err) => {
      console.warn('[AgentChat] 旧 RTR 会话销毁失败:', err)
    })
    routerSessionId.value = null
  }

  // 创建新 Router 会话并启动路由决策
  const sessionId = rtrGenerateSessionId()
  const targets = buildDefaultRouteTargets()
  try {
    await rtrCreate(sessionId, providerConfig, targets, {
      strategy: 'llm', // 默认 LLM 决策，可选 'keyword' 关键词匹配
      fallbackTargetId: 'writer', // 无匹配时走文档专家
    })
    routerSessionId.value = sessionId
    // 清空输入框
    inputBarRef.value?.setInputText('')
    // 启动路由决策（异步执行，事件流会推送 decisionMade/noMatch/error）
    void rtrRun(sessionId, task).catch((err) => {
      console.error(`[AgentChat] Router 运行失败 session=${sessionId}:`, err)
    })
  } catch (err) {
    console.error('[AgentChat] Router 创建失败:', err)
  }
}

// 注册 /router 命令（与 /tot /got /ma /supervisor 同级，category=action）
onMounted(() => {
  register({
    id: 'router',
    label: 'Router',
    icon: 'map',
    description: '启动路由决策（Router 根据输入自动选 coder/writer 分支，/router <task>）',
    category: 'action',
    handler: handleRouterCommand,
  })
})

// 会话切换时清理 RTR 会话（避免跨会话残留）
watch(
  () => currentSessionId.value,
  async (newId, oldId) => {
    if (oldId && newId !== oldId && routerSessionId.value) {
      await rtrDestroy(routerSessionId.value).catch((err) => {
        console.warn('[AgentChat] Router 会话切换清理失败:', err)
      })
      routerSessionId.value = null
    }
  },
)

// 组件卸载时清理 RTR 会话，避免 Rust 端 registry 泄漏
onUnmounted(() => {
  if (routerSessionId.value) {
    rtrDestroy(routerSessionId.value).catch((err) => {
      console.warn('[AgentChat] Router 会话卸载清理失败:', err)
    })
    routerSessionId.value = null
  }
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

/* Rust 实验模式提示横幅 */
.rust-mode-banner {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--agent-text-secondary, #888);
  background: rgba(255, 200, 100, 0.08);
  border-bottom: 1px solid rgba(255, 200, 100, 0.2);
  text-align: center;
  flex-shrink: 0;
}
</style>
