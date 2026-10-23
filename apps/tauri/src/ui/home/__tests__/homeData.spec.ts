import { describe, expect, it } from 'vitest'
import type { Entity, PluginView, Relation, SproutToggle } from '@worldsea/entity-core'
import type { WorldPlugin } from '@/world/manifest'
import type { FieldMatrixModel } from '@/world/plugins/field-matrix/model/types'
import { buildHomeData, relativeTime, resolveContinueTarget } from '../homeData'
import type { HomeDataInput } from '../homeData'

function entity(id: string, type: string, name: string, updatedAt: string, properties: Record<string, unknown> = {}): Entity {
  return { id, type, name, description: `${name}简介`, properties, tags: [], createdAt: updatedAt, updatedAt }
}
function view(id: string, label: string, pluginId: string): PluginView {
  return { id, label, icon: 'user', component: {} as never, pluginId }
}
function plugin(id: string, domain: string, types: string[], secondaryDomains: string[] = []): WorldPlugin {
  return {
    manifest: { id, name: id, version: '1.0.0', description: id, domain, secondaryDomains, kind: 'sprout', entityTypes: types },
    apply: () => {},
  }
}
function sprout(id: string, active: boolean): SproutToggle {
  return { id, label: id.replace('official.', ''), icon: 'user', active }
}

const entities = [
  entity('c1', 'character', '乔', '2026-10-22T10:00:00.000Z'),
  entity('c2', 'character', '乔2', '2026-10-23T10:00:00.000Z'),
  entity('con1', 'concept', '设定', '2026-10-21T10:00:00.000Z'),
  entity('o1', 'outline_node', '第一章', '2026-10-20T10:00:00.000Z'),
  entity('b1', 'book', '书', '2026-10-19T10:00:00.000Z'),
  entity('m1', 'manuscript', '正文一', '2026-10-18T10:00:00.000Z', { bookId: 'b1', wordCount: 1200 }),
  entity('m2', 'manuscript', '正文二', '2026-10-17T10:00:00.000Z', { bookId: 'b1', wordCount: 800 }),
]
const relations: Relation[] = []
const sprouts = [
  sprout('official.characters', true),
  sprout('official.concepts', true),
  sprout('official.outline', true),
  sprout('official.manuscript', true),
  sprout('official.items', false),
]
const plugins = [
  plugin('official.characters', 'life', ['character']),
  plugin('official.concepts', 'knowledge', ['concept']),
  plugin('official.outline', 'narrative', ['outline_node']),
  plugin('official.manuscript', 'narrative', ['book', 'manuscript']),
  plugin('official.items', 'goods', ['item']),
]
const views = [
  view('characters', '角色', 'official.characters'),
  view('concepts', '概念', 'official.concepts'),
  view('outline', '大纲', 'official.outline'),
  view('manuscript', '正文写作', 'official.manuscript'),
]
const pluginTypes = new Map([
  ['official.characters', ['character']],
  ['official.concepts', ['concept']],
  ['official.outline', ['outline_node']],
  ['official.manuscript', ['book', 'manuscript']],
])
const typeMeta = new Map([
  ['character', { label: '角色', icon: 'character', pluginId: 'official.characters' }],
  ['concept', { label: '概念', icon: 'concept', pluginId: 'official.concepts' }],
  ['outline_node', { label: '大纲', icon: 'outline', pluginId: 'official.outline' }],
  ['book', { label: '书籍', icon: 'book', pluginId: 'official.manuscript' }],
  ['manuscript', { label: '正文', icon: 'manuscript', pluginId: 'official.manuscript' }],
])
const matrix: FieldMatrixModel = {
  entities: [
    { type: 'character', label: '角色', pluginId: 'official.characters', traits: [], facets: [], fields: [
      { key: 'name', label: '名称', fieldType: 'text', required: true, sourceKind: 'own', sourceLabel: '芽自有', notes: [], search: '' },
      { key: 'age', label: '年龄', fieldType: 'number', required: false, sourceKind: 'own', sourceLabel: '芽自有', notes: [], search: '' },
    ] },
    { type: 'concept', label: '概念', pluginId: 'official.concepts', traits: [], facets: [], fields: [
      { key: 'name', label: '名称', fieldType: 'text', required: true, sourceKind: 'own', sourceLabel: '芽自有', notes: [], search: '' },
    ] },
  ],
  traits: [],
  facets: [],
  relations: [{ type: 'knows', label: '认识', sourceTypes: ['character'], targetTypes: ['character'], inverseType: 'knows', inverseLabel: '认识', symmetric: true, propertyCount: 0 }],
  views: [],
  stats: { buds: 27, entities: 2, instances: 3, keys: 2, traits: 0, facets: 0 },
}
const base: HomeDataInput = {
  projectName: '纯真',
  profile: { version: 1, tagline: '', about: '', coverImage: '', updatedAt: null },
  entities,
  relations,
  sprouts,
  plugins,
  visibleViews: views,
  pluginTypes,
  typeMeta,
  matrix,
  preferredViewId: 'characters',
}

