import { defineStore } from 'pinia'
import { ref } from 'vue'
// P3-W5 前置迁移：ChatMode 类型源从根 agent 入口改为共享包（根 useAgent 亦 re-export 自此处）
import type { ChatMode } from '@worldsmith/shared-composables/agent/useAgent'

export type { ChatMode }
export type SpaceMode = 'chat' | 'group'
export type GroupChatMode = 'meeting' | 'casual'
export type LeftPanel = 'knowledge' | null
export type RightPanel = 'memory' | 'persona' | 'activity' | 'agent-settings' | null
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
  const rightPanel = ref<RightPanel>(null)
  const leftPanelWidth = ref(340)
  const rightPanelWidth = ref(340)
  const planPanelOpen = ref(false)
  const planPanelWidth = ref(300)
  const MIN_PANEL_WIDTH = 240
  const MAX_PANEL_WIDTH = 560
  const chatMode = ref<ChatMode>('normal')
  const groupChatMode = ref<GroupChatMode>('casual')
  const workspaceDrawerOpen = ref(false)
  const sessionSidebarOpen = ref(false)
  const sessionSidebarWidth = ref(260)
  const persona = ref<AgentPersona>(loadPersona())
  const activityPinned = ref(false)
  const inputInjection = ref<InputInjectionChip | null>(null)

  function setMode(m: SpaceMode) { mode.value = m }
  function toggleLeftPanel(panel: LeftPanel) {
    leftPanel.value = leftPanel.value === panel ? null : panel
  }
  function toggleRightPanel(panel: RightPanel) {
    rightPanel.value = rightPanel.value === panel ? null : panel
  }
  function setChatMode(m: ChatMode) { chatMode.value = m }
  function setGroupChatMode(m: GroupChatMode) { groupChatMode.value = m }
  function setWorkspaceDrawerOpen(v: boolean) { workspaceDrawerOpen.value = v }
  function setSessionSidebarOpen(v: boolean) { sessionSidebarOpen.value = v }
  function toggleSessionSidebar() { sessionSidebarOpen.value = !sessionSidebarOpen.value }
  function setLeftPanelWidth(w: number) {
    leftPanelWidth.value = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, w))
  }
  function setRightPanelWidth(w: number) {
    rightPanelWidth.value = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, w))
  }
  function setPlanPanelWidth(w: number) {
    planPanelWidth.value = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, w))
  }
  function togglePlanPanel() {
    planPanelOpen.value = !planPanelOpen.value
  }
  function updatePersona(patch: Partial<AgentPersona>) {
    persona.value = { ...persona.value, ...patch }
    savePersona(persona.value)
  }

  return {
    mode, leftPanel, rightPanel, leftPanelWidth, rightPanelWidth,
    planPanelOpen, planPanelWidth,
    chatMode, groupChatMode, workspaceDrawerOpen, sessionSidebarOpen, sessionSidebarWidth, persona,
    activityPinned, inputInjection,
    setMode, toggleLeftPanel, toggleRightPanel, setChatMode, setGroupChatMode,
    setWorkspaceDrawerOpen, setSessionSidebarOpen, toggleSessionSidebar,
    setLeftPanelWidth, setRightPanelWidth, setPlanPanelWidth, togglePlanPanel,
    updatePersona,
  }
})
