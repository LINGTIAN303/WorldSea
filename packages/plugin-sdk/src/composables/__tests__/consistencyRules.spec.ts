import { describe, it, expect } from 'vitest'
import { runConsistencyChecks, type ConsistencyCheckInput } from '../consistencyRules'
import type { Entity, FieldSchema, Relation } from '@worldsea/entity-core'

// 2026-10-02 一致性检查增强：纯函数规则集单测（规则见 ../consistencyRules.ts）
// 重点回归：必填判定不得把 0/false 当缺失（旧实现 !value 误报）；字段类型经 normalizeFieldType 归一

function makeEntity(partial: Partial<Entity> & { id: string }): Entity {
  return {
    type: 'char',
    name: '',
    description: '',
    properties: {},
    tags: [],
    createdAt: '',
    updatedAt: '',
    ...partial,
  }
}

function makeRelation(partial: Partial<Relation> & { id: string; type: string; sourceId: string; targetId: string }): Relation {
  return { properties: {}, createdAt: '', updatedAt: '', ...partial }
}

function makeField(partial: Partial<FieldSchema> & { key: string }): FieldSchema {
  return { label: partial.key, fieldType: 'text', ...partial }
}

function makeInput(partial: Partial<ConsistencyCheckInput>): ConsistencyCheckInput {
  return { entities: [], relations: [], schemas: new Map(), relationTypes: new Map(), ...partial }
}

const KNOWS = { label: '认识', sourceTypes: ['char'], targetTypes: ['char'] }

describe('consistencyRules 必填判定（回归：0/false 是合法值）', () => {
  const fields: FieldSchema[] = [
    makeField({ key: 'level', label: '等级', fieldType: 'number', required: true }),
    makeField({ key: 'active', label: '启用', fieldType: 'boolean', required: true }),
    makeField({ key: 'title', label: '头衔', fieldType: 'text', required: true }),
    makeField({ key: 'rank', label: '段位', fieldType: 'select', required: true, options: [{ value: 'a', label: 'A' }] }),
    makeField({ key: 'notes', label: '备注', fieldType: 'multiSelect', required: true }),
  ]

  function input(properties: Record<string, unknown>): ConsistencyCheckInput {
    return makeInput({
      entities: [makeEntity({ id: 'e1', properties })],
      schemas: new Map([['char', { fields }]]),
    })
  }

  it('0 / false / 合法选项值不算缺失，不计入问题', () => {
    const issues = runConsistencyChecks(input({ level: 0, active: false, title: '王', rank: 'a', notes: ['x'] }))
    expect(issues.filter(i => i.category === 'missing_required')).toHaveLength(0)
  })

  it('空白字符串 / 缺键 / 空数组算缺失', () => {
    // level/active/rank 给合法值（0/false/合法选项）排除干扰，仅让 title/notes 落空
    const issues = runConsistencyChecks(input({ level: 0, active: false, rank: 'a', title: '   ', notes: [] }))
    const missing = issues.filter(i => i.category === 'missing_required').map(i => i.message)
    expect(missing).toHaveLength(2)
    expect(missing.join('\n')).toContain('头衔')
    expect(missing.join('\n')).toContain('备注')
  })
})

describe('consistencyRules 关系级检查', () => {
  const base = (): ConsistencyCheckInput =>
    makeInput({
      entities: [
        makeEntity({ id: 'e1', name: '甲', type: 'char' }),
        makeEntity({ id: 'e2', name: '乙', type: 'char' }),
      ],
      schemas: new Map([['char', { fields: [] }]]),
      relationTypes: new Map([['knows', KNOWS]]),
    })

  it('悬空关系：源/目标实体不存在各报一条 error', () => {
    const issues = runConsistencyChecks({
      ...base(),
      relations: [makeRelation({ id: 'r1', type: 'knows', sourceId: 'gone', targetId: 'e1' })],
    })
    const dangling = issues.filter(i => i.category === 'dangling_relation')
    expect(dangling).toHaveLength(1)
    expect(dangling[0].severity).toBe('error')
    expect(dangling[0].message).toContain('源实体')
    expect(dangling[0].message).toContain('gone')
  })

  it('未注册关系类型：报 warning 且不参与类型校验', () => {
    const issues = runConsistencyChecks({
      ...base(),
      relations: [makeRelation({ id: 'r1', type: 'ghost', sourceId: 'e1', targetId: 'e2' })],
    })
    expect(issues.filter(i => i.category === 'unregistered_type')).toHaveLength(1)
    expect(issues.filter(i => i.category === 'type_mismatch')).toHaveLength(0)
  })

  it('自环关系：源=目标报 warning', () => {
    const issues = runConsistencyChecks({
      ...base(),
      relations: [makeRelation({ id: 'r1', type: 'knows', sourceId: 'e1', targetId: 'e1' })],
    })
    const loops = issues.filter(i => i.category === 'self_loop')
    expect(loops).toHaveLength(1)
    expect(loops[0].severity).toBe('warning')
  })

  it('类型不匹配：目标类型不在允许集报 warning（源端合法不报）', () => {
    const issues = runConsistencyChecks({
      ...base(),
      entities: [
        makeEntity({ id: 'e1', name: '甲', type: 'char' }),
        makeEntity({ id: 'e2', name: '城', type: 'place' }),
      ],
      relations: [makeRelation({ id: 'r1', type: 'knows', sourceId: 'e1', targetId: 'e2' })],
    })
    const mismatch = issues.filter(i => i.category === 'type_mismatch')
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0].message).toContain('目标实体类型')
  })
})

