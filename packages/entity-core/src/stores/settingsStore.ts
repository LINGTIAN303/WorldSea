import { defineStore } from 'pinia'
import { ref, watch, computed, type Ref } from 'vue'
import { useTheme } from '../composables/useTheme'
import { getProjectManager } from '../core'
import { watchDebounced } from '@worldsea/perf-kit/render'

export interface SproutToggle {
  id: string
  label: string
  icon: string
  active: boolean
  dependencies?: { moduleId: string; version?: string; optional?: boolean }[]
  source?: 'builtin' | 'local' | 'remote'
  /** 芽分类，用于芽管理页标签筛选 */
  category?: SproutCategory
}

/** 芽分类定义（芽管理页标签筛选用） */
export const SPROUT_CATEGORIES = [
  { id: 'world', label: '世界观' },
  { id: 'characters', label: '角色' },
  { id: 'items', label: '物品' },
  { id: 'narrative', label: '叙事' },
  { id: 'visual', label: '视觉' },
  { id: 'system', label: '系统' },
] as const

export type SproutCategory = typeof SPROUT_CATEGORIES[number]['id']

export interface CustomProviderEntry {
  id: string
  name: string
  baseUrl: string
  apiType: string
  modelId: string
}

const STORAGE_KEY_PLUGINS = 'worldsea_plugin_toggles'
const STORAGE_KEY_UNDO_LIMIT = 'worldsea_undo_history_limit'
const STORAGE_KEY_MULTI_STEP_REDO = 'worldsea_multi_step_redo'
const STORAGE_KEY_MAX_CENTER_NODES = 'worldsea_max_center_nodes'
const STORAGE_KEY_PANEL_LIMIT_ENABLED = 'worldsea_panel_limit_enabled'
const STORAGE_KEY_SMOOTH_CARET = 'worldsea_smooth_caret'
const STORAGE_KEY_SMOOTH_CARET_DURATION = 'worldsea_smooth_caret_duration'
const STORAGE_KEY_SMOOTH_CARET_VARIANT = 'worldsea_smooth_caret_variant'
const STORAGE_KEY_AUTO_CREATE_ENTITY = 'worldsea_auto_create_entity'
const STORAGE_KEY_AUTO_CREATE_SELECTOR = 'worldsea_auto_create_selector'
const STORAGE_KEY_AUTO_CREATE_ENTITY_REF = 'worldsea_auto_create_entity_ref'
const STORAGE_KEY_AUTO_CREATE_GRAPH = 'worldsea_auto_create_graph'
const STORAGE_KEY_HIGHLIGHT_PULSE_ENABLED = 'worldsea_highlight_pulse_enabled'
const STORAGE_KEY_HIGHLIGHT_DIMMING_ENABLED = 'worldsea_highlight_dimming_enabled'
const STORAGE_KEY_HIGHLIGHT_DIMMING_MODE = 'worldsea_highlight_dimming_mode'
const STORAGE_KEY_HIGHLIGHT_DIM_OPACITY = 'worldsea_highlight_dim_opacity'
const STORAGE_KEY_HIGHLIGHT_SPREAD_HOPS = 'worldsea_highlight_spread_hops'
const STORAGE_KEY_AI_PROVIDER_MODE = 'worldsea_ai_provider_mode'
const STORAGE_KEY_AI_CLOUD_PROVIDER = 'worldsea_ai_cloud_provider'
const STORAGE_KEY_AI_CLOUD_MODEL = 'worldsea_ai_cloud_model'
const STORAGE_KEY_AI_LOCAL_ENDPOINT = 'worldsea_ai_local_endpoint'
const STORAGE_KEY_AI_LOCAL_TYPE = 'worldsea_ai_local_type'
const STORAGE_KEY_AI_LOCAL_MODEL = 'worldsea_ai_local_model'
const STORAGE_KEY_AI_CUSTOM_BASE_URL = 'worldsea_ai_custom_base_url'
const STORAGE_KEY_AI_CUSTOM_TYPE = 'worldsea_ai_custom_type'
const STORAGE_KEY_AI_CUSTOM_MODEL = 'worldsea_ai_custom_model'
const STORAGE_KEY_AI_CUSTOM_PROVIDERS = 'worldsea_ai_custom_providers'
const STORAGE_KEY_AGENT_BACKEND = 'worldsea_agent_backend'
const STORAGE_KEY_VISION_SUB_AGENT_PROVIDER = 'worldsea_vision_sub_agent_provider'
const STORAGE_KEY_VISION_SUB_AGENT_MODEL = 'worldsea_vision_sub_agent_model'
const STORAGE_KEY_OUTLINE_INLINE_EDIT = 'worldsea_outline_inline_edit'
const STORAGE_KEY_COMPANION_MODE_ENABLED = 'worldsea_companion_mode_enabled'
const STORAGE_KEY_COMPANION_MODE_DURATION = 'worldsea_companion_mode_duration'
const STORAGE_KEY_COMPANION_MODE_PERSONA_TRANSITION = 'worldsea_companion_mode_persona_transition'
const STORAGE_KEY_COMPANION_MODE_DEBOUNCE = 'worldsea_companion_mode_debounce'
const STORAGE_KEY_COMPANION_MODE_TIMEOUT = 'worldsea_companion_mode_timeout'
const STORAGE_KEY_COMPANION_MODE_MAX_FAILURES = 'worldsea_companion_mode_max_failures'
const STORAGE_KEY_COMPANION_MODE_CROSS_PLUGIN = 'worldsea_companion_mode_cross_plugin'
const STORAGE_KEY_COMPANION_MODE_PERSONA_SWITCH_CHANCE = 'worldsea_companion_mode_persona_switch_chance'
const STORAGE_KEY_COMPANION_MODE_PAUSE_THRESHOLD = 'worldsea_companion_mode_pause_threshold'
const STORAGE_KEY_COMPANION_MODE_SENTENCE_TRIGGER = 'worldsea_companion_mode_sentence_trigger'
const STORAGE_KEY_COMPANION_MODE_CHAR_THRESHOLD = 'worldsea_companion_mode_char_threshold'
const STORAGE_KEY_COMPANION_MODE_LUCK_ENABLED = 'worldsea_companion_mode_luck_enabled'
const STORAGE_KEY_COMPANION_MODE_LUCK_RESET_MINUTES = 'worldsea_companion_mode_luck_reset_minutes'
const STORAGE_KEY_COMPANION_MODE_LUCK_RESET_OPS = 'worldsea_companion_mode_luck_reset_ops'
const STORAGE_KEY_COMPANION_MODE_POSITION_CONTEXT = 'worldsea_companion_mode_position_context'
const STORAGE_KEY_COMPANION_MODE_CLICK_PIN = 'worldsea_companion_mode_click_pin'
const STORAGE_KEY_COMPANION_MODE_SCENE_PROBS = 'worldsea_companion_mode_scene_probs'
const STORAGE_KEY_COMPANION_MODE_CUSTOM_MODEL = 'worldsea_companion_mode_custom_model'
const STORAGE_KEY_COMPANION_MODE_PROVIDER_KEY = 'worldsea_companion_mode_provider_key'
const STORAGE_KEY_COMPANION_MODE_MODEL_ID = 'worldsea_companion_mode_model_id'
const STORAGE_KEY_COMPANION_MODE_SILENT_IN_SPACE = 'worldsea_companion_mode_silent_in_space'
const STORAGE_KEY_SIDEBAR_POSITION = 'worldsea_sidebar_position'
const STORAGE_KEY_DETAIL_PANEL_POSITION = 'worldsea_detail_panel_position'
const STORAGE_KEY_TIMELINE_DRAG_ENABLED = 'worldsea_timeline_drag_enabled'
const STORAGE_KEY_TIMELINE_DEFAULT_MODE = 'worldsea_timeline_default_mode'
const STORAGE_KEY_TIMELINE_DEFAULT_GROUP = 'worldsea_timeline_default_group'
const STORAGE_KEY_TIMELINE_COMPACT_MODE = 'worldsea_timeline_compact_mode'
const STORAGE_KEY_GROUP_CHAT_MAX_AGENTS = 'worldsea_group_chat_max_agents'
const STORAGE_KEY_GROUP_CHAT_DEFAULT_STRATEGY = 'worldsea_group_chat_default_strategy'
const STORAGE_KEY_GROUP_CHAT_GLOBAL_RPM = 'worldsea_group_chat_global_rpm'
const STORAGE_KEY_GROUP_CHAT_GLOBAL_CONCURRENT = 'worldsea_group_chat_global_concurrent'
// 无障碍：减弱动态效果（默认 false = 不减弱，保留动画；开启后通过根元素 data-reduce-motion 关闭界面动效）
const STORAGE_KEY_REDUCE_MOTION = 'worldsea_reduce_motion'
// 动画效果分组开关（2026-08-23）：供用户逐项关闭某类动画，默认全部开启
const STORAGE_KEY_ANIMATIONS = 'worldsea_animations'
/** 动画效果分组定义：key → 展示标签 */
export const ANIMATION_GROUPS: Record<string, string> = {
  messages: '消息与对话',
  status: '状态与脉冲',
  panels: '面板与侧边栏',
  overlays: '弹窗与控件',
  splash: '启动动画',
}
/** 动画分组默认值：全部开启 */
const ANIMATION_DEFAULTS: Record<string, boolean> = Object.keys(ANIMATION_GROUPS).reduce((acc, k) => ({ ...acc, [k]: true }), {})

