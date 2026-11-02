/** 工作台背景配置：全局 localStorage + 根属性/变量；不依赖 Tauri。 */
import { ref } from 'vue'

export type BackgroundFit = 'cover' | 'contain' | 'tile'
export type FocusStep = 0 | 50 | 100

export interface WorkspaceBackground {
  version: 1
  enabled: boolean
  path: string
  src: string
  fit: BackgroundFit
  focusX: FocusStep
  focusY: FocusStep
  dim: number
  blur: number
}

export const BACKGROUND_KEY = 'worldsea_workspace_background'
export const BACKGROUND_DEFAULTS: WorkspaceBackground = {
  version: 1, enabled: false, path: '', src: '',
  fit: 'cover', focusX: 50, focusY: 50, dim: 35, blur: 8,
}
export const BACKGROUND_VARS = [
  '--ws-bg-image', '--ws-bg-size', '--ws-bg-repeat',
  '--ws-bg-position', '--ws-bg-dim', '--ws-bg-blur',
] as const

const FOCUS_STEPS: FocusStep[] = [0, 50, 100]
const FIT_VALUES: BackgroundFit[] = ['cover', 'contain', 'tile']

function nearestFocus(value: unknown): FocusStep {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 50
  return FOCUS_STEPS.reduce((best, step) => Math.abs(step - n) < Math.abs(best - n) ? step : best, 50)
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function normalizeBackground(raw: unknown): WorkspaceBackground {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const fit = typeof value.fit === 'string' && FIT_VALUES.includes(value.fit as BackgroundFit)
    ? value.fit as BackgroundFit
    : 'cover'
  return {
    version: 1,
    enabled: value.enabled === true,
    path: typeof value.path === 'string' ? value.path : '',
    src: typeof value.src === 'string' ? value.src : '',
    fit,
    focusX: nearestFocus(value.focusX),
    focusY: nearestFocus(value.focusY),
    dim: clamp(value.dim, 0, 80, 35),
    blur: clamp(value.blur, 0, 30, 8),
  }
}

const state = ref<WorkspaceBackground>({ ...BACKGROUND_DEFAULTS })
const missing = ref(false)
let loaded = false
let persistTimer: ReturnType<typeof setTimeout> | null = null

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function load() {
  if (loaded) return
  loaded = true
  const raw = storage()?.getItem(BACKGROUND_KEY)
  if (!raw) return
  try { state.value = normalizeBackground(JSON.parse(raw)) } catch { state.value = { ...BACKGROUND_DEFAULTS } }
}

function persistNow() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
  try {
    storage()?.setItem(BACKGROUND_KEY, JSON.stringify(state.value))
  } catch (err) {
    // 配额超限/隐私模式禁写：仅告警，内存态与 CSS 变量已生效，不向上抛
    console.warn('[背景] 配置写入 localStorage 失败:', err)
  }
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => { persistTimer = null; persistNow() }, 150)
}

function apply() {
  const root = document.documentElement
  const bg = state.value
  if (!missing.value && bg.src) {
    root.style.setProperty('--ws-bg-image', `url("${bg.src}")`)
    root.style.setProperty('--ws-bg-size', bg.fit === 'cover' ? 'cover' : bg.fit === 'contain' ? 'contain' : 'auto')
    root.style.setProperty('--ws-bg-repeat', bg.fit === 'tile' ? 'repeat' : 'no-repeat')
    root.style.setProperty('--ws-bg-position', `${bg.focusX}% ${bg.focusY}%`)
    root.style.setProperty('--ws-bg-dim', String(bg.dim))
    root.style.setProperty('--ws-bg-blur', `${bg.blur}px`)
  } else {
    for (const name of BACKGROUND_VARS) root.style.removeProperty(name)
  }
  if (!missing.value && bg.enabled && bg.src) root.dataset.workspaceBg = 'on'
  else delete root.dataset.workspaceBg
}

function setEnabled(on: boolean) {
  state.value = { ...state.value, enabled: on }
  apply()
  persistNow()
}
function setImage(image: { path: string; src: string }) {
  const firstImage = !state.value.path
  state.value = {
    ...state.value,
    ...image,
    enabled: firstImage ? true : state.value.enabled,
  }
  missing.value = false
  apply()
  persistNow()
}
function setSrc(src: string) {
  state.value = { ...state.value, src }
  missing.value = false
  apply()
  persistNow()
}
function markMissing() {
  missing.value = true
  apply()
}
function clear() {
  state.value = { ...BACKGROUND_DEFAULTS }
  missing.value = false
  apply()
  persistNow()
}
function setFit(fit: BackgroundFit) {
  if (!FIT_VALUES.includes(fit)) return
  state.value = { ...state.value, fit }
  apply()
  schedulePersist()
}
function setFocus(x: FocusStep, y: FocusStep) {
  state.value = { ...state.value, focusX: nearestFocus(x), focusY: nearestFocus(y) }
  apply()
  schedulePersist()
}
function setDim(value: number) {
  state.value = { ...state.value, dim: clamp(value, 0, 80, 35) }
  apply()
  schedulePersist()
}
function setBlur(value: number) {
  state.value = { ...state.value, blur: clamp(value, 0, 30, 8) }
  apply()
  schedulePersist()
}

export function applyPersistedBackground() {
  load()
  apply()
}

export function useBackground() {
  load()
  return { background: state, missing, setEnabled, setImage, setSrc, markMissing, clear, setFit, setFocus, setDim, setBlur, apply, flush: persistNow }
}
