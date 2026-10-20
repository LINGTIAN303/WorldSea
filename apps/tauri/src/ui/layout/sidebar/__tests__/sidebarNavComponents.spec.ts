import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { PluginView } from '@worldsea/entity-core/types'
import DomainDual from '../DomainDual.vue'
import DomainList from '../DomainList.vue'
import DomainSidebar from '../DomainSidebar.vue'
import SproutList from '../SproutList.vue'
import WheelDomainList from '../WheelDomainList.vue'

const domains = [
  { id: 'all' as const, label: '全部', icon: 'menu', count: 2 },
  { id: 'life' as const, label: '生命与族群', icon: 'species', count: 2 },
]

const views: PluginView[] = [
  { id: 'characters', label: '角色', icon: 'character', component: {} as never, pluginId: 'official.characters' },
  { id: 'species', label: '物种', icon: 'species', component: {} as never, pluginId: 'official.species' },
]

describe('DomainList', () => {
  it('点击域按钮发出 id 与事件', async () => {
    const wrapper = mount(DomainList, { props: { domains, active: 'all' } })
    await wrapper.findAll('button')[1].trigger('click')
    const emitted = wrapper.emitted('select')!
    expect(emitted).toHaveLength(1)
    expect(emitted[0][0]).toBe('life')
    expect(emitted[0][1]).toBeInstanceOf(MouseEvent)
  })
})

describe('DomainDual', () => {
  it('域列与芽列分别发出选择事件，芽列标题跟随当前域', async () => {
    const wrapper = mount(DomainDual, {
      props: { domains, filter: 'life', views, activeId: null },
      global: { plugins: [createPinia()] },
    })
    expect(wrapper.text()).toContain('生命与族群')
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    expect(wrapper.emitted('select-domain')?.[0]?.[0]).toBe('all')
    const character = wrapper.findAll('.ws-sn-view').find(btn => btn.text().includes('角色'))!
    await character.trigger('click')
    expect(wrapper.emitted('select-view')?.[0]?.[0]).toMatchObject({ id: 'characters' })
  })
})

describe('DomainSidebar', () => {
  it('渲染域轮盘并标记当前域', () => {
    const wrapper = mount(DomainSidebar, {
      props: { side: 'right', domains, filter: 'life' },
      global: { plugins: [createPinia()] },
    })
    expect(wrapper.text()).toContain('全部')
    expect(wrapper.text()).toContain('生命与族群')
    expect(wrapper.find('.ws-split-domain.active')?.text()).toContain('生命与族群')
  })

  it('轮盘关闭时静态列出全部域并可点击选择', async () => {
    const wrapper = mount(DomainSidebar, {
      props: { side: 'left', domains, filter: 'all', wheel: false },
      global: { plugins: [createPinia()] },
    })
    expect(wrapper.findAll('.ws-split-domain')).toHaveLength(domains.length)
    expect(wrapper.find('.ws-split-carousel').classes()).toContain('is-static')
    await wrapper.findAll('.ws-split-domain')[1].trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toBe('life')
  })
})

describe('WheelDomainList', () => {
  it('点击域按钮落位并发出域 id 与鼠标事件', async () => {
    const wrapper = mount(WheelDomainList, { props: { domains, active: 'all' } })
    await wrapper.findAll('.ws-wheel-domain')[1].trigger('click')
    const emitted = wrapper.emitted('select')!
    expect(emitted).toHaveLength(1)
    expect(emitted[0][0]).toBe('life')
    expect(emitted[0][1]).toBeInstanceOf(MouseEvent)
  })
})

describe('SproutList', () => {
  it('点击芽按钮发出视图', async () => {
    const wrapper = mount(SproutList, {
      props: { views, activeId: 'characters' },
      global: { plugins: [createPinia()] },
    })
    await wrapper.findAll('button')[1].trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 'species' })
  })

  it('空列表显示空态', () => {
    const wrapper = mount(SproutList, {
      props: { views: [], activeId: null },
      global: { plugins: [createPinia()] },
    })
    expect(wrapper.text()).toContain('当前域暂无可见芽')
  })
})
