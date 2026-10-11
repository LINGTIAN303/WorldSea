// EntityCardCover 响应链守卫（2026-10-05）：卡片封面必须随实体对象替换即时增删——
// 上游 useShallowArray.updateById 已改为按引用替换，这里锁定组件侧的 reactive 链
// （coverValue → useEntityImage → img）与 hasCover 的增/删两态。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import EntityCardCover from '../EntityCardCover.vue'

const baseEntity = {
  id: 'bld-1', type: 'building', name: '黑鸦堡', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
}

let wrapper: VueWrapper | undefined

function mountCover(entity: Record<string, unknown>) {
  setActivePinia(createPinia())
  wrapper = mount(EntityCardCover, {
    props: { entity: entity as never, coverFieldKey: 'coverImage' },
  })
  return wrapper
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('EntityCardCover —— 封面随实体替换即时增删', () => {
  it('无封面：不渲染 img；setProps 换带封面的新实体 → img 出现', async () => {
    const w = mountCover({ ...baseEntity })
    expect(w.find('img.card-cover').exists()).toBe(false)

    await w.setProps({ entity: { ...baseEntity, coverImage: 'https://x/castle.png' } })
    await vi.waitFor(() => {
      const img = w.find('img.card-cover')
      expect(img.exists()).toBe(true)
      expect(img.attributes('src')).toBe('https://x/castle.png')
    })
  })

  it('已显示封面 → setProps 换移除封面的新实体 → img 消失', async () => {
    const w = mountCover({ ...baseEntity, coverImage: 'https://x/castle.png' })
    await vi.waitFor(() => expect(w.find('img.card-cover').exists()).toBe(true))

    await w.setProps({ entity: { ...baseEntity } })
    await vi.waitFor(() => expect(w.find('img.card-cover').exists()).toBe(false))
  })
})
