import { defineStore } from 'pinia'
import { ref, watch, computed, type Ref } from 'vue'
import { useTheme } from '../composables/useTheme'
import {
  loadStoredSproutToggles,
  saveSproutToggles,
  loadProjectSproutToggles,
  loadStoredSproutGroups,
  saveSproutGroups as persistSproutGroups,
  loadProjectSproutGroups as persistProjectSproutGroups,
  loadStoredExternalSprouts,
  saveExternalSprouts as persistExternalSprouts,
  loadProjectExternalSprouts as persistProjectExternalSprouts,
} from './sproutPersistence'

export interface SproutToggle {
  id: string
  label: string
  icon: string
  active: boolean
  dependencies?: { moduleId: string; version?: string; optional?: boolean }[]
  source?: 'builtin' | 'local' | 'remote' | 'external'
  /** @deprecated 2026-10-20（R2）：旧 6 类仅作过渡筛选标签，待 R4 退役；新芽只写 manifest.domain。 */
  category?: SproutCategory
}

/** @deprecated 2026-10-20（R2）：旧 6 类过渡标签；域真源 = manifest.domain。 */
export const SPROUT_CATEGORIES = [
  { id: 'world', label: '世界观' },
  { id: 'characters', label: '角色' },
  { id: 'items', label: '物品' },
  { id: 'narrative', label: '叙事' },
  { id: 'visual', label: '视觉' },
  { id: 'system', label: '系统' },
] as const

/** @deprecated 2026-10-20（R2）：旧 6 类过渡标签，待 R4 退役。 */
export type SproutCategory = typeof SPROUT_CATEGORIES[number]['id']

export interface CustomProviderEntry {
  id: string
  name: string
  baseUrl: string
  apiType: string
  modelId: string
}

