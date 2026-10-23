/**
 * useShellViewSwitch 单测（2026-10-23 产品域首页）：首页下 Ctrl+↑/↓ 不得改视图，
 * 工作台内按侧栏同一份可见顺序前进/回绕并同步 viewComponent。
 *
 * 视图种子取两个默认启用的内置芽（settingsStore.DEFAULT_SPROUTS 中 active: true），
 * 保证 `visibleViewsInSidebarOrder()` 的可见过滤不会把它们滤掉。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { markRaw } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePluginStore, useUIStore } from '@worldsea/entity-core'
import { useShellViewSwitch } from '../useShellViewSwitch'

function view(id: string, pluginId: string, label: string) {
  // markRaw：组件对象不参与响应式；不标记则 viewComponent 存原始对象、getView 返回代理，按引用比对不等
  return { id, label, icon: 'bulb', component: markRaw({ name: id }) as never, pluginId }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('useShellViewSwitch', () => {
  it('首页：返回 false，且不改视图/组件', () => {
    const plugins = usePluginStore()
    plugins.registerView(view('characters', 'official.characters', '角色'))
    plugins.registerView(view('timeline', 'official.timeline', '时间线'))
    const ui = useUIStore()
    ui.setView('characters')
    ui.setSurface('home')

    expect(useShellViewSwitch()(1)).toBe(false)
    expect(ui.currentView).toBe('characters')
    expect(ui.viewComponent).toBeNull()
  })

  it('工作台：按侧栏顺序前进并回绕，同步组件', () => {
    const plugins = usePluginStore()
    plugins.registerView(view('characters', 'official.characters', '角色'))
    plugins.registerView(view('timeline', 'official.timeline', '时间线'))
    const ui = useUIStore()
    ui.setView('characters')
    ui.setSurface('workspace')
    const switchViewBy = useShellViewSwitch()

    expect(switchViewBy(1)).toBe(true)
    expect(ui.currentView).toBe('timeline')
    expect(ui.viewComponent).toBe(plugins.getView('timeline')!.component)

    expect(switchViewBy(1)).toBe(true)
    expect(ui.currentView).toBe('characters')

    expect(switchViewBy(-1)).toBe(true)
    expect(ui.currentView).toBe('timeline')
  })

  it('工作台但无可见视图：返回 false 且不设视图', () => {
    const ui = useUIStore()
    ui.setSurface('workspace')

    expect(useShellViewSwitch()(1)).toBe(false)
    expect(ui.currentView).toBeNull()
  })
})
