/** 自定义图标打包分区：项目全部图标 + 被项目覆盖引用的全局图标（base64 内嵌）+ 项目覆盖状态。 */
import type { IconAssetExportEntry } from '../customIcons'
import type { Serializer } from './types'
import { useIconAssetStore } from '../../stores/iconAssetStore'
import { useIconOverrideStore } from '../../stores/iconOverrideStore'

export const iconAssetsSerializer: Serializer = {
  id: 'icon-assets',
  label: '图标与自定义图标',
  dependsOn: [],

  async collect(): Promise<Record<string, unknown>> {
    const assets = await useIconAssetStore().collectExportAssets()
    return {
      version: 1,
      total: assets.length,
      assets,
      project: useIconOverrideStore().exportProjectState(),
    }
  },

  async import(data, strategy) {
    const raw = Array.isArray(data.assets) ? data.assets as Array<Partial<IconAssetExportEntry>> : []
    const result = await useIconAssetStore().importExportAssets(raw, strategy)
    const project = data.project && typeof data.project === 'object'
      ? data.project as Record<string, unknown>
      : null
    if (project) {
      const store = useIconOverrideStore()
      if (strategy === 'merge') {
        const current = store.exportProjectState()
        const incoming = project.overrides && typeof project.overrides === 'object'
          ? project.overrides as Record<string, string>
          : {}
        store.replaceProjectState({
          followGlobal: project.followGlobal ?? current.followGlobal,
          overrides: { ...current.overrides, ...incoming },
        })
      } else {
        store.replaceProjectState(project)
      }
    }
    return {
      serializerId: 'icon-assets',
      total: raw.length,
      added: result.imported,
      skipped: result.skipped,
      updated: 0,
      errors: [],
    }
  },
}
