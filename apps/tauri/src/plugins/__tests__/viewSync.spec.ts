/**
 * viewSync 装配（D 批，2026-09-25）：真源 `pluginAPI` 派发 → 显示侧镜像。
 *
 * 【反证式验收】本 spec 里有一条**退订反证**：退订后再反注册，显示侧不再跟随——
 * 以此证明「镜像由事件订阅驱动」，而不是某处巧合的手动同步。
 * 另有一条**顺序偏好保留**断言：反注册不得删 `sidebarOrder`（那是用户排序，删了会丢）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { pluginAPI, usePluginStore, useUIStore } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core'
import { installViewSynchronizer, uninstallViewSynchronizer } from '../viewSync'

function view(id: string): PluginView {
  return { id, label: id, icon: 'bulb', component: {} as never }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  uninstallViewSynchronizer()
  pluginAPI.clearViews()
})

afterEach(() => {
  uninstallViewSynchronizer()
})

describe('installViewSynchronizer', () => {
  it('注册镜像到 store 与侧栏顺序；反注册从 store 移除但保留顺序偏好', () => {
    installViewSynchronizer()
    const store = usePluginStore()
    const ui = useUIStore()

    pluginAPI.registerView(view('a'))
    pluginAPI.registerView(view('b'))
    expect(store.views.map(v => v.id)).toEqual(['a', 'b'])
    expect(ui.sidebarOrder).toEqual(['a', 'b'])

    pluginAPI.unregisterView('a')
    expect(store.views.map(v => v.id)).toEqual(['b'])
    expect(ui.sidebarOrder).toEqual(['a', 'b']) // 顺序偏好保留（重播种后回原位）
  })

  it('重复装配幂等（同一订阅，不重复计数）', () => {
    const off1 = installViewSynchronizer()
    const off2 = installViewSynchronizer()
    expect(off2).toBe(off1)

    const store = usePluginStore()
    pluginAPI.registerView(view('a'))
    expect(store.views.map(v => v.id)).toEqual(['a'])
  })

  it('反证：退订后再反注册，显示侧不再跟随（证明镜像由事件驱动）', () => {
    installViewSynchronizer()
    const store = usePluginStore()
    pluginAPI.registerView(view('a'))
    expect(store.views.map(v => v.id)).toEqual(['a'])

    uninstallViewSynchronizer()
    pluginAPI.registerView(view('b'))
    pluginAPI.unregisterView('a')

    expect(store.views.map(v => v.id)).toEqual(['a']) // 未跟随：b 没进来、a 没删掉
    expect(pluginAPI.getViews().map(v => v.id)).toEqual(['b']) // 真源确实变了
  })

  it('clearViews（项目切换路径）把显示侧清空', () => {
    installViewSynchronizer()
    const store = usePluginStore()
    pluginAPI.registerView(view('a'))
    pluginAPI.registerView(view('b'))

    pluginAPI.clearViews()

    expect(store.views.length).toBe(0)
  })
})