describe('consistencyRules 实体级检查', () => {
  it('悬空引用：entityRef 指向不存在的实体报 error（含漂移别名 entity-ref）', () => {
    const input = makeInput({
      entities: [makeEntity({ id: 'e1', name: '甲', properties: { spouse: 'ghost-id', mentor: 'nope' } })],
      schemas: new Map([['char', { fields: [
        makeField({ key: 'spouse', label: '配偶', fieldType: 'entityRef' }),
        makeField({ key: 'mentor', label: '导师', fieldType: 'entity-ref' }),
      ] }]]),
    })
    const refs = runConsistencyChecks(input).filter(i => i.category === 'dangling_ref')
    expect(refs).toHaveLength(2)
    expect(refs[0].severity).toBe('error')
    expect(refs[0].message).toContain('ghost-id')
  })

  it('选项越界：select 值不在 options 报 warning，multiSelect 逐元素查', () => {
    const input = makeInput({
      entities: [makeEntity({ id: 'e1', name: '甲', properties: { rank: 'zz', tags: ['a', 'bad'] } })],
      schemas: new Map([['char', { fields: [
        makeField({ key: 'rank', label: '段位', fieldType: 'select', options: [{ value: 'a', label: 'A' }] }),
        makeField({ key: 'tags', label: '标签', fieldType: 'multiSelect', options: [{ value: 'a', label: 'A' }] }),
      ] }]]),
    })
    const invalid = runConsistencyChecks(input).filter(i => i.category === 'invalid_select')
    expect(invalid).toHaveLength(2)
    expect(invalid.map(i => i.message).join('\n')).toContain('zz')
    expect(invalid.map(i => i.message).join('\n')).toContain('bad')
  })

  it('重名：同类型 trim+忽略大小写分组，跨类型不误报', () => {
    const input = makeInput({
      entities: [
        makeEntity({ id: 'e1', name: 'Alice ', type: 'char' }),
        makeEntity({ id: 'e2', name: 'alice', type: 'char' }),
        makeEntity({ id: 'e3', name: 'Alice', type: 'place' }),
        makeEntity({ id: 'e4', name: 'unique', type: 'char' }),
      ],
      schemas: new Map([['char', { fields: [] }]]),
    })
    const dup = runConsistencyChecks(input).filter(i => i.category === 'duplicate_name')
    expect(dup).toHaveLength(2)
    expect(dup.every(i => i.severity === 'warning')).toBe(true)
  })

  it('空白名称：报 error，且不参与重名分组', () => {
    const input = makeInput({
      entities: [
        makeEntity({ id: 'e1', name: '  ' }),
        makeEntity({ id: 'e2', name: '' }),
      ],
      schemas: new Map([['char', { fields: [] }]]),
    })
    const empty = runConsistencyChecks(input).filter(i => i.category === 'empty_name')
    expect(empty).toHaveLength(2)
    expect(empty.every(i => i.severity === 'error')).toBe(true)
    expect(runConsistencyChecks(input).filter(i => i.category === 'duplicate_name')).toHaveLength(0)
  })

  it('孤立实体：无任何关系报 info', () => {
    const issues = runConsistencyChecks(makeInput({
      entities: [makeEntity({ id: 'e1', name: '甲' })],
      schemas: new Map([['char', { fields: [] }]]),
    }))
    const orphan = issues.filter(i => i.category === 'orphan_entity')
    expect(orphan).toHaveLength(1)
    expect(orphan[0].severity).toBe('info')
  })
})