const STORAGE_KEY_UNDO_LIMIT = 'worldsea_undo_history_limit'
const STORAGE_KEY_MULTI_STEP_REDO = 'worldsea_multi_step_redo'
const STORAGE_KEY_MAX_CENTER_NODES = 'worldsea_max_center_nodes'
const STORAGE_KEY_PANEL_LIMIT_ENABLED = 'worldsea_panel_limit_enabled'
const STORAGE_KEY_DECK_WHEEL_GATE = 'worldsea_deck_wheel_gate'
const STORAGE_KEY_SMOOTH_CARET = 'worldsea_smooth_caret'
const STORAGE_KEY_SMOOTH_CARET_DURATION = 'worldsea_smooth_caret_duration'
const STORAGE_KEY_SMOOTH_CARET_VARIANT = 'worldsea_smooth_caret_variant'
const STORAGE_KEY_AUTO_CREATE_ENTITY = 'worldsea_auto_create_entity'
const STORAGE_KEY_AUTO_CREATE_SELECTOR = 'worldsea_auto_create_selector'
const STORAGE_KEY_AUTO_CREATE_ENTITY_REF = 'worldsea_auto_create_entity_ref'
const STORAGE_KEY_HIGHLIGHT_PULSE_ENABLED = 'worldsea_highlight_pulse_enabled'
const STORAGE_KEY_HIGHLIGHT_DIMMING_ENABLED = 'worldsea_highlight_dimming_enabled'
const STORAGE_KEY_CARD_HOVER_PREVIEW = 'worldsea_card_hover_preview'
const STORAGE_KEY_HOVER_PREVIEW_FRAMELESS = 'worldsea_hover_preview_frameless'
const STORAGE_KEY_VIDEO_COVER_AUTOPLAY = 'worldsea_video_cover_autoplay'
const STORAGE_KEY_VIDEO_AUTOPLAY_ENTITIES = 'worldsea_video_autoplay_entities'
const STORAGE_KEY_VIDEO_HOVER_PLAY = 'worldsea_video_hover_play'
const STORAGE_KEY_VIDEO_PAUSE_ON_SCROLL = 'worldsea_video_pause_on_scroll'
const STORAGE_KEY_PORTRAIT_FOLLOW_MOUSE = 'worldsea_portrait_follow_mouse'
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
const STORAGE_KEY_SIDEBAR_POSITION = 'worldsea_sidebar_position'
const STORAGE_KEY_DETAIL_PANEL_POSITION = 'worldsea_detail_panel_position'
/** 图谱底色档（批 D）：`dark`＝深色星图画布；`theme`＝跟随应用主题（浅/深令牌） */
const STORAGE_KEY_GRAPH_BACKGROUND = 'worldsea_graph_background'
const STORAGE_KEY_PHONE_PREVIEW_MODE = 'worldsea_phone_preview_mode'
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
  nav: '导航与视图切换',
  content: '内容增减与重排',
  panels: '面板与侧边栏',
  overlays: '弹窗与浮层',
  status: '状态与脉冲',
  messages: '消息与对话',
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
  // label/icon 以侧边栏视图注册名（apps/tauri/src/world/plugins/<id>/index.ts registerView）为权威，2026-09-13 对齐；2026-10-14 修正过期路径（原指 sprouts/official/ 已退役）
  // category 为旧 6 类过渡标签，待 R4 退役；域真源 = 各芽 manifest.domain（R1/R2，2026-10-20）
  { id: 'official.characters', label: '角色', icon: 'character', active: true, category: 'characters' },
  { id: 'official.regions', label: '区域图谱', icon: 'region', active: false, category: 'world' },
  { id: 'official.timeline', label: '时间线', icon: 'timeline', active: true, category: 'narrative' },
  { id: 'official.organizations', label: '势力/组织', icon: 'organization', active: false, category: 'characters' },
  { id: 'official.concepts', label: '概念/设定库', icon: 'concept', active: true, category: 'world' },
  { id: 'official.items', label: '道具', icon: 'item', active: false, category: 'items' },
  { id: 'official.apparel', label: '服饰/装备', icon: 'apparel', active: false, category: 'items' },
  { id: 'official.custom', label: '自定义视窗', icon: 'dashboard', active: false, category: 'system' },
  { id: 'official.mindmap', label: '思维导图', icon: 'mindmap', active: false, category: 'visual' },
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
  { id: 'official.combat_stats', label: '战力', icon: 'target', active: false, category: 'system' },
  { id: 'official.weapons', label: '武器', icon: 'weapon', active: false, category: 'items' },
  { id: 'official.manuscript', label: '正文写作', icon: 'manuscript', active: false, category: 'narrative' },
  { id: 'official.drawing', label: '画板', icon: 'drawing', active: false, category: 'visual' },
  { id: 'official.tactical-board', label: '战术棋盘', icon: 'tactical-board', active: false, category: 'visual' },
  { id: 'official.notebook', label: '笔记本', icon: 'notebook', active: true, category: 'visual' },
  { id: 'official.orchestration', label: '创作编排', icon: 'lightning', active: true, category: 'system' },
  { id: 'official.field-matrix', label: '字段矩阵', icon: 'grid', active: true, category: 'system' },
  { id: 'official.gallery', label: '图库', icon: 'image', active: true, category: 'system' },
  { id: 'official.codex', label: '设定集', icon: 'book-open', active: true, category: 'system' },
  { id: 'official.creatures', label: '生物图鉴', icon: 'paw', active: true, category: 'world' },
]

/** 芽清单内的 id 集合（持久化面归一用；见 `./sproutPersistence`）。 */
const KNOWN_SPROUT_IDS = new Set(DEFAULT_SPROUTS.map(s => s.id))

/** 外部持久化条目 → 最小 SproutToggle（label/icon 占位，world 树 sync 后更新为 manifest 真值）。 */
function externalToggleFrom(entry: { id: string; active: boolean }): SproutToggle {
  return {
    id: entry.id,
    label: entry.id.split('.').pop() ?? entry.id,
    icon: 'puzzle',
    active: entry.active,
    source: 'external',
  }
}

/** 并入外部持久化条目（内置骨架后 append；同 id 不重复）。 */
function mergeExternalPersisted(list: SproutToggle[], entries: { id: string; active: boolean }[] | null): SproutToggle[] {
  if (!entries || entries.length === 0) return list
  const known = new Set(list.map(item => item.id))
  const extras = entries.filter(entry => !known.has(entry.id)).map(externalToggleFrom)
  return extras.length > 0 ? [...list, ...extras] : list
}

