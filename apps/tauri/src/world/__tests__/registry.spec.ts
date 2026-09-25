/**
 * 按插件作用域注册面（B 批）：修 `pluginAPI.currentPluginId` 全局单值问题。
 *
 * 【反证口径】不经作用域注册（旧写法 `pluginAPI.setPluginId('别人')` 后直接 registerView）→
 * 视图 `pluginId` 指向别人（旧病复现）；经 `registerViewFor` 注册 → 恒为该插件 id，
 * 且调用结束后全局值**恢复原样**（不污染后来者）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { pluginAPI } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core'
import { registerViewFor, registerPluginCleanup, runPluginCleanups, unregisterViewFor } from '../registry'

function view(id: string): PluginView {
  return { id, label: id, icon: 'bulb', component: {} as never }
}

beforeEach(() => {
  pluginAPI.clearViews()
  pluginAPI.setPluginId('')
})

describe('registerViewFor / unregisterViewFor', () => {
  it('作用域内注册：视图 pluginId 恒为插件自身 id，退出后全局值恢复', () => {
    pluginAPI.setPluginId('official.characters') // 模拟「最后一次 activate 的芽」污染

    registerViewFor('ws.demo.plugin', view('a'))

    const stored = pluginAPI.getViews().find(v => v.id === 'a')
    expect(stored?.pluginId).toBe('ws.demo.plugin')
    expect(pluginAPI.getPluginId()).toBe('official.characters')
  })

  it('反证：不经作用域（直接注册）→ pluginId 指向被污染的全局值', () => {
    pluginAPI.setPluginId('official.characters')
    pluginAPI.registerView(view('b'))
    expect(pluginAPI.getViews().find(v => v.id === 'b')?.pluginId).toBe('official.characters')
  })

  it('反注册同样走作用域（真源派发，返回是否删掉）', () => {
    registerViewFor('ws.demo.plugin', view('c'))
    expect(unregisterViewFor('ws.demo.plugin', 'c')).toBe(true)
    expect(unregisterViewFor('ws.demo.plugin', 'c')).toBe(false)
    expect(pluginAPI.getViews().map(v => v.id)).not.toContain('c')
  })
})

describe('插件清理登记', () => {
  it('按插件登记并在拆树时逐个执行（一次），抛错隔离', () => {
    const seen: string[] = []
    registerPluginCleanup('ws.clean.one', () => seen.push('a'))
    registerPluginCleanup('ws.clean.one', () => {
      throw new Error('清理故障')
    })
    registerPluginCleanup('ws.clean.one', () => seen.push('b'))

    const spy = console.error
    console.error = () => {}
    runPluginCleanups('ws.clean.one')
    console.error = spy

    expect(seen).toEqual(['a', 'b'])
    // 已执行即清表：再拆不重复
    runPluginCleanups('ws.clean.one')
    expect(seen).toEqual(['a', 'b'])
  })
})
