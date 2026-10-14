/**
 * official.settings 插件（批5，L2 收尾）：overlay 登记语义——对齐 batch3-plugins.spec 模式。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { pluginAPI } from '@worldsea/entity-core'

import { manifest, apply } from '../plugins/settings'
import { createPluginApi } from '../api'
import { runPluginCleanups } from '../registry'

afterEach(() => {
  pluginAPI.clearOverlays()
})

describe('official.settings 插件（批5）', () => {
  it('manifest：官方域 + utility 身份（非芽类）', () => {
    expect(manifest.id).toBe('official.settings')
    expect(manifest.kind).toBe('utility')
  })

  it('apply 登记 settings overlay，pluginId 锁到本插件', () => {
    apply(undefined, createPluginApi('official.settings'))
    const overlays = pluginAPI.getOverlays()
    expect(overlays.map(o => o.id)).toEqual(['settings'])
    expect(overlays[0]!.pluginId).toBe('official.settings')
    expect(overlays[0]!.component).toBeTruthy()
  })

  it('清理函数撤登记（卸载语义）', () => {
    apply(undefined, createPluginApi('official.settings'))
    runPluginCleanups('official.settings')
    expect(pluginAPI.getOverlays()).toHaveLength(0)
  })
})
