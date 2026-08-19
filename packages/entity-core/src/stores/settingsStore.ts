import { defineStore } from 'pinia'
import { ref, watch, computed, type Ref } from 'vue'
import { useTheme } from '../composables/useTheme'
import { getProjectManager } from '../core'
import { watchDebounced } from '@worldsmith/perf-kit/render'

export interface PluginToggle {
  id: string
  label: string
  icon: string
  active: boolean
  dependencies?: { moduleId: string; version?: string; optional?: boolean }[]
  source?: 'builtin' | 'local' | 'remote'
  /** 插件分类，用于插件管理页标签筛选 */
  category?: PluginCategory
}

/** 插件分类定义（插件管理页标签筛选用） */
export const PLUGIN_CATEGORIES = [
  { id: 'world', label: '世界观' },
  { id: 'characters', label: '角色' },
  { id: 'items', label: '物品' },
  { id: 'narrative', label: '叙事' },
  { id: 'visual', label: '视觉' },
  { id: 'system', label: '系统' },
] as const

export type PluginCategory = typeof PLUGIN_CATEGORIES[number]['id']

export interface CustomProviderEntry {
  id: string
  name: string
  baseUrl: string
  apiType: string
  modelId: string
}

const STORAGE_KEY_PLUGINS = 'worldsmith_plugin_toggles'
const STORAGE_KEY_UNDO_LIMIT = 'worldsmith_undo_history_limit'
const STORAGE_KEY_MULTI_STEP_REDO = 'worldsmith_multi_step_redo'
const STORAGE_KEY_MAX_CENTER_NODES = 'worldsmith_max_center_nodes'
const STORAGE_KEY_PANEL_LIMIT_ENABLED = 'worldsmith_panel_limit_enabled'
const STORAGE_KEY_SMOOTH_CARET = 'worldsmith_smooth_caret'
const STORAGE_KEY_SMOOTH_CARET_DURATION = 'worldsmith_smooth_caret_duration'
const STORAGE_KEY_SMOOTH_CARET_VARIANT = 'worldsmith_smooth_caret_variant'
const STORAGE_KEY_AUTO_CREATE_ENTITY = 'worldsmith_auto_create_entity'
const STORAGE_KEY_AUTO_CREATE_SELECTOR = 'worldsmith_auto_create_selector'
const STORAGE_KEY_AUTO_CREATE_ENTITY_REF = 'worldsmith_auto_create_entity_ref'
const STORAGE_KEY_AUTO_CREATE_GRAPH = 'worldsmith_auto_create_graph'
const STORAGE_KEY_HIGHLIGHT_PULSE_ENABLED = 'worldsmith_highlight_pulse_enabled'
const STORAGE_KEY_HIGHLIGHT_DIMMING_ENABLED = 'worldsmith_highlight_dimming_enabled'
const STORAGE_KEY_HIGHLIGHT_DIMMING_MODE = 'worldsmith_highlight_dimming_mode'
const STORAGE_KEY_HIGHLIGHT_DIM_OPACITY = 'worldsmith_highlight_dim_opacity'
const STORAGE_KEY_HIGHLIGHT_SPREAD_HOPS = 'worldsmith_highlight_spread_hops'
const STORAGE_KEY_AI_PROVIDER_MODE = 'worldsmith_ai_provider_mode'
const STORAGE_KEY_AI_CLOUD_PROVIDER = 'worldsmith_ai_cloud_provider'
const STORAGE_KEY_AI_CLOUD_MODEL = 'worldsmith_ai_cloud_model'
const STORAGE_KEY_AI_LOCAL_ENDPOINT = 'worldsmith_ai_local_endpoint'
const STORAGE_KEY_AI_LOCAL_TYPE = 'worldsmith_ai_local_type'
const STORAGE_KEY_AI_LOCAL_MODEL = 'worldsmith_ai_local_model'
const STORAGE_KEY_AI_CUSTOM_BASE_URL = 'worldsmith_ai_custom_base_url'
const STORAGE_KEY_AI_CUSTOM_TYPE = 'worldsmith_ai_custom_type'
const STORAGE_KEY_AI_CUSTOM_MODEL = 'worldsmith_ai_custom_model'
const STORAGE_KEY_AI_CUSTOM_PROVIDERS = 'worldsmith_ai_custom_providers'
const STORAGE_KEY_AI_DANGER_CONFIRM = 'worldsmith_ai_danger_confirm'
const STORAGE_KEY_AGENT_SECURITY_LEVEL = 'worldsmith_agent_security_level'
const STORAGE_KEY_AGENT_BACKEND = 'worldsmith_agent_backend'
const STORAGE_KEY_VISION_SUB_AGENT_PROVIDER = 'worldsmith_vision_sub_agent_provider'
const STORAGE_KEY_VISION_SUB_AGENT_MODEL = 'worldsmith_vision_sub_agent_model'
const STORAGE_KEY_OUTLINE_INLINE_EDIT = 'worldsmith_outline_inline_edit'
const STORAGE_KEY_COMPANION_MODE_ENABLED = 'worldsmith_companion_mode_enabled'
const STORAGE_KEY_COMPANION_MODE_DURATION = 'worldsmith_companion_mode_duration'
const STORAGE_KEY_COMPANION_MODE_PERSONA_TRANSITION = 'worldsmith_companion_mode_persona_transition'
const STORAGE_KEY_COMPANION_MODE_DEBOUNCE = 'worldsmith_companion_mode_debounce'
const STORAGE_KEY_COMPANION_MODE_TIMEOUT = 'worldsmith_companion_mode_timeout'
const STORAGE_KEY_COMPANION_MODE_MAX_FAILURES = 'worldsmith_companion_mode_max_failures'
const STORAGE_KEY_COMPANION_MODE_CROSS_PLUGIN = 'worldsmith_companion_mode_cross_plugin'
const STORAGE_KEY_COMPANION_MODE_PERSONA_SWITCH_CHANCE = 'worldsmith_companion_mode_persona_switch_chance'
const STORAGE_KEY_COMPANION_MODE_PAUSE_THRESHOLD = 'worldsmith_companion_mode_pause_threshold'
const STORAGE_KEY_COMPANION_MODE_SENTENCE_TRIGGER = 'worldsmith_companion_mode_sentence_trigger'
const STORAGE_KEY_COMPANION_MODE_CHAR_THRESHOLD = 'worldsmith_companion_mode_char_threshold'
const STORAGE_KEY_COMPANION_MODE_LUCK_ENABLED = 'worldsmith_companion_mode_luck_enabled'
const STORAGE_KEY_COMPANION_MODE_LUCK_RESET_MINUTES = 'worldsmith_companion_mode_luck_reset_minutes'
const STORAGE_KEY_COMPANION_MODE_LUCK_RESET_OPS = 'worldsmith_companion_mode_luck_reset_ops'
const STORAGE_KEY_COMPANION_MODE_POSITION_CONTEXT = 'worldsmith_companion_mode_position_context'
const STORAGE_KEY_COMPANION_MODE_CLICK_PIN = 'worldsmith_companion_mode_click_pin'
const STORAGE_KEY_COMPANION_MODE_SCENE_PROBS = 'worldsmith_companion_mode_scene_probs'
const STORAGE_KEY_COMPANION_MODE_CUSTOM_MODEL = 'worldsmith_companion_mode_custom_model'
const STORAGE_KEY_COMPANION_MODE_PROVIDER_KEY = 'worldsmith_companion_mode_provider_key'
const STORAGE_KEY_COMPANION_MODE_MODEL_ID = 'worldsmith_companion_mode_model_id'
const STORAGE_KEY_COMPANION_MODE_SILENT_IN_SPACE = 'worldsmith_companion_mode_silent_in_space'
const STORAGE_KEY_SIDEBAR_POSITION = 'worldsmith_sidebar_position'
const STORAGE_KEY_DETAIL_PANEL_POSITION = 'worldsmith_detail_panel_position'
const STORAGE_KEY_TIMELINE_DRAG_ENABLED = 'worldsmith_timeline_drag_enabled'
const STORAGE_KEY_TIMELINE_DEFAULT_MODE = 'worldsmith_timeline_default_mode'
const STORAGE_KEY_TIMELINE_DEFAULT_GROUP = 'worldsmith_timeline_default_group'
const STORAGE_KEY_TIMELINE_COMPACT_MODE = 'worldsmith_timeline_compact_mode'
const STORAGE_KEY_GROUP_CHAT_MAX_AGENTS = 'worldsmith_group_chat_max_agents'
const STORAGE_KEY_GROUP_CHAT_DEFAULT_STRATEGY = 'worldsmith_group_chat_default_strategy'
const STORAGE_KEY_GROUP_CHAT_GLOBAL_RPM = 'worldsmith_group_chat_global_rpm'
const STORAGE_KEY_GROUP_CHAT_GLOBAL_CONCURRENT = 'worldsmith_group_chat_global_concurrent'

