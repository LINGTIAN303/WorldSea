/** 背景状态单例：五目标配置、全局+项目覆盖合并、根变量；v1 画布 API 暂留兼容。 */
import { computed, ref } from 'vue'

export type BackgroundTarget = 'canvas' | 'home' | 'titlebar' | 'sidebar' | 'content'
export type BackgroundTheme = 'light' | 'dark'
export type BackgroundScope = 'global' | 'project'
export type BackgroundFit = 'cover' | 'contain' | 'tile'
export type FocusStep = 0 | 50 | 100

export interface BackgroundImageRef {
  path: string
  src: string
}

export interface BackgroundTargetConfig {
  enabled: boolean
  paths: { light: string; dark: string }
  fit: BackgroundFit
  focusX: FocusStep
  focusY: FocusStep
  dim: number
  blur: number
}

export interface BackgroundGlobalConfig {
  version: 2
  targets: Record<BackgroundTarget, BackgroundTargetConfig>
}

export interface BackgroundProjectConfig {
  version: 1
  targets: Partial<Record<BackgroundTarget, BackgroundTargetConfig>>
}

/** v1 兼容形状：旧卡与启动引导仍按此读取画布目标 */
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

export const BACKGROUND_KEY = 'worldsea_background_v2'
export const BACKGROUND_V1_KEY = 'worldsea_workspace_background'
export const BACKGROUND_TARGETS: readonly BackgroundTarget[] = ['canvas', 'home', 'titlebar', 'sidebar', 'content']
export const BACKGROUND_THEMES: readonly BackgroundTheme[] = ['light', 'dark']
export const BACKGROUND_TARGET_CAPS: Record<BackgroundTarget, { fit: boolean; focus: boolean }> = {
  canvas: { fit: true, focus: true },
  home: { fit: true, focus: true },
  titlebar: { fit: false, focus: false },
  sidebar: { fit: false, focus: false },
  content: { fit: false, focus: false },
}
export const BACKGROUND_VARS = [
  '--ws-bg-image', '--ws-bg-size', '--ws-bg-repeat',
  '--ws-bg-position', '--ws-bg-dim', '--ws-bg-blur',
] as const

const FOCUS_STEPS: FocusStep[] = [0, 50, 100]
const FIT_VALUES: BackgroundFit[] = ['cover', 'contain', 'tile']
const TARGET_VAR_SUFFIXES = ['image-light', 'image-dark', 'size', 'repeat', 'position', 'dim', 'blur'] as const

type ThemeSrcs = { light: string; dark: string }
type SrcMap = Record<BackgroundTarget, ThemeSrcs>
type MissingMap = Record<BackgroundTarget, Record<BackgroundTheme, boolean>>

function defaultTarget(): BackgroundTargetConfig {
  return { enabled: false, paths: { light: '', dark: '' }, fit: 'cover', focusX: 50, focusY: 50, dim: 35, blur: 8 }
}

function emptyTargets(): Record<BackgroundTarget, BackgroundTargetConfig> {
  const out = {} as Record<BackgroundTarget, BackgroundTargetConfig>
  for (const target of BACKGROUND_TARGETS) out[target] = defaultTarget()
  return out
}

function emptySrcs(): SrcMap {
  const out = {} as SrcMap
  for (const target of BACKGROUND_TARGETS) out[target] = { light: '', dark: '' }
  return out
}

function emptyMissing(): MissingMap {
  const out = {} as MissingMap
  for (const target of BACKGROUND_TARGETS) out[target] = { light: false, dark: false }
  return out
}

export const BACKGROUND_DEFAULTS: BackgroundGlobalConfig = { version: 2, targets: emptyTargets() }

function cloneDefaults(): BackgroundGlobalConfig {
  return { version: 2, targets: emptyTargets() }
}

