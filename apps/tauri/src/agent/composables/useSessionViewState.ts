/**
 * useSessionViewState：会话级视图状态（场景 / 模式 / execTab / 活动日志 / 编排现场 / 多Agent 摘要）
 *
 * 目标：右侧面板执行绑定主对话区（= 会话）、主对话区绑定会话条目；切换会话时恢复该会话上次状态。
 * 持久化：localStorage 单键（按 sessionId 隔离 + 防膨胀：列表截断 + 30 会话 LRU），切换会话与重启均恢复。
 * 上游接线：useAgentRust 在 newSession/switchSession 调 setActiveSession；useActivityLog / useOrchEvents
 * 以本模块为权威桶，只暴露 active 桶给组件只读。
 */
import { ref, computed, reactive } from 'vue'
import type { ChatMode } from '@worldsmith/shared-composables/agent/useAgent'
import type { ExecTab, RightTab } from '@/space/stores/space-store'
import type { ActivityLogEntry } from './useActivityLog'
import type { OrchNode, OrchStatus, OrchTask } from './useOrchEvents'

/** 会话编排现场快照（ToT/GoT 思维树 + Supervisor 委派） */
export interface SessionOrchView {
  nodes: OrchNode[]
  status: OrchStatus
  reason: string
  best: { thoughtId: string; score: number } | null
  supervisorTasks: OrchTask[]
}

/** 多 Agent 协作摘要（恢复徽标/轮次用，精简防膨胀） */
export interface MultiAgentSummary {
  rounds: number
  converged: boolean
  messageCount: number
}

/** 会话级视图状态（persist → localStorage） */
export interface SessionViewState {
  sceneId: string
  chatMode: ChatMode
  execTab: ExecTab
  /** [2026-08-29] 执行面板已打开的区（宫格首页 + 加号新增式多面板，按打开顺序堆叠） */
  openExecSections: ExecTab[]
  /** [C] 右侧面板工作台式 Level-1（执行/配置/创作/预览），会话级记忆上次面板 */
  rightPanel: RightTab
  /** [E3] 会话级模型选择（缺省 null → 回退全局 settingsStore） */
  model: { provider: string; modelId: string } | null
  activityLog: ActivityLogEntry[]
  orch: SessionOrchView
  multiSummary: MultiAgentSummary | null
  lastSwitchAt: number
}

const VALID_EXEC_TABS: ExecTab[] = ['trace', 'activity', 'router', 'tot', 'got', 'supervisor', 'multi', 'terminal', 'subagent']

const STORAGE_KEY = 'worldsmith_agent_session_views'
export const LAST_SESSION_KEY = 'worldsmith_agent_last_session'
const MAX_SESSIONS = 30
const MAX_ACTIVITY = 120
const MAX_ORCH_NODES = 80
const MAX_SUPERVISOR_TASKS = 60

function defaultOrch(): SessionOrchView {
  return { nodes: [], status: 'idle', reason: '', best: null, supervisorTasks: [] }
}
function defaultState(partial?: Partial<SessionViewState>): SessionViewState {
  return {
    sceneId: 'worldbuilding',
    // 三模式移除（2026-08-31）：统一 normal
    chatMode: 'normal',
    execTab: 'trace',
    openExecSections: [],
    rightPanel: 'exec',
    model: null,
    activityLog: [],
    orch: defaultOrch(),
    multiSummary: null,
    lastSwitchAt: Date.now(),
    ...partial,
  }
}

// ─── 单例状态 ─────────────────────────────────────────────
const views = new Map<string, SessionViewState>()
const activeSessionId = ref<string | null>(null)
let hydrated = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** 首次访问时从 localStorage 水合一次（防重复读盘） */
function ensureHydrated(): void {
  if (hydrated) return
  hydrated = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const obj = JSON.parse(raw) as Record<string, Partial<SessionViewState>>
    for (const [k, v] of Object.entries(obj)) {
      if (!k || typeof v !== 'object' || v === null) continue
      views.set(k, reactive(normalize(v)))
    }
  } catch (e) {
    console.warn('[useSessionViewState] 读取本地会话视图状态失败:', e)
  }
}

/** 归一化（合并默认值 + 列表截断），保证落盘数据损坏也不崩 */
function normalize(raw: Partial<SessionViewState>): SessionViewState {
  const s = defaultState(raw)
  // openExecSections 去重 + 过滤非法值（旧版落盘可能含脏数据）
  const seen = new Set<ExecTab>()
  s.openExecSections = (raw.openExecSections ?? [])
    .filter((t): t is ExecTab => VALID_EXEC_TABS.includes(t as ExecTab) && !seen.has(t as ExecTab) && !!seen.add(t as ExecTab))
  s.activityLog = (raw.activityLog ?? []).slice(0, MAX_ACTIVITY)
  s.orch = {
    nodes: (raw.orch?.nodes ?? []).slice(0, MAX_ORCH_NODES),
    status: raw.orch?.status ?? 'idle',
    reason: raw.orch?.reason ?? '',
    best: raw.orch?.best ?? null,
    supervisorTasks: (raw.orch?.supervisorTasks ?? []).slice(0, MAX_SUPERVISOR_TASKS),
  }
  return s
}

/** LRU 淘汰：仅保留最近切换的 MAX_SESSIONS 个会话 */
function prune(): void {
  if (views.size <= MAX_SESSIONS) return
  const sorted = [...views.entries()].sort((a, b) => (b[1].lastSwitchAt ?? 0) - (a[1].lastSwitchAt ?? 0))
  for (const [k] of sorted.slice(MAX_SESSIONS)) views.delete(k)
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveViews()
  }, 500)
}

