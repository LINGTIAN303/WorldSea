import { describe, expect, it } from 'vitest'
import type { PluginView } from '@worldsea/entity-core/types'
import { buildDomainMap, buildSproutNavigation, filterForView, filterViewsByDomain, makeDomainOfPlugin } from '../sproutNavigation'
import { normalizeSproutDomainFilter, normalizeSproutNavMode } from '@/stores/uiStore'

function view(id: string, pluginId: string): PluginView {
  return { id, label: id, icon: 'circle', component: {} as never, pluginId }
}

const views = [
  view('characters', 'official.characters'),
  view('species', 'official.species'),
  view('timeline', 'official.timeline'),
  view('outline', 'official.outline'),
  view('field-matrix', 'official.field-matrix'),
  view('ws.external', 'ws.external'),
]

const domainMap = buildDomainMap([
  { manifest: { id: 'official.characters', domain: 'life' } },
  { manifest: { id: 'official.species', domain: 'life' } },
  { manifest: { id: 'official.timeline', domain: 'time' } },
  { manifest: { id: 'official.outline', domain: 'narrative' } },
  { manifest: { id: 'official.field-matrix', domain: 'tool' } },
])
const domainOf = makeDomainOfPlugin(domainMap)

describe('buildSproutNavigation', () => {
  it('「全部」第一项，只列有可见芽的域；unclassified 只在全部出现', () => {
    const nav = buildSproutNavigation(views, domainOf, 'all')
    expect(nav.domains[0]).toEqual({ id: 'all', label: '全部', icon: 'menu', count: 6 })
    expect(nav.domains.map(domain => domain.id)).toEqual(['all', 'life', 'time', 'narrative', 'tool'])
    expect(nav.domains.find(domain => domain.id === 'life')?.count).toBe(2)
    expect(nav.views).toHaveLength(6)
    expect(nav.views.some(item => item.id === 'ws.external')).toBe(true)
  })

  it('域过滤只保留该域视图，且保持 sidebarOrder 传入顺序', () => {
    const nav = buildSproutNavigation(views, domainOf, 'life')
    expect(nav.views.map(item => item.id)).toEqual(['characters', 'species'])
    expect(nav.domains.map(domain => domain.id)).toEqual(['all', 'life', 'time', 'narrative', 'tool'])
  })

  it('域内无可见芽时该域不出现；全部仍可用', () => {
    const onlyLife = views.slice(0, 2)
    const nav = buildSproutNavigation(onlyLife, domainOf, 'time')
    expect(nav.domains.map(domain => domain.id)).toEqual(['all', 'life'])
    expect(nav.views).toEqual([])
  })
})

describe('filterViewsByDomain', () => {
  it('all 返回全量；域过滤只留该域；unclassified 不进入域列表', () => {
    expect(filterViewsByDomain(views, 'all', domainOf)).toHaveLength(6)
    expect(filterViewsByDomain(views, 'life', domainOf).map(view => view.id)).toEqual(['characters', 'species'])
    expect(filterViewsByDomain(views, 'time', domainOf).map(view => view.id)).toEqual(['timeline'])
    expect(filterViewsByDomain(views, 'life', domainOf).some(view => view.id === 'ws.external')).toBe(false)
  })
})

describe('filterForView', () => {
  it('有域名返回域名；unclassified 返回 all', () => {
    expect(filterForView(views[0], domainOf)).toBe('life')
    expect(filterForView(views[5], domainOf)).toBe('all')
    expect(filterForView(null, domainOf)).toBe('all')
  })
})

describe('导航状态归一', () => {
  it('未知形态 → flat；未知域 → all', () => {
    expect(normalizeSproutNavMode('rail')).toBe('rail')
    expect(normalizeSproutNavMode('nope')).toBe('flat')
    expect(normalizeSproutDomainFilter('life')).toBe('life')
    expect(normalizeSproutDomainFilter('nope')).toBe('all')
  })
})