function nearestFocus(value: unknown): FocusStep {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 50
  return FOCUS_STEPS.reduce((best, step) => Math.abs(step - n) < Math.abs(best - n) ? step : best, 50)
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 单目标归一化：分区目标强制 cover/居中；paths 只接受字符串 light/dark */
export function normalizeTargetConfig(raw: unknown, target: BackgroundTarget): BackgroundTargetConfig {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const paths = value.paths && typeof value.paths === 'object' ? value.paths as Record<string, unknown> : {}
  const caps = BACKGROUND_TARGET_CAPS[target]
  const fit = typeof value.fit === 'string' && FIT_VALUES.includes(value.fit as BackgroundFit)
    ? value.fit as BackgroundFit
    : 'cover'
  return {
    enabled: value.enabled === true,
    paths: {
      light: typeof paths.light === 'string' ? paths.light : '',
      dark: typeof paths.dark === 'string' ? paths.dark : '',
    },
    fit: caps.fit ? fit : 'cover',
    focusX: caps.focus ? nearestFocus(value.focusX) : 50,
    focusY: caps.focus ? nearestFocus(value.focusY) : 50,
    dim: clamp(value.dim, 0, 80, 35),
    blur: clamp(value.blur, 0, 30, 8),
  }
}

/** 全局配置归一化：五个目标逐个归一化，缺失目标用默认值 */
export function normalizeGlobalConfig(raw: unknown): BackgroundGlobalConfig {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const targetsRaw = value.targets && typeof value.targets === 'object' ? value.targets as Record<string, unknown> : {}
  const targets = {} as Record<BackgroundTarget, BackgroundTargetConfig>
  for (const target of BACKGROUND_TARGETS) targets[target] = normalizeTargetConfig(targetsRaw[target], target)
  return { version: 2, targets }
}

/** 项目配置归一化：只保留已知目标；无有效目标返回 null */
export function normalizeProjectConfig(raw: unknown): BackgroundProjectConfig | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (!value.targets || typeof value.targets !== 'object') return null
  const targetsRaw = value.targets as Record<string, unknown>
  const targets: Partial<Record<BackgroundTarget, BackgroundTargetConfig>> = {}
  let count = 0
  for (const target of BACKGROUND_TARGETS) {
    const entry = targetsRaw[target]
    if (!entry || typeof entry !== 'object') continue
    targets[target] = normalizeTargetConfig(entry, target)
    count++
  }
  return count ? { version: 1, targets } : null
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** v1 迁移：path → canvas.paths.light，src 丢弃；非法 JSON 返回 null */
export function migrateV1Config(): BackgroundGlobalConfig | null {
  const raw = storage()?.getItem(BACKGROUND_V1_KEY)
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  const value = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const config = cloneDefaults()
  config.targets.canvas = normalizeTargetConfig({
    enabled: value.enabled,
    paths: { light: value.path, dark: '' },
    fit: value.fit,
    focusX: value.focusX,
    focusY: value.focusY,
    dim: value.dim,
    blur: value.blur,
  }, 'canvas')
  return config
}

/** v1 兼容：旧归一化入口，接受平铺字段并还原旧形状 */
export function normalizeBackground(raw: unknown): WorkspaceBackground {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const canvas = normalizeTargetConfig({
    enabled: value.enabled,
    paths: { light: value.path, dark: '' },
    fit: value.fit,
    focusX: value.focusX,
    focusY: value.focusY,
    dim: value.dim,
    blur: value.blur,
  }, 'canvas')
  return {
    version: 1,
    enabled: canvas.enabled,
    path: canvas.paths.light,
    src: typeof value.src === 'string' ? value.src : '',
    fit: canvas.fit,
    focusX: canvas.focusX,
    focusY: canvas.focusY,
    dim: canvas.dim,
    blur: canvas.blur,
  }
}

const globalConfig = ref<BackgroundGlobalConfig>(cloneDefaults())
const projectConfig = ref<BackgroundProjectConfig | null>(null)
const globalSrcs = ref<SrcMap>(emptySrcs())
const projectSrcs = ref<SrcMap>(emptySrcs())
const globalMissing = ref<MissingMap>(emptyMissing())
const projectMissing = ref<MissingMap>(emptyMissing())
const missing = computed<MissingMap>(() => {
  const out = emptyMissing()
  for (const target of BACKGROUND_TARGETS) {
    out[target] = projectConfig.value?.targets[target] ? projectMissing.value[target] : globalMissing.value[target]
  }
  return out
})
let loaded = false
let persistTimer: ReturnType<typeof setTimeout> | null = null

const effective = computed(() => {
  const out = {} as Record<BackgroundTarget, BackgroundTargetConfig>
  for (const target of BACKGROUND_TARGETS) {
    out[target] = projectConfig.value?.targets[target] ?? globalConfig.value.targets[target]
  }
  return out
})

const srcs = computed(() => {
  const out = {} as Record<BackgroundTarget, ThemeSrcs>
  for (const target of BACKGROUND_TARGETS) {
    out[target] = projectConfig.value?.targets[target] ? projectSrcs.value[target] : globalSrcs.value[target]
  }
  return out
})

function load() {
  if (loaded) return
  loaded = true
  const raw = storage()?.getItem(BACKGROUND_KEY)
  if (raw) {
    try { globalConfig.value = normalizeGlobalConfig(JSON.parse(raw)) } catch { globalConfig.value = cloneDefaults() }
    return
  }
  const migrated = migrateV1Config()
  if (!migrated) return
  globalConfig.value = migrated
  persistNow()
}

function persistNow() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
  try {
    storage()?.setItem(BACKGROUND_KEY, JSON.stringify(globalConfig.value))
  } catch (err) {
    // 配额超限/隐私模式禁写：仅告警，内存态与 CSS 变量已生效，不向上抛
    console.warn('[背景] 配置写入 localStorage 失败:', err)
  }
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => { persistTimer = null; persistNow() }, 150)
}

