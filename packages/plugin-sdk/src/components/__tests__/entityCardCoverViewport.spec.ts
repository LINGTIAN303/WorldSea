// F3 守卫：视口感知渲染——模型/Lottie 封面离屏卸载、回视口重挂；无 IO 环境回退可见。
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import EntityCardCover from '../EntityCardCover.vue'
import PortraitRenderer from '../PortraitRenderer.vue'
import { resetInViewportObserverForTests } from '../../composables/useInViewport'

class FakeIO {
  static instances: FakeIO[] = []
  callback: IntersectionObserverCallback
  elements = new Set<Element>()
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb
    FakeIO.instances.push(this)
  }
  observe(el: Element) { this.elements.add(el) }
  unobserve(el: Element) { this.elements.delete(el) }
  disconnect() { this.elements.clear() }
  takeRecords() { return [] }
  trigger(isIntersecting: boolean) {
    this.callback(
      [...this.elements].map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    )
  }
}

const baseEntity = {
  id: 'hero-1', type: 'character', name: '凉', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
  portrait: 'https://asset.localhost/hero.glb',
  portraitKind: 'model',
  coverSource: 'portrait',
}

let wrapper: VueWrapper | undefined
let io: FakeIO

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', FakeIO)
})
afterAll(() => {
  vi.unstubAllGlobals()
})
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  resetInViewportObserverForTests()
  FakeIO.instances.length = 0
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

function mountModelCover() {
  wrapper = mount(EntityCardCover, { props: { entity: baseEntity as never, coverFieldKey: 'coverImage' } })
  return wrapper
}

describe('EntityCardCover —— 视口感知渲染（F3）', () => {
  it('模型封面初始占位；进入视口才挂载，离屏卸载，回视口重挂', async () => {
    const w = mountModelCover()
    await nextTick()
    io = FakeIO.instances[0]
    expect(io).toBeTruthy()
    // 首帧未判定前不实例化模型（避免 20+ 卡初始全部加载）
    expect(w.findComponent(PortraitRenderer).exists()).toBe(false)
    expect(w.find('.card-cover-placeholder').exists()).toBe(true)

    io.trigger(true)
    await nextTick()
    expect(w.findComponent(PortraitRenderer).exists()).toBe(true)

    io.trigger(false)
    await nextTick()
    expect(w.findComponent(PortraitRenderer).exists()).toBe(false)
    expect(w.find('.card-cover-placeholder').exists()).toBe(true)

    io.trigger(true)
    await nextTick()
    expect(w.findComponent(PortraitRenderer).exists()).toBe(true)
    expect(w.find('.card-cover-placeholder').exists()).toBe(false)
  })

  it('多张卡共享同一个 IntersectionObserver（单例多注册）', async () => {
    const w1 = mountModelCover()
    await nextTick()
    const w2 = mount(EntityCardCover, { props: { entity: { ...baseEntity, id: 'hero-2' } as never, coverFieldKey: 'coverImage' } })
    await nextTick()
    expect(FakeIO.instances).toHaveLength(1)
    expect(FakeIO.instances[0].elements.size).toBe(2)
    w1.unmount()
    w2.unmount()
    wrapper = undefined
  })
})
