import { describe, expect, it } from 'vitest'
import {
  buildSproutInsights,
  externalDomainText,
  sproutDomainLabel,
  type SproutInsightInput,
} from '../sproutInsights'

const sprout = (id: string, active = true, source = 'builtin') => ({
  id,
  label: id,
  icon: 'bulb',
  active,
  source,
})

const plugin = (id: string, entityTypes: string[], extra: Record<string, unknown> = {}) => ({
  manifest: {
    id,
    name: `芽 ${id}`,
    version: '1.0.0',
    description: id,
    domain: 'life',
    entityTypes,
    ...extra,
  },
})

const relation = (
  type: string,
  label: string,
  sourceTypes: string[],
  targetTypes: string[],
  inverseType: string,
) => ({ type, label, sourceTypes, targetTypes, inverseType })

function makeInput(overrides: Partial<SproutInsightInput> = {}): SproutInsightInput {
  return {
    sprouts: [sprout('official.a'), sprout('official.b'), sprout('official.c')],
    plugins: [
      plugin('official.a', ['a']),
      plugin('official.b', ['b']),
      plugin('official.c', ['c']),
    ],
    relations: [],
    runtime: { plugins: ['official.a', 'official.b', 'official.c'], skipped: [], rejected: [] },
    external: [],
    views: [
      { pluginId: 'official.a' },
      { pluginId: 'official.b' },
      { pluginId: 'official.c' },
    ],
    ...overrides,
  }
}

describe('buildSproutInsights 依赖方向', () => {
  it('按声明方向聚合，自动逆关系不重复计数', () => {
    const insights = buildSproutInsights(makeInput({
      relations: [
        relation('a_to_b', 'A到B', ['a'], ['b'], 'b_to_a'),
        relation('b_to_a', 'B到A', ['b'], ['a'], 'a_to_b'),
        relation('a_to_b_2', 'A到B二', ['a'], ['b'], 'b_to_a_2'),
      ],
    }))
    const a = insights.find(item => item.id === 'official.a')!
    const b = insights.find(item => item.id === 'official.b')!
    expect(a.outgoing).toHaveLength(1)
    expect(a.outgoing[0]).toMatchObject({ pluginId: 'official.b', relations: ['A到B', 'A到B二'] })
    expect(b.incoming[0]).toMatchObject({ pluginId: 'official.a', relations: ['A到B', 'A到B二'] })
    expect(b.outgoing).toEqual([])
  })

  it('停用芽仍用 manifest 类型计算依赖', () => {
    const insights = buildSproutInsights(makeInput({
      sprouts: [sprout('official.a', false), sprout('official.b'), sprout('official.c')],
      relations: [relation('a_to_b', 'A到B', ['a'], ['b'], 'b_to_a')],
    }))
    const a = insights.find(item => item.id === 'official.a')!
    expect(a.runtime).toBe('skipped')
    expect(a.reason).toBe('未启用')
    expect(a.outgoing[0].pluginId).toBe('official.b')
  })

  it('被拒原因与无入口视图可见', () => {
    const insights = buildSproutInsights(makeInput({
      runtime: {
        plugins: ['official.b'],
        skipped: ['official.c'],
        rejected: [{ id: 'official.a', reason: '清单非法' }],
      },
      views: [{ pluginId: 'official.b' }],
    }))
    const a = insights.find(item => item.id === 'official.a')!
    const b = insights.find(item => item.id === 'official.b')!
    expect(a.runtime).toBe('rejected')
    expect(a.reason).toBe('清单非法')
    expect(b.runtime).toBe('loaded')
    expect(b.viewCount).toBe(1)
  })

  it('外部插件缺 entityTypes 时回退运行时归属，并标记依赖受限', () => {
    const insights = buildSproutInsights(makeInput({
      sprouts: [sprout('ws.ext', true, 'external'), sprout('official.b')],
      plugins: [
        // 注意：不能写 entityTypes: [] —— 空数组也属于「已声明」，不会触发运行时回退
        { manifest: {
          id: 'ws.ext',
          name: '外部芽',
          version: '1.0.0',
          description: '外部插件',
          domain: 'homebrew',
        } },
        plugin('official.b', ['b']),
      ],
      external: [{ id: 'ws.ext', status: 'loaded', domain: 'homebrew' }],
      runtimeTypeOwners: { x: 'ws.ext' },
      relations: [relation('x_to_b', 'X到B', ['x'], ['b'], 'b_to_x')],
    }))
    const ext = insights.find(item => item.id === 'ws.ext')!
    expect(ext.entityTypes).toEqual(['x'])
    expect(ext.dependencyLimited).toBe(true)
    expect(ext.outgoing[0].pluginId).toBe('official.b')
  })
})

describe('声明层补丁', () => {
  it('补回被幂等挡住的 owned_by 显式声明（仅展示层）', () => {
    const insights = buildSproutInsights(makeInput({
      sprouts: [
        sprout('official.characters'),
        sprout('official.items'),
        sprout('official.buildings'),
        sprout('official.organizations'),
      ],
      plugins: [
        plugin('official.characters', ['character']),
        plugin('official.items', ['item']),
        plugin('official.buildings', ['building']),
        plugin('official.organizations', ['organization']),
      ],
      relations: [
        relation('owns', '拥有', ['character'], ['item'], 'owned_by'),
        relation('owned_by', '被拥有', ['item'], ['character'], 'owns'),
      ],
    }))
    const items = insights.find(item => item.id === 'official.items')!
    const buildings = insights.find(item => item.id === 'official.buildings')!
    expect(items.outgoing.find(dep => dep.pluginId === 'official.characters')?.relations)
      .toContain('拥有者')
    expect(items.outgoing.find(dep => dep.pluginId === 'official.organizations')?.relations)
      .toContain('拥有者')
    expect(buildings.outgoing.find(dep => dep.pluginId === 'official.organizations')?.relations)
      .toContain('拥有者')
  })
})

describe('域标签', () => {
  it('已登记域用中文名，未声明归未分类，未知外部域原样显示', () => {
    expect(sproutDomainLabel('life')).toBe('生命与族群')
    expect(sproutDomainLabel(undefined)).toBe('未分类')
    expect(sproutDomainLabel('homebrew')).toBe('homebrew')
    expect(externalDomainText('life', ['society'])).toBe('域：生命与族群 · 副域：社会与文明')
    expect(externalDomainText(undefined)).toBe('域：未分类')
  })
})
