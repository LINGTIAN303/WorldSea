/**
 * 视图生命周期（D 批，2026-09-25）——真源 `pluginAPI` 的变更事件 + 显示侧 `pluginStore` 反注册。
 *
 * 【为什么单独立这个 spec】此前「产品壳」有**两份视图数组**（真源 `pluginAPI._views` 与显示侧
 * `pluginStore.views`），却只有一个单向、一次性的镜像钩子：反注册（deactivate / 模块删视图 / 清空）
 * 不回写显示侧 → 侧栏留幽灵项，各调用点只好各写一套同步（全量重灌 / 手动 splice / 过滤数组）。
 * 本批改为「真源派发事件 + 装配层单一订阅」，本 spec 把事件语义钉住。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { pluginAPI } from '../../core/PluginAPI'
import { usePluginStore } from '../pluginStore'
import type { PluginView } from '../../types'

function view(id: string): PluginView {
  return { id, label: id, icon: 'bulb', component: {} as never }
}

beforeEach(() => {
  setActivePinia(createPinia())
  pluginAPI.clearViews()
})

describe('pluginAPI 视图变更事件', () => {
  it('注册与反注册都派发，且带被变更的视图', () => {
    const changes: Array<{ kind: string; id: string }> = []
    pluginAPI.onViewChange(c => changes.push({ kind: c.kind, id: c.view.id }))

    const v = view('a')
    pluginAPI.registerView(v)
    expect(pluginAPI.unregisterView('a')).toBe(true)

    expect(changes).toEqual([
      { kind: 'registered', id: 'a' },
      { kind: 'unregistered', id: 'a' },
    ])
  })

  it('重复 id 注册不派发（幂等），反注册不存在的 id 返回 false 且不派发', () => {
    const listener = vi.fn()
    pluginAPI.onViewChange(listener)

    pluginAPI.registerView(view('a'))
    pluginAPI.registerView(view('a'))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(pluginAPI.getViews().length).toBe(1)

    expect(pluginAPI.unregisterView('missing')).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('clearViews 对每条视图派发 unregistered（项目切换重播种的语义）', () => {
    const listener = vi.fn()
    pluginAPI.registerView(view('a'))
    pluginAPI.registerView(view('b'))
    pluginAPI.onViewChange(listener)

    pluginAPI.clearViews()

    expect(pluginAPI.getViews().length).toBe(0)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls.map(c => [c[0].kind, c[0].view.id])).toEqual([
      ['unregistered', 'a'],
      ['unregistered', 'b'],
    ])
    // 清空后不残留：再次 clearViews 不派发
    pluginAPI.clearViews()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('退订后不再收到事件', () => {
    const listener = vi.fn()
    const off = pluginAPI.onViewChange(listener)
    pluginAPI.registerView(view('a'))
    off()
    pluginAPI.registerView(view('b'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('监听器抛错被隔离：不影响其它监听器，也不阻断注册', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const good = vi.fn()
    // 该监听器故意抛错；用例末尾退订，避免污染后续用例的 beforeEach（pluginAPI 是模块级单例）
    const offThrowing = pluginAPI.onViewChange(() => {
      throw new Error('监听器故障')
    })
    pluginAPI.onViewChange(good)

    pluginAPI.registerView(view('a'))

    expect(pluginAPI.getViews().map(v => v.id)).toEqual(['a'])
    expect(good).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalled()
    offThrowing()
    spy.mockRestore()
  })
})

describe('pluginStore.unregisterView（显示侧对称面）', () => {
  it('删掉存在的视图返回 true；不存在返回 false；不触碰其它视图', () => {
    const store = usePluginStore()
    store.registerView(view('a'))
    store.registerView(view('b'))

    expect(store.unregisterView('a')).toBe(true)
    expect(store.views.map(v => v.id)).toEqual(['b'])
    expect(store.unregisterView('a')).toBe(false)
  })
})
