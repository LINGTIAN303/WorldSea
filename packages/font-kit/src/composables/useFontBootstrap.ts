import { useFontLibraryStore } from '../stores/fontLibraryStore'
import { useFontStore } from '@worldsmith/entity-core'
import { useFontPresets, FONT_PRESETS } from './useFontPresets'
import { installFromWsfont } from '../fontInstaller'

export function useFontBootstrap() {
  const libraryStore = useFontLibraryStore()
  const fontStore = useFontStore()
  const { markInstalled } = useFontPresets()

  async function bootstrap() {
    // 1. 首次启动时迁移预设到 FontLibraryStore
    if (libraryStore.getAllEntries().length === 0) {
      await migratePresets()
    }

    // 2. 从 FontLibraryStore 恢复所有已安装字体
    await libraryStore.restoreAllFonts()

    // 3. 应用分层 CSS 变量
    fontStore.reapplyAllLayers()

    // 4. 标记预设为已安装
    for (const entry of libraryStore.getAllEntries()) {
      markInstalled(entry.id)
    }
  }

  async function migratePresets() {
    for (const preset of FONT_PRESETS) {
      if (preset.source !== 'wsfont' || !preset.wsfontPath) continue
      try {
        const resp = await fetch(preset.wsfontPath, { method: 'HEAD' })
        if (!resp.ok) continue
        const ct = resp.headers.get('content-type') || ''
        // 跳过非二进制响应（Vite dev server 可能返回 200 + HTML）
        if (ct.includes('text/html') || ct.includes('text/plain')) continue
        const fullResp = await fetch(preset.wsfontPath)
        const buffer = await fullResp.arrayBuffer()
        // 最小 zip 文件至少 22 字节（End of Central Directory）
        if (buffer.byteLength < 22) continue
        const { entry } = await installFromWsfont(buffer)
        entry.source = 'preset'
        entry.tags = preset.tags
        libraryStore.addEntry(entry)
      } catch {
        // 预设文件不存在或格式无效时静默跳过
      }
    }
  }

  return { bootstrap }
}
