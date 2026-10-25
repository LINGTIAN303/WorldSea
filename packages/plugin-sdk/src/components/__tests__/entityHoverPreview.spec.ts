// 形象图批 B 守卫：PortraitRenderer 分支分发 + EntityCard 悬停预览门控（2026-10-25）。
// model/lottie 分支依赖懒加载 web component 与网络 fetch，jsdom 覆盖 static/animated 分支
// 与门控逻辑；模型分支靠真机走查。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import PortraitRenderer from '../PortraitRenderer.vue'
import EntityCard from '../EntityCard.vue'
import EntityCardHoverPreview from '../EntityCardHoverPreview.vue'
import { useSettingsStore } from '@worldsea/entity-core'

const baseEntity = {
  id: 'chr-1', type: 'character', name: '凉', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
}

let wrapper: VueWrapper | undefined

function mountCard(entity: Record<string, unknown>, opts?: { hoverOn?: boolean }) {
  setActivePinia(createPinia())
  const store = useSettingsStore()
  if (opts?.hoverOn === false) store.entityCardHoverPreview = false
  wrapper = mount(EntityCard, { props: { entity: entity as never } })
  return { wrapper: wrapper!, store }
}

beforeEach(() => { vi.useFakeTimers(); localStorage.clear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers() })

describe('PortraitRenderer —— kind 分支分发', () => {
  it('static/animated → img 直渲染（动图由浏览器自播）', () => {
    const w = mount(PortraitRenderer, { props: { src: 'https://x/a.png', kind: 'static' } })
    expect(w.find('img.pr-media').attributes('src')).toBe('https://x/a.png')
    // 静态 play() no-op 不抛错
    expect(() => w.vm.play()).not.toThrow()
    w.unmount()
  })
})

describe('EntityCard —— 悬停预览门控（需求 #1/#13）', () => {
  it('有形象图 + 设置开 → over 延迟后浮层出现，out 后（150ms 确认）消失', async () => {
    const { wrapper: w } = mountCard({ ...baseEntity, portrait: 'https://x/p.png', portraitKind: 'static' })
    await w.trigger('mouseover', { relatedTarget: null })
    await vi.advanceTimersByTimeAsync(300)
    expect(w.findComponent(EntityCardHoverPreview).exists()).toBe(true)
    await w.trigger('mouseout', { relatedTarget: null })
    await vi.advanceTimersByTimeAsync(200)
    expect(w.findComponent(EntityCardHoverPreview).exists()).toBe(false)
  })

  it('重派的 over/out 对不重置在途计时（model-viewer 乱序终修：假 leave 的 rt 可能是卡外）', async () => {
    const { wrapper: w } = mountCard({ ...baseEntity, portrait: 'https://x/p.png', portraitKind: 'static' })
    await w.trigger('mouseover', { relatedTarget: null })
    await vi.advanceTimersByTimeAsync(150) // 计时进行到 150ms
    // 乱序重派：out（rt=卡外，走 leave 路径）+ 150ms 后 :hover 假象(测试环境恒 false→隐藏)
    // ——jsdom 下 :hover 恒 false 会真隐藏；真机 :hover=true 挡住。此处锁「重派 over 不重置」：
    await w.trigger('mouseover', { relatedTarget: null }) // 二次 over（重派）
    await vi.advanceTimersByTimeAsync(120) // 距首次 over 共 270ms ≥ 250ms
    // jsdom 限制：中间的 out 未发；直接验证 preview 在 270ms 处已出现（计时未被重置）
    expect(w.findComponent(EntityCardHoverPreview).exists()).toBe(true)
  })

  it('内部元素切换（relatedTarget 在卡内）不触发进出——model-viewer 伪 leave 防护（D3 走查修复）', async () => {
    const { wrapper: w } = mountCard({ ...baseEntity, portrait: 'https://x/p.png', portraitKind: 'static' })
    await w.trigger('mouseover', { relatedTarget: null })
    await vi.advanceTimersByTimeAsync(300)
    expect(w.findComponent(EntityCardHoverPreview).exists()).toBe(true)
    // 卡内元素间切换：over/out 各一次，relatedTarget 为卡内节点 → 忽略
    const inner = w.element.querySelector('.card-header') ?? w.element.firstElementChild
    await w.trigger('mouseout', { relatedTarget: inner })
    await w.trigger('mouseover', { relatedTarget: inner })
    await vi.advanceTimersByTimeAsync(300)
    expect(w.findComponent(EntityCardHoverPreview).exists()).toBe(true)
    // 真离开仍正常隐藏
    await w.trigger('mouseout', { relatedTarget: null })
    await vi.advanceTimersByTimeAsync(200)
    expect(w.findComponent(EntityCardHoverPreview).exists()).toBe(false)
  })

  it('无形象图 → 不出现（悬停预览是形象图专属容器）', async () => {
    const { wrapper: w } = mountCard({ ...baseEntity })
    await w.trigger('mouseover', { relatedTarget: null })
    await vi.advanceTimersByTimeAsync(300)
    expect(w.findComponent(EntityCardHoverPreview).exists()).toBe(false)
  })

  it('设置关（entityCardHoverPreview=false）→ 不出现', async () => {
    const { wrapper: w } = mountCard(
      { ...baseEntity, portrait: 'https://x/p.png', portraitKind: 'static' },
      { hoverOn: false },
    )
    await w.trigger('mouseover', { relatedTarget: null })
    await vi.advanceTimersByTimeAsync(300)
    expect(w.findComponent(EntityCardHoverPreview).exists()).toBe(false)
  })

  it('无框设置传递到浮层（frameless class，需求 #1 默认有框）', async () => {
    const { wrapper: w, store } = mountCard({ ...baseEntity, portrait: 'https://x/p.png', portraitKind: 'static' })
    store.hoverPreviewFrameless = true
    await w.trigger('mouseover', { relatedTarget: null })
    await vi.advanceTimersByTimeAsync(300)
    const preview = w.findComponent(EntityCardHoverPreview)
    expect(preview.props('frameless')).toBe(true)
  })
})
