import { defineStore } from 'pinia'
import { ref } from 'vue'
import { watchDebounced } from '@worldsea/perf-kit/render'

/** 字体分层。canvas/agent 为退役保留键（无 CSS 变量，仅旧数据兼容）：
 *  canvas 仅 canvas 图片渲染直读 prefs；agent 面已随旧 Agent 面退场。 */
export type FontLayer = 'chrome' | 'editorUi' | 'content' | 'preview' | 'canvas' | 'agent'

/** 活跃层（设置面展示与变量写入口径）；canvas/agent 退役层不在其中 */
export type ActiveFontLayer = Exclude<FontLayer, 'canvas' | 'agent'>

export interface FontLayerPref { family: string; weight: number; style: string }

export interface FontPreferences {
  chrome: FontLayerPref
  editorUi: FontLayerPref
  content: FontLayerPref
  preview: FontLayerPref
  canvas: FontLayerPref
  agent: FontLayerPref
}

const STORAGE_KEY = 'worldsea_font_prefs'

/** 分层 → CSS 变量。空串 = 该层不写变量（canvas 仅渲染直读 prefs；agent 层已退役）。 */
const LAYER_CSS_VAR: Record<FontLayer, string> = {
  chrome: '--font-family-chrome',
  editorUi: '--font-family-editor-ui',
  content: '--font-family-content',
  preview: '--font-family-preview',
  canvas: '',
  agent: '',
}

const LAYER_WEIGHT_VAR: Record<ActiveFontLayer, string> = {
  chrome: '--font-weight-chrome',
  editorUi: '--font-weight-editor-ui',
  content: '--font-weight-content',
  preview: '--font-weight-preview',
}

const LAYER_STYLE_VAR: Record<ActiveFontLayer, string> = {
  chrome: '--font-style-chrome',
  editorUi: '--font-style-editor-ui',
  content: '--font-style-content',
  preview: '--font-style-preview',
}

const DEFAULT_PREF: FontLayerPref = { family: '', weight: 400, style: 'normal' }

const DEFAULT_PREFS: FontPreferences = {
  chrome: { ...DEFAULT_PREF },
  editorUi: { ...DEFAULT_PREF },
  content: { ...DEFAULT_PREF },
  preview: { ...DEFAULT_PREF },
  canvas: { ...DEFAULT_PREF },
  agent: { ...DEFAULT_PREF },
}

/** 从旧格式（纯字符串）或新格式（对象）迁移 */
function migratePref(raw: unknown): FontLayerPref {
  if (typeof raw === 'string') {
    return { family: raw, weight: 400, style: 'normal' }
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    return {
      family: typeof obj.family === 'string' ? obj.family : '',
      weight: typeof obj.weight === 'number' ? obj.weight : 400,
      style: typeof obj.style === 'string' ? obj.style : 'normal',
    }
  }
  return { ...DEFAULT_PREF }
}

function loadPrefs(): FontPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(DEFAULT_PREFS)
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: Record<string, FontLayerPref> = {}
    for (const key of Object.keys(DEFAULT_PREFS)) {
      result[key] = migratePref(parsed[key])
    }
    return result as unknown as FontPreferences
  } catch {
    return structuredClone(DEFAULT_PREFS)
  }
}

function savePrefs(prefs: FontPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

/** 界面字号档位范围（0.85–1.15）与持久化键（独立键，避免破坏分层 prefs 迁移逻辑） */
export const UI_SCALE_MIN = 0.85
export const UI_SCALE_MAX = 1.15
const UI_SCALE_KEY = 'worldsea_font_ui_scale'

function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(v * 100) / 100))
}

function loadUiScale(): number {
  try {
    const v = Number(localStorage.getItem(UI_SCALE_KEY))
    return v >= UI_SCALE_MIN && v <= UI_SCALE_MAX ? v : 1
  } catch {
    return 1
  }
}

export const useFontStore = defineStore('font', () => {
  const prefs = ref<FontPreferences>(loadPrefs())
  /** 界面字号档位（--ui-font-scale，默认 1 = 主题令牌原值） */
  const uiScale = ref<number>(loadUiScale())

  watchDebounced(() => prefs.value, () => savePrefs(prefs.value), { debounce: 200, deep: true })
  watchDebounced(() => uiScale.value, () => localStorage.setItem(UI_SCALE_KEY, String(uiScale.value)), { debounce: 200 })

  /** 把某层用户偏好写入 documentElement inline 变量（inline 优先级高于主题表默认值） */
  function applyLayerCSS(layer: FontLayer, pref: FontLayerPref) {
    const familyVar = LAYER_CSS_VAR[layer]
    if (familyVar) {
      if (pref.family) {
        const cssValue = `"${pref.family}", sans-serif`
        document.documentElement.style.setProperty(familyVar, cssValue)
      } else {
        document.documentElement.style.removeProperty(familyVar)
      }
    }

    const weightVar = LAYER_WEIGHT_VAR[layer as ActiveFontLayer]
    if (weightVar) {
      if (pref.family && pref.weight !== 400) {
        document.documentElement.style.setProperty(weightVar, String(pref.weight))
      } else {
        document.documentElement.style.removeProperty(weightVar)
      }
    }

    const styleVar = LAYER_STYLE_VAR[layer as ActiveFontLayer]
    if (styleVar) {
      if (pref.family && pref.style !== 'normal') {
        document.documentElement.style.setProperty(styleVar, pref.style)
      } else {
        document.documentElement.style.removeProperty(styleVar)
      }
    }
  }

  /** 界面字号档位 → --ui-font-scale（默认 1 时移除 inline，吃主题表默认值） */
  function applyUiScale() {
    const v = clampScale(uiScale.value)
    if (v !== 1) {
      document.documentElement.style.setProperty('--ui-font-scale', String(v))
    } else {
      document.documentElement.style.removeProperty('--ui-font-scale')
    }
  }

  function setLayerFont(layer: FontLayer, family: string, weight?: number, style?: string) {
    prefs.value[layer] = { family, weight: weight ?? 400, style: style ?? 'normal' }
    applyLayerCSS(layer, prefs.value[layer])
  }

  function setLayerVariant(layer: FontLayer, weight: number, style: string) {
    prefs.value[layer] = { ...prefs.value[layer], weight, style }
    applyLayerCSS(layer, prefs.value[layer])
  }

  function resetLayer(layer: FontLayer) {
    prefs.value[layer] = { ...DEFAULT_PREF }
    applyLayerCSS(layer, prefs.value[layer])
  }

  /** 启动恢复：重放全部层变量 + 字号档位（幂等，可重复调用） */
  function reapplyAll() {
    for (const layer of Object.keys(LAYER_CSS_VAR) as FontLayer[]) {
      applyLayerCSS(layer, prefs.value[layer])
    }
    applyUiScale()
  }

  function getLayerFont(layer: FontLayer): string {
    return prefs.value[layer].family
  }

  function getLayerPref(layer: FontLayer): FontLayerPref {
    return prefs.value[layer]
  }

  function setUiScale(v: number) {
    uiScale.value = clampScale(v)
    applyUiScale()
  }

  return {
    prefs,
    uiScale,
    setLayerFont,
    setLayerVariant,
    resetLayer,
    reapplyAll,
    getLayerFont,
    getLayerPref,
    setUiScale,
  }
})
