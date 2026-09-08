import { defineStore } from 'pinia'
import { ref } from 'vue'
import { watchDebounced } from '@worldsea/perf-kit/render'

export type FontLayer = 'chrome' | 'editorUi' | 'content' | 'preview' | 'canvas' | 'agent'

export interface FontLayerPref {
  family: string
  weight: number
  style: string
}

export interface FontPreferences {
  chrome: FontLayerPref
  editorUi: FontLayerPref
  content: FontLayerPref
  preview: FontLayerPref
  canvas: FontLayerPref
  agent: FontLayerPref
}

const STORAGE_KEY = 'worldsea_font_prefs'

const LAYER_CSS_VAR: Record<FontLayer, string> = {
  chrome: '--font-family-chrome',
  editorUi: '--font-family-editor-ui',
  content: '--font-family-content',
  preview: '--font-family-preview',
  canvas: '',
  agent: '--font-family-agent',
}

const LAYER_WEIGHT_VAR: Record<FontLayer, string> = {
  chrome: '--font-weight-chrome',
  editorUi: '--font-weight-editor-ui',
  content: '--font-weight-content',
  preview: '--font-weight-preview',
  canvas: '',
  agent: '--font-weight-agent',
}

const LAYER_STYLE_VAR: Record<FontLayer, string> = {
  chrome: '--font-style-chrome',
  editorUi: '--font-style-editor-ui',
  content: '--font-style-content',
  preview: '--font-style-preview',
  canvas: '',
  agent: '--font-style-agent',
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

/**
 * 从旧格式（纯字符串）或新格式（对象）迁移
 */
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

export const useFontStore = defineStore('font', () => {
  const prefs = ref<FontPreferences>(loadPrefs())

  watchDebounced(() => prefs.value, () => savePrefs(prefs.value), { debounce: 200, deep: true })

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

    const weightVar = LAYER_WEIGHT_VAR[layer]
    if (weightVar) {
      if (pref.family && pref.weight !== 400) {
        document.documentElement.style.setProperty(weightVar, String(pref.weight))
      } else {
        document.documentElement.style.removeProperty(weightVar)
      }
    }

    const styleVar = LAYER_STYLE_VAR[layer]
    if (styleVar) {
      if (pref.family && pref.style !== 'normal') {
        document.documentElement.style.setProperty(styleVar, pref.style)
      } else {
        document.documentElement.style.removeProperty(styleVar)
      }
    }
  }

  function setLayerFont(layer: FontLayer, family: string, weight?: number, style?: string) {
    prefs.value[layer] = {
      family,
      weight: weight ?? 400,
      style: style ?? 'normal',
    }
    applyLayerCSS(layer, prefs.value[layer])
  }

  function setLayerVariant(layer: FontLayer, weight: number, style: string) {
    prefs.value[layer] = {
      ...prefs.value[layer],
      weight,
      style,
    }
    applyLayerCSS(layer, prefs.value[layer])
  }

  function resetLayer(layer: FontLayer) {
    prefs.value[layer] = { ...DEFAULT_PREF }
    applyLayerCSS(layer, prefs.value[layer])
  }

  function reapplyAllLayers() {
    for (const layer of Object.keys(LAYER_CSS_VAR) as FontLayer[]) {
      applyLayerCSS(layer, prefs.value[layer])
    }
  }

  function getLayerFont(layer: FontLayer): string {
    return prefs.value[layer].family
  }

  function getLayerPref(layer: FontLayer): FontLayerPref {
    return prefs.value[layer]
  }

  return {
    prefs,
    setLayerFont,
    setLayerVariant,
    resetLayer,
    reapplyAllLayers,
    getLayerFont,
    getLayerPref,
  }
})
