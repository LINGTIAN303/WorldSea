import { ref, computed } from 'vue'
import { deriveDark, deriveGradTo, pickOnAccent, quantizeAnchor } from './accentColor'

export interface ThemeDefinition {
  name: string
  id: string
  author: string
  version: string
  /** 收束后（2026-09-13）导出自定义主题不再携带 mode（明暗已独立于主题风味） */
  mode?: 'dark' | 'light'
  tokens: Record<string, string>
  darkTokens?: Record<string, string>
  overrides?: Record<string, string>
  customCSS?: string
}

// ── 主题模型（2026-09-13 收束）：主题 = 底色 × 强调色 两轴 ──
// 底色（light/dark/system）：App 壳三态唯一控制（apps/tauri/src/components/ui/useTheme.ts → data-theme）。
// 强调色：本模块六色预设 ACCENT_PRESETS——浅色锚点手工定（过 AA 白字线），深色主值 / 渐变末端类比色 / accent 面文字由 OKLCH 算法派生；
// 其余派生令牌（hover/soft/soft-border/ring）用 color-mix 随主值自动跟随。
// 原六预设主题（aurora-abyss/light/forge-ember/ink-scroll/crystal-prism/cosmic）的 mode+accent 语义由两轴组合承接（旧 id 经 THEME_ID_MIGRATIONS 迁移）。
// 风格包（纹理/图标/动效）已随 theme-kit 退役删除——2026-09-13 取证：--texture-*、data-interaction-mode 等在仓库内零消费点，从未真实生效。
const STORAGE_KEY = 'worldsea-theme'
const CUSTOM_THEMES_KEY = 'worldsea-custom-themes'
const OVERRIDES_KEY = 'worldsea-theme-overrides'
/** 自定义强调色：currentThemeId 记 'custom'，量化后的锚点色存此键 */
const CUSTOM_ACCENT_KEY = 'worldsea-accent-custom'
export const CUSTOM_ACCENT_ID = 'custom'
/** 我的强调色：用户收藏的自定义锚点列表（量化后 hex），上限 12 个挤掉最早 */
const SAVED_ACCENTS_KEY = 'worldsea-accent-saved'
export const SAVED_ACCENTS_LIMIT = 12

/** 强调色预设：id 同时作为 currentThemeId（面板高亮 / 编辑器导出取名） */
export interface AccentPreset {
  id: string
  label: string
  /** 浅色主值 = 色相锚点（须与 #ffffff 对比 ≥ 4.5:1，保证 accent 面白字达标） */
  light: string
  /** 深色主值：缺省由 OKLCH 算法派生（提亮 + 降饱和）；水墨等特殊中性色可手工指定 */
  dark?: string
  /** 渐变末端手工覆盖（仅水墨这类近黑锚点需要——色相旋转公式对近黑色无意义） */
  gradTo?: { light: string; dark: string }
}

// 2026-10-24 重排：按 OKLCH 色相均匀取锚（靛蓝 277 / 棱镜蓝 262 / 青瓷 210 / 苔绿 150 / 余烬橙 45 / 水墨中性），
// 旧「三紫扎堆」退场；全部浅色锚点过 AA 白字线（≥4.5:1）。深色值除基准靛蓝与水墨外一律算法派生。
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'indigo', label: '靛蓝', light: '#4f46e5', dark: '#8b87f8' },
  { id: 'prism', label: '棱镜蓝', light: '#2563eb' },
  { id: 'cyan', label: '青瓷', light: '#0e7490' },
  { id: 'moss', label: '苔绿', light: '#15803d' },
  { id: 'ember', label: '余烬橙', light: '#c2410c' },
  { id: 'ink', label: '水墨', light: '#2a2018', dark: '#d6c9b4', gradTo: { light: '#847c72', dark: '#efe9dd' } },
]

export const DEFAULT_ACCENT_ID = 'indigo'

/** 旧预设主题 id → 强调色 id（localStorage 迁移；含更早的 cyberpunk/parchment；极光紫/宇宙紫随 2026-10-24 色板重排并入靛蓝） */
const THEME_ID_MIGRATIONS: Record<string, string> = {
  'aurora-abyss': 'indigo',
  'aurora': 'indigo',
  'cosmic': 'indigo',
  'light': 'indigo',
  'forge-ember': 'ember',
  'ink-scroll': 'ink',
  'crystal-prism': 'prism',
  'cyberpunk': 'indigo',
  'parchment': 'ink',
}

