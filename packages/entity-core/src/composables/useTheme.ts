import { ref, computed } from 'vue'
import { useThemeManifest } from '@worldsea/theme-kit'

export interface ThemeDefinition {
  name: string
  id: string
  author: string
  version: string
  mode: 'dark' | 'light'
  tokens: Record<string, string>
  darkTokens?: Record<string, string>
  overrides?: Record<string, string>
  customCSS?: string
}

const STORAGE_KEY = 'worldsea-theme'
const CUSTOM_THEMES_KEY = 'worldsea-custom-themes'
const OVERRIDES_KEY = 'worldsea-theme-overrides'

const builtinThemeIds = ['aurora-abyss', 'light', 'forge-ember', 'ink-scroll', 'crystal-prism', 'cosmic']

// SSR/Node 守卫：CLI/测试环境无 localStorage，使用 noop 实现
const hasLocalStorage = typeof localStorage !== 'undefined'
const localStorageShim = {
  getItem: (_k: string) => null,
  setItem: (_k: string, _v: string) => {},
}
const ls = hasLocalStorage ? localStorage : (localStorageShim as Storage)

function migrateTheme(id: string): string {
  const migrations: Record<string, string> = {
    'cyberpunk': 'aurora-abyss',
    'parchment': 'ink-scroll',
  }
  const migrated = migrations[id]
  if (migrated) {
    ls.setItem(STORAGE_KEY, migrated)
  }
  return migrated || id
}

const currentThemeId = ref(migrateTheme(ls.getItem(STORAGE_KEY) || 'aurora-abyss'))
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

export function useTheme() {
  const isDark = computed(() => {
    const darkThemes = ['aurora-abyss', 'cosmic', 'forge-ember', 'crystal-prism']
    return darkThemes.includes(currentThemeId.value)
  })

  const allThemes = computed(() => {
    const builtins = builtinThemeIds.map(id => ({
      id,
      name: getThemeName(id),
      author: 'WorldSea',
      version: '1.0.0',
      mode: (['light', 'ink-scroll'].includes(id) ? 'light' : 'dark') as 'dark' | 'light',
      tokens: {},
    }))
    return [...builtins, ...customThemes.value]
  })

  function getThemeName(id: string): string {
    const names: Record<string, string> = {
      'aurora-abyss': '极光深渊',
      'light': '明亮',
      'cosmic': '宇宙',
      'forge-ember': '锻造炉',
      'ink-scroll': '水墨卷轴',
      'crystal-prism': '晶体棱镜',
    }
    return names[id] || id
  }

  function setTheme(id: string) {
    currentThemeId.value = id
    // 不再写 data-theme：data-theme 由 App 壳三态（components/ui/useTheme setMode）唯一控制，
    // 命名 id（如 'forge-ember'）写入会让 theme.css 只认 light/dark 的覆盖失效而回退到 :root。
    // 本函数只负责令牌/Manifest 风味；明暗由 App 壳在 ws-set-theme 中同步 setMode。
    ls.setItem(STORAGE_KEY, id)
    clearDynamicTokens()
    // fontStore 已下沉到 entity-core/src/stores/fontStore.ts，相对路径保持不变
    import('../stores/fontStore').then(m => m.useFontStore().reapplyAllLayers())
    if (userOverrides.value && Object.keys(userOverrides.value).length > 0) {
      applyTokens(userOverrides.value)
    }
    for (const custom of customThemes.value) {
      if (custom.id === id && custom.tokens) {
        applyTokens(custom.tokens)
        break
      }
    }
    for (const [, tokens] of Object.entries(componentOverrides.value)) {
      applyTokens(tokens)
    }
    // 应用主题 Manifest（纹理/图标/动画/交互模式）
    const { applyManifest } = useThemeManifest()
    applyManifest(id)
  }

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
      setTheme('aurora-abyss')
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
