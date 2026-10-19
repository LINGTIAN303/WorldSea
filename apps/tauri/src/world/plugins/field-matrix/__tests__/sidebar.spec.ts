import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MatrixSidebar from '../components/MatrixSidebar.vue'
import type { MatrixNavGroup } from '../model/nav'

const groups: MatrixNavGroup[] = [
  {
    title: '总览',
    fixed: true,
    items: [
      { id: 'overview', label: '速览' },
      { id: 'traits', label: 'Trait 矩阵' },
    ],
  },
  {
    title: '世界观测实体芽',
    items: [{ id: 'entity-character', label: '角色', meta: 'character', count: 18 }],
  },
]

describe('MatrixSidebar', () => {
  it('以页内右栏结构渲染目录、类型与计数', () => {
    const wrapper = mount(MatrixSidebar, { props: { groups, active: 'overview' } })
    expect(wrapper.find('.fm-rail').exists()).toBe(true)
    expect(wrapper.find('.sidebar').exists()).toBe(false)
    expect(wrapper.find('.fm-rail-fixed').text()).toContain('速览')
    expect(wrapper.find('.fm-rail-fixed').text()).not.toContain('角色')
    expect(wrapper.find('.fm-rail-scroll').text()).toContain('角色')
    expect(wrapper.find('.fm-rail-item.active').text()).toContain('速览')
    expect(wrapper.find('.fm-rail-item.active').attributes('aria-current')).toBe('location')
    expect(wrapper.text()).toContain('character')
    expect(wrapper.text()).toContain('18')
  })

  it('点击目录项回传目标分区', async () => {
    const wrapper = mount(MatrixSidebar, { props: { groups, active: 'overview' } })
    await wrapper.findAll('.fm-rail-item')[1].trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['traits'])
  })

  it('collapsed 时收起整列但保留内容', () => {
    const wrapper = mount(MatrixSidebar, {
      props: { groups, active: 'overview', collapsed: true },
    })
    expect(wrapper.find('.fm-rail').classes()).toContain('collapsed')
    expect(wrapper.find('.fm-rail-fixed').exists()).toBe(true)
    expect(wrapper.find('.fm-rail-scroll').exists()).toBe(true)
  })

  it('过滤后无条目时隐藏固定块并显示空提示', () => {
    const wrapper = mount(MatrixSidebar, {
      props: {
        groups: [{ title: '总览', fixed: true, items: [] }],
        active: '',
      },
    })
    expect(wrapper.find('.fm-rail-fixed').exists()).toBe(false)
    expect(wrapper.find('.fm-rail-empty').text()).toContain('没有匹配的条目')
  })
})
