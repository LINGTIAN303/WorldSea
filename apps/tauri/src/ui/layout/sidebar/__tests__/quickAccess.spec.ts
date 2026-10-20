import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

type QuickAccessModule = typeof import('../useQuickAccess')
let useQuickAccess: QuickAccessModule['useQuickAccess']

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  ;({ useQuickAccess } = await import('../useQuickAccess'))
})

describe('useQuickAccess', () => {
  it('收藏切换：新收藏在最前，再次切换移除', () => {
    const qa = useQuickAccess()
    qa.toggleFavorite('characters')
    qa.toggleFavorite('timeline')
    expect(qa.favorites.value).toEqual(['timeline', 'characters'])
    expect(qa.isFavorite('timeline')).toBe(true)
    qa.toggleFavorite('characters')
    expect(qa.favorites.value).toEqual(['timeline'])
    expect(qa.isFavorite('characters')).toBe(false)
  })

  it('最近访问：最新在前、去重、上限 5', () => {
    const qa = useQuickAccess()
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) qa.recordRecent(id)
    expect(qa.recent.value).toEqual(['f', 'e', 'd', 'c', 'b'])
    qa.recordRecent('d')
    expect(qa.recent.value).toEqual(['d', 'f', 'e', 'c', 'b'])
  })

  it('收藏与最近落盘并读回', async () => {
    const qa = useQuickAccess()
    qa.toggleFavorite('characters')
    qa.recordRecent('timeline')
    await nextTick()

    vi.resetModules()
    const fresh = (await import('../useQuickAccess')).useQuickAccess()
    expect(fresh.favorites.value).toEqual(['characters'])
    expect(fresh.recent.value).toEqual(['timeline'])
    expect(fresh.isFavorite('characters')).toBe(true)
  })
})