const DEFAULT_PLUGINS: PluginToggle[] = [
  { id: 'official.characters', label: '人物志', icon: 'character', active: true, category: 'characters' },
  { id: 'official.regions', label: '区域图谱', icon: 'region', active: false, category: 'world' },
  { id: 'official.timeline', label: '时间线', icon: 'timeline', active: true, category: 'narrative' },
  { id: 'official.organizations', label: '势力', icon: 'organization', active: false, category: 'characters' },
  { id: 'official.concepts', label: '概念/设定库', icon: 'concept', active: true, category: 'world' },
  { id: 'official.items', label: '道具/装备', icon: 'trade', active: false, category: 'items' },
  { id: 'official.apparel', label: '服饰/装备', icon: 'apparel', active: false, category: 'items' },
  { id: 'official.mindmap', label: '思维导图', icon: 'mindmap', active: false, category: 'visual' },
  { id: 'official.custom', label: '自定义视图', icon: 'dashboard', active: false, category: 'system' },
  { id: 'official.module-builder', label: '自定义模块', icon: 'module-builder', active: true, category: 'system' },
  { id: 'official.graph', label: '关系图谱', icon: 'graph', active: false, category: 'visual' },
  { id: 'official.buildings', label: '建筑物', icon: 'building', active: false, category: 'world' },
  { id: 'official.species', label: '种族', icon: 'species', active: false, category: 'world' },
  { id: 'official.magic', label: '魔法', icon: 'magic', active: false, category: 'world' },
  { id: 'official.outline', label: '大纲', icon: 'outline', active: true, category: 'narrative' },
  { id: 'official.languages', label: '语言/文字', icon: 'language', active: false, category: 'world' },
  { id: 'official.culture', label: '文化/文明', icon: 'culture', active: false, category: 'world' },
  { id: 'official.conflict', label: '冲突/战争', icon: 'combat', active: false, category: 'narrative' },
  { id: 'official.inspiration', label: '灵感/素材库', icon: 'inspiration', active: true, category: 'narrative' },
  { id: 'official.plants', label: '植物', icon: 'plant', active: false, category: 'world' },
  { id: 'official.combat_stats', label: '战力', icon: 'combat', active: false, category: 'system' },
  { id: 'official.weapons', label: '武器', icon: 'weapon', active: false, category: 'items' },
  { id: 'official.manuscript', label: '正文编辑', icon: 'manuscript', active: false, category: 'narrative' },
  { id: 'official.drawing', label: '画板', icon: 'drawing', active: false, category: 'visual' },
  { id: 'official.tactical-board', label: '战术棋盘', icon: 'tactical-board', active: false, category: 'visual' },
  { id: 'official.notebook', label: '笔记本', icon: 'notebook', active: true, category: 'visual' },
  { id: 'official.workflow', label: '工作流', icon: 'lightning', active: true, category: 'system' },
]

