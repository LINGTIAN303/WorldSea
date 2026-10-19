import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ViewSection from '../components/ViewSection.vue'
import type { MatrixView } from '../model/types'

const views: MatrixView[] = [
  { id: 'characters', label: '角色', icon: 'character', pluginId: 'official.characters', toolbar: 'bar', entityTypes: ['character'] },
  { id: 'field-matrix', label: '字段矩阵', icon: 'grid', pluginId: 'official.field-matrix', toolbar: 'bar', entityTypes: [] },
]

describe('ViewSection', () => {
  it('渲染视图与实体类型链接，无实体类型显示占位', () => {
    const wrapper = mount(ViewSection, { props: { views } })
    expect(wrapper.text()).toContain('characters')
    expect(wrapper.text()).toContain('字段矩阵')
    expect(wrapper.find('a[href="#entity-character"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('bar')
    expect(wrapper.text()).toContain('—')
  })
})
