import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { HomeDomain } from '../homeData'
import HomeAssetMap from '../HomeAssetMap.vue'

const domains: HomeDomain[] = [
  {
    id: 'life', label: '生命与族群', icon: 'species', question: '谁生活在这个世界',
    entityCount: 3, firstViewId: 'characters',
    activeSprouts: [{ id: 'official.characters', label: '角色', icon: 'character', viewId: 'characters' }],
    recentEntities: [{ id: 'c1', name: '乔', type: 'character', updatedAt: '2026-10-23T00:00:00Z', viewId: 'characters' }],
  },
  {
    id: 'goods', label: '物产与造物', icon: 'item', question: '世界里有哪些物品',
    entityCount: null, firstViewId: null, activeSprouts: [], recentEntities: [],
  },
]

describe('HomeAssetMap', () => {
  it('标题注明域计数含跨域；不再渲染无图例彩条', () => {
    const w = mount(HomeAssetMap, { props: { domains } })
    expect(w.find('.home-section-note').text()).toContain('含跨域')
    expect(w.find('.home-domain-bar').exists()).toBe(false)
  })

  it('代表芽最多 2 个，溢出显示 +N', () => {
    const domain: HomeDomain = {
      ...domains[0],
      activeSprouts: [
        { id: 'a', label: 'A', icon: 'user', viewId: 'v1' },
        { id: 'b', label: 'B', icon: 'user', viewId: 'v2' },
        { id: 'c', label: 'C', icon: 'user', viewId: 'v3' },
      ],
    }
    const w = mount(HomeAssetMap, { props: { domains: [domain] } })
    expect(w.findAll('.home-chip:not(.is-muted)')).toHaveLength(2)
    expect(w.find('.home-chip.is-muted').text()).toBe('+1')
  })

  it('渲染域卡、空域禁用、点击芽/实体/进入派发', async () => {
    const w = mount(HomeAssetMap, { props: { domains } })
    const cards = w.findAll('.home-domain')
    expect(cards).toHaveLength(2)
    expect(cards[1].classes()).toContain('is-empty')
    expect(cards[0].find('.home-domain-unit').text()).toBe('实体')
    expect(cards[1].find('.home-domain-count').text()).toBe('—')
    expect(cards[1].find('.home-domain-unit').exists()).toBe(false)
    expect(cards[1].find('.home-domain-open').attributes('disabled')).toBeDefined()

    await cards[0].find('.home-chip').trigger('click')
    expect(w.emitted('enter')?.[0]).toEqual(['characters'])

    await cards[0].find('.home-entity-link').trigger('click')
    expect(w.emitted('entity')?.[0]).toEqual(['characters', 'c1'])

    await cards[0].find('.home-domain-open').trigger('click')
    expect(w.emitted('enter')?.at(-1)).toEqual(['characters'])
    expect(cards[0].find('.home-btn-enter').exists()).toBe(false)
  })
})
