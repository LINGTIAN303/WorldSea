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
import { listen } from '@tauri-apps/api/event'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'worldsea:theme'

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
/** 当前偏好（三态）：'light' | 'dark' | 'system'（未设置视为 system，批次99 修复"跟随系统不可达"） */
const preference = ref<ThemePreference>(loadPreference() ?? 'system')

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

/** 应用偏好：更新 preference + 持久化 + 应用实际主题（system 时按系统检测） */
function applyPreference(p: ThemePreference) {
  preference.value = p
  persist(p)
  apply(p === 'system' ? detectSystem() : p)
  // E2（2026-09-24）：新壳里主题真源在**壳侧**（`<app_data>/worldsea/prefs.json`）——变更通知壳，
  // 由壳同步 dsh 并广播两窗；无桥时（浏览器预览 / 旧壳）静默跳过，行为与此前一致
  const notifyShell = (globalThis as { __WORLDSEA_SET_THEME__?: (v: string) => Promise<unknown> })
    .__WORLDSEA_SET_THEME__
  if (typeof notifyShell === 'function') {
    void notifyShell(p).catch(e => console.error('[useTheme] 同步壳主题失败:', e))
  }
  // 广播三态变化（设置面板底色段高亮同步）：同页面无 storage 事件，只能手动派发
  try {
    window.dispatchEvent(new CustomEvent('ws-theme-mode-changed', { detail: { preference: p, applied: theme.value } }))
  } catch {
    // 非浏览器环境忽略
  }
}

/** 主题按钮三态循环：浅色 → 深色 → 跟随系统 → 浅色（批次99，使 system 态可达） */
function toggle() {
  const order: ThemePreference[] = ['light', 'dark', 'system']
  const idx = order.indexOf(preference.value)
  applyPreference(order[(idx + 1) % order.length])
}

/**
 * 强制设定模式（供主题编辑器等外部模块调用，接入同一三态模型）：
 * 持久化该模式并应用；传入 'system' 则恢复跟随系统。
 * 保证 data-theme 始终由本模块（App 壳三态）唯一控制，避免多主题源互相踩踏。
 */
function setMode(mode: ThemeMode) {
  applyPreference(mode)
}

/** 跟随系统：清除显式选择，实时响应系统变化 */
function followSystem() {
  applyPreference('system')
}

// 模块初始化：监听系统深浅色变化，处于 system 偏好（含未设置）时联动（桌面端成熟体验）
let mql: MediaQueryList | null = null
try {
  mql = window.matchMedia('(prefers-color-scheme: dark)')
} catch {
  mql = null
}
function onSystemThemeChange() {
  const p = loadPreference()
  if (p === 'system' || p === null) {
    apply(detectSystem())
    preference.value = 'system'
  }
}
if (mql && typeof mql.addEventListener === 'function') {
  mql.addEventListener('change', onSystemThemeChange)
}
// E2：壳广播（壳侧或另一窗改了主题）→ 以真源重应用；与本地同值时 no-op（防「产品→壳→产品」回环）
try {
  void listen<{ theme?: string }>('worldsea:theme-changed', event => {
    const next = event.payload?.theme
    if ((next === 'light' || next === 'dark' || next === 'system') && next !== loadPreference()) {
      applyPreference(next)
    }
  }).catch(() => {
    /* 事件面不可用（非 Tauri 环境）时忽略 */
  })
} catch {
  /* listen 同步抛（无 __TAURI_INTERNALS__）时忽略 */
}
// Vite HMR：模块热更新时移除旧监听，避免监听器叠加（批次100 P3；生产无热更新，无害）
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mql?.removeEventListener('change', onSystemThemeChange)
  })
}

export function useTheme() {
  return {
    theme,
    preference,
    toggle,
    apply,
    setMode,
    followSystem,
  }
}
