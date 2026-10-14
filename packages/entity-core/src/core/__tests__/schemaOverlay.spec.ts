/** 批 7：schema 覆盖合并器/校验器单测（口径锁死——ownFields 按 key 匹配、traits 按 traitId 合并） */
import { describe, expect, it } from 'vitest'
import { applySchemaOverlay, validateSchemaOverlay, type SchemaOverlayBase } from '../schemaOverlay'

const BASE: SchemaOverlayBase = {
  type: 'species',
  label: '物种',
  icon: 'species',
  traits: [
    { traitId: 'identifiable' },
    { traitId: 'ageable', fieldOverrides: { birthDate: { label: '起源时间' } } },
  ],
  ownFields: [
    { key: 'speciesType', label: '类型', fieldType: 'select' },
    { key: 'avgLifespan', label: '平均寿命', fieldType: 'text' },
  ],
  facets: ['weapon'],
}

describe('validateSchemaOverlay', () => {
  it('合法覆盖通过并保留全部键', () => {
    const r = validateSchemaOverlay(
      { type: 'species', label: '物种 v2', traits: [{ traitId: 'ageable' }], ownFields: [{ key: 'language', label: '语言' }] },
      'species',
    )
    expect(r.ok).toBe(true)
  })

  it('type 与文件名不一致拒绝', () => {
    const r = validateSchemaOverlay({ type: 'character' }, 'species')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('不一致')
  })

  it('未知顶层键拒绝', () => {
    const r = validateSchemaOverlay({ type: 'species', hack: 1 }, 'species')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('未知顶层键')
  })

  it('ownFields 缺 key 拒绝', () => {
    const r = validateSchemaOverlay({ type: 'species', ownFields: [{ label: '无键' }] }, 'species')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('ownFields[0].key')
  })

  it('traits 缺 traitId 拒绝', () => {
    const r = validateSchemaOverlay({ type: 'species', traits: [{ fieldOverrides: {} }] }, 'species')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('traits[0].traitId')
  })

  it('非对象顶层拒绝', () => {
    expect(validateSchemaOverlay('nope', 'species').ok).toBe(false)
    expect(validateSchemaOverlay([], 'species').ok).toBe(false)
  })
})

describe('applySchemaOverlay', () => {
  it('label/icon 覆盖，其余透传', () => {
    const out = applySchemaOverlay(BASE, { type: 'species', label: '物种 v2', icon: 'species-2' })
    expect(out.label).toBe('物种 v2')
    expect(out.icon).toBe('species-2')
    expect(out.traits).toHaveLength(2)
    expect(out.ownFields).toHaveLength(2)
    expect(out.facets).toEqual(['weapon'])
  })

  it('ownFields 同 key 整字段替换、新 key 追加（保序）', () => {
    const out = applySchemaOverlay(BASE, {
      type: 'species',
      ownFields: [
        { key: 'avgLifespan', label: '寿命（改）', fieldType: 'number' },
        { key: 'language', label: '语言', fieldType: 'text' },
      ],
    })
    expect(out.ownFields.map(f => f.key)).toEqual(['speciesType', 'avgLifespan', 'language'])
    expect(out.ownFields[1]).toEqual({ key: 'avgLifespan', label: '寿命（改）', fieldType: 'number' })
  })

  it('traits 同 traitId 的 fieldOverrides 按 fieldKey 浅合并', () => {
    const out = applySchemaOverlay(BASE, {
      type: 'species',
      traits: [{ traitId: 'ageable', fieldOverrides: { birthDate: { label: '诞生时间' }, deathDate: { label: '灭绝时间' } } }],
    })
    const ageable = out.traits.find(t => t.traitId === 'ageable')!
    expect(ageable.fieldOverrides!.birthDate!.label).toBe('诞生时间')
    expect(ageable.fieldOverrides!.deathDate!.label).toBe('灭绝时间')
  })

  it('顶层 fieldOverrides 便捷写法折进 traits（新 traitId 追加）', () => {
    const out = applySchemaOverlay(BASE, {
      type: 'species',
      fieldOverrides: { taggable: { tags: { label: '标签（改）' } } },
    })
    expect(out.traits.find(t => t.traitId === 'taggable')!.fieldOverrides!.tags!.label).toBe('标签（改）')
  })

  it('空覆盖返回等价副本且不修改内置基座（不可变语义）', () => {
    const snapshot = JSON.stringify(BASE)
    const out = applySchemaOverlay(BASE, { type: 'species' })
    expect(out).toEqual(BASE)
    expect(out).not.toBe(BASE)
    expect(JSON.stringify(BASE)).toBe(snapshot)
  })
})
