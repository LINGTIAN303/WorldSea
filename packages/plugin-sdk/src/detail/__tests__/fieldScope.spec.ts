import { describe, expect, it } from 'vitest'

import {
  buildFieldDefsPatch,
  defsAfterDemote,
  defsAfterPromote,
  ENTITY_FIELD_DEFS_KEY,
  isFieldKeyTaken,
  mergeScopedFields,
  readEntityFieldDefs,
} from '../fieldScope'
import type { DetailFieldMeta } from '../fieldMeta'
import type { Entity } from '@worldsea/entity-core'

const typeFields: DetailFieldMeta[] = [
  { key: 'age', label: '年龄', fieldType: 'text', source: 'builtin' },
  { key: 'aura', label: '光环', fieldType: 'text', source: 'user' },
]
const entityFields: DetailFieldMeta[] = [
  { key: 'hobby', label: '爱好', fieldType: 'text', source: 'user' },
  { key: 'aura', label: '重名的实体级项', fieldType: 'text', source: 'user' },
]

describe('readEntityFieldDefs —— 只认数组形态', () => {
  it('有定义时按序读回', () => {
    const e = { properties: { [ENTITY_FIELD_DEFS_KEY]: [{ key: 'hobby', label: '爱好', fieldType: 'text' }] } } as unknown as Entity
    expect(readEntityFieldDefs(e)).toEqual([{ key: 'hobby', label: '爱好', fieldType: 'text' }])
  })

  it('无定义 / 非数组 / 缺 key 一律按空处理（不猜旧串形态）', () => {
    expect(readEntityFieldDefs(null)).toEqual([])
    expect(readEntityFieldDefs({ properties: {} } as unknown as Entity)).toEqual([])
    expect(readEntityFieldDefs({ properties: { [ENTITY_FIELD_DEFS_KEY]: '[]' } } as unknown as Entity)).toEqual([])
    expect(readEntityFieldDefs({ properties: { [ENTITY_FIELD_DEFS_KEY]: [{ label: '没 key' }] } } as unknown as Entity)).toEqual([])
  })
})

describe('mergeScopedFields —— 类型级在前且同 key 以类型级为准', () => {
  it('实体级独有项追加在后，与类型级重名的被剔掉', () => {
    const merged = mergeScopedFields(typeFields, entityFields)
    expect(merged.map(f => f.key)).toEqual(['age', 'aura', 'hobby'])
    expect(merged.find(f => f.key === 'aura')?.label).toBe('光环')
  })

  it('两侧都空得到空表', () => {
    expect(mergeScopedFields([], [])).toEqual([])
  })
})

describe('buildFieldDefsPatch —— 保住兄弟字段', () => {
  it('写定义时其余 properties 原样保留（properties 是整体替换语义）', () => {
    const e = { properties: { age: '27', gender: '男' } } as unknown as Entity
    const patch = buildFieldDefsPatch(e, [{ key: 'hobby', label: '爱好', fieldType: 'text' }])
    expect(patch.properties[ENTITY_FIELD_DEFS_KEY]).toEqual([{ key: 'hobby', label: '爱好', fieldType: 'text' }])
    expect(patch.properties.age).toBe('27')
    expect(patch.properties.gender).toBe('男')
  })

  it('定义清空时该键整体移除，不留空数组', () => {
    const e = { properties: { age: '27', [ENTITY_FIELD_DEFS_KEY]: [{ key: 'x', label: 'x', fieldType: 'text' }] } } as unknown as Entity
    const patch = buildFieldDefsPatch(e, [])
    expect(ENTITY_FIELD_DEFS_KEY in patch.properties).toBe(false)
    expect(patch.properties.age).toBe('27')
  })
})

describe('作用域操作', () => {
  const defs = [{ key: 'hobby', label: '爱好', fieldType: 'text' }]

  it('isFieldKeyTaken 跨两层查重（否则两个作用域互相看不见）', () => {
    expect(isFieldKeyTaken('age', typeFields, defs)).toBe(true)
    expect(isFieldKeyTaken('hobby', typeFields, defs)).toBe(true)
    expect(isFieldKeyTaken('aura', typeFields, defs)).toBe(true)
    expect(isFieldKeyTaken('newOne', typeFields, defs)).toBe(false)
    expect(isFieldKeyTaken('  hobby  ', typeFields, defs)).toBe(true)
  })

  it('升级＝从实体定义摘掉；降级＝塞回实体定义且不重复', () => {
    expect(defsAfterPromote(defs, 'hobby')).toEqual([])
    expect(defsAfterPromote(defs, 'other')).toEqual(defs)
    expect(defsAfterDemote([], { key: 'aura', label: '光环', fieldType: 'text' })).toEqual([{ key: 'aura', label: '光环', fieldType: 'text' }])
    expect(defsAfterDemote(defs, { key: 'hobby', label: '爱好', fieldType: 'text' })).toEqual(defs)
  })
})
