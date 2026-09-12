import { defineStore } from 'pinia'
import { ref } from 'vue'
// P3-W5 前置迁移：ChatMode 类型源从根 agent 入口改为共享包（根 useAgent 亦 re-export 自此处）
import type { ChatMode } from '@worldsea/shared-composables/agent/useAgent'

export type { ChatMode }
export type SpaceMode = 'chat' | 'group'
export type GroupChatMode = 'meeting' | 'casual'
/** 侧边栏内 Tab（2026-08-12）：会话列表 / 知识库 共用一个面板，默认会话列表 */
export type SidebarTab = 'session' | 'knowledge'
/** 右侧面板 Level-1 Tab（2026-08-12）：执行 / 配置 共用一个面板；[C] 2026-08-20 扩展为 执行/配置/创作/预览；2026-08-23 加入 用量 */
export type RightTab = 'exec' | 'config' | 'creation' | 'preview' | 'usage'
/** 配置 Tab 内子切换：记忆 / 人格 / 档案（档案为占位，2026-08-29） */
export type ConfigSubTab = 'memory' | 'persona' | 'profile'
/** 执行面板 Tab：轨迹/活动/会话日志/终端/子Agent + 编排模式（Supervisor）；
    2026-09-09 右栏消除 tot/got/multi 区（ToT/GoT/multi 迁创作编排承载面）；
    2026-09-09 消除 Router 区（Router 归场景识别底座，命令与面板下线）；
    2026-09-12 新增 sessionlog 区（A1 R3：前端 session 日志（历史）面板） */
export type ExecTab = 'trace' | 'activity' | 'sessionlog' | 'supervisor' | 'terminal' | 'subagent'
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

const PERSONA_STORAGE_KEY = 'worldsea_agent_persona'

function loadPersona(): AgentPersona {
  try {
    const raw = localStorage.getItem(PERSONA_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {
    name: 'WorldSea Agent',
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
  // execTab（执行面板子页）已移入 useSessionViewState（按会话隔离，切换会话恢复），此处不再持有
  const RIGHT_PANEL_WIDTH_KEY = 'worldsea_right_panel_width'
  const RIGHT_PANEL_WIDTH_CUSTOM_KEY = 'worldsea_right_panel_width_custom'
  const rightPanelWidth = ref(loadRightPanelWidth())
  /** [3] 右栏宽度是否被用户拖拽过（区别于默认 70% 占比）：拖拽后持久保存，不再弹回默认 */
  const rightPanelWidthCustom = ref(loadRightPanelWidthCustom())
  const MIN_PANEL_WIDTH = 240
  // [1] 右栏 70% 主导：上限放宽，容纳 70vw 大面板（原 560 会截断 70% 主导）
  const MAX_PANEL_WIDTH = 2000

  function loadRightPanelWidth(): number {
    try {
      const raw = localStorage.getItem(RIGHT_PANEL_WIDTH_KEY)
      const n = raw ? Number(raw) : 0
      if (n && n > 0) return n
    } catch {}
    return 340
  }
  function loadRightPanelWidthCustom(): boolean {
    try { return localStorage.getItem(RIGHT_PANEL_WIDTH_CUSTOM_KEY) === '1' } catch { return false }
  }
  function persistRightPanelWidth() {
    try {
      localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(rightPanelWidth.value))
      if (rightPanelWidthCustom.value) localStorage.setItem(RIGHT_PANEL_WIDTH_CUSTOM_KEY, '1')
      else localStorage.removeItem(RIGHT_PANEL_WIDTH_CUSTOM_KEY)
    } catch {}
  }
  const chatMode = ref<ChatMode>('normal')
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
    persistRightPanelWidth()
  }
  /** [3] 标记右栏宽度为用户自定义：拖拽结束时调用，令其持久保持、不再被默认 70% 弹回。
      在 AgentSpace 的 onExecResizeStart 的 mouseup 阶段由消费者触发（此处仅提供），或透传一次。 */
  function markRightPanelWidthCustom() {
    rightPanelWidthCustom.value = true
    persistRightPanelWidth()
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
    // 右侧面板（执行/配置 合并；execTab 见 useSessionViewState）
    rightPanelOpen, rightTab, configSubTab, rightPanelWidth, rightPanelWidthCustom,
    openRightPanel, closeRightPanel, toggleRightPanel, setRightTab, setConfigSubTab,
    toggleExecPanel, toggleConfigMemory, setRightPanelWidth, markRightPanelWidthCustom,
    setMode, setChatMode, setGroupChatMode,
    setSessionSidebarOpen, toggleSessionSidebar, setSessionSidebarTab,
    updatePersona,
  }
})
