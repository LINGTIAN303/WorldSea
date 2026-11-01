import { ref, readonly, onScopeDispose, getCurrentScope, type Ref } from 'vue'
import {
  scanSystemFonts,
  readFontFile,
  isTauriAvailable,
  type SystemFontInfo,
} from '../TauriFontBridge'
import { installFromRawFont } from '../fontInstaller'
import { useFontLibraryStore } from '../stores/fontLibraryStore'

export type { SystemFontInfo }

export interface UseSystemFontsReturn {
  available: Readonly<Ref<boolean>>
  scanning: Readonly<Ref<boolean>>
  fonts: Readonly<Ref<readonly SystemFontInfo[]>>
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

  /** 安装系统字体到库：复用 installFromRawFont 完整链（解析真实 family/weight/style →
   *  FontFace 注册 + IndexedDB 持久化），再登记进 fontLibraryStore——重启可恢复、可删除。 */
  async function installFont(fontInfo: SystemFontInfo): Promise<boolean> {
    const buffer = await readFontFile(fontInfo.path)
    if (!buffer) return false
    try {
      const fileName = fontInfo.path.split(/[\\/]/).pop() || fontInfo.family
      const { entry } = await installFromRawFont(buffer, fileName)
      const libraryStore = useFontLibraryStore()
      if (libraryStore.getEntryByFamily(entry.family)) return true // 已在库内视为成功
      entry.source = 'system'
      return libraryStore.addEntry(entry).ok
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
