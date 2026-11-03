// 主题持久化层：localStorage 键位、旧 id 迁移、自定义主题/覆盖/我的强调色的读写。
// 与响应式层分离——本文件不依赖 Vue，可被启动页等无响应式入口复用。
// 模型说明见 docs/details/注释/packages/entity-core/useTheme.md
import { DEFAULT_ACCENT_ID } from './accentPresets'

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

export const STORAGE_KEY = 'worldsea-theme'
export const CUSTOM_THEMES_KEY = 'worldsea-custom-themes'
export const OVERRIDES_KEY = 'worldsea-theme-overrides'
/** 自定义强调色：currentThemeId 记 'custom'，量化后的锚点色存此键 */
export const CUSTOM_ACCENT_KEY = 'worldsea-accent-custom'
/** 自定义强调色轴的 id（currentThemeId 等于此值即自定义轴激活） */
export const CUSTOM_ACCENT_ID = 'custom'
/** 我的强调色：用户收藏的自定义锚点列表（量化后 hex），上限 12 个挤掉最早 */
export const SAVED_ACCENTS_KEY = 'worldsea-accent-saved'
export const SAVED_ACCENTS_LIMIT = 12

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
export const hasLocalStorage = typeof localStorage !== 'undefined'
const localStorageShim = {
  getItem: (_k: string) => null,
  setItem: (_k: string, _v: string) => {},
}
export const ls = hasLocalStorage ? localStorage : (localStorageShim as Storage)

export function migrateTheme(id: string): string {
  const migrated = THEME_ID_MIGRATIONS[id]
  if (migrated) {
    ls.setItem(STORAGE_KEY, migrated)
  }
  return migrated || id
}

export function loadCustomThemes(): ThemeDefinition[] {
  try {
    const raw = ls.getItem(CUSTOM_THEMES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveCustomThemes(themes: ThemeDefinition[]) {
  ls.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes))
}

export function loadUserOverrides(): Record<string, string> {
  try {
    const raw = ls.getItem(OVERRIDES_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveUserOverrides(overrides: Record<string, string>) {
  ls.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
}

export function loadComponentOverrides(): Record<string, Record<string, string>> {
  try {
    const raw = ls.getItem('worldsea-component-overrides')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveComponentOverrides(overrides: Record<string, Record<string, string>>) {
  ls.setItem('worldsea-component-overrides', JSON.stringify(overrides))
}

export function loadSavedAccents(): string[] {
  try {
    const raw = ls.getItem(SAVED_ACCENTS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, SAVED_ACCENTS_LIMIT) : []
  } catch {
    return []
  }
}

/** 初始强调色 id（含旧 id 迁移） */
export function initialThemeId(): string {
  return migrateTheme(ls.getItem(STORAGE_KEY) || DEFAULT_ACCENT_ID)
}

/** 初始自定义强调色锚点（无 localStorage 环境下恒为 null） */
export function initialCustomAccent(): string | null {
  return hasLocalStorage ? ls.getItem(CUSTOM_ACCENT_KEY) : null
}
