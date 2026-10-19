import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useFieldMatrixFilter } from '../composables/useFieldMatrixFilter'
import type { FieldMatrixModel, MatrixField } from '../model/types'

function field(overrides: Partial<MatrixField>): MatrixField {
  return {
    key: 'field', label: '字段', fieldType: 'text', required: false,
    sourceKind: 'own', sourceLabel: '芽自有', notes: [], search: 'field 字段 text 芽自有',
    ...overrides,
  }
}

const model: FieldMatrixModel = {
  entities: [{
    type: 'character', label: '角色', pluginId: 'official.characters', traits: ['identifiable'], facets: [],
    fields: [
      field({ key: 'title', label: '标题', required: true, sourceKind: 'trait', sourceLabel: 'Trait · identifiable', search: 'title 标题 text trait identifiable' }),
      field({ key: 'race', label: '种族', search: 'race 种族 text 芽自有' }),
      field({ key: 'condition', label: '状态', fieldType: 'select', sourceKind: 'own', search: 'condition 状态 select 芽自有' }),
      field({ key: 'appearance', label: '外貌', sourceKind: 'replace', sourceLabel: '芽自有 · 覆盖 physical', search: 'appearance 外貌 textarea 芽自有 覆盖 physical' }),
      field({ key: 'mood', label: '心情', sourceKind: 'user', sourceLabel: '用户自定义', search: 'mood 心情 text 用户自定义' }),
    ],
  }],
  traits: [],
  facets: [],
  relations: [],
  views: [],
  stats: { buds: 1, entities: 1, instances: 5, keys: 5, traits: 0, facets: 0 },
}

describe('useFieldMatrixFilter', () => {
  it('按中文名/字段键/实体名匹配', () => {
    const filter = useFieldMatrixFilter(ref(model))
    filter.query.value = '种族'
    expect(model.entities[0].fields.filter(field => filter.matches(model.entities[0], field)).map(field => field.key)).toEqual(['race'])
    filter.query.value = '角色'
    expect(model.entities[0].fields.filter(field => filter.matches(model.entities[0], field))).toHaveLength(5)
  })

  it('只看必填 / 只看芽自有', () => {
    const filter = useFieldMatrixFilter(ref(model))
    filter.onlyRequired.value = true
    expect(model.entities[0].fields.filter(field => filter.matches(model.entities[0], field)).map(field => field.key)).toEqual(['title'])
    filter.onlyRequired.value = false
    filter.onlyOwn.value = true
    expect(model.entities[0].fields.filter(field => filter.matches(model.entities[0], field)).map(field => field.key)).toEqual(['race', 'condition', 'appearance'])
  })

  it('类型筛选、类型选项与清空', () => {
    const filter = useFieldMatrixFilter(ref(model))
    filter.typeFilter.value = 'select'
    expect(model.entities[0].fields.filter(field => filter.matches(model.entities[0], field)).map(field => field.key)).toEqual(['condition'])
    expect(filter.typeOptions.value.map(option => option.value)).toEqual(['text', 'select'])
    filter.query.value = 'race'
    filter.typeFilter.value = 'text'
    filter.clearFilters()
    expect(filter.isFiltering.value).toBe(false)
    expect(filter.query.value).toBe('')
    expect(filter.typeFilter.value).toBe('')
  })
})
