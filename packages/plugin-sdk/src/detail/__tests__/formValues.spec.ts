import { describe, it, expect } from 'vitest'
import type { Entity } from '@worldsea/entity-core'
import {
  displayOf,
  fieldFamily,
  groupsOf,
  narrativeSections,
  orderedVisibleFields,
  shortChips,
  textOfField,
  timelinePoints,
  valueOfField,
} from '../formValues'
import type { DetailFieldMeta } from '../fieldMeta'

/**
 * 内容形态的归类与取数（纯函数层）。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 */

const F = (key: string, fieldType: string, label = key): DetailFieldMeta => ({ key, label, fieldType })

const ENTITY = {
  id: 'e1',
  type: 'character',
  name: '林渊',
  description: '少年剑客\n\n守夜人首领',
  tags: ['剑客', '守夜人'],
  properties: { species: '人族', born: '1420-03-01', master: 'e2', mood: '', photo: '/img/lin.png' },
} as unknown as Entity

const SRC = { entity: ENTITY, draft: {}, editing: false }

describe('fieldFamily —— 形态靠归类编排，不靠字段名硬编码', () => {
  it('长文本族含 textarea 与 richtext', () => {
    expect(fieldFamily(F('description', 'textarea'))).toBe('long')
    expect(fieldFamily(F('lore', 'richText'))).toBe('long')
  })

  it('date 类型与约定时间 key 都算时间族（trait 给的日期是 text + 约定 key）', () => {
    expect(fieldFamily(F('born', 'date'))).toBe('time')
    expect(fieldFamily(F('birthDate', 'text'))).toBe('time')
    expect(fieldFamily(F('createdAt', 'text'))).toBe('time')
  })

  it('其余归短字段族', () => {
    expect(fieldFamily(F('species', 'text'))).toBe('short')
    expect(fieldFamily(F('tags', 'tags'))).toBe('short')
  })
})

describe('orderedVisibleFields / groupsOf', () => {
  const fields = [F('title', 'text'), F('species', 'text'), F('born', 'date'), F('mood', 'text')]

  it('按 order 排、跳过隐藏项与标题与不存在的 key，未进 order 的新字段补在末尾（不凭空消失）', () => {
    expect(orderedVisibleFields(fields, { order: ['born', 'ghost', 'species'], hidden: ['mood'] })
      .map(f => f.key)).toEqual(['born', 'species'])
    // 新增字段（title 除外）没进 order 时补末尾，不会静默消失
    expect(orderedVisibleFields([...fields, F('age', 'number')], { order: ['born'], hidden: [] })
      .map(f => f.key)).toEqual(['born', 'species', 'mood', 'age'])
  })

  it('order 未覆盖的字段补末尾', () => {
    const out = orderedVisibleFields(fields, { order: ['species'], hidden: [] })
    expect(out.map(f => f.key)).toEqual(['species', 'born', 'mood'])
  })

  it('漏在组外的字段进「其它」，跨组重复的 key 只留第一次', () => {
    const groups = groupsOf(fields.filter(f => f.key !== 'title'), [
      { key: 'g1', label: '基本', fieldKeys: ['species', 'born'] },
      { key: 'g2', label: '重复组', fieldKeys: ['born'] },
    ])
    expect(groups.map(g => g.key)).toEqual(['g1', '__other'])
    expect(groups[0].fields.map(f => f.key)).toEqual(['species', 'born'])
    expect(groups[1].fields.map(f => f.key)).toEqual(['mood'])
  })
})

describe('取值与展示文本', () => {
  it('编辑态读草稿（含 `_` 前缀方言），非编辑态读实体', () => {
    expect(valueOfField(F('title', 'text'), { ...SRC, editing: true, draft: { _name: '改名' } })).toBe('改名')
    expect(valueOfField(F('species', 'text'), SRC)).toBe('人族')
    expect(valueOfField(F('tags', 'tags'), SRC)).toEqual(['剑客', '守夜人'])
  })

  it('空值统一「—」，布尔统一「是/否」，数组并读', () => {
    expect(textOfField(F('mood', 'text'), SRC)).toBe('—')
    expect(displayOf(F('alive', 'boolean'), false)).toBe('否')
    expect(textOfField(F('tags', 'tags'), SRC)).toBe('剑客、守夜人')
  })

  it('entityRef 解成实体名；解不出说实话，绝不退回裸 ID（1a 缺陷的复活路径）', () => {
    const ref = F('master', 'entityRef', '师父')
    expect(displayOf(ref, 'e2', id => (id === 'e2' ? '沈砚' : undefined))).toBe('沈砚')
    expect(displayOf(ref, 'e2')).toBe('引用已失效')
    expect(displayOf(ref, '', () => '沈砚')).toBe('—')
  })

  it('image 字段在只读形态里报「已配图」而不是路径串', () => {
    expect(textOfField(F('photo', 'image'), SRC)).toBe('已配图')
  })
})

describe('三种派生编排的数据形状', () => {
  const fields = [
    F('species', 'text', '种族'),
    F('mood', 'text', '心情'),
    F('description', 'textarea', '描述'),
    F('born', 'date', '出生'),
    F('createdAt', 'text', '创建时间'),
  ]

  it('摘要式只收短字段，空值标出来给上层滤', () => {
    const chips = shortChips(fields, SRC)
    expect(chips.map(c => c.key)).toEqual(['species', 'mood'])
    expect(chips.find(c => c.key === 'mood')?.empty).toBe(true)
  })

  it('段落式只收长文本、剥标签、可按配置排除描述段', () => {
    const withDesc = narrativeSections([...fields, F('lore', 'richText')], SRC, true)
    expect(withDesc.map(s => s.key)).toEqual(['description', 'lore'])
    expect(narrativeSections(fields, { ...SRC, entity: { ...ENTITY, description: '<p>带标签的正文</p>' } as Entity }, true)[0].text).toBe('带标签的正文')
    expect(narrativeSections(fields, SRC, false)).toEqual([])
  })

  it('时间轴式跳过空日期，创建时间默认不入轴', () => {
    expect(timelinePoints(fields, SRC, false).map(p => p.key)).toEqual(['born'])
    const withCreated = { ...SRC, entity: { ...ENTITY, properties: { ...ENTITY.properties, createdAt: '2026-10-02' } } as Entity }
    expect(timelinePoints(fields, withCreated, false).map(p => p.key)).toEqual(['born'])
    expect(timelinePoints(fields, withCreated, true).map(p => p.key)).toEqual(['born', 'createdAt'])
  })
})