function loadPlugins(): PluginToggle[] {
  // 优先从项目 DB 的 project_settings 表读取
  // 同步初始化时先从 localStorage 加载，异步加载项目 DB 数据后更新
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLUGINS)
    if (!raw) return DEFAULT_PLUGINS.map(p => ({ ...p }))
    const saved = JSON.parse(raw) as { id: string; active: boolean }[]
    return DEFAULT_PLUGINS.map(def => {
      const found = saved.find((s: any) => s.id === def.id)
      return { ...def, active: found ? found.active : def.active }
    })
  } catch {
    return DEFAULT_PLUGINS.map(p => ({ ...p }))
  }
}

/**
 * 异步加载项目级插件开关。
 * 从项目 DB 的 project_settings 表读取，更新 plugins ref。
 * 切换项目后调用。
 */
async function loadProjectPlugins(): Promise<PluginToggle[] | null> {
  try {
    const pm = getProjectManager()
    const db = pm.getCurrentProjectDb()
    const entry = await db.table('project_settings').get('plugin_toggles')
    if (!entry) return null
    const saved = JSON.parse((entry as any).value) as { id: string; active: boolean }[]
    return DEFAULT_PLUGINS.map(def => {
      const found = saved.find((s: any) => s.id === def.id)
      return { ...def, active: found ? found.active : def.active }
    })
  } catch {
    return null
  }
}

