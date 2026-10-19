import { describe, expect, it } from 'vitest'
import { buildMatrixModel } from '../buildMatrixModel'
import type { FieldMatrixSources } from '../types'

const sources: FieldMatrixSources = {
  schemas: [{
    type: 'character',
    label: '角色',
    pluginId: 'official.characters',
    traits: [{ traitId: 'identifiable' }],
    ownFields: [
      { key: 'age', label: '年龄', fieldType: 'text' },
      { key: 'notes', label: '备注', fieldType: 'textarea', required: true },
    ],
    facets: [],
    _compiledFields: [],
    _traitIds: ['identifiable'],
  }],
  traits: [{
    id: 'identifiable',
    label: '标识',
    fields: [
      { key: 'title', label: '标题', fieldType: 'text', required: true },
      { key: 'description', label: '描述', fieldType: 'textarea' },
    ],
  }],
  facets: [],
  relations: [{
    type: 'parent_of',
    label: '父母',
    sourceTypes: ['character'],
    targetTypes: ['character'],
    inverseType: 'child_of',
    inverseLabel: '子女',
    symmetric: false,
    domain: 'person',
  }],
  views: [{
    id: 'characters',
    label: '角色',
    icon: 'character',
    component: {} as never,
    pluginId: 'official.characters',
    toolbar: 'bar',
  }],
  userFields: () => [{ key: 'mood', label: '心情', fieldType: 'text' }],
}

describe('buildMatrixModel', () => {
  it('合并 Trait + ownFields + 用户字段，并保留来源', () => {
    const model = buildMatrixModel(sources)
    const entity = model.entities.find(item => item.type === 'character')!
    expect(entity.fields.map(field => field.key)).toEqual(['title', 'description', 'age', 'notes', 'mood'])
    expect(entity.fields.find(field => field.key === 'title')?.sourceKind).toBe('trait')
    expect(entity.fields.find(field => field.key === 'notes')?.required).toBe(true)
    expect(entity.fields.find(field => field.key === 'mood')?.sourceLabel).toBe('用户自定义')
  })

  it('统计与关系/视图映射', () => {
    const model = buildMatrixModel(sources)
    expect(model.stats.entities).toBe(1)
    expect(model.stats.instances).toBe(5)
    expect(model.relations[0]).toMatchObject({ type: 'parent_of', label: '父母' })
    expect(model.views[0]).toMatchObject({ id: 'characters', entityTypes: ['character'] })
    expect(model.traits[0]).toMatchObject({ id: 'identifiable', usage: 1 })
  })

  it('应用 fieldOverrides，并让同 key 的自有字段覆盖 Trait 字段', () => {
    const overridden = buildMatrixModel({
      ...sources,
      schemas: [{
        ...sources.schemas[0],
        traits: [{
          traitId: 'identifiable',
          fieldOverrides: { description: { label: '简介' } },
        }],
        ownFields: [{ key: 'description', label: '覆盖描述', fieldType: 'textarea' }],
      }],
      userFields: () => [],
    })
    const entity = overridden.entities[0]
    const description = entity.fields.find(field => field.key === 'description')!
    expect(description.label).toBe('覆盖描述')
    expect(description.sourceKind).toBe('replace')
    expect(description.notes.join(' ')).toContain('覆盖同名 trait 字段')
  })
})