function sizeValue(fit: BackgroundFit): string {
  return fit === 'cover' ? 'cover' : fit === 'contain' ? 'contain' : 'auto'
}

function datasetKey(target: BackgroundTarget): string {
  return `wsBg${target[0].toUpperCase()}${target.slice(1)}`
}

function applyLegacy(root: HTMLElement) {
  const cfg = globalConfig.value.targets.canvas
  const s = globalSrcs.value.canvas
  const light = s.light || s.dark
  const bothMissing = globalMissing.value.canvas.light && globalMissing.value.canvas.dark
  if (light && !bothMissing) {
    root.style.setProperty('--ws-bg-image', `url("${light}")`)
    root.style.setProperty('--ws-bg-size', sizeValue(cfg.fit))
    root.style.setProperty('--ws-bg-repeat', cfg.fit === 'tile' ? 'repeat' : 'no-repeat')
    root.style.setProperty('--ws-bg-position', `${cfg.focusX}% ${cfg.focusY}%`)
    root.style.setProperty('--ws-bg-dim', String(cfg.dim))
    root.style.setProperty('--ws-bg-blur', `${cfg.blur}px`)
  } else {
    for (const name of BACKGROUND_VARS) root.style.removeProperty(name)
  }
  if (cfg.enabled && light && !bothMissing) root.dataset.workspaceBg = 'on'
  else delete root.dataset.workspaceBg
}

function apply() {
  const root = document.documentElement
  for (const target of BACKGROUND_TARGETS) {
    const cfg = effective.value[target]
    const s = srcs.value[target]
    const light = s.light || s.dark
    const dark = s.dark || s.light
    if (light || dark) {
      root.style.setProperty(`--ws-bg-${target}-image-light`, `url("${light}")`)
      root.style.setProperty(`--ws-bg-${target}-image-dark`, `url("${dark}")`)
      root.style.setProperty(`--ws-bg-${target}-size`, sizeValue(cfg.fit))
      root.style.setProperty(`--ws-bg-${target}-repeat`, cfg.fit === 'tile' ? 'repeat' : 'no-repeat')
      root.style.setProperty(`--ws-bg-${target}-position`, `${cfg.focusX}% ${cfg.focusY}%`)
      root.style.setProperty(`--ws-bg-${target}-dim`, String(cfg.dim))
      root.style.setProperty(`--ws-bg-${target}-blur`, `${cfg.blur}px`)
    } else {
      for (const suffix of TARGET_VAR_SUFFIXES) root.style.removeProperty(`--ws-bg-${target}-${suffix}`)
    }
    if (cfg.enabled && (light || dark)) root.dataset[datasetKey(target)] = 'on'
    else delete root.dataset[datasetKey(target)]
  }
  applyLegacy(root)
}

