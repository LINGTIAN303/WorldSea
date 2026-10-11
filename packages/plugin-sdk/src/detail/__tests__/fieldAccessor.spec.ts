import { describe, expect, it } from 'vitest'

import { buildFieldPatch, isTitleField, readFieldValue, topLevelOf } from '../fieldAccessor'
import type { Entity } from '@worldsea/entity-core'

const entity = {
  id: 'c-1',
  type: 'character',
  name: '林越',
  description: '北境斥候',
  tags: ['主角', '斥候'],
  coverImage: 'asset://a.png',
  properties: { age: '27', gender: '男', title: '不该被读到', tags: '不该被读到' },
} as unknown as Entity

describe('readFieldValue —— 顶层承载的字段读顶层', () => {
  it('title/description/tags/coverImage 走实体顶层（修「恒为 — 的幽灵行」）', () => {
    expect(readFieldValue(entity, 'title')).toBe('林越')
    expect(readFieldValue(entity, 'description')).toBe('北境斥候')
    expect(readFieldValue(entity, 'tags')).toEqual(['主角', '斥候'])
    expect(readFieldValue(entity, 'coverImage')).toBe('asset://a.png')
  })

  it('普通字段仍读 properties', () => {
    expect(readFieldValue(entity, 'age')).toBe('27')
    expect(readFieldValue(entity, 'unknownKey')).toBeUndefined()
  })

  it('空实体不炸', () => {
    expect(readFieldValue(null, 'age')).toBeUndefined()
    expect(readFieldValue(undefined, 'title')).toBeUndefined()
  })

  it('topLevelOf 只认既定的顶层键', () => {
    expect(topLevelOf('title')).toBe('name')
    expect(topLevelOf('avatar')).toBe('avatar')
    expect(topLevelOf('age')).toBeUndefined()
  })
})

describe('buildFieldPatch —— 写回必须保住兄弟字段', () => {
  it('顶层字段只发顶层键', () => {
    expect(buildFieldPatch(entity, 'description', '新描述')).toEqual({ description: '新描述' })
    expect(buildFieldPatch(entity, 'title', '改名')).toEqual({ name: '改名' })
  })

  it('properties 字段带合并后的全量（properties 是整体替换语义）', () => {
    const patch = buildFieldPatch(entity, 'age', '28') as { properties: Record<string, unknown> }
    expect(patch.properties.age).toBe('28')
    expect(patch.properties.gender).toBe('男')
    expect(patch.properties.title).toBe('不该被读到')
  })

  it('properties 缺失时也能写', () => {
    const bare = { id: 'x', type: 't', name: 'n', description: '', tags: [] } as unknown as Entity
    expect(buildFieldPatch(bare, 'age', '1')).toEqual({ properties: { age: '1' } })
  })

  it('isTitleField 用于正文去重（标题栏已承载）', () => {
    expect(isTitleField('title')).toBe(true)
    expect(isTitleField('description')).toBe(false)
  })
})