// SSR/Node 守卫：CLI/测试环境无 localStorage，使用 noop 实现
const hasLocalStorage = typeof localStorage !== 'undefined'
const localStorageShim = {
  getItem: (_k: string) => null,
  setItem: (_k: string, _v: string) => {},
}
const ls = hasLocalStorage ? localStorage : (localStorageShim as Storage)

function migrateTheme(id: string): string {
  const migrated = THEME_ID_MIGRATIONS[id]
  if (migrated) {
    ls.setItem(STORAGE_KEY, migrated)
  }
  return migrated || id
}

const currentThemeId = ref(migrateTheme(ls.getItem(STORAGE_KEY) || DEFAULT_ACCENT_ID))
/** 自定义强调色锚点（已合规化；'custom' 轴激活时的主值来源） */
const customAccentColor = ref<string | null>(hasLocalStorage ? ls.getItem(CUSTOM_ACCENT_KEY) : null)
/** 我的强调色：收藏的自定义锚点（量化后 hex） */
const savedAccents = ref<string[]>(loadSavedAccents())
const customThemes = ref<ThemeDefinition[]>(loadCustomThemes())
const userOverrides = ref<Record<string, string>>(loadUserOverrides())
const componentOverrides = ref<Record<string, Record<string, string>>>(loadComponentOverrides())

