import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RelationSection from '../components/RelationSection.vue'
import type { MatrixRelation } from '../model/types'

const relation: MatrixRelation = {
  type: 'parent_of', label: '父母',
  sourceTypes: ['character'], targetTypes: ['character'],
  inverseType: 'child_of', inverseLabel: '子女',
  symmetric: false, domain: 'person', propertyCount: 0,
}

describe('RelationSection', () => {
  it('渲染关系类型并按已注册实体生成交叉链接', () => {
    const wrapper = mount(RelationSection, {
      props: { relations: [relation], entityTypes: new Set(['character']) },
    })
    expect(wrapper.text()).toContain('parent_of')
    expect(wrapper.text()).toContain('父母')
    expect(wrapper.text()).toContain('子女')
    expect(wrapper.find('a[href="#entity-character"]').exists()).toBe(true)
  })

  it('未注册实体类型不生成链接', () => {
    const wrapper = mount(RelationSection, {
      props: { relations: [relation], entityTypes: new Set<string>() },
    })
    expect(wrapper.find('a[href="#entity-character"]').exists()).toBe(false)
  })
})