function loadSprouts(): SproutToggle[] {
  // 同步初始化先从 localStorage 加载（含一次性归一写回）；项目 DB 数据由 loadProjectSprouts 异步更新
  // 外部插件条目自持独立持久化键（内置归一会滤掉清单外 id），此处并入
  return mergeExternalPersisted(loadStoredSproutToggles(DEFAULT_SPROUTS), loadStoredExternalSprouts())
}

/**
 * 异步加载项目级芽开关（项目 DB `project_settings.plugin_toggles`，切换项目后调用）。
 * 外部插件副本（同项目 DB 的 `external_plugins`）一并并入——项目级插件集随项目切换。
 */
async function loadProjectSprouts(): Promise<SproutToggle[] | null> {
  const merged = await loadProjectSproutToggles(DEFAULT_SPROUTS)
  if (!merged) return null
  return mergeExternalPersisted(merged, await persistProjectExternalSprouts())
}

function saveSprouts(sprouts: SproutToggle[]) {
  // localStorage（回退）+ 项目 DB 两处写；细口径见 `./sproutPersistence`
  saveSproutToggles(sprouts)
}

// ─── 芽分组（2026-09-13）：用户自建的激活范围方案 ───
// 持久化模式与芽开关一致：localStorage（回退）+ 项目 DB project_settings（项目级，
// 不同项目可维护不同分组）。key = 'sprout_groups'。
export interface SproutGroup {
  id: string
  name: string
  sproutIds: string[]
}
/** 全停用兜底：保留此角色芽视图（人物志）为激活态 */
const FALLBACK_SPROUT_ID = 'official.characters'

function loadSproutGroups(): SproutGroup[] {
  return loadStoredSproutGroups<SproutGroup>(KNOWN_SPROUT_IDS)
}

function saveSproutGroups(groups: SproutGroup[]) {
  persistSproutGroups(groups)
}

/** 异步加载项目级芽分组（切换项目后调用，模式同 loadProjectSprouts） */
async function loadProjectSproutGroups(): Promise<SproutGroup[] | null> {
  return persistProjectSproutGroups<SproutGroup>(KNOWN_SPROUT_IDS)
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
    if (typeof defaultValue === 'boolean') initial = (raw === 'true' ? true : raw === 'false' ? false : defaultValue) as T
    // 无法识别的值回退到默认值
    else if (typeof defaultValue === 'number') initial = (Number.isFinite(Number(raw)) ? Number(raw) : defaultValue) as T
    else initial = raw as T
  }
  const val = ref(initial) as Ref<T extends boolean ? boolean : T extends number ? number : string>
  watch(val, (v) => { localStorage.setItem(key, String(v)) })
  return val
}