function savePlugins(plugins: PluginToggle[]) {
  const data = JSON.stringify(plugins.map(p => ({ id: p.id, active: p.active })))
  // 同时写入 localStorage（回退）和项目 DB
  localStorage.setItem(STORAGE_KEY_PLUGINS, data)
  try {
    const pm = getProjectManager()
    const db = pm.getCurrentProjectDb()
    db.table('project_settings').put({ key: 'plugin_toggles', value: data })
  } catch {
    // 项目系统未初始化，仅保存到 localStorage
  }
}

function loadCustomProviders(): CustomProviderEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AI_CUSTOM_PROVIDERS)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveCustomProviders(providers: CustomProviderEntry[]): void {
  localStorage.setItem(STORAGE_KEY_AI_CUSTOM_PROVIDERS, JSON.stringify(providers))
}

function persistedRef<T extends string | number | boolean>(key: string, defaultValue: T): Ref<T extends boolean ? boolean : T extends number ? number : string> {
  const raw = localStorage.getItem(key)
  let initial: T = defaultValue
  if (raw !== null) {
    if (typeof defaultValue === 'boolean') {
      if (raw === 'true') initial = true as T
      else if (raw === 'false') initial = false as T
      // 无法识别的值回退到默认值
    } else if (typeof defaultValue === 'number') {
      const parsed = Number(raw)
      initial = (Number.isFinite(parsed) ? parsed : defaultValue) as T
    } else {
      initial = raw as T
    }
  }
  const val = ref(initial) as Ref<T extends boolean ? boolean : T extends number ? number : string>
  watch(val, (v) => {
    localStorage.setItem(key, String(v))
  })
  return val
}

function deriveKeyStoreId(baseUrl: string): string {
  if (!baseUrl || !baseUrl.trim()) return 'custom:_empty'
  try {
    const url = new URL(baseUrl)
    return 'custom:' + url.hostname
  } catch {
    return 'custom:' + baseUrl.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 60)
  }
}


/* ─── 快捷键默认键位 ─── */