function saveViews(): void {
  try {
    prune()
    const obj: Record<string, SessionViewState> = {}
    views.forEach((v, k) => { obj[k] = v })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch (e) {
    console.warn('[useSessionViewState] 保存本地会话视图状态失败:', e)
  }
}

function getOrCreate(sessionId: string): SessionViewState {
  ensureHydrated()
  let s = views.get(sessionId)
  if (!s) {
    s = reactive(defaultState())
    views.set(sessionId, s)
  }
  return s
}

const activeState = computed<SessionViewState | null>(() => {
  const id = activeSessionId.value
  return id ? getOrCreate(id) : null
})

// ─── API ────────────────────────────────────────────────

/** 会话切换/新建时调用：设 active 会话并水合（缓存/localStorage），写 lastSwitchAt + 上次会话键 */
function setActiveSession(sessionId: string): void {
  ensureHydrated()
  activeSessionId.value = sessionId
  const s = getOrCreate(sessionId)
  s.lastSwitchAt = Date.now()
  try { localStorage.setItem(LAST_SESSION_KEY, sessionId) } catch {}
  scheduleSave()
}

/** 删除会话时级联清理视图状态（镜像记忆库 cascade 模式） */
function removeSession(sessionId: string): void {
  ensureHydrated()
  views.delete(sessionId)
  if (activeSessionId.value === sessionId) activeSessionId.value = null
  scheduleSave()
}

/** 活动日志写（按会话桶，截断 MAX_ACTIVITY） */
function mutateActivity(sessionId: string, fn: (list: ActivityLogEntry[]) => void): void {
  const s = getOrCreate(sessionId)
  fn(s.activityLog)
  if (s.activityLog.length > MAX_ACTIVITY) s.activityLog = s.activityLog.slice(0, MAX_ACTIVITY)
  scheduleSave()
}

/** 编排现场写（按会话桶，截断 nodes/supervisorTasks） */
function mutateOrch(sessionId: string, fn: (o: SessionOrchView) => void): void {
  const s = getOrCreate(sessionId)
  fn(s.orch)
  if (s.orch.nodes.length > MAX_ORCH_NODES) s.orch.nodes = s.orch.nodes.slice(-MAX_ORCH_NODES)
  if (s.orch.supervisorTasks.length > MAX_SUPERVISOR_TASKS) s.orch.supervisorTasks = s.orch.supervisorTasks.slice(-MAX_SUPERVISOR_TASKS)
  scheduleSave()
}

/** 清空一轮编排现场（新运行前调用） */
function resetOrch(sessionId: string): void {
  const s = getOrCreate(sessionId)
  s.orch = defaultOrch()
  scheduleSave()
}

function setScene(sceneId: string): void {
  const id = activeSessionId.value
  if (!id) return
  getOrCreate(id).sceneId = sceneId
  scheduleSave()
}

function setMode(m: ChatMode): void {
  const id = activeSessionId.value
  if (!id) return
  getOrCreate(id).chatMode = m
  scheduleSave()
}

function setExecTab(t: ExecTab): void {
  const id = activeSessionId.value
  if (!id) return
  getOrCreate(id).execTab = t
  scheduleSave()
}

/** [2026-08-29] 追加打开一个执行区（宫格/加号/自动打开共用）；已打开则幂等。同时更新 execTab 兼容旧消费方 */
function addExecSection(t: ExecTab): void {
  const id = activeSessionId.value
  if (!id) return
  const s = getOrCreate(id)
  if (!s.openExecSections.includes(t)) s.openExecSections.push(t)
  s.execTab = t
  scheduleSave()
}

/** [2026-08-29] 关闭一个执行区（卡片 ×）；关闭当前 execTab 时回退到最后一个剩余区 */
function removeExecSection(t: ExecTab): void {
  const id = activeSessionId.value
  if (!id) return
  const s = getOrCreate(id)
  s.openExecSections = s.openExecSections.filter(x => x !== t)
  if (s.execTab === t) s.execTab = s.openExecSections[s.openExecSections.length - 1] ?? 'trace'
  scheduleSave()
}

/** [C] 右侧面板工作台式 Level-1（会话级记忆）：无活跃会话时不落库（空容器由 AgentSpace 呈现） */
function setRightPanel(t: RightTab): void {
  const id = activeSessionId.value
  if (!id) return
  getOrCreate(id).rightPanel = t
  scheduleSave()
}

/** [E3] 会话级模型选择记忆：切换会话恢复该会话上次模型，null 表示回退全局 settingsStore */
function setModel(m: { provider: string; modelId: string } | null): void {
  const id = activeSessionId.value
  if (!id) return
  getOrCreate(id).model = m
  scheduleSave()
}

function setMultiSummary(sessionId: string, summary: MultiAgentSummary | null): void {
  getOrCreate(sessionId).multiSummary = summary
  scheduleSave()
}

export function useSessionViewState() {
  return {
    activeSessionId,
    activeState,
    getState: getOrCreate,
    setActiveSession,
    removeSession,
    mutateActivity,
    mutateOrch,
    resetOrch,
    setScene,
    setMode,
    setExecTab,
    addExecSection,
    removeExecSection,
    setRightPanel,
    setModel,
    setMultiSummary,
  }
}
