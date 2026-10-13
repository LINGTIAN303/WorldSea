import { ref, computed } from 'vue'

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
// 强调色：本模块六色预设 ACCENT_PRESETS，深浅各定一个主值；派生令牌（hover/soft/soft-border/grad-to/ring/on-accent）用 color-mix 随主值自动跟随。
// 原六预设主题（aurora-abyss/light/forge-ember/ink-scroll/crystal-prism/cosmic）的 mode+accent 语义由两轴组合承接（旧 id 经 THEME_ID_MIGRATIONS 迁移）。
// 风格包（纹理/图标/动效）已随 theme-kit 退役删除——2026-09-13 取证：--texture-*、data-interaction-mode 等在仓库内零消费点，从未真实生效。
const STORAGE_KEY = 'worldsea-theme'
const CUSTOM_THEMES_KEY = 'worldsea-custom-themes'
const OVERRIDES_KEY = 'worldsea-theme-overrides'

/** 强调色预设：id 同时作为 currentThemeId（面板高亮 / 编辑器导出取名） */
export interface AccentPreset {
  id: string
  label: string
  /** 浅色底主值 */
  light: string
  /** 深色底主值（提亮保证对比） */
  dark: string
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'indigo', label: '靛蓝', light: '#4f46e5', dark: '#8b87f8' },
  { id: 'aurora', label: '极光紫', light: '#8b5cf6', dark: '#a78bfa' },
  { id: 'ember', label: '余烬橙', light: '#c87830', dark: '#e0954e' },
  { id: 'prism', label: '棱镜蓝', light: '#3b82f6', dark: '#64b4ff' },
  { id: 'cosmic', label: '宇宙紫', light: '#a855f7', dark: '#c084fc' },
  { id: 'ink', label: '水墨', light: '#2a2018', dark: '#d6c9b4' },
]

export const DEFAULT_ACCENT_ID = 'indigo'

/** 旧预设主题 id → 强调色 id（localStorage 迁移；含更早的 cyberpunk/parchment） */
const THEME_ID_MIGRATIONS: Record<string, string> = {
  'aurora-abyss': 'aurora',
  'light': 'indigo',
  'forge-ember': 'ember',
  'ink-scroll': 'ink',
  'crystal-prism': 'prism',
  'cosmic': 'cosmic',
  'cyberpunk': 'aurora',
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
  const a = mode === 'light' ? p.light : p.dark
  const decls = [
    `--accent: ${a}`,
    `--accent-soft: color-mix(in srgb, ${a} ${mode === 'light' ? '12' : '18'}%, transparent)`,
    `--accent-soft-border: color-mix(in srgb, ${a} 35%, transparent)`,
    // 渐变末端 = 同色系提亮（rail-logo / 助手头像渐变跟随强调色，不再固定紫系）
    `--accent-grad-to: color-mix(in srgb, ${a} ${mode === 'light' ? '65' : '75'}%, #fff)`,
    `--ring-color: color-mix(in srgb, ${a} ${mode === 'light' ? '35' : '40'}%, transparent)`,
  ]
  if (mode === 'light') {
    // 浅色底：hover 加深；accent 面文字用白
    decls.push(`--accent-hover: color-mix(in srgb, ${a} 85%, #000)`, `--on-accent: #ffffff`)
  } else {
    // 深色底：hover 提亮；accent 已提亮，白字对比不足 → 换深字（对齐 theme.css 基准逻辑）
    decls.push(`--accent-hover: color-mix(in srgb, ${a} 82%, #fff)`, `--on-accent: #17171b`)
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
 * 切换强调色（收束后的「主题」第二轴）：1) 剔除 userOverrides 中的 accent 系内联键（预设语义 = 重置强调色，手动强调色被预设覆盖）；
 * 2) 清内联动态令牌并重放其余覆盖（圆角/密度等用户令牌借此在启动与切换时恢复）；3) 注入/移除深浅双段强调色规则；
 * 4) 记账 currentThemeId + 持久化（幂等，可安全重复调用）。
 */
function setAccent(id: string): void {
  const preset = ACCENT_PRESETS.find(a => a.id === id)
    ?? ACCENT_PRESETS.find(a => a.id === DEFAULT_ACCENT_ID)!
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
    applyAccentStyle(preset.id === DEFAULT_ACCENT_ID ? null : preset)
  }
  currentThemeId.value = preset.id
  ls.setItem(STORAGE_KEY, preset.id)
}

/** 启动恢复：重放用户令牌覆盖 + 注入已持久化的强调色（App.vue onMounted 调用一次；修复重启后观感回退裸基准） */
function restorePersistedTheme(): void {
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
    userOverrides,
    componentOverrides,
    setAccent,
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
