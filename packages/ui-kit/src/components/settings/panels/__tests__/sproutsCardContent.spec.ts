import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { h } from 'vue'
import SproutsCardContent from '../SproutsCardContent.vue'

function mountCard() {
  return mount(SproutsCardContent, {
    props: { attentionIds: ['official.characters'] },
    global: { plugins: [createPinia()] },
    slots: {
      'sprout-detail': ({ id }: { id: string }) => h('div', { class: 'test-detail' }, id),
    },
  })
}

describe('SproutsCardContent 行内详情', () => {
  it('点击信息图标展开详情，再次点击收起', async () => {
    const w = mountCard()
    await w.find('.set-input').setValue('角色')
    const info = w.get('[aria-label="角色详情"]')
    expect(info.attributes('aria-expanded')).toBe('false')
    await info.trigger('click')
    expect(info.attributes('aria-expanded')).toBe('true')
    expect(w.get('.test-detail').text()).toBe('official.characters')
    expect(w.emitted('inspect')?.[0]).toEqual(['official.characters'])
    await info.trigger('click')
    expect(w.find('.test-detail').exists()).toBe(false)
  })

  it('同时只展开一个芽，异常芽信息图标带 warn 标记', async () => {
    const w = mountCard()
    await w.find('.set-input').setValue('角色')
    const info = w.get('[aria-label="角色详情"]')
    expect(info.classes()).toContain('warn')
    await info.trigger('click')
    await w.find('.set-input').setValue('')
    const another = w.get('[aria-label="区域图谱详情"]')
    await another.trigger('click')
    expect(w.findAll('.test-detail')).toHaveLength(1)
    expect(w.get('.test-detail').text()).toBe('official.regions')
  })
})
