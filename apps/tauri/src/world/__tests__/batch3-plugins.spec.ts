/**
 * 批3 插件登记语义（theme-editor / entity-tools）：overlay 登记进真源、
 * pluginId 归属、清理函数撤登记——模式对齐 data-tools.spec。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { pluginAPI } from '@worldsea/entity-core'

import { apply as applyTheme, manifest as themeManifest } from '../plugins/theme-editor'
import { apply as applyEntity, manifest as entityManifest } from '../plugins/entity-tools'
import { createPluginApi } from '../api'
import { runPluginCleanups } from '../registry'

afterEach(() => {
  pluginAPI.clearOverlays()
})

describe('official.theme-editor 插件（批3）', () => {
  it('manifest 官方域 + apply 登记 theme-editor overlay', () => {
    expect(themeManifest.id).toBe('official.theme-editor')
    applyTheme(undefined, createPluginApi('official.theme-editor'))
    const overlays = pluginAPI.getOverlays()
    expect(overlays.map(o => o.id)).toEqual(['theme-editor'])
    expect(overlays[0]!.pluginId).toBe('official.theme-editor')
    expect(overlays[0]!.component).toBeTruthy()
  })

  it('清理函数撤登记', () => {
    applyTheme(undefined, createPluginApi('official.theme-editor'))
    runPluginCleanups('official.theme-editor')
    expect(pluginAPI.getOverlays()).toHaveLength(0)
  })
})

describe('official.entity-tools 插件（批3）', () => {
  it('manifest 官方域 + apply 登记两对话框 overlay', () => {
    expect(entityManifest.id).toBe('official.entity-tools')
    applyEntity(undefined, createPluginApi('official.entity-tools'))
    const overlays = pluginAPI.getOverlays()
    expect(overlays.map(o => o.id)).toEqual(['custom-rel-type', 'entity-template'])
    for (const overlay of overlays) {
      expect(overlay.pluginId).toBe('official.entity-tools')
      expect(overlay.component).toBeTruthy()
    }
  })

  it('清理函数撤登记', () => {
    applyEntity(undefined, createPluginApi('official.entity-tools'))
    runPluginCleanups('official.entity-tools')
    expect(pluginAPI.getOverlays()).toHaveLength(0)
  })
})