/** JSON 持久化 ref（数组/对象值；解析失败回退默认，2026-10-25 形象图批 C：视频自动播放实体列表） */
function persistedJsonRef<T>(key: string, defaultValue: T): Ref<T> {
  let initial = defaultValue
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) initial = JSON.parse(raw) as T
  } catch { /* 回退默认 */ }
  const val = ref(initial) as Ref<T>
  watch(val, (v) => {
    localStorage.setItem(key, JSON.stringify(v))
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

export const useSettingsStore = defineStore('settings', () => {
  const { currentThemeId, setTheme: setThemeFromEngine } = useTheme()
  const sprouts = ref<SproutToggle[]>(loadSprouts())
  // 芽分组：用户自建的激活范围方案（项目级持久化，模式同 sprouts）
  const sproutGroups = ref<SproutGroup[]>(loadSproutGroups())
  const theme = computed(() => currentThemeId.value)

  const undoHistoryLimit = persistedRef(STORAGE_KEY_UNDO_LIMIT, 20)
  const multiStepRedo = persistedRef(STORAGE_KEY_MULTI_STEP_REDO, true)
  const maxCenterNodes = persistedRef(STORAGE_KEY_MAX_CENTER_NODES, 5)
  const panelLimitEnabled = persistedRef(STORAGE_KEY_PANEL_LIMIT_ENABLED, true)
  // 设置翻卡滚轮手势判定（2026-10-26）：默认开启——可滚内容到边缘后需停顿再滚（新手势）才翻卡，防惯性连翻；关闭则到边缘即翻
  const deckWheelGateEnabled = persistedRef(STORAGE_KEY_DECK_WHEEL_GATE, true)
  const smoothCaretEnabled = persistedRef(STORAGE_KEY_SMOOTH_CARET, true)
  const smoothCaretDuration = persistedRef(STORAGE_KEY_SMOOTH_CARET_DURATION, 150)
  const smoothCaretVariant = persistedRef(STORAGE_KEY_SMOOTH_CARET_VARIANT, 'line')
  const autoCreateEntityEnabled = persistedRef(STORAGE_KEY_AUTO_CREATE_ENTITY, true)
  const autoCreateSelectorEnabled = persistedRef(STORAGE_KEY_AUTO_CREATE_SELECTOR, true)
  const autoCreateEntityRefEnabled = persistedRef(STORAGE_KEY_AUTO_CREATE_ENTITY_REF, true)
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
  // Agent 后端类型：'ts'（TS Agent）或 'rust'（Rust Agent，现默认）
  // 注意：已有用户的 localStorage 中若存储了 'ts'，仍保持 'ts'；
  //       仅新用户或清除存储的用户会默认使用 'rust'
  const agentBackend = persistedRef(STORAGE_KEY_AGENT_BACKEND, 'rust')
  const visionSubAgentProvider = persistedRef(STORAGE_KEY_VISION_SUB_AGENT_PROVIDER, '')
  const visionSubAgentModel = persistedRef(STORAGE_KEY_VISION_SUB_AGENT_MODEL, '')
  const outlineInlineEdit = persistedRef(STORAGE_KEY_OUTLINE_INLINE_EDIT, true)
  const groupChatMaxAgents = persistedRef(STORAGE_KEY_GROUP_CHAT_MAX_AGENTS, 5)
  const groupChatDefaultStrategy = persistedRef(STORAGE_KEY_GROUP_CHAT_DEFAULT_STRATEGY, 'speaking-desire')
  const groupChatGlobalRpm = persistedRef(STORAGE_KEY_GROUP_CHAT_GLOBAL_RPM, 60)
  const groupChatGlobalConcurrent = persistedRef(STORAGE_KEY_GROUP_CHAT_GLOBAL_CONCURRENT, 5)
  // 无障碍：减弱动态效果（默认 false = 不减弱）
  const reduceMotion = persistedRef(STORAGE_KEY_REDUCE_MOTION, false)
  // 动画效果分组开关（默认全部开启；关闭某组 → 根元素 data-anim-<组>='off' 禁用该类动画）
  const animations = ref<Record<string, boolean>>(loadAnimations())
  watch(animations, (v) => { localStorage.setItem(STORAGE_KEY_ANIMATIONS, JSON.stringify(v)) }, { deep: true })

  const sidebarPosition = persistedRef(STORAGE_KEY_SIDEBAR_POSITION, 'left')
  const detailPanelPosition = persistedRef(STORAGE_KEY_DETAIL_PANEL_POSITION, 'right')
  // 正文芽手机预览形态（2026-10-02）：右栏页为默认，弹窗为设置可选项
  const phonePreviewMode = persistedRef(STORAGE_KEY_PHONE_PREVIEW_MODE, 'dock' as string)
  const timelineDragEnabled = persistedRef(STORAGE_KEY_TIMELINE_DRAG_ENABLED, false)
  const timelineDefaultMode = persistedRef(STORAGE_KEY_TIMELINE_DEFAULT_MODE, 'vertical' as string)
  const timelineDefaultGroup = persistedRef(STORAGE_KEY_TIMELINE_DEFAULT_GROUP, 'none' as string)
  const timelineCompactMode = persistedRef(STORAGE_KEY_TIMELINE_COMPACT_MODE, false)
  /** 图谱底色（2026-10-09 图谱批 D）：默认「深色星图」；切「跟随主题」后画布与浮层走主题令牌 */
  const graphBackgroundMode = persistedRef(STORAGE_KEY_GRAPH_BACKGROUND, 'dark' as string)
  /** 实体卡片悬停形象预览（2026-10-25 形象图批 B）：默认开；无框模式默认关（有框） */
  const entityCardHoverPreview = persistedRef(STORAGE_KEY_CARD_HOVER_PREVIEW, true)
  const hoverPreviewFrameless = persistedRef(STORAGE_KEY_HOVER_PREVIEW_FRAMELESS, false)
  /** 视频封面自动播放三档（批 C #15/#17）：off=默认不自动播放 / all=全部 / selected=仅指定实体 */
  const videoCoverAutoplay = persistedRef(STORAGE_KEY_VIDEO_COVER_AUTOPLAY, 'off' as string)
  const videoCoverAutoplayEntities = persistedJsonRef<string[]>(STORAGE_KEY_VIDEO_AUTOPLAY_ENTITIES, [])
  /** 悬停卡片播放视频封面（批 C #18）：独立开关，进入播放/离开回首帧 */
  const videoCoverHoverPlay = persistedRef(STORAGE_KEY_VIDEO_HOVER_PLAY, true)
  /** 滚动网格时暂停视频封面（批 C 走查追加，多视频同播的帧率缓冲）：默认开 */
  const videoCoverPauseOnScroll = persistedRef(STORAGE_KEY_VIDEO_PAUSE_ON_SCROLL, true)
  /** 点击实体后形象图置顶浮层跟随鼠标（D1 #11）：默认不跟踪（固定左下角） */
  const portraitFollowMouse = persistedRef(STORAGE_KEY_PORTRAIT_FOLLOW_MOUSE, false)

  watch(customProviders, v => saveCustomProviders(v))

  function toggleSprout(id: string) {
    const p = sprouts.value.find(p => p.id === id)
    if (!p) return
    p.active = !p.active
    saveSprouts(sprouts.value)
  }

  /**
   * 外部插件清单对账（world 树装载/重对账后调用）：校正 label/icon 为 manifest 真值、
   * 剔除已消失的外部条目、写回独立持久化键（内置条目不动、active 尊重用户开关）。
   */
  function syncExternalSprouts(incoming: SproutToggle[]) {
    const builtins = sprouts.value.filter(p => p.source !== 'external')
    const externals: SproutToggle[] = incoming.map(item => {
      const existing = sprouts.value.find(p => p.id === item.id)
      return existing
        ? { ...existing, label: item.label, icon: item.icon, source: 'external' as const }
        : { ...item, source: 'external' as const }
    })
    sprouts.value = [...builtins, ...externals]
    persistExternalSprouts(externals.map(p => ({ id: p.id, active: p.active })))
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

  return { sprouts, sproutGroups, theme, toggleSprout, syncExternalSprouts, setSproutsActive, saveSproutGroup, applySproutGroup, removeSproutGroup, setTheme, isActive, getActiveSproutIds, loadProjectSprouts, loadProjectSproutGroups,
           undoHistoryLimit, multiStepRedo, maxCenterNodes, panelLimitEnabled, deckWheelGateEnabled,
           smoothCaretEnabled, smoothCaretDuration, smoothCaretVariant,
           autoCreateEntityEnabled, autoCreateSelectorEnabled, autoCreateEntityRefEnabled,
           highlight_pulseEnabled, highlight_dimmingEnabled, highlight_dimmingMode, highlight_dimOpacity, highlight_spreadHops,
           aiProviderMode, aiCloudProvider, aiCloudModel, aiLocalEndpoint, aiLocalType, aiLocalModel,
           aiCustomBaseUrl, aiCustomType, aiCustomModel, agentBackend,
           customProviders, addCustomProvider, removeCustomProvider, getCustomKeyStoreId,
           visionSubAgentProvider, visionSubAgentModel,
           outlineInlineEdit,
           groupChatMaxAgents, groupChatDefaultStrategy, groupChatGlobalRpm, groupChatGlobalConcurrent,
            reduceMotion, animations, ANIMATION_GROUPS,
            sidebarPosition, detailPanelPosition, phonePreviewMode,
            timelineDragEnabled, timelineDefaultMode, timelineDefaultGroup, timelineCompactMode,
            graphBackgroundMode,
            entityCardHoverPreview, hoverPreviewFrameless,
            videoCoverAutoplay, videoCoverAutoplayEntities, videoCoverHoverPlay, videoCoverPauseOnScroll,
            portraitFollowMouse }
})