const SHORTCUT_DEFAULTS: Record<string, string[]> = {
  'help.shortcuts':   ['?'],
  'sidebar.toggle':   ['ctrl', 'b'],
  'search.open':      ['ctrl', 'k'],
  'menu.import-export': ['ctrl', 'shift', 's'],
  'settings.open':    ['ctrl', ','],
  'global.undo':      ['ctrl', 'z'],
  'global.redo':      ['ctrl', 'y'],
  'global.redo-alt':  ['ctrl', 'shift', 'z'],
  'global.undoHistory': ['ctrl', 'alt', 'z'],
  'project.save':     ['ctrl', 's'],
  'region.borderline': ['alt'],
  'character.undo':   ['ctrl', 'z'],
  'character.redo':   ['ctrl', 'y'],
  'org.undo':         ['ctrl', 'z'],
  'org.redo':         ['ctrl', 'y'],
  'region.undo':      ['ctrl', 'z'],
  'region.redo':      ['ctrl', 'y'],
  'drawing.undo':     ['ctrl', 'z'],
  'drawing.redo':     ['ctrl', 'shift', 'z'],
  'drawing.zoomIn':   ['ctrl', '='],
  'drawing.zoomOut':  ['ctrl', '-'],
  'drawing.fitView':  ['ctrl', '0'],
  'mindmap.undo':     ['ctrl', 'z'],
  'mindmap.redo':     ['ctrl', 'y'],
  'mindmap.toggleDetail': ['i'],
  'mindmap.fitView':  ['f'],
  'mindmap.exitNested': ['escape'],
  'mindmap.deleteNode': ['delete'],
  'mindmap.freeDraw': ['d'],
  'mindmap.aiSuggest': ['ctrl', 'j'],
}

const STORAGE_KEY_SHORTCUTS = 'worldsmith_shortcuts'
// 语音输入设置（Web Speech API）
const STORAGE_KEY_VOICE_LANG = 'worldsmith_voice_lang'
const STORAGE_KEY_VOICE_CONTINUOUS = 'worldsmith_voice_continuous'

function loadShortcuts(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SHORTCUTS)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveShortcuts(overrides: Record<string, string[]>) {
  localStorage.setItem(STORAGE_KEY_SHORTCUTS, JSON.stringify(overrides))
}

