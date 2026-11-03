/** 背景状态单例：六目标配置、全局+项目覆盖合并、分范围运行时态与根变量。 */
import { computed, ref } from 'vue'
import { normalizeGlobalConfig, normalizeProjectConfig, normalizeTargetConfig } from './background-normalize'
import type {
  BackgroundFit,
  BackgroundGlobalConfig,
  BackgroundImageRef,
  BackgroundProjectConfig,
  BackgroundScope,
  BackgroundTarget,
  BackgroundTargetConfig,
  BackgroundTheme,
  FocusStep,
} from './background-types'
import {
  BACKGROUND_KEY,
  BACKGROUND_TARGETS,
  BACKGROUND_TARGET_CAPS,
  BACKGROUND_THEMES,
  BACKGROUND_V1_KEY,
} from './background-types'

// 类型与配置常量定义在 background-types.ts（与 background-normalize.ts 共用），此处原样转出
export type {
  BackgroundFit,
  BackgroundGlobalConfig,
  BackgroundImageRef,
  BackgroundProjectConfig,
  BackgroundScope,
  BackgroundTarget,
  BackgroundTargetConfig,
  BackgroundTheme,
  FocusStep,
}
export {
  BACKGROUND_KEY,
  BACKGROUND_TARGETS,
  BACKGROUND_TARGET_CAPS,
  BACKGROUND_THEMES,
  BACKGROUND_V1_KEY,
}
export {
  normalizeGlobalConfig,
  normalizeProjectConfig,
  normalizeTargetConfig,
}
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

/** 连字符目标写 dataset 转 camelCase：content-toolbar → wsBgContentToolbar */
function datasetKey(target: BackgroundTarget): string {
  return `wsBg${target.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')}`
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

/** 标记运行时缺失：清该槽 src，保留持久化路径 */
function markMissing(target: BackgroundTarget, theme: BackgroundTheme, scope: BackgroundScope) {
  writeSrc(scope, target, theme, '')
  setMissing(scope, target, theme, true)
  apply()
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
    globalSrcs,
    projectSrcs,
    globalMissing,
    projectMissing,
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
  }
}
