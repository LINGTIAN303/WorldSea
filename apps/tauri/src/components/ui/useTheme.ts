/**
 * useTheme：Tauri 端主题管理（浅色 / 深色，支持跟随系统）
 *
 * 模块级单例。主题模型三态：localStorage 存 'light' | 'dark' | 'system'。
 * - 'system'：跟随系统偏好实时变化（matchMedia 监听，未手动选择时的默认态）
 * - 'light' / 'dark'：用户手动锁定，不再跟随系统
 * 应用时在 <html data-theme="light|dark"> 上设置，theme.css 的
 * `[data-theme="dark"]` 令牌覆盖生效。
 * 详细why请见 docs/details/注释/tauri/components/useTheme.md
 */
import { ref } from 'vue'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'worldsmith:theme'

/** 持久化值：显式选择或跟随系统 */
type ThemePreference = ThemeMode | 'system'

/** 读取已保存的偏好（无则 null） */
function loadPreference(): ThemePreference | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : null
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

const theme = ref<ThemeMode>(loadPreference() === 'system' || !loadPreference() ? detectSystem() : (loadPreference() as ThemeMode))

/** 应用主题到 <html data-theme> */
function apply(t: ThemeMode) {
  theme.value = t
  document.documentElement.dataset.theme = t
}

/** 持久化偏好（显式选择时写 'light'/'dark'；system 模式写 'system'） */
function persist(p: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, p)
  } catch {
    // localStorage 不可用时仅内存生效
  }
}

/** 切换浅色/深色：退出跟随系统，锁定为另一显式值 */
function toggle() {
  const next: ThemeMode = theme.value === 'light' ? 'dark' : 'light'
  persist(next)
  apply(next)
}

/** 跟随系统：清除显式选择，实时响应系统变化 */
function followSystem() {
  persist('system')
  apply(detectSystem())
}

// 模块初始化：监听系统深浅色变化，仅处于 system 偏好时联动（桌面端成熟体验）
let mql: MediaQueryList | null = null
try {
  mql = window.matchMedia('(prefers-color-scheme: dark)')
} catch {
  mql = null
}
if (mql && typeof mql.addEventListener === 'function') {
  mql.addEventListener('change', () => {
    if (loadPreference() === 'system') apply(detectSystem())
  })
}

export function useTheme() {
  return {
    theme,
    toggle,
    apply,
    followSystem,
  }
}