export const useSettingsStore = defineStore('settings', () => {
  const { currentThemeId, setTheme: setThemeFromEngine } = useTheme()
  const plugins = ref<PluginToggle[]>(loadPlugins())
  const theme = computed(() => currentThemeId.value)

  // 语音输入设置（Web Speech API）：识别语言 + 连续识别
  const voiceLang = persistedRef(STORAGE_KEY_VOICE_LANG, 'zh-CN')
  const voiceContinuous = persistedRef(STORAGE_KEY_VOICE_CONTINUOUS, false)

  const undoHistoryLimit = persistedRef(STORAGE_KEY_UNDO_LIMIT, 20)
  const multiStepRedo = persistedRef(STORAGE_KEY_MULTI_STEP_REDO, true)
  const maxCenterNodes = persistedRef(STORAGE_KEY_MAX_CENTER_NODES, 5)
  const panelLimitEnabled = persistedRef(STORAGE_KEY_PANEL_LIMIT_ENABLED, true)
  const smoothCaretEnabled = persistedRef(STORAGE_KEY_SMOOTH_CARET, true)
  const smoothCaretDuration = persistedRef(STORAGE_KEY_SMOOTH_CARET_DURATION, 150)
  const smoothCaretVariant = persistedRef(STORAGE_KEY_SMOOTH_CARET_VARIANT, 'line')
  const autoCreateEntityEnabled = persistedRef(STORAGE_KEY_AUTO_CREATE_ENTITY, true)
  const autoCreateSelectorEnabled = persistedRef(STORAGE_KEY_AUTO_CREATE_SELECTOR, true)
  const autoCreateEntityRefEnabled = persistedRef(STORAGE_KEY_AUTO_CREATE_ENTITY_REF, true)
  const autoCreateGraphEnabled = persistedRef(STORAGE_KEY_AUTO_CREATE_GRAPH, true)
  const highlight_pulseEnabled = persistedRef(STORAGE_KEY_HIGHLIGHT_PULSE_ENABLED, true)
  const highlight_dimmingEnabled = persistedRef(STORAGE_KEY_HIGHLIGHT_DIMMING_ENABLED, true)
  const highlight_dimmingMode = persistedRef(STORAGE_KEY_HIGHLIGHT_DIMMING_MODE, 'spread')
  const highlight_dimOpacity = persistedRef(STORAGE_KEY_HIGHLIGHT_DIM_OPACITY, 0.25)
  const highlight_spreadHops = persistedRef(STORAGE_KEY_HIGHLIGHT_SPREAD_HOPS, 3)

  const aiProviderMode = persistedRef(STORAGE_KEY_AI_PROVIDER_MODE, 'cloud')
  const aiCloudProvider = persistedRef(STORAGE_KEY_AI_CLOUD_PROVIDER, 'anthropic')
  const aiCloudModel = persistedRef(STORAGE_KEY_AI_CLOUD_MODEL, 'claude-sonnet-4-20250514')
  const aiLocalEndpoint = persistedRef(STORAGE_KEY_AI_LOCAL_ENDPOINT, 'http://localhost:11434')
  const aiLocalType = persistedRef(STORAGE_KEY_AI_LOCAL_TYPE, 'ollama')
  const aiLocalModel = persistedRef(STORAGE_KEY_AI_LOCAL_MODEL, '')
  const aiCustomBaseUrl = persistedRef(STORAGE_KEY_AI_CUSTOM_BASE_URL, '')
  const aiCustomType = persistedRef(STORAGE_KEY_AI_CUSTOM_TYPE, 'openai-compatible')
  const aiCustomModel = persistedRef(STORAGE_KEY_AI_CUSTOM_MODEL, '')
  const customProviders = ref<CustomProviderEntry[]>(loadCustomProviders())
  const aiDangerConfirm = persistedRef(STORAGE_KEY_AI_DANGER_CONFIRM, true)
  // A7 工具安全级别：off / dangerous_only / moderate_and_dangerous（默认仅危险操作确认）
  const agentSecurityLevel = persistedRef(STORAGE_KEY_AGENT_SECURITY_LEVEL, 'dangerous_only')
  // Agent 后端类型：'ts'（TS Agent）或 'rust'（Rust Agent，P1-5 起为默认）
  // 注意：已有用户的 localStorage 中若存储了 'ts'，仍保持 'ts'；
  //       仅新用户或清除存储的用户会默认使用 'rust'
  const agentBackend = persistedRef(STORAGE_KEY_AGENT_BACKEND, 'rust')
  const visionSubAgentProvider = persistedRef(STORAGE_KEY_VISION_SUB_AGENT_PROVIDER, '')
  const visionSubAgentModel = persistedRef(STORAGE_KEY_VISION_SUB_AGENT_MODEL, '')
  const outlineInlineEdit = persistedRef(STORAGE_KEY_OUTLINE_INLINE_EDIT, true)
  const companionModeEnabled = persistedRef(STORAGE_KEY_COMPANION_MODE_ENABLED, false)
  const companionModeDuration = persistedRef(STORAGE_KEY_COMPANION_MODE_DURATION, 5)
  const companionModePersonaTransition = persistedRef(STORAGE_KEY_COMPANION_MODE_PERSONA_TRANSITION, true)
  const companionModeDebounce = persistedRef(STORAGE_KEY_COMPANION_MODE_DEBOUNCE, 5)
  const companionModeTimeout = persistedRef(STORAGE_KEY_COMPANION_MODE_TIMEOUT, 3)
  const companionModeMaxFailures = persistedRef(STORAGE_KEY_COMPANION_MODE_MAX_FAILURES, 3)
  const companionModeCrossPlugin = persistedRef(STORAGE_KEY_COMPANION_MODE_CROSS_PLUGIN, false)
  const companionModePersonaSwitchChance = persistedRef(STORAGE_KEY_COMPANION_MODE_PERSONA_SWITCH_CHANCE, 30)
  const companionModePauseThreshold = persistedRef(STORAGE_KEY_COMPANION_MODE_PAUSE_THRESHOLD, 2)
  const companionModeSentenceTrigger = persistedRef(STORAGE_KEY_COMPANION_MODE_SENTENCE_TRIGGER, true)
  const companionModeCharThreshold = persistedRef(STORAGE_KEY_COMPANION_MODE_CHAR_THRESHOLD, 20)
  const companionModeLuckEnabled = persistedRef(STORAGE_KEY_COMPANION_MODE_LUCK_ENABLED, true)
  const companionModeLuckResetMinutes = persistedRef(STORAGE_KEY_COMPANION_MODE_LUCK_RESET_MINUTES, 5)
  const companionModeLuckResetOps = persistedRef(STORAGE_KEY_COMPANION_MODE_LUCK_RESET_OPS, 10)
  const companionModePositionContext = persistedRef(STORAGE_KEY_COMPANION_MODE_POSITION_CONTEXT, true)
  const companionModeClickPin = persistedRef(STORAGE_KEY_COMPANION_MODE_CLICK_PIN, true)

  const companionModeCustomModel = persistedRef(STORAGE_KEY_COMPANION_MODE_CUSTOM_MODEL, false)
  const companionModeProviderKey = persistedRef(STORAGE_KEY_COMPANION_MODE_PROVIDER_KEY, '')
  const companionModeModelId = persistedRef(STORAGE_KEY_COMPANION_MODE_MODEL_ID, '')
  const companionModeSilentInSpace = persistedRef(STORAGE_KEY_COMPANION_MODE_SILENT_IN_SPACE, true)

  const groupChatMaxAgents = persistedRef(STORAGE_KEY_GROUP_CHAT_MAX_AGENTS, 5)
  const groupChatDefaultStrategy = persistedRef(STORAGE_KEY_GROUP_CHAT_DEFAULT_STRATEGY, 'speaking-desire')
  const groupChatGlobalRpm = persistedRef(STORAGE_KEY_GROUP_CHAT_GLOBAL_RPM, 60)
  const groupChatGlobalConcurrent = persistedRef(STORAGE_KEY_GROUP_CHAT_GLOBAL_CONCURRENT, 5)

  const DEFAULT_SCENE_PROBS: Record<string, number> = {
    entity_create: 80,
    entity_delete: 90,
    field_short: 50,
    field_long: 40,
    name_input: 60,
    relation_create: 30,
    relation_delete: 40,
    view_switch: 20,
    batch_edit: 25,
  }

  function loadSceneProbs(): Record<string, number> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COMPANION_MODE_SCENE_PROBS)
      return raw ? { ...DEFAULT_SCENE_PROBS, ...JSON.parse(raw) } : { ...DEFAULT_SCENE_PROBS }
    } catch {
      return { ...DEFAULT_SCENE_PROBS }
    }
  }

  const companionModeSceneProbs = ref<Record<string, number>>(loadSceneProbs())

  const sidebarPosition = persistedRef(STORAGE_KEY_SIDEBAR_POSITION, 'left')
  const detailPanelPosition = persistedRef(STORAGE_KEY_DETAIL_PANEL_POSITION, 'right')
  const timelineDragEnabled = persistedRef(STORAGE_KEY_TIMELINE_DRAG_ENABLED, false)
  const timelineDefaultMode = persistedRef(STORAGE_KEY_TIMELINE_DEFAULT_MODE, 'vertical' as string)
  const timelineDefaultGroup = persistedRef(STORAGE_KEY_TIMELINE_DEFAULT_GROUP, 'none' as string)
  const timelineCompactMode = persistedRef(STORAGE_KEY_TIMELINE_COMPACT_MODE, false)

  watch(customProviders, v => saveCustomProviders(v))
  watchDebounced(() => companionModeSceneProbs.value, () => localStorage.setItem(STORAGE_KEY_COMPANION_MODE_SCENE_PROBS, JSON.stringify(companionModeSceneProbs.value)), { debounce: 200, deep: true })

  function togglePlugin(id: string) {
    const p = plugins.value.find(p => p.id === id)
    if (!p) return
    p.active = !p.active
    savePlugins(plugins.value)
  }

  function setTheme(t: string) {
    setThemeFromEngine(t)
  }

  function isActive(id: string): boolean {
    return plugins.value.find(p => p.id === id)?.active ?? false
  }

  function getActivePluginIds(): string[] {
    return plugins.value.filter(p => p.active).map(p => p.id)
  }

  /* ─── 快捷键覆盖 ─── */
  const shortcutOverrides = ref<Record<string, string[]>>(loadShortcuts())

  function getShortcut(id: string): string[] {
    return shortcutOverrides.value[id] || SHORTCUT_DEFAULTS[id] || []
  }

  function setShortcut(id: string, keys: string[]) {
    shortcutOverrides.value[id] = keys
    saveShortcuts(shortcutOverrides.value)
  }

  function resetShortcut(id: string) {
    delete shortcutOverrides.value[id]
    saveShortcuts(shortcutOverrides.value)
  }

  function resetAllShortcuts() {
    shortcutOverrides.value = {}
    localStorage.removeItem(STORAGE_KEY_SHORTCUTS)
  }

  function addCustomProvider(entry: Omit<CustomProviderEntry, 'id'>): CustomProviderEntry {
    const id = 'cp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const item: CustomProviderEntry = { id, ...entry }
    customProviders.value = [...customProviders.value, item]
    return item
  }

  function removeCustomProvider(id: string): void {
    const idx = customProviders.value.findIndex(p => p.id === id)
    if (idx !== -1) customProviders.value = customProviders.value.filter(p => p.id !== id)
  }

  function getCustomKeyStoreId(baseUrl: string): string {
    return deriveKeyStoreId(baseUrl)
  }

  return { plugins, theme, togglePlugin, setTheme, isActive, getActivePluginIds, loadProjectPlugins,
           shortcutOverrides, getShortcut, setShortcut, resetShortcut, resetAllShortcuts,
           SHORTCUT_DEFAULTS, undoHistoryLimit, multiStepRedo, maxCenterNodes, panelLimitEnabled,
           smoothCaretEnabled, smoothCaretDuration, smoothCaretVariant,
           autoCreateEntityEnabled, autoCreateSelectorEnabled, autoCreateEntityRefEnabled, autoCreateGraphEnabled,
           highlight_pulseEnabled, highlight_dimmingEnabled, highlight_dimmingMode, highlight_dimOpacity, highlight_spreadHops,
           aiProviderMode, aiCloudProvider, aiCloudModel, aiLocalEndpoint, aiLocalType, aiLocalModel,
           aiCustomBaseUrl, aiCustomType, aiCustomModel, aiDangerConfirm, agentSecurityLevel, agentBackend,
           customProviders, addCustomProvider, removeCustomProvider, getCustomKeyStoreId,
           visionSubAgentProvider, visionSubAgentModel,
           outlineInlineEdit,
           companionModeEnabled, companionModeDuration, companionModePersonaTransition,
           companionModeDebounce, companionModeTimeout, companionModeMaxFailures,
           companionModeCrossPlugin, companionModePersonaSwitchChance,
           companionModePauseThreshold, companionModeSentenceTrigger, companionModeCharThreshold,
           companionModeLuckEnabled, companionModeLuckResetMinutes, companionModeLuckResetOps,
           companionModePositionContext, companionModeClickPin, companionModeSceneProbs,
           companionModeCustomModel, companionModeProviderKey, companionModeModelId,
           companionModeSilentInSpace,
           groupChatMaxAgents, groupChatDefaultStrategy, groupChatGlobalRpm, groupChatGlobalConcurrent,
             sidebarPosition, detailPanelPosition,
            timelineDragEnabled, timelineDefaultMode, timelineDefaultGroup, timelineCompactMode,
           voiceLang, voiceContinuous,
           DEFAULT_SCENE_PROBS }
})