function targetConfigAt(scope: BackgroundScope, target: BackgroundTarget): BackgroundTargetConfig {
  return scope === 'project'
    ? projectConfig.value?.targets[target] ?? globalConfig.value.targets[target]
    : globalConfig.value.targets[target]
}

function writeTargetConfig(scope: BackgroundScope, target: BackgroundTarget, next: BackgroundTargetConfig) {
  if (scope === 'project') {
    const targets = { ...projectConfig.value?.targets }
    targets[target] = next
    projectConfig.value = { version: 1, targets }
    return
  }
  const targets = { ...globalConfig.value.targets }
  targets[target] = next
  globalConfig.value = { ...globalConfig.value, targets }
}

function writeSrc(scope: BackgroundScope, target: BackgroundTarget, theme: BackgroundTheme, src: string) {
  const bucket = scope === 'project' ? projectSrcs : globalSrcs
  const targetSrcs = { ...bucket.value[target], [theme]: src }
  bucket.value = { ...bucket.value, [target]: targetSrcs }
}

function setMissing(scope: BackgroundScope, target: BackgroundTarget, theme: BackgroundTheme, value: boolean) {
  const bucket = scope === 'project' ? projectMissing : globalMissing
  bucket.value = { ...bucket.value, [target]: { ...bucket.value[target], [theme]: value } }
}

function setProjectConfig(config: BackgroundProjectConfig | null) {
  projectConfig.value = config
  projectSrcs.value = emptySrcs()
  projectMissing.value = emptyMissing()
  apply()
}

function setTargetSrcs(target: BackgroundTarget, next: { light?: string; dark?: string }, scope: BackgroundScope) {
  const bucket = scope === 'project' ? projectSrcs : globalSrcs
  bucket.value = { ...bucket.value, [target]: { light: next.light ?? '', dark: next.dark ?? '' } }
  for (const theme of BACKGROUND_THEMES) {
    if (bucket.value[target][theme]) setMissing(scope, target, theme, false)
  }
  apply()
}

function setTargetSrc(target: BackgroundTarget, theme: BackgroundTheme, src: string, scope: BackgroundScope) {
  writeSrc(scope, target, theme, src)
  if (src) setMissing(scope, target, theme, false)
  apply()
}

function updateTarget(target: BackgroundTarget, patch: Partial<BackgroundTargetConfig>, scope: BackgroundScope) {
  if (scope === 'project' && !projectConfig.value?.targets[target]) setTargetCustom(target, true)
  const current = targetConfigAt(scope, target)
  writeTargetConfig(scope, target, normalizeTargetConfig({ ...current, ...patch, paths: { ...current.paths, ...(patch.paths ?? {}) } }, target))
  if (scope === 'global') schedulePersist()
  apply()
}

function setTargetImage(target: BackgroundTarget, theme: BackgroundTheme, image: BackgroundImageRef, scope: BackgroundScope) {
  if (scope === 'project' && !projectConfig.value?.targets[target]) setTargetCustom(target, true)
  const current = targetConfigAt(scope, target)
  const firstImage = !current.paths.light && !current.paths.dark
  writeTargetConfig(scope, target, normalizeTargetConfig({
    ...current,
    paths: { ...current.paths, [theme]: image.path },
    enabled: firstImage ? true : current.enabled,
  }, target))
  writeSrc(scope, target, theme, image.src)
  if (image.src) setMissing(scope, target, theme, false)
  if (scope === 'global') persistNow()
  apply()
}

