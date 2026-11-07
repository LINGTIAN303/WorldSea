/**
 * manuscript 测试专用：把 `world.font` / `world.fontLibrary` 服务表登记为「转发到真实 store」。
 *
 * 为什么需要：`PhonePreview` 与 `useManuscriptExport` 已改为经树服务取字体配置，而这些
 * spec 不起树（直接 `setActivePinia` 挂载组件）。不登记服务表会抛「服务未就绪」。
 *
 * 转发而非替身：保持「真实 store」的集成语义，避免测试与生产取数路径分叉。
 */
import { useFontStore } from '@worldsea/entity-core/stores/fontStore'
import { useFontLibraryStore } from '@worldsea/font-kit'

import { registerWorldServiceTable } from '../../../service-registry'

/** 登记字体两个服务，均转发到当前活动 pinia 的 store。 */
export function installFontServices(): void {
  registerWorldServiceTable({
    'world.font': {
      family: (layer: 'chrome' | 'editorUi' | 'content' | 'preview' | 'canvas' | 'agent') =>
        useFontStore().prefs[layer].family,
      exportFamily: (fallback = 'Microsoft YaHei') => {
        const prefs = useFontStore().prefs
        return prefs.preview.family || prefs.content.family || fallback
      },
      uiScale: () => useFontStore().uiScale,
    },
    'world.fontLibrary': {
      list: () =>
        useFontLibraryStore().getAllEntries().map(entry => ({
          id: entry.id,
          family: entry.family,
          displayName: entry.displayName,
        })),
    },
  })
}