function loadAnimations(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ANIMATIONS)
    return raw ? { ...ANIMATION_DEFAULTS, ...JSON.parse(raw) } : { ...ANIMATION_DEFAULTS }
  } catch {
    return { ...ANIMATION_DEFAULTS }
  }
}

const DEFAULT_SPROUTS: SproutToggle[] = [
  // label/icon 以侧边栏视图注册名（apps/tauri/src/sprouts/official/*/index.ts registerView）为权威，2026-09-13 对齐
  { id: 'official.characters', label: '角色', icon: 'character', active: true, category: 'characters' },
  { id: 'official.regions', label: '区域图谱', icon: 'region', active: false, category: 'world' },
  { id: 'official.timeline', label: '时间线', icon: 'timeline', active: true, category: 'narrative' },
  { id: 'official.organizations', label: '势力/组织', icon: 'organization', active: false, category: 'characters' },
  { id: 'official.concepts', label: '概念/设定库', icon: 'concept', active: true, category: 'world' },
  { id: 'official.items', label: '道具', icon: 'item', active: false, category: 'items' },
  { id: 'official.apparel', label: '服饰/装备', icon: 'apparel', active: false, category: 'items' },
  { id: 'official.mindmap', label: '思维导图', icon: 'mindmap', active: false, category: 'visual' },
  { id: 'official.custom', label: '自定义视窗', icon: 'dashboard', active: false, category: 'system' },
  { id: 'official.module-builder', label: '自定义模块', icon: 'module-builder', active: true, category: 'system' },
  { id: 'official.graph', label: '全局图谱', icon: 'graph', active: false, category: 'visual' },
  { id: 'official.buildings', label: '建筑/地点细节', icon: 'building', active: false, category: 'world' },
  { id: 'official.species', label: '种族/物种', icon: 'species', active: false, category: 'world' },
  { id: 'official.magic', label: '魔法/技能体系', icon: 'magic', active: false, category: 'world' },
  { id: 'official.outline', label: '大纲', icon: 'outline', active: true, category: 'narrative' },
  { id: 'official.languages', label: '语言/文字', icon: 'language', active: false, category: 'world' },
  { id: 'official.culture', label: '文化/习俗', icon: 'culture', active: false, category: 'world' },
  { id: 'official.conflict', label: '冲突/战争', icon: 'combat', active: false, category: 'narrative' },
  { id: 'official.inspiration', label: '灵感/素材库', icon: 'inspiration', active: true, category: 'narrative' },
  { id: 'official.plants', label: '植物/生态', icon: 'plant', active: false, category: 'world' },
  { id: 'official.combat_stats', label: '战力', icon: 'combat', active: false, category: 'system' },
  { id: 'official.weapons', label: '武器', icon: 'weapon', active: false, category: 'items' },
  { id: 'official.manuscript', label: '正文写作', icon: 'manuscript', active: false, category: 'narrative' },
  { id: 'official.drawing', label: '画板', icon: 'drawing', active: false, category: 'visual' },
  { id: 'official.tactical-board', label: '战术棋盘', icon: 'tactical-board', active: false, category: 'visual' },
  { id: 'official.notebook', label: '笔记本', icon: 'notebook', active: true, category: 'visual' },
  { id: 'official.workflow', label: '创作编排', icon: 'lightning', active: true, category: 'system' },
]

