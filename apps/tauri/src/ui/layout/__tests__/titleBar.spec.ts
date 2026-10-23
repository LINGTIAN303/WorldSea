import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { usePluginStore } from '@worldsea/entity-core'
import { useUIStore } from '@/stores/uiStore'

vi.mock('@/composables/useProjectSwitcher', () => ({
  useProjectSwitcher: () => ({
    switching: ref(false),
    currentProject: ref({
      id: 'p1', name: '纯真', description: '', createdAt: '2026-10-01T00:00:00Z',
      lastOpenedAt: '2026-10-01T00:00:00Z', dirPath: 'D:/world', isDefault: false,
    }),
    projectList: ref([]),
    switchProject: vi.fn(),
    refreshProjectList: vi.fn(),
  }),
}))

import TitleBar from '../TitleBar.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('TitleBar 中心标签', () => {
  it('首页显示「首页」；工作台显示当前芽名', async () => {
    const ui = useUIStore()
    const plugins = usePluginStore()
    plugins.registerView({ id: 'characters', label: '角色', icon: 'character', component: {} as never, pluginId: 'official.characters' })
    ui.setSurface('home')
    const w = mount(TitleBar, { global: { stubs: { ProjectSwitcher: true, ProjectHomeButton: true } } })
    expect(w.find('.titlebar-viewname').text()).toBe('首页')
    ui.setSurface('workspace')
    ui.setView('characters')
    await nextTick()
    expect(w.find('.titlebar-viewname').text()).toBe('角色')
  })
})

describe('TitleBar 左侧品牌位接线', () => {
  it('渲染真实 ProjectHomeButton；ProjectSwitcher 走 titlebar 变体且不渲染品牌位', () => {
    const w = mount(TitleBar)
    expect(w.find('.titlebar-home').exists()).toBe(true)
    expect(w.find('.ps-trigger').classes()).toContain('ps--titlebar')
    expect(w.find('.ps-logo').exists()).toBe(false)
    expect(w.find('.ps-title').exists()).toBe(false)
    expect(w.find('.ps-label').text()).toBe('纯真')
  })

  it('工作台点品牌按钮回首页（非桩件的真实行为）', async () => {
    const ui = useUIStore()
    ui.setSurface('workspace')
    const w = mount(TitleBar)
    await w.find('.titlebar-home').trigger('click')
    await nextTick()
    expect(ui.surface).toBe('home')
    expect(w.find('.titlebar-home').attributes('aria-current')).toBe('page')
  })
})
