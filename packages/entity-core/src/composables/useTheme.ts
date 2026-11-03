import { ref, computed } from 'vue'
import { quantizeAnchor } from './accentColor'
import { ACCENT_PRESETS, DEFAULT_ACCENT_ID, accentCssBlock, type AccentPreset } from './accentPresets'
import {
  STORAGE_KEY,
  CUSTOM_ACCENT_KEY,
  SAVED_ACCENTS_KEY,
  CUSTOM_ACCENT_ID,
  SAVED_ACCENTS_LIMIT,
  loadCustomThemes,
  saveCustomThemes,
  loadUserOverrides,
  saveUserOverrides,
  loadComponentOverrides,
  saveComponentOverrides,
  loadSavedAccents,
  migrateTheme,
  initialThemeId,
  initialCustomAccent,
  ls,
  type ThemeDefinition,
} from './theme-storage'

// 预设清单 / 类型 / 注入模板在 accentPresets.ts（纯模块：启动页独立构建入口无响应式层，需与此共用单一真源）；此处转发保持既有导出不变
export { ACCENT_PRESETS, DEFAULT_ACCENT_ID } from './accentPresets'
export type { AccentPreset } from './accentPresets'
// 存储层（键位/迁移/读写）在 theme-storage.ts，此处转发保持既有导出不变
export { CUSTOM_ACCENT_ID }
export { SAVED_ACCENTS_LIMIT }
export type { ThemeDefinition }

// ── 主题模型（2026-09-13 收束）：主题 = 底色 × 强调色 两轴 ──
// 底色（light/dark/system）：App 壳三态唯一控制（apps/tauri/src/components/ui/useTheme.ts → data-theme）。
// 强调色：本模块六色预设 ACCENT_PRESETS——浅色锚点手工定（过 AA 白字线），深色主值 / 渐变末端类比色 / accent 面文字由 OKLCH 算法派生；
// 其余派生令牌（hover/soft/soft-border/ring）用 color-mix 随主值自动跟随。
// 风格包（纹理/图标/动效）已随 theme-kit 退役删除——2026-09-13 取证：--texture-*、data-interaction-mode 等在仓库内零消费点，从未真实生效。

const currentThemeId = ref(initialThemeId())
/** 自定义强调色锚点（已合规化；'custom' 轴激活时的主值来源） */
const customAccentColor = ref<string | null>(initialCustomAccent())
/** 我的强调色：收藏的自定义锚点（量化后 hex） */
const savedAccents = ref<string[]>(loadSavedAccents())
const customThemes = ref<ThemeDefinition[]>(loadCustomThemes())
const userOverrides = ref<Record<string, string>>(loadUserOverrides())
const componentOverrides = ref<Record<string, Record<string, string>>>(loadComponentOverrides())

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
export const ACCENT_INLINE_KEYS = ['--accent', '--accent-hover', '--accent-soft', '--accent-soft-border']

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

/**
 * 把当前令牌覆盖保存为命名主题（引擎已支持 customThemes，此前无编辑器入口）：
 * 剔除强调色管理键（--accent 系由强调色轴统一管理，不随主题保存，避免双入口打架）；
 * 当前无有效覆盖时返回 null。
 */
function saveCurrentOverridesAsTheme(name: string): ThemeDefinition | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const tokens: Record<string, string> = {}
  for (const [k, v] of Object.entries(userOverrides.value)) {
    if ((ACCENT_INLINE_KEYS as readonly string[]).includes(k)) continue
    tokens[k] = v
  }
  if (Object.keys(tokens).length === 0) return null
  const theme: ThemeDefinition = {
    name: trimmed,
    id: `custom-${Date.now()}`,
    author: 'User',
    version: '1.0.0',
    tokens,
  }
  customThemes.value = [...customThemes.value, theme]
  saveCustomThemes(customThemes.value)
  return theme
}

/** 应用命名主题：整组替换当前令牌覆盖（回到该主题保存时的样子） */
function applyNamedTheme(id: string): boolean {
  const theme = customThemes.value.find(t => t.id === id)
  if (!theme?.tokens) return false
  userOverrides.value = { ...theme.tokens }
  saveUserOverrides(userOverrides.value)
  applyTokens(userOverrides.value)
  return true
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
    saveCurrentOverridesAsTheme,
    applyNamedTheme,
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
