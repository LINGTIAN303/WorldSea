import { defineStore } from 'pinia'
import { ref } from 'vue'
// P3-W5 前置迁移：ChatMode 类型源从根 agent 入口改为共享包（根 useAgent 亦 re-export 自此处）
import type { ChatMode } from '@worldsmith/shared-composables/agent/useAgent'

export type { ChatMode }
export type SpaceMode = 'chat' | 'group'
export type GroupChatMode = 'meeting' | 'casual'
export type LeftPanel = 'knowledge' | null
/** 配置抽屉：记忆/人格（弹出层，互斥；设置已迁入主设置弹窗，无 settings 分支） */
export type ConfigPanel = 'memory' | 'persona' | null
/** 执行面板 Tab：轨迹/活动/计划/终端/子Agent */
export type ExecTab = 'trace' | 'activity' | 'plan' | 'terminal' | 'subagent'
export type AgentMood = 'active' | 'thinking' | 'focused' | 'idle'

export interface AgentPersona {
  name: string
  avatar: string
  mood: AgentMood
  statusMessage: string
}

export interface InputInjectionChip {
  label: string
  ref: string
}

const PERSONA_STORAGE_KEY = 'worldsmith_agent_persona'

function loadPersona(): AgentPersona {
  try {
    const raw = localStorage.getItem(PERSONA_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {
    name: 'WorldSmith Agent',
    avatar: '',
    mood: 'active',
    statusMessage: '',
  }
}

function savePersona(p: AgentPersona) {
  try {
    localStorage.setItem(PERSONA_STORAGE_KEY, JSON.stringify(p))
  } catch {}
}

export const useSpaceStore = defineStore('space', () => {
  const mode = ref<SpaceMode>('chat')
  const leftPanel = ref<LeftPanel>(null)
  // ── 重构双轨状态（T1）：执行面板（常驻开关）+ 配置抽屉（弹出层，互斥） ──
  const execPanelOpen = ref(false)
  const execTab = ref<ExecTab>('trace')
  const configPanel = ref<ConfigPanel>(null)
  const execPanelWidth = ref(300)
  /** 配置抽屉宽度（视觉稿 360） */
  const configPanelWidth = ref(360)
  const leftPanelWidth = ref(340)
  const MIN_PANEL_WIDTH = 240
  const MAX_PANEL_WIDTH = 560
  const chatMode = ref<ChatMode>('deep')
  const groupChatMode = ref<GroupChatMode>('casual')
  const sessionSidebarOpen = ref(false)
  const sessionSidebarWidth = ref(260)
  const persona = ref<AgentPersona>(loadPersona())
  const activityPinned = ref(false)
  const inputInjection = ref<InputInjectionChip | null>(null)

  function setMode(m: SpaceMode) { mode.value = m }
  function toggleLeftPanel(panel: LeftPanel) {
    leftPanel.value = leftPanel.value === panel ? null : panel
  }
  // ── 双轨操作（T1） ──
  function toggleExecPanel() { execPanelOpen.value = !execPanelOpen.value }
  function openExecPanel() { execPanelOpen.value = true }
  function closeExecPanel() { execPanelOpen.value = false }
  function setExecTab(t: ExecTab) { execTab.value = t }
  function setConfigPanel(p: ConfigPanel) { configPanel.value = p }
  function toggleConfigPanel(p: Exclude<ConfigPanel, null>) {
    configPanel.value = configPanel.value === p ? null : p
  }
  function setExecPanelWidth(w: number) {
    execPanelWidth.value = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, w))
  }
  function setConfigPanelWidth(w: number) {
    configPanelWidth.value = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, w))
  }
  function setChatMode(m: ChatMode) { chatMode.value = m }
  function setGroupChatMode(m: GroupChatMode) { groupChatMode.value = m }
  function setSessionSidebarOpen(v: boolean) { sessionSidebarOpen.value = v }
  function toggleSessionSidebar() { sessionSidebarOpen.value = !sessionSidebarOpen.value }
  function setLeftPanelWidth(w: number) {
    leftPanelWidth.value = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, w))
  }
  function updatePersona(patch: Partial<AgentPersona>) {
    persona.value = { ...persona.value, ...patch }
    savePersona(persona.value)
  }

  return {
    mode, leftPanel, leftPanelWidth,
    chatMode, groupChatMode, sessionSidebarOpen, sessionSidebarWidth, persona,
    activityPinned, inputInjection,
    // 双轨（T1）
    execPanelOpen, execTab, configPanel, execPanelWidth, configPanelWidth,
    toggleExecPanel, openExecPanel, closeExecPanel, setExecTab,
    setConfigPanel, toggleConfigPanel, setExecPanelWidth, setConfigPanelWidth,
    setMode, toggleLeftPanel, setChatMode, setGroupChatMode,
    setSessionSidebarOpen, toggleSessionSidebar,
    setLeftPanelWidth,
    updatePersona,
  }
})
