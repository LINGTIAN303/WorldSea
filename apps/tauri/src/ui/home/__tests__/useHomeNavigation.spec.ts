import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { markRaw, nextTick } from 'vue'
import { usePluginStore, useUIStore } from '@worldsea/entity-core'
import { useHomeNavigation } from '../useHomeNavigation'

function view(id: string, label: string, pluginId?: string) {
  // markRaw：组件对象不应被 Vue 代理；Pinia 赋值会 toRaw（Vue 3.5），
  // 不标记则 viewComponent 存原始对象、getView 返回代理，按引用比对必然不等
  return { id, label, icon: 'user', component: markRaw({}) as never, pluginId }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('useHomeNavigation', () => {
  it('显式 view：切到工作台、设视图与组件', () => {
    const plugins = usePluginStore()
    plugins.registerView(view('characters', '角色', 'official.characters'))
    const ui = useUIStore()
    ui.setSurface('home')
    const nav = useHomeNavigation()
    expect(nav.openWorkspace('characters')).toBe(true)
    expect(ui.surface).toBe('workspace')
    expect(ui.currentView).toBe('characters')
    expect(ui.viewComponent).toBe(plugins.getView('characters')!.component)
  })

  it('无显式 view：恢复 currentView', () => {
    usePluginStore().registerView(view('characters', '角色', 'official.characters'))
    const ui = useUIStore()
    ui.setView('characters')
    ui.setSurface('home')
    expect(useHomeNavigation().openWorkspace()).toBe(true)
    expect(ui.currentView).toBe('characters')
  })

  it('无 currentView：恢复 worldsea_last_view；失效则回落首项', () => {
    usePluginStore().registerView(view('characters', '角色', 'official.characters'))
    usePluginStore().registerView(view('timeline', '时间线', 'official.timeline'))
    localStorage.setItem('worldsea_last_view', 'timeline')
    const ui = useUIStore()
    ui.setSurface('home')
    expect(useHomeNavigation().openWorkspace()).toBe(true)
    expect(ui.currentView).toBe('timeline')
  })

  it('entityId：写挂起位并派发 ws-select-entity', () => {
    usePluginStore().registerView(view('characters', '角色', 'official.characters'))
    const spy = vi.spyOn(window, 'dispatchEvent')
    const ui = useUIStore()
    ui.setSurface('home')
    expect(useHomeNavigation().openWorkspace('characters', 'c1')).toBe(true)
    expect(ui.selectedEntityId).toBe('c1')
    const event = spy.mock.calls.map(([e]) => e).find(e => (e as CustomEvent).type === 'ws-select-entity') as CustomEvent
    expect(event.detail).toEqual({ entityId: 'c1' })
  })

  it('无可见视图：不切面并返回 false', () => {
    const ui = useUIStore()
    ui.setSurface('home')
    expect(useHomeNavigation().openWorkspace()).toBe(false)
    expect(ui.surface).toBe('home')
  })

  it('进入工作台后把焦点交接到 #main-content', async () => {
    usePluginStore().registerView(view('characters', '角色', 'official.characters'))
    const main = document.createElement('main')
    main.id = 'main-content'
    main.tabIndex = -1
    document.body.appendChild(main)
    try {
      useUIStore().setSurface('home')
      expect(useHomeNavigation().openWorkspace('characters')).toBe(true)
      await nextTick()
      expect(document.activeElement).toBe(main)
    } finally {
      main.remove()
    }
  })
})
