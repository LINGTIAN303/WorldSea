import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EntityFieldTable from '../components/EntityFieldTable.vue'
import FacetSection from '../components/FacetSection.vue'
import OverviewSection from '../components/OverviewSection.vue'
import SystemSection from '../components/SystemSection.vue'
import TraitMatrixSection from '../components/TraitMatrixSection.vue'
import { SYSTEM_FIELDS } from '../model/system'
import type { MatrixEntity, MatrixFacet, MatrixField, MatrixTrait } from '../model/types'

function field(overrides: Partial<MatrixField>): MatrixField {
  return {
    key: 'field', label: '字段', fieldType: 'text', required: false,
    sourceKind: 'own', sourceLabel: '芽自有', notes: [], search: 'field 字段 text 芽自有',
    ...overrides,
  }
}

const entity: MatrixEntity = {
  type: 'character', label: '角色', pluginId: 'official.characters',
  traits: ['identifiable'], facets: [],
  fields: [
    field({ key: 'title', label: '标题', required: true, sourceKind: 'trait', sourceLabel: 'Trait · identifiable' }),
    field({ key: 'condition', label: '状态', fieldType: 'select', options: [
      { value: 'a', label: '甲' }, { value: 'b', label: '乙' }, { value: 'c', label: '丙' },
      { value: 'd', label: '丁' }, { value: 'e', label: '戊' },
    ] }),
  ],
}

const trait: MatrixTrait = {
  id: 'identifiable', label: '标识', usage: 1,
  fields: [
    { key: 'title', label: '标题', fieldType: 'text', required: true },
  ],
}

describe('字段矩阵既有区块', () => {
  it('OverviewSection 渲染统计与实体行', () => {
    const wrapper = mount(OverviewSection, {
      props: {
        stats: { buds: 1, entities: 1, instances: 2, keys: 2, traits: 1, facets: 0 },
        entities: [entity],
      },
    })
    expect(wrapper.text()).toContain('注册芽')
    expect(wrapper.text()).toContain('角色')
    expect(wrapper.text()).toContain('official.characters')
  })

  it('EntityFieldTable 渲染字段、必填、来源与选项折叠', () => {
    const wrapper = mount(EntityFieldTable, {
      props: { entity, fields: entity.fields, notify: () => {} },
    })
    expect(wrapper.text()).toContain('title')
    expect(wrapper.text()).toContain('标题')
    expect(wrapper.text()).toContain('必填')
    expect(wrapper.text()).toContain('Trait · identifiable')
    expect(wrapper.text()).toContain('5 个选项')
    expect(wrapper.find('.entity-head').exists()).toBe(true)
    expect(wrapper.find('.entity-details').exists()).toBe(false)
    expect(wrapper.find('table.field-table').exists()).toBe(true)
  })

  it('TraitMatrixSection 渲染矩阵与使用数', () => {
    const wrapper = mount(TraitMatrixSection, { props: { traits: [trait], entities: [entity] } })
    expect(wrapper.text()).toContain('identifiable')
    expect(wrapper.text()).toContain('使用数')
    expect(wrapper.text()).toContain('✓')
  })

  it('FacetSection / SystemSection 渲染字段表', () => {
    const facet: MatrixFacet = {
      id: 'weapon', label: '武器特性', hostTypes: ['item'],
      fields: [field({ key: 'weaponType', label: '武器类型', sourceKind: 'facet', sourceLabel: 'Facet · weapon' })],
    }
    const facetWrapper = mount(FacetSection, { props: { facets: [facet], notify: () => {} } })
    expect(facetWrapper.text()).toContain('武器类型')
    expect(facetWrapper.text()).toContain('weapon')

    const systemWrapper = mount(SystemSection, { props: { fields: SYSTEM_FIELDS.slice(0, 1), notify: () => {} } })
    expect(systemWrapper.text()).toContain('id')
    expect(systemWrapper.text()).toContain('实体 ID')
  })
})
