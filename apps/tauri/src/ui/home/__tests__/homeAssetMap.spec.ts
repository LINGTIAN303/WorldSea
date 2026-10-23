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
  it('渲染域卡、空域禁用、点击芽/实体/进入派发', async () => {
    const w = mount(HomeAssetMap, { props: { domains } })
    const cards = w.findAll('.home-domain')
    expect(cards).toHaveLength(2)
    expect(cards[1].classes()).toContain('is-empty')
    expect(cards[1].find('.home-domain-count').text()).toBe('—')
    expect(cards[1].find('button.home-btn-enter').attributes('disabled')).toBeDefined()

    await cards[0].find('.home-chip').trigger('click')
    expect(w.emitted('enter')?.[0]).toEqual(['characters'])

    await cards[0].find('.home-entity-link').trigger('click')
    expect(w.emitted('entity')?.[0]).toEqual(['characters', 'c1'])

    await cards[0].find('button.home-btn-enter').trigger('click')
    expect(w.emitted('enter')?.at(-1)).toEqual(['characters'])
  })
})
