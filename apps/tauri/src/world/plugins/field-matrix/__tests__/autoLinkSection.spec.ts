import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { autoLinkDecisionStore, clearAutoLinkEvents, recordAutoLinkEvent } from '@worldsea/entity-core'
import AutoLinkSection from '../components/AutoLinkSection.vue'

describe('AutoLinkSection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearAutoLinkEvents()
    autoLinkDecisionStore.clear()
  })

  it('渲染事件流、当前态与阶段开关', () => {
    recordAutoLinkEvent('index:start', '索引 character')
    const wrapper = mount(AutoLinkSection)
    expect(wrapper.text()).toContain('AutoLink 运转')
    expect(wrapper.text()).toContain('index:start')
    expect(wrapper.text()).toContain('索引 character')
    expect(wrapper.text()).toContain('关联建议')
    expect(wrapper.text()).toContain('自动创建实体')
    expect(wrapper.text()).toContain('潜在链接')
    expect(wrapper.text()).toContain('决策')
  })

  it('暂停后冻结事件流，继续后恢复', async () => {
    recordAutoLinkEvent('index:start', 'first')
    const wrapper = mount(AutoLinkSection)
    await wrapper.findAll('button').find(button => button.text() === '暂停')!.trigger('click')
    recordAutoLinkEvent('index:end', 'second')
    expect(wrapper.text()).toContain('first')
    expect(wrapper.text()).not.toContain('second')
    await wrapper.findAll('button').find(button => button.text() === '继续')!.trigger('click')
    expect(wrapper.text()).toContain('second')
  })
})
