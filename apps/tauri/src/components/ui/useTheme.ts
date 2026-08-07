/**
 * useTheme：Tauri 端主题管理（浅色 / 深色）
 *
 * 模块级单例。初始值优先取 localStorage 持久化选择，否则跟随系统偏好；
 * 应用时在 <html data-theme="light|dark"> 上设置，theme.css 的
 * `[data-theme="dark"]` 令牌覆盖生效。手动切换后持久化。
 * 详细why请见 docs/details/注释/tauri/components/useTheme.md
 */
import { ref } from 'vue'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'worldsmith:theme'

/** 读取已保存的主题（无则返回 null） */
function loadSaved(): ThemeMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

/** 检测系统偏好（默认浅色） */
function detectSystem(): ThemeMode {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const theme = ref<ThemeMode>(loadSaved() ?? detectSystem())

/** 应用主题到 <html data-theme> 并持久化 */
function apply(t: ThemeMode) {
  theme.value = t
  document.documentElement.dataset.theme = t
  try {
    localStorage.setItem(STORAGE_KEY, t)
  } catch {
    // localStorage 不可用时仅内存生效
  }
}

/** 切换浅色/深色 */
function toggle() {
  apply(theme.value === 'light' ? 'dark' : 'light')
}

export function useTheme() {
  return {
    theme,
    toggle,
    apply,
  }
}