function clearTargetImage(target: BackgroundTarget, theme: BackgroundTheme, scope: BackgroundScope) {
  if (scope === 'project' && !projectConfig.value?.targets[target]) return
  const current = targetConfigAt(scope, target)
  writeTargetConfig(scope, target, normalizeTargetConfig({ ...current, paths: { ...current.paths, [theme]: '' } }, target))
  writeSrc(scope, target, theme, '')
  setMissing(scope, target, theme, false)
  if (scope === 'global') schedulePersist()
  apply()
}

/** 项目范围：true 以全局参数为底创建自定义目标（图片留空）；false 删除目标回到跟随全局 */
function setTargetCustom(target: BackgroundTarget, custom: boolean) {
  if (custom) {
    const targets = { ...projectConfig.value?.targets }
    if (!targets[target]) targets[target] = { ...globalConfig.value.targets[target], paths: { light: '', dark: '' } }
    projectConfig.value = { version: 1, targets }
    projectMissing.value = { ...projectMissing.value, [target]: { light: false, dark: false } }
  } else {
    const targets = { ...projectConfig.value?.targets }
    delete targets[target]
    projectConfig.value = { version: 1, targets }
    projectSrcs.value = { ...projectSrcs.value, [target]: { light: '', dark: '' } }
    projectMissing.value = { ...projectMissing.value, [target]: { light: false, dark: false } }
  }
  apply()
}

/** 标记运行时缺失：清该槽 src，保留持久化路径；无参调用兼容 v1（canvas/light） */
function markMissing(
  target: BackgroundTarget = 'canvas',
  theme: BackgroundTheme = 'light',
  scope: BackgroundScope = 'global',
) {
  writeSrc(scope, target, theme, '')
  setMissing(scope, target, theme, true)
  apply()
}

const background = computed<WorkspaceBackground>(() => {
  const c = globalConfig.value.targets.canvas
  const s = globalSrcs.value.canvas
  return {
    version: 1,
    enabled: c.enabled,
    path: c.paths.light,
    src: s.light || s.dark,
    fit: c.fit,
    focusX: c.focusX,
    focusY: c.focusY,
    dim: c.dim,
    blur: c.blur,
  }
})

function setImage(image: BackgroundImageRef) {
  setTargetImage('canvas', 'light', image, 'global')
}

function setSrc(src: string) {
  setTargetSrc('canvas', 'light', src, 'global')
  setMissing('global', 'canvas', 'light', false)
  persistNow()
}

function clear() {
  const targets = { ...globalConfig.value.targets }
  targets.canvas = defaultTarget()
  globalConfig.value = { ...globalConfig.value, targets }
  globalSrcs.value = { ...globalSrcs.value, canvas: { light: '', dark: '' } }
  globalMissing.value = { ...globalMissing.value, canvas: { light: false, dark: false } }
  apply()
  persistNow()
}

function setEnabled(on: boolean) {
  updateTarget('canvas', { enabled: on }, 'global')
  persistNow()
}

function setFit(fit: BackgroundFit) {
  if (!FIT_VALUES.includes(fit)) return
  updateTarget('canvas', { fit }, 'global')
}

function setFocus(x: FocusStep, y: FocusStep) {
  updateTarget('canvas', { focusX: nearestFocus(x), focusY: nearestFocus(y) }, 'global')
}

function setDim(value: number) {
  updateTarget('canvas', { dim: clamp(value, 0, 80, 35) }, 'global')
}

function setBlur(value: number) {
  updateTarget('canvas', { blur: clamp(value, 0, 30, 8) }, 'global')
}

export function applyPersistedBackground() {
  load()
  apply()
}

export function useBackground() {
  load()
  return {
    globalConfig,
    projectConfig,
    effective,
    srcs,
    missing,
    setProjectConfig,
    setTargetSrcs,
    setTargetSrc,
    updateTarget,
    setTargetImage,
    clearTargetImage,
    setTargetCustom,
    markMissing,
    apply,
    flushGlobal: persistNow,
    // v1 兼容别名：旧卡与启动引导按画布目标消费
    background,
    setImage,
    setSrc,
    clear,
    setEnabled,
    setFit,
    setFocus,
    setDim,
    setBlur,
    flush: persistNow,
  }
}