describe('buildHomeData', () => {
  it('域卡按启用芽计数、去重类型、未启用域为 null', () => {
    const d = buildHomeData(base)
    expect(d.domains.find(x => x.id === 'life')?.entityCount).toBe(2)
    expect(d.domains.find(x => x.id === 'knowledge')?.entityCount).toBe(1)
    expect(d.domains.find(x => x.id === 'narrative')?.entityCount).toBe(4) // 大纲 1 + 书 1 + 正文 2
    expect(d.domains.find(x => x.id === 'goods')?.entityCount).toBeNull()
    expect(d.domains.find(x => x.id === 'life')?.activeSprouts[0].viewId).toBe('characters')
    expect(d.domains.find(x => x.id === 'life')?.recentEntities.map(e => e.name)).toEqual(['乔2', '乔'])
  })

  it('最近动态按 updatedAt 倒序、只取可见类型', () => {
    expect(buildHomeData(base).recent.map(e => e.name)).toEqual(['乔2', '乔', '设定', '第一章', '书', '正文一', '正文二'])
  })

  it('近期写作：book 汇总章节与字数', () => {
    expect(buildHomeData(base).featuredBook).toMatchObject({
      id: 'b1', chapterCount: 2, wordCount: 2000, viewId: 'manuscript',
    })
  })

  it('矩阵摘要：字段数降序、关系类型数按类型计', () => {
    const rows = buildHomeData(base).matrixRows
    expect(rows[0]).toMatchObject({ type: 'character', fieldCount: 2, requiredCount: 1, relationTypeCount: 1 })
    expect(rows[0].sproutLabel).toBe('characters')
  })

  it('continue target：preferred 可见则用它，否则首项', () => {
    expect(resolveContinueTarget(views, 'outline')?.viewId).toBe('outline')
    expect(resolveContinueTarget(views, 'ghost')?.viewId).toBe('characters')
    expect(resolveContinueTarget([], 'x')).toBeNull()
  })

  it('空项目：计数 0、域卡 0（启用域）、最近空、写作 null、矩阵仍在', () => {
    const d = buildHomeData({ ...base, entities: [], relations: [], preferredViewId: null })
    expect(d.snapshot.entityCount).toBe(0)
    expect(d.snapshot.outlineCount).toBe(0)
    expect(d.domains.find(x => x.id === 'life')?.entityCount).toBe(0)
    expect(d.recent).toEqual([])
    expect(d.featuredBook).toBeNull()
    expect(d.matrixRows).toHaveLength(2)
    expect(d.tagline).toBe('尚未填写简介')
  })

  it('副域归属：secondaryDomains 命中的域同样计数（主域不变）', () => {
    const d = buildHomeData({
      ...base,
      plugins: [
        ...plugins,
        plugin('official.culture', 'knowledge', ['character'], ['life']),
      ],
      sprouts: [...sprouts, sprout('official.culture', true)],
      pluginTypes: new Map([...pluginTypes, ['official.culture', ['character']]]),
      visibleViews: [...views, view('culture', '文化', 'official.culture')],
    })
    // culture 为副域 life：life 仍按类型去重（character 只算一次），knowledge 同域类型去重（concept + character）
    expect(d.domains.find(x => x.id === 'life')?.entityCount).toBe(2)
    expect(d.domains.find(x => x.id === 'knowledge')?.entityCount).toBe(3)
    expect(d.domains.find(x => x.id === 'life')?.activeSprouts.map(s => s.id)).toContain('official.culture')
  })

  it('矩阵摘要上限 8 行（字段数降序截断）', () => {
    const manyTypes = Array.from({ length: 10 }, (_, i) => ({
      type: `t${i}`,
      label: `类型${i}`,
      pluginId: 'official.characters',
      traits: [],
      facets: [],
      fields: Array.from({ length: 10 - i }, (_, k) => ({
        key: `f${k}`,
        label: `字段${k}`,
        fieldType: 'text' as const,
        required: false,
        sourceKind: 'own' as const,
        sourceLabel: '芽自有',
        notes: [],
        search: '',
      })),
    }))
    const d = buildHomeData({ ...base, matrix: { ...matrix, entities: manyTypes } })
    expect(d.matrixRows).toHaveLength(8)
    expect(d.matrixRows[0].type).toBe('t0')
    expect(d.matrixRows.some(r => r.type === 't9')).toBe(false)
  })

  it('lastUpdatedAt 取最大 updatedAt；无实体为 null', () => {
    expect(buildHomeData(base).snapshot.lastUpdatedAt).toBe('2026-10-23T10:00:00.000Z')
    expect(buildHomeData({ ...base, entities: [] }).snapshot.lastUpdatedAt).toBeNull()
  })

  it('没有 book 时用最近正文兜底（chapterCount=1）', () => {
    const d = buildHomeData({ ...base, entities: entities.filter(e => e.type !== 'book') })
    expect(d.featuredBook).toMatchObject({
      id: 'm1', chapterCount: 1, wordCount: 1200, viewId: 'manuscript',
    })
  })

  it('无可见视图的类型不进最近动态', () => {
    // 隐去概念视图：concept 无 viewId 映射 → 最近动态不列「设定」
    const d = buildHomeData({ ...base, visibleViews: views.filter(v => v.id !== 'concepts') })
    expect(d.recent.map(e => e.name)).not.toContain('设定')
    expect(d.recent.map(e => e.name)).toContain('乔2')
    // 域内最近同样排除
    expect(d.domains.find(x => x.id === 'knowledge')?.recentEntities).toEqual([])
  })

  it('域内最近：先过滤不可跳转类型再取前 3，不被占位挤掉', () => {
    // life 域新增一个无可见视图的类型（creature），且它比角色更新
    const extra = [
      entity('cr1', 'creature', '兽一', '2026-10-23T11:00:00.000Z'),
      entity('cr2', 'creature', '兽二', '2026-10-23T11:30:00.000Z'),
      entity('cr3', 'creature', '兽三', '2026-10-23T11:45:00.000Z'),
    ]
    const d = buildHomeData({
      ...base,
      entities: [...entities, ...extra],
      plugins: [...plugins, plugin('official.creatures', 'life', ['creature'])],
      sprouts: [...sprouts, sprout('official.creatures', true)],
      pluginTypes: new Map([...pluginTypes, ['official.creatures', ['creature']]]),
    })
    expect(d.domains.find(x => x.id === 'life')?.recentEntities.map(e => e.name)).toEqual(['乔2', '乔'])
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-10-23T12:00:00.000Z')
  it('分钟/小时/昨天/日期', () => {
    expect(relativeTime('2026-10-23T11:59:30.000Z', now)).toBe('刚刚')
    expect(relativeTime('2026-10-23T11:30:00.000Z', now)).toBe('30 分钟前')
    expect(relativeTime('2026-10-23T09:00:00.000Z', now)).toBe('3 小时前')
    expect(relativeTime('2026-10-22T11:00:00.000Z', now)).toBe('昨天')
    expect(relativeTime('2026-10-20T11:00:00.000Z', now)).toBe('10-20')
  })
})
