// EntityCardCover 响应链守卫（2026-10-05）：卡片封面必须随实体对象替换即时增删——
// 上游 useShallowArray.updateById 已改为按引用替换，这里锁定组件侧的 reactive 链
// （coverValue → useEntityImage → img）与 hasCover 的增/删两态。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import EntityCardCover from '../EntityCardCover.vue'
import PortraitRenderer from '../PortraitRenderer.vue'

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

describe('EntityCardCover —— coverSource 封面源优先级（2026-10-25 形象图批 A）', () => {
  it('勾选形象作封面：静态形象 img.src = portrait（压过 coverImage）', async () => {
    const w = mountCover({
      ...baseEntity,
      coverImage: 'https://x/cover.png',
      portrait: 'https://asset.localhost/portrait_1.png',
      portraitKind: 'static',
      coverSource: 'portrait',
    })
    await vi.waitFor(() => {
      const img = w.find('img.card-cover')
      expect(img.exists()).toBe(true)
      expect(img.attributes('src')).toBe('https://asset.localhost/portrait_1.png')
    })
  })

  it('形象存在但未勾选：仍用封面图（默认封面图）', async () => {
    const w = mountCover({
      ...baseEntity,
      coverImage: 'https://x/cover.png',
      portrait: 'https://asset.localhost/portrait_1.png',
      portraitKind: 'static',
    })
    await vi.waitFor(() => {
      expect(w.find('img.card-cover').attributes('src')).toBe('https://x/cover.png')
    })
  })

  it('模型/Lottie 形象作封面：PortraitRenderer 实时渲染（B 批接管 A 批占位）', () => {
    const w = mountCover({
      ...baseEntity,
      portrait: 'https://asset.localhost/hero.glb',
      portraitKind: 'model',
      coverSource: 'portrait',
    })
    expect(w.find('img.card-cover').exists()).toBe(false)
    expect(w.findComponent(PortraitRenderer).exists()).toBe(true)
  })

  it('形象作封面时的焦点取 portraitMeta.focus（无则回退默认）', async () => {
    const w = mountCover({
      ...baseEntity,
      coverImage: 'https://x/cover.png',
      coverPosition: '10% 90%',
      portrait: 'https://asset.localhost/portrait_1.png',
      portraitKind: 'static',
      portraitMeta: { focus: { position: '30% 40%', zoom: 2 } },
      coverSource: 'portrait',
    })
    await vi.waitFor(() => {
      const style = w.find('img.card-cover').attributes('style') ?? ''
      expect(style).toContain('30% 40%')
      expect(style).toContain('scale(2)')
    })
  })
})
