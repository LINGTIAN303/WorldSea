/**
 * data-tools 插件（批2）：三个数据面板的 overlay 登记语义——
 * 用真 createPluginApi（作用域锁定 + 清理登记面），测的是插件真行为：
 * 登记进真源、pluginId 归属、清理函数撤登记（卸载语义）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { pluginAPI } from '@worldsea/entity-core'

import { manifest, apply } from '../plugins/data-tools'
import { createPluginApi } from '../api'
import { runPluginCleanups } from '../registry'

afterEach(() => {
  pluginAPI.clearOverlays()
})

describe('official.data-tools 插件（批2）', () => {
  it('manifest：id 官方域 + 通过清单校验形状', () => {
    expect(manifest.id).toBe('official.data-tools')
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(manifest.description.trim()).toBeTruthy()
  })

  it('apply 登记三个 overlay，pluginId 锁到本插件', () => {
    apply(undefined, createPluginApi('official.data-tools'))
    const ids = pluginAPI.getOverlays().map(o => o.id)
    expect(ids).toEqual(['trash', 'artifacts', 'consistency'])
    for (const overlay of pluginAPI.getOverlays()) {
      expect(overlay.pluginId).toBe('official.data-tools')
      expect(overlay.component, `${overlay.id} 应携带面板组件`).toBeTruthy()
    }
  })

  it('清理函数撤登记（插件卸载 → 三入口静默失效）', () => {
    apply(undefined, createPluginApi('official.data-tools'))
    expect(pluginAPI.getOverlays()).toHaveLength(3)

    runPluginCleanups('official.data-tools')
    expect(pluginAPI.getOverlays()).toHaveLength(0)
  })
})