function loadSprouts(): SproutToggle[] {
  // 优先从项目 DB 的 project_settings 表读取
  // 同步初始化时先从 localStorage 加载，异步加载项目 DB 数据后更新
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLUGINS)
    if (!raw) return DEFAULT_SPROUTS.map(p => ({ ...p }))
    const saved = JSON.parse(raw) as { id: string; active: boolean }[]
    return DEFAULT_SPROUTS.map(def => {
      const found = saved.find((s: any) => s.id === def.id)
      return { ...def, active: found ? found.active : def.active }
    })
  } catch {
    return DEFAULT_SPROUTS.map(p => ({ ...p }))
  }
}

/**
 * 异步加载项目级芽开关。
 * 从项目 DB 的 project_settings 表读取，更新 sprouts ref。
 * 切换项目后调用。
 */
async function loadProjectSprouts(): Promise<SproutToggle[] | null> {
  try {
    const pm = getProjectManager()
    const db = pm.getCurrentProjectDb()
    const entry = await db.table('project_settings').get('plugin_toggles')
    if (!entry) return null
    const saved = JSON.parse((entry as any).value) as { id: string; active: boolean }[]
    return DEFAULT_SPROUTS.map(def => {
      const found = saved.find((s: any) => s.id === def.id)
      return { ...def, active: found ? found.active : def.active }
    })
  } catch {
    return null
  }
}

