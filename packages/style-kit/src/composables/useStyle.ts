/** 风格状态单例：data-style 由本模块唯一控制，持久化键见下方常量；详细说明见 docs/details/注释/packages/style-kit/index.md */
import { computed, ref } from 'vue'
import { AXIS_META, DEFAULT_STYLE_ID, STYLE_PACKS, type AxisKey, type StyleAxes, type StyleId } from '../packs'

const STYLE_KEY = 'worldsea_ui_style'
const AXES_KEY = 'worldsea_ui_style_axes'
const PERF_KEY = 'worldsea_ui_style_perf'
const GLASS_KEY = 'worldsea_ui_style_glass'

export type GlassVariant = 'regular' | 'clear'

const styleId = ref<StyleId>(DEFAULT_STYLE_ID)
const overrides = ref<Partial<StyleAxes>>({})
const perfMode = ref(false)
const glassVariant = ref<GlassVariant>('regular')
let loaded = false

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isStyleId(value: unknown): value is StyleId {
  return typeof value === 'string' && value in STYLE_PACKS && STYLE_PACKS[value as StyleId].status === 'ready'
}

function clampAxis(key: AxisKey, value: number): number {
  const meta = AXIS_META[key]
  return Math.min(meta.max, Math.max(meta.min, Math.round(value)))
}

function load() {
  if (loaded) return
  loaded = true
  const ls = storage()
  if (!ls) return
  const saved = ls.getItem(STYLE_KEY)
  if (isStyleId(saved)) styleId.value = saved
  perfMode.value = ls.getItem(PERF_KEY) === '1'
  glassVariant.value = ls.getItem(GLASS_KEY) === 'clear' ? 'clear' : 'regular'
  try {
    const raw = ls.getItem(AXES_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<StyleAxes>) : null
    if (parsed) {
      const next: Partial<StyleAxes> = {}
      for (const key of Object.keys(AXIS_META) as AxisKey[]) {
        const value = parsed[key]
        if (typeof value === 'number' && Number.isFinite(value)) next[key] = clampAxis(key, value)
      }
      overrides.value = next
    }
  } catch {
    overrides.value = {}
  }
}

const resolvedAxes = computed<StyleAxes>(() => ({ ...STYLE_PACKS[styleId.value].axes, ...overrides.value }))

function apply() {
  const root = document.documentElement
  root.dataset.style = styleId.value
  root.dataset.perf = perfMode.value ? 'on' : 'off'
  root.dataset.glass = glassVariant.value
  const axes = resolvedAxes.value
  root.style.setProperty('--sf-material', String(axes.material))
  root.style.setProperty('--sf-depth', String(axes.depth))
  root.style.setProperty('--sf-morph', String(axes.morph))
  root.style.setProperty('--sf-tactile', String(axes.tactile))
}

function persist() {
  const ls = storage()
  if (!ls) return
  ls.setItem(STYLE_KEY, styleId.value)
  ls.setItem(PERF_KEY, perfMode.value ? '1' : '0')
  ls.setItem(GLASS_KEY, glassVariant.value)
  if (Object.keys(overrides.value).length) ls.setItem(AXES_KEY, JSON.stringify(overrides.value))
  else ls.removeItem(AXES_KEY)
}

export function applyPersistedStyle() {
  load()
  apply()
}

export function useStyle() {
  load()

  function setStyle(id: StyleId) {
    if (STYLE_PACKS[id].status !== 'ready') return
    styleId.value = id
    persist()
    const root = document.documentElement
    root.classList.add('is-style-switching')
    apply()
    window.setTimeout(() => root.classList.remove('is-style-switching'), 220)
  }

  function setAxis(key: AxisKey, value: number) {
    overrides.value = { ...overrides.value, [key]: clampAxis(key, value) }
    persist()
    apply()
  }

  function resetAxis(key: AxisKey) {
    const next = { ...overrides.value }
    delete next[key]
    overrides.value = next
    persist()
    apply()
  }

  function resetAxes() {
    overrides.value = {}
    persist()
    apply()
  }

  function setPerfMode(on: boolean) {
    perfMode.value = on
    persist()
    apply()
  }

  function setGlassVariant(variant: GlassVariant) {
    glassVariant.value = variant
    persist()
    apply()
  }

  function isOverridden(key: AxisKey) {
    return overrides.value[key] !== undefined
  }

  return { styleId, overrides, resolvedAxes, perfMode, glassVariant, setStyle, setAxis, resetAxis, resetAxes, setPerfMode, setGlassVariant, isOverridden }
}