function loadCustomThemes(): ThemeDefinition[] {
  try {
    const raw = ls.getItem(CUSTOM_THEMES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveCustomThemes(themes: ThemeDefinition[]) {
  ls.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes))
}

function loadUserOverrides(): Record<string, string> {
  try {
    const raw = ls.getItem(OVERRIDES_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveUserOverrides(overrides: Record<string, string>) {
  ls.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
}

function loadComponentOverrides(): Record<string, Record<string, string>> {
  try {
    const raw = ls.getItem('worldsea-component-overrides')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function loadSavedAccents(): string[] {
  try {
    const raw = ls.getItem(SAVED_ACCENTS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, SAVED_ACCENTS_LIMIT) : []
  } catch {
    return []
  }
}

function saveComponentOverrides(overrides: Record<string, Record<string, string>>) {
  ls.setItem('worldsea-component-overrides', JSON.stringify(overrides))
}

function applyTokens(tokens: Record<string, string>) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(tokens)) {
    const cssVar = key.startsWith('--') ? key : `--${key}`
    root.style.setProperty(cssVar, value)
  }
}

function clearDynamicTokens() {
  const root = document.documentElement
  for (let i = root.style.length - 1; i >= 0; i--) {
    const prop = root.style[i]
    if (prop) {
      root.style.removeProperty(prop)
    }
  }
}

// ── 强调色注入引擎 ──
// 规则注入 <style id="ws-accent-override">：:root 浅色段 + [data-theme='dark'] 深色段。
// 不走内联样式的原因：内联无法按 data-theme 分支出深浅两套值；
// 默认「靛蓝」不注入任何规则（theme.css 基准即靛蓝，避免重复定义）。
const ACCENT_STYLE_ID = 'ws-accent-override'
/** 强调色预设语义 = 重置强调色：这些键不再走 userOverrides 内联覆盖 */
const ACCENT_INLINE_KEYS = ['--accent', '--accent-hover', '--accent-soft', '--accent-soft-border']

function accentCssBlock(p: AccentPreset, mode: 'light' | 'dark'): string {
  const a = mode === 'light' ? p.light : (p.dark ?? deriveDark(p.light))
  // 渐变末端 = 类比色（色相 +25°）；水墨等近黑锚点走手工覆盖。默认靛蓝不注入（theme.css 基准 #7c3aed 与本式同源）
  const gradTo = mode === 'light' ? (p.gradTo?.light ?? deriveGradTo(a)) : (p.gradTo?.dark ?? deriveGradTo(a))
  const decls = [
    `--accent: ${a}`,
    `--accent-soft: color-mix(in srgb, ${a} ${mode === 'light' ? '12' : '18'}%, transparent)`,
    `--accent-soft-border: color-mix(in srgb, ${a} 35%, transparent)`,
    `--accent-grad-to: ${gradTo}`,
    `--ring-color: color-mix(in srgb, ${a} ${mode === 'light' ? '35' : '40'}%, transparent)`,
    // accent 面文字：锚点已保证浅色白字 ≥4.5:1，此处按实测对比择向（深色提亮主值自动落墨字侧）
    `--on-accent: ${pickOnAccent(a)}`,
  ]
  if (mode === 'light') {
    // 浅色底：hover 加深
    decls.push(`--accent-hover: color-mix(in srgb, ${a} 85%, #000)`)
  } else {
    // 深色底：hover 提亮
    decls.push(`--accent-hover: color-mix(in srgb, ${a} 82%, #fff)`)
  }
  return decls.join('; ')
}

function applyAccentStyle(p: AccentPreset | null): void {
  if (typeof document === 'undefined') return
  let el = document.getElementById(ACCENT_STYLE_ID) as HTMLStyleElement | null
  if (!p) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('style')
    el.id = ACCENT_STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = `:root { ${accentCssBlock(p, 'light')}; }\n[data-theme='dark'] { ${accentCssBlock(p, 'dark')}; }`
}

/**
 * 强调色应用管线（预设与自定义共用）：1) 剔除 userOverrides 中的 accent 系内联键（切预设语义 = 重置强调色）；
 * 2) 清内联动态令牌并重放其余覆盖（圆角/密度等用户令牌借此在启动与切换时恢复）；3) 注入/移除深浅双段强调色规则；
 * 4) 记账 currentThemeId + 持久化（幂等，可安全重复调用）。
 */
function applyAccentPipeline(preset: AccentPreset, id: string): void {
  const cleaned = { ...userOverrides.value }
  let dirty = false
  for (const k of ACCENT_INLINE_KEYS) {
    if (k in cleaned) {
      delete cleaned[k]
      dirty = true
    }
  }
  if (dirty) {
    userOverrides.value = cleaned
    saveUserOverrides(cleaned)
  }
  if (typeof document !== 'undefined') {
    clearDynamicTokens()
    if (Object.keys(userOverrides.value).length > 0) applyTokens(userOverrides.value)
    for (const custom of customThemes.value) {
      if (custom.id === preset.id && custom.tokens) applyTokens(custom.tokens)
    }
    for (const [, tokens] of Object.entries(componentOverrides.value)) {
      applyTokens(tokens)
    }
    applyAccentStyle(id === DEFAULT_ACCENT_ID ? null : preset)
  }
  currentThemeId.value = id
  ls.setItem(STORAGE_KEY, id)
}

function setAccent(id: string): void {
  const preset = ACCENT_PRESETS.find(a => a.id === id)
    ?? ACCENT_PRESETS.find(a => a.id === DEFAULT_ACCENT_ID)!
  applyAccentPipeline(preset, preset.id)
}

/** 自定义强调色：取色器任意色 → 锚点合规化（白字 AA 亮度带）→ 走同一管线；深色/渐变/文字色由 OKLCH 派生 */
function setCustomAccent(hex: string): void {
  const light = quantizeAnchor(hex)
  customAccentColor.value = light
  ls.setItem(CUSTOM_ACCENT_KEY, light)
  applyAccentPipeline({ id: CUSTOM_ACCENT_ID, label: '自定义', light }, CUSTOM_ACCENT_ID)
}

/** 保存当前自定义强调色到「我的强调色」：去重、超上限挤掉最早。返回是否新增（false = 已在收藏） */
function saveCurrentAccent(): boolean {
  if (!customAccentColor.value) return false
  const hex = customAccentColor.value
  if (savedAccents.value.includes(hex)) return false
  savedAccents.value = [...savedAccents.value, hex].slice(-SAVED_ACCENTS_LIMIT)
  ls.setItem(SAVED_ACCENTS_KEY, JSON.stringify(savedAccents.value))
  return true
}

/** 删除收藏项：仅移除收藏记录，当前激活色不受影响 */
function removeSavedAccent(hex: string): void {
  savedAccents.value = savedAccents.value.filter(x => x !== hex)
  ls.setItem(SAVED_ACCENTS_KEY, JSON.stringify(savedAccents.value))
}

/** 启动恢复：自定义强调色优先回放，其余重放已持久化的预设（App.vue onMounted 调用一次；修复重启后观感回退裸基准） */
function restorePersistedTheme(): void {
  if (currentThemeId.value === CUSTOM_ACCENT_ID && customAccentColor.value) {
    applyAccentPipeline({ id: CUSTOM_ACCENT_ID, label: '自定义', light: customAccentColor.value }, CUSTOM_ACCENT_ID)
    return
  }
  setAccent(currentThemeId.value)
}

/**
 * @deprecated 旧「预设主题」切换入口（2026-09-13 收束为底色 × 强调色两轴）。
 * 等价于 setAccent（旧主题 id 经 THEME_ID_MIGRATIONS 自动迁移），仅为 settingsStore 转发等历史调用方保留。
 */
function setTheme(id: string): void {
  setAccent(migrateTheme(id))
}

export function useTheme() {
  /**
   * @deprecated 旧预设主题派生的明暗判断（2026-09-13 收束后主题不再携带 mode）。
   * 明暗唯一权威 = App 壳 data-theme；本值非响应式（无 CSS 变量以外依赖），仅保留导出兼容，勿新增消费。
   */
  const isDark = computed(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.dataset.theme === 'dark'
  })

  const allThemes = computed(() => {
    const builtins = ACCENT_PRESETS.map(a => ({
      id: a.id,
      name: a.label,
      author: 'WorldSea',
      version: '1.0.0',
      tokens: {},
    }))
    return [...builtins, ...customThemes.value]
  })

  function setUserOverrides(overrides: Record<string, string>) {
    userOverrides.value = overrides
    saveUserOverrides(overrides)
    applyTokens(overrides)
  }

  function setComponentOverride(componentName: string, tokens: Record<string, string>) {
    componentOverrides.value = { ...componentOverrides.value, [componentName]: tokens }
    saveComponentOverrides(componentOverrides.value)
    applyTokens(tokens)
  }

  function removeComponentOverride(componentName: string) {
    const next = { ...componentOverrides.value }
    const oldTokens = next[componentName]
    delete next[componentName]
    componentOverrides.value = next
    saveComponentOverrides(next)
    if (oldTokens) {
      const root = document.documentElement
      for (const key of Object.keys(oldTokens)) {
        const cssVar = key.startsWith('--') ? key : `--${key}`
        root.style.removeProperty(cssVar)
      }
    }
  }

  function getComponentOverride(componentName: string): Record<string, string> {
    return componentOverrides.value[componentName] ?? {}
  }

  function addCustomTheme(theme: ThemeDefinition) {
    const idx = customThemes.value.findIndex(t => t.id === theme.id)
    if (idx >= 0) {
      customThemes.value[idx] = theme
    } else {
      customThemes.value.push(theme)
    }
    saveCustomThemes(customThemes.value)
  }

  function removeCustomTheme(id: string) {
    customThemes.value = customThemes.value.filter(t => t.id !== id)
    saveCustomThemes(customThemes.value)
    if (currentThemeId.value === id) {
      setAccent(DEFAULT_ACCENT_ID)
    }
  }

  function exportTheme(theme: ThemeDefinition): string {
    return JSON.stringify(theme, null, 2)
  }

  function importTheme(json: string): ThemeDefinition | null {
    try {
      const theme = JSON.parse(json) as ThemeDefinition
      if (!theme.id || !theme.name || !theme.tokens) return null
      addCustomTheme(theme)
      return theme
    } catch {
      return null
    }
  }

  function buildNaiveThemeOverrides() {
    const style = getComputedStyle(document.documentElement)
    return {
      common: {
        primaryColor: style.getPropertyValue('--color-primary').trim(),
        primaryColorHover: style.getPropertyValue('--color-primary-hover').trim(),
        primaryColorPressed: style.getPropertyValue('--color-primary-active').trim(),
        textColor1: style.getPropertyValue('--color-text-primary').trim(),
        textColor2: style.getPropertyValue('--color-text-secondary').trim(),
        textColor3: style.getPropertyValue('--color-text-tertiary').trim(),
        borderColor: style.getPropertyValue('--color-border').trim(),
        inputColor: style.getPropertyValue('--input-bg').trim(),
        cardColor: style.getPropertyValue('--card-bg').trim(),
        modalColor: style.getPropertyValue('--modal-bg').trim(),
        popoverColor: style.getPropertyValue('--dropdown-bg').trim(),
        tableColor: style.getPropertyValue('--card-bg').trim(),
        bodyColor: style.getPropertyValue('--color-bg-base').trim(),
        successColor: style.getPropertyValue('--color-success').trim(),
        warningColor: style.getPropertyValue('--color-warning').trim(),
        errorColor: style.getPropertyValue('--color-danger').trim(),
        infoColor: style.getPropertyValue('--color-info').trim(),
        borderRadius: style.getPropertyValue('--radius-btn').trim(),
        borderRadiusSmall: style.getPropertyValue('--radius-sm').trim(),
        fontFamily: style.getPropertyValue('--font-family-base').trim(),
      },
    }
  }

  return {
    currentThemeId,
    isDark,
    allThemes,
    customThemes,
    customAccentColor,
    savedAccents,
    userOverrides,
    componentOverrides,
    setAccent,
    setCustomAccent,
    saveCurrentAccent,
    removeSavedAccent,
    restorePersistedTheme,
    setTheme,
    setUserOverrides,
    setComponentOverride,
    removeComponentOverride,
    getComponentOverride,
    addCustomTheme,
    removeCustomTheme,
    exportTheme,
    importTheme,
    buildNaiveThemeOverrides,
  }
}