function saveSprouts(sprouts: SproutToggle[]) {
  const data = JSON.stringify(sprouts.map(p => ({ id: p.id, active: p.active })))
  // 同时写入 localStorage（回退）和项目 DB（键名保持 plugin_toggles，待芽收束为工具时统一迁移）
  localStorage.setItem(STORAGE_KEY_PLUGINS, data)
  try {
    const pm = getProjectManager()
    const db = pm.getCurrentProjectDb()
    db.table('project_settings').put({ key: 'plugin_toggles', value: data })
  } catch {
    // 项目系统未初始化，仅保存到 localStorage
  }
}

// ─── 芽分组（2026-09-13）：用户自建的激活范围方案 ───
// 持久化模式与芽开关一致：localStorage（回退）+ 项目 DB project_settings（项目级，
// 不同项目可维护不同分组）。key = 'sprout_groups'。
export interface SproutGroup {
  id: string
  name: string
  sproutIds: string[]
}
const STORAGE_KEY_SPROUT_GROUPS = 'worldsea_sprout_groups'
/** 全停用兜底：保留此角色芽视图（人物志）为激活态 */
const FALLBACK_SPROUT_ID = 'official.characters'

function loadSproutGroups(): SproutGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SPROUT_GROUPS)
    const arr = raw ? JSON.parse(raw) as SproutGroup[] : []
    return Array.isArray(arr)
      ? arr.filter(g => g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.sproutIds))
      : []
  } catch {
    return []
  }
}

function saveSproutGroups(groups: SproutGroup[]) {
  const data = JSON.stringify(groups)
  localStorage.setItem(STORAGE_KEY_SPROUT_GROUPS, data)
  try {
    const pm = getProjectManager()
    const db = pm.getCurrentProjectDb()
    db.table('project_settings').put({ key: 'sprout_groups', value: data })
  } catch {
    // 项目系统未初始化，仅保存到 localStorage
  }
}

