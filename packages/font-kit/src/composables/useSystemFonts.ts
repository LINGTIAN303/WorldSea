import { ref, readonly, onScopeDispose, getCurrentScope } from 'vue'
import {
  scanSystemFonts,
  readFontFile,
  isTauriAvailable,
  type SystemFontInfo,
} from '../TauriFontBridge'
import {
  register,
  type FontSource,
} from '../FontRegistry'
import { loadFont } from '../FontLoader'

export type { SystemFontInfo }

export interface UseSystemFontsReturn {
  available: ReturnType<typeof readonly<ReturnType<typeof ref<boolean>>>>
  scanning: ReturnType<typeof readonly<ReturnType<typeof ref<boolean>>>>
  fonts: ReturnType<typeof readonly<ReturnType<typeof ref<SystemFontInfo[]>>>>
  scan: () => Promise<SystemFontInfo[]>
  installFont: (fontInfo: SystemFontInfo) => Promise<boolean>
  installFonts: (fontInfos: SystemFontInfo[]) => Promise<number>
}

export function useSystemFonts(): UseSystemFontsReturn {
  const available = ref(false)
  const scanning = ref(false)
  const fonts = ref<SystemFontInfo[]>([])

  if (getCurrentScope()) {
    onScopeDispose(() => {
      fonts.value = []
    })
  }

  isTauriAvailable().then(v => { available.value = v })

  async function scan(): Promise<SystemFontInfo[]> {
    scanning.value = true
    try {
      const result = await scanSystemFonts()
      fonts.value = result
      return result
    } finally {
      scanning.value = false
    }
  }

  async function installFont(fontInfo: SystemFontInfo): Promise<boolean> {
    const buffer = await readFontFile(fontInfo.path)
    if (!buffer) return false

    const id = `sys-${fontInfo.family}-${fontInfo.weight}-${fontInfo.style}`
      .replace(/\s+/g, '-')

    const source: FontSource = {
      type: 'buffer',
      buffer,
      format: fontInfo.format,
    }

    register({
      id,
      family: fontInfo.family,
      weight: fontInfo.weight,
      style: fontInfo.style,
      source,
    })

    try {
      await loadFont(id)
      return true
    } catch {
      return false
    }
  }

  async function installFonts(fontInfos: SystemFontInfo[]): Promise<number> {
    let installed = 0
    for (const fi of fontInfos) {
      if (await installFont(fi)) installed++
    }
    return installed
  }

  return {
    available: readonly(available),
    scanning: readonly(scanning),
    fonts: readonly(fonts),
    scan,
    installFont,
    installFonts,
  }
}
