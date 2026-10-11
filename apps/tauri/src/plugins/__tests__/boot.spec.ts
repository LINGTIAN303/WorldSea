/**
 * bootstrapShell 首屏默认视图（2026-10-09 缺陷修复反证）。
 *
 * 默认视图的挑选归 `viewOrder` 单一口径：优先恢复上次视图（`worldsea_last_view`，
 * 须仍在**可见侧栏列表**），否则侧栏首项；`skipDefaultView`（切项目重播种）不动当前选中。
 * 反证要点：旧实现取注册序 `pluginStore.views[0]`（＝装载器字典序，`apparel` 恒第一）——
 * 本 spec 的「恢复上次视图（非首项）」与「失效回落首项」两条用例在旧实现下必红。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { pluginAPI, useUIStore } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core'
import { uninstallViewSynchronizer } from '../viewSync'
import { bootstrapShell } from '../boot'

function view(id: string, component: unknown = {}): PluginView {
  return { id, label: id, icon: 'bulb', component: component as never }
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

describe('bootstrapShell / 首屏默认视图', () => {
  it('有记忆 → 恢复上次视图（哪怕不是侧栏首项），并带上组件', async () => {
    const compB = { name: 'B-view' }
    pluginAPI.registerView(view('a'))
    pluginAPI.registerView(view('b', compB))
    localStorage.setItem('worldsea_last_view', 'b')

    await bootstrapShell()

    const ui = useUIStore()
    expect(ui.currentView).toBe('b')
    expect(ui.viewComponent).toBe(compB)
  })

  it('无记忆 → 侧栏首项', async () => {
    pluginAPI.registerView(view('a'))
    pluginAPI.registerView(view('b'))

    await bootstrapShell()

    expect(useUIStore().currentView).toBe('a')
  })

  it('记忆失效（不在可见列表）→ 侧栏首项', async () => {
    pluginAPI.registerView(view('a'))
    localStorage.setItem('worldsea_last_view', 'ghost')

    await bootstrapShell()

    expect(useUIStore().currentView).toBe('a')
  })

  it('skipDefaultView（切项目重播种）不动当前选中', async () => {
    pluginAPI.registerView(view('a'))
    const ui = useUIStore()
    ui.setView('keep')

    await bootstrapShell({ skipDefaultView: true })

    expect(ui.currentView).toBe('keep')
  })
})