/** 异步加载项目级芽分组（切换项目后调用，模式同 loadProjectSprouts） */
async function loadProjectSproutGroups(): Promise<SproutGroup[] | null> {
  try {
    const pm = getProjectManager()
    const db = pm.getCurrentProjectDb()
    const entry = await db.table('project_settings').get('sprout_groups')
    if (!entry) return null
    const arr = JSON.parse((entry as any).value) as SproutGroup[]
    return Array.isArray(arr)
      ? arr.filter(g => g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.sproutIds))
      : []
  } catch {
    return null
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


/* ─── 快捷键默认键位 ───
 * 已退役（2026-09 快捷键系统整顿）：默认键位以各注册处 register() 声明为准，
 * 目录元数据见 ui-kit settings/utils.ts 的 SHORTCUT_CATALOG。 */

const STORAGE_KEY_VOICE_LANG = 'worldsea_voice_lang'
const STORAGE_KEY_VOICE_CONTINUOUS = 'worldsea_voice_continuous'

export const useSettingsStore = defineStore('settings', () => {
  const { currentThemeId, setTheme: setThemeFromEngine } = useTheme()
  const sprouts = ref<SproutToggle[]>(loadSprouts())
  // 芽分组：用户自建的激活范围方案（项目级持久化，模式同 sprouts）
  const sproutGroups = ref<SproutGroup[]>(loadSproutGroups())
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
  // 无障碍：减弱动态效果（默认 false = 不减弱）
  const reduceMotion = persistedRef(STORAGE_KEY_REDUCE_MOTION, false)
  // 动画效果分组开关（默认全部开启；关闭某组 → 根元素 data-anim-<组>='off' 禁用该类动画）
  const animations = ref<Record<string, boolean>>(loadAnimations())
  watch(animations, (v) => { localStorage.setItem(STORAGE_KEY_ANIMATIONS, JSON.stringify(v)) }, { deep: true })

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

  function toggleSprout(id: string) {
    const p = sprouts.value.find(p => p.id === id)
    if (!p) return
    p.active = !p.active
    saveSprouts(sprouts.value)
  }

  /** 批量设置激活态（仅影响给定 id 集合，其余不动），持久化——全选/全不选的落点 */
  function setSproutsActive(ids: string[], active: boolean) {
    const set = new Set(ids)
    sprouts.value = sprouts.value.map(p => set.has(p.id) ? { ...p, active } : p)
    ensureFallbackSprout()
    saveSprouts(sprouts.value)
  }

  /** 全停用兜底芽：至少保留一个角色芽视图（人物志），避免 workbench 无视图可用（2026-09-13 用户要求） */
  function ensureFallbackSprout() {
    if (sprouts.value.some(p => p.active)) return
    const fallback = sprouts.value.find(p => p.id === FALLBACK_SPROUT_ID)
    if (fallback) fallback.active = true
  }

  /**
   * 保存当前激活集为分组（激活范围快照）。同名分组覆盖更新（重复保存同名 = 修改其芽集合）。
   * @returns 保存后的分组
   */
  function saveSproutGroup(name: string, groupSproutIds: string[]): SproutGroup {
    const trimmed = name.trim()
    const ids = [...groupSproutIds]
    const existing = sproutGroups.value.find(g => g.name === trimmed)
    if (existing) {
      existing.sproutIds = ids
      saveSproutGroups(sproutGroups.value)
      return existing
    }
    const group: SproutGroup = {
      id: 'sg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: trimmed,
      sproutIds: ids,
    }
    sproutGroups.value = [...sproutGroups.value, group]
    saveSproutGroups(sproutGroups.value)
    return group
  }

  /** 应用分组 = 激活范围替换为组内集合（组外停用），并持久化；全停用时兜底保留角色芽 */
  function applySproutGroup(groupId: string) {
    const g = sproutGroups.value.find(x => x.id === groupId)
    if (!g) return
    const ids = new Set(g.sproutIds)
    sprouts.value = sprouts.value.map(p => ({ ...p, active: ids.has(p.id) }))
    ensureFallbackSprout()
    saveSprouts(sprouts.value)
  }

  function removeSproutGroup(groupId: string) {
    sproutGroups.value = sproutGroups.value.filter(g => g.id !== groupId)
    saveSproutGroups(sproutGroups.value)
  }

  function setTheme(t: string) {
    setThemeFromEngine(t)
  }

  function isActive(id: string): boolean {
    return sprouts.value.find(p => p.id === id)?.active ?? false
  }

  function getActiveSproutIds(): string[] {
    return sprouts.value.filter(p => p.active).map(p => p.id)
  }

  /* ─── 快捷键 ───
   * 已整体退役（2026-09 快捷键系统整顿）：键位权威在 ui-kit useShortcuts 注册表
   * （注册处声明默认值 + localStorage['worldsea_shortcuts'] 用户覆盖），设置面板
   * 直接读写 registry。本 store 不再持有任何快捷键状态。 */

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

  return { sprouts, sproutGroups, theme, toggleSprout, setSproutsActive, saveSproutGroup, applySproutGroup, removeSproutGroup, setTheme, isActive, getActiveSproutIds, loadProjectSprouts, loadProjectSproutGroups,
           undoHistoryLimit, multiStepRedo, maxCenterNodes, panelLimitEnabled,
           smoothCaretEnabled, smoothCaretDuration, smoothCaretVariant,
           autoCreateEntityEnabled, autoCreateSelectorEnabled, autoCreateEntityRefEnabled, autoCreateGraphEnabled,
           highlight_pulseEnabled, highlight_dimmingEnabled, highlight_dimmingMode, highlight_dimOpacity, highlight_spreadHops,
           aiProviderMode, aiCloudProvider, aiCloudModel, aiLocalEndpoint, aiLocalType, aiLocalModel,
           aiCustomBaseUrl, aiCustomType, aiCustomModel, agentBackend,
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
            reduceMotion, animations, ANIMATION_GROUPS,
            sidebarPosition, detailPanelPosition,
            timelineDragEnabled, timelineDefaultMode, timelineDefaultGroup, timelineCompactMode,
           voiceLang, voiceContinuous,
           DEFAULT_SCENE_PROBS }
})
