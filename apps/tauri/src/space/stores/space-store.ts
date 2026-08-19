import { defineStore } from 'pinia'
import { ref } from 'vue'
// P3-W5 前置迁移：ChatMode 类型源从根 agent 入口改为共享包（根 useAgent 亦 re-export 自此处）
import type { ChatMode } from '@worldsmith/shared-composables/agent/useAgent'

export type { ChatMode }
export type SpaceMode = 'chat' | 'group'
export type GroupChatMode = 'meeting' | 'casual'
/** 侧边栏内 Tab（2026-08-12）：会话列表 / 知识库 共用一个面板，默认会话列表 */
export type SidebarTab = 'session' | 'knowledge'
/** 右侧面板 Level-1 Tab（2026-08-12）：执行 / 配置 共用一个面板 */
export type RightTab = 'exec' | 'config'
/** 配置 Tab 内子切换：记忆 / 人格 */
export type ConfigSubTab = 'memory' | 'persona'
/** 执行面板 Tab：轨迹/活动/计划/终端/子Agent */
export type ExecTab = 'trace' | 'activity' | 'plan' | 'router' | 'tot' | 'got' | 'supervisor' | 'terminal' | 'subagent'
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
  // ── 右侧面板（2026-08-12）：执行 / 配置 合并为单一面板，Level-1 Tab 切换 ──
  const rightPanelOpen = ref(false)
  const rightTab = ref<RightTab>('exec')
  const configSubTab = ref<ConfigSubTab>('memory')
  const execTab = ref<ExecTab>('trace')
  const rightPanelWidth = ref(340)
  const MIN_PANEL_WIDTH = 240
  const MAX_PANEL_WIDTH = 560
  const chatMode = ref<ChatMode>('deep')
  const groupChatMode = ref<GroupChatMode>('casual')
  const sessionSidebarOpen = ref(false)
  const sessionSidebarWidth = ref(260)
  /** 侧边栏内 Tab：会话列表 / 知识库（2026-08-12），默认会话列表 */
  const sessionSidebarTab = ref<SidebarTab>('session')
  const persona = ref<AgentPersona>(loadPersona())
  const activityPinned = ref(false)
  const inputInjection = ref<InputInjectionChip | null>(null)

  function setMode(m: SpaceMode) { mode.value = m }
  // ── 右侧面板操作（2026-08-12）：执行 / 配置 合并 ──
  function openRightPanel(tab: RightTab) { rightPanelOpen.value = true; rightTab.value = tab }
  function closeRightPanel() { rightPanelOpen.value = false }
  function toggleRightPanel() { rightPanelOpen.value = !rightPanelOpen.value }
  function setRightTab(tab: RightTab) { rightPanelOpen.value = true; rightTab.value = tab }
  function setExecTab(t: ExecTab) { execTab.value = t }
  function setConfigSubTab(t: ConfigSubTab) { setRightTab('config'); configSubTab.value = t }
  function toggleExecPanel() {
    if (rightPanelOpen.value && rightTab.value === 'exec') rightPanelOpen.value = false
    else openRightPanel('exec')
  }
  function toggleConfigMemory() {
    const isHere = rightPanelOpen.value && rightTab.value === 'config' && configSubTab.value === 'memory'
    if (isHere) rightPanelOpen.value = false
    else { openRightPanel('config'); configSubTab.value = 'memory' }
  }
  function setRightPanelWidth(w: number) {
    rightPanelWidth.value = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, w))
  }
  function setChatMode(m: ChatMode) { chatMode.value = m }
  function setGroupChatMode(m: GroupChatMode) { groupChatMode.value = m }
  function setSessionSidebarOpen(v: boolean) { sessionSidebarOpen.value = v }
  function toggleSessionSidebar() { sessionSidebarOpen.value = !sessionSidebarOpen.value }
  function setSessionSidebarTab(t: SidebarTab) { sessionSidebarTab.value = t }
  function updatePersona(patch: Partial<AgentPersona>) {
    persona.value = { ...persona.value, ...patch }
    savePersona(persona.value)
  }

  return {
    mode, sessionSidebarTab,
    chatMode, groupChatMode, sessionSidebarOpen, sessionSidebarWidth, persona,
    activityPinned, inputInjection,
    // 右侧面板（执行/配置 合并）
    rightPanelOpen, rightTab, configSubTab, execTab, rightPanelWidth,
    openRightPanel, closeRightPanel, toggleRightPanel, setRightTab, setExecTab, setConfigSubTab,
    toggleExecPanel, toggleConfigMemory, setRightPanelWidth,
    setMode, setChatMode, setGroupChatMode,
    setSessionSidebarOpen, toggleSessionSidebar, setSessionSidebarTab,
    updatePersona,
  }
})
