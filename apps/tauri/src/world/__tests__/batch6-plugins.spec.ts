/**
 * 批6 六插件登记语义（纯登记壳——组件在 ui-kit/plugin-sdk，插件只做 manifest + overlay 登记）：
 * search / import-export / batch-edit / templates / version-history / doc-export。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { pluginAPI } from '@worldsea/entity-core'

import * as search from '../plugins/search'
import * as importExport from '../plugins/import-export'
import * as batchEdit from '../plugins/batch-edit'
import * as templates from '../plugins/templates'
import * as versionHistory from '../plugins/version-history'
import * as docExport from '../plugins/doc-export'
import { createPluginApi } from '../api'
import { runPluginCleanups } from '../registry'

/** 插件表：id → 模块（登记断言数据源）。 */
const PLUGINS = [
  { mod: search, id: 'official.search', overlayId: 'search' },
  { mod: importExport, id: 'official.import-export', overlayId: 'import-export' },
  { mod: batchEdit, id: 'official.batch-edit', overlayId: 'batch-edit' },
  { mod: templates, id: 'official.templates', overlayId: 'template' },
  { mod: versionHistory, id: 'official.version-history', overlayId: 'version' },
  { mod: docExport, id: 'official.doc-export', overlayId: 'doc-export' },
] as const

afterEach(() => {
  pluginAPI.clearOverlays()
})

describe('批6 六插件（纯登记壳）', () => {
  it('manifest：官方域 + utility 身份（常驻）', () => {
    for (const { mod, id } of PLUGINS) {
      expect((mod.manifest as { id: string }).id).toBe(id)
      expect((mod.manifest as { kind?: string }).kind).toBe('utility')
    }
  })

  it('apply 登记各自 overlay 且 pluginId 归属正确；清理函数撤登记', () => {
    for (const { mod, id, overlayId } of PLUGINS) {
      ;(mod.apply as (ctx: unknown, api: unknown) => void)(undefined, createPluginApi(id))
      const overlays = pluginAPI.getOverlays()
      expect(overlays.map(o => o.id)).toEqual([overlayId])
      expect(overlays[0]!.pluginId).toBe(id)
      expect(overlays[0]!.component).toBeTruthy()

      runPluginCleanups(id)
      expect(pluginAPI.getOverlays()).toHaveLength(0)
    }
  })
})
