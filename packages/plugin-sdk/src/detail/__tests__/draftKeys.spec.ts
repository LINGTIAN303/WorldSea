import { describe, expect, it } from 'vitest'

import { draftKeyOf, draftValue, splitDraft } from '../draftKeys'
import type { Entity } from '@worldsea/entity-core'

const entity = {
  id: 'c-1', type: 'character', name: '林越', description: '北境斥候', tags: ['主角'],
  coverImage: 'asset://a.png', properties: { age: '27', title: '幽灵值' },
} as unknown as Entity

describe('draftKeyOf —— schema 方言 ↔ 草稿方言', () => {
  it('顶层字段有专门草稿键', () => {
    expect(draftKeyOf('title')).toBe('_name')
    expect(draftKeyOf('description')).toBe('_description')
    expect(draftKeyOf('tags')).toBe('_tags')
    expect(draftKeyOf('coverZoom')).toBe('_coverZoom')
  })

  it('properties 字段同名', () => {
    expect(draftKeyOf('age')).toBe('age')
  })
})

describe('draftValue —— 取值的优先级', () => {
  it('草稿里有就用草稿（编辑中的未保存值）', () => {
    expect(draftValue({ _name: '改名中' }, entity, 'title')).toBe('改名中')
    expect(draftValue({ age: '28' }, entity, 'age')).toBe('28')
  })

  it('草稿没给时回落实体顶层，而不是掉进 properties', () => {
    expect(draftValue({}, entity, 'title')).toBe('林越')
    expect(draftValue({}, entity, 'tags')).toEqual(['主角'])
  })

  it('properties 字段回落 properties', () => {
    expect(draftValue({}, entity, 'age')).toBe('27')
    expect(draftValue({}, entity, 'ghost')).toBeUndefined()
  })

  it('草稿显式空串仍算「有值」（清空字段不该被当成未编辑）', () => {
    expect(draftValue({ age: '' }, entity, 'age')).toBe('')
  })

  it('空实体不炸', () => {
    expect(draftValue({}, null, 'title')).toBeUndefined()
  })
})

describe('splitDraft —— 保存切分', () => {
  it('顶层草稿键回写实体顶层，其余进 properties', () => {
    const { topLevel, properties } = splitDraft({ _name: '林越', _description: '新描述', _tags: ['主角', '斥候'], age: '28' })
    expect(topLevel).toEqual({ name: '林越', description: '新描述', tags: ['主角', '斥候'] })
    expect(properties).toEqual({ age: '28' })
  })

  it('非本方言的下划线内部键不污染 properties', () => {
    const { properties } = splitDraft({ _undoHint: 'x', age: '1' })
    expect(properties).toEqual({ age: '1' })
  })

  it('自定义字段定义不再随实体落库（改走类型级 fieldRegistry）', () => {
    const { properties } = splitDraft({ __customFieldDefs: '[{"key":"x"}]', age: '1' })
    expect(properties.__customFieldDefs).toBeUndefined()
  })
})
