import { ref, computed } from 'vue'

export interface FontPresetEntry {
  id: string
  displayName: string
  family: string
  category: 'content' | 'ui'
  source: 'wsfont' | 'system'
  wsfontPath?: string
  tags: string[]
  description?: string
}

/** 预设字体清单（数据挂账：原 10 个内置 wsfont 预设的资产文件不存在——public/fonts/ 目录缺失，
 *  迁移链为静默跳过的死码；死数据已于字体系统 v2 批 1 退役。机制保留，
 *  待「自托管预设字体包」拍板后重新填入条目。 */
export const FONT_PRESETS: FontPresetEntry[] = []

export function useFontPresets() {
  const installedIds = ref<Set<string>>(new Set())

  const contentPresets = computed(() =>
    FONT_PRESETS.filter((p) => p.category === 'content'),
  )

  const uiPresets = computed(() =>
    FONT_PRESETS.filter((p) => p.category === 'ui'),
  )

  function getPreset(id: string): FontPresetEntry | undefined {
    return FONT_PRESETS.find((p) => p.id === id)
  }

  function getPresetByFamily(family: string): FontPresetEntry | undefined {
    return FONT_PRESETS.find((p) => p.family === family)
  }

  function isInstalled(id: string): boolean {
    return installedIds.value.has(id)
  }

  function markInstalled(id: string) {
    if (installedIds.value.has(id)) return
    installedIds.value = new Set([...installedIds.value, id])
  }

  return {
    installedIds,
    contentPresets,
    uiPresets,
    getPreset,
    getPresetByFamily,
    isInstalled,
    markInstalled,
  }
}
