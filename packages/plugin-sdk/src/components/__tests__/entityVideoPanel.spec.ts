// 形象图批 C 守卫（2026-10-25）：视频 Tab 面板写顶层字段 + 卡片封面 video 分支三档播放。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import EntityVideoPanel from '../EntityVideoPanel.vue'
import AssetField from '../AssetField.vue'
import EntityCardCover from '../EntityCardCover.vue'
import { useCardVideoScrollPause } from '../../composables/useCardVideoScrollPause'
import { useEntityStore, useSettingsStore } from '@worldsea/entity-core'

const baseEntity = {
  id: 'bld-1', type: 'building', name: '黑鸦堡', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
}

let wrapper: VueWrapper | undefined

beforeEach(() => { localStorage.clear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('EntityVideoPanel —— 视频 Tab 顶层字段（#14/#15）', () => {
  it('上传 → videoAsset；勾选 → coverSource=video；取消 → image', async () => {
    setActivePinia(createPinia())
    const store = useEntityStore()
    const spy = vi.spyOn(store, 'update').mockResolvedValue(undefined)
    wrapper = mount(EntityVideoPanel, { props: { entity: { ...baseEntity, videoAsset: 'http://asset.localhost/v.mp4' } as never } })

    await wrapper.find('.evp-check input').setValue(true)
    expect(spy).toHaveBeenCalledWith('bld-1', { coverSource: 'video' })
    await wrapper.find('.evp-check input').setValue(false)
    expect(spy).toHaveBeenLastCalledWith('bld-1', { coverSource: 'image' })
  })

  it('移除视频（null）→ videoAsset 清空；正作封面时回退 image', () => {
    setActivePinia(createPinia())
    const store = useEntityStore()
    const spy = vi.spyOn(store, 'update').mockResolvedValue(undefined)
    wrapper = mount(EntityVideoPanel, {
      props: { entity: { ...baseEntity, videoAsset: 'http://asset.localhost/v.mp4', coverSource: 'video' } as never },
    })
    wrapper.findComponent(AssetField).vm.$emit('update:value', null)
    expect(spy).toHaveBeenCalledWith('bld-1', { videoAsset: '', coverSource: 'image' })
  })
})

describe('EntityCardCover —— 视频封面三档播放（#15/#16/#17/#18）', () => {
  function mountCover(entity: Record<string, unknown>) {
    setActivePinia(createPinia())
    wrapper = mount(EntityCardCover, { props: { entity: entity as never, coverFieldKey: 'coverImage' } })
    return wrapper
  }

  it('coverSource=video → 渲染 video 而非 img；off 档不自动播放', () => {
    const w = mountCover({ ...baseEntity, videoAsset: 'http://asset.localhost/v.mp4', coverSource: 'video' })
    expect(w.find('video.card-cover').exists()).toBe(true)
    expect(w.find('video.card-cover').attributes('autoplay')).toBeUndefined()
    w.unmount()
  })

  it('all 档 → autoplay；selected 档仅列表内实体 autoplay', async () => {
    const w = mountCover({ ...baseEntity, videoAsset: 'http://asset.localhost/v.mp4', coverSource: 'video' })
    const settings = useSettingsStore()
    settings.videoCoverAutoplay = 'all'
    await nextTick()
    expect(w.find('video.card-cover').attributes('autoplay')).toBeDefined()
    settings.videoCoverAutoplay = 'selected'
    await nextTick()
    expect(w.find('video.card-cover').attributes('autoplay')).toBeUndefined()
    settings.videoCoverAutoplayEntities = ['bld-1']
    await nextTick()
    expect(w.find('video.card-cover').attributes('autoplay')).toBeDefined()
    w.unmount()
  })

  it('视频源优先于形象与封面图（互斥枚举 video > portrait > image）', () => {
    const w = mountCover({
      ...baseEntity,
      coverImage: 'https://x/c.png',
      portrait: 'http://asset.localhost/p.png',
      portraitKind: 'static',
      videoAsset: 'http://asset.localhost/v.mp4',
      coverSource: 'video',
    })
    expect(w.find('video.card-cover').exists()).toBe(true)
    expect(w.find('img.card-cover').exists()).toBe(false)
    w.unmount()
  })

  it('滚动暂停（批 C 走查追加）：scrolling 中暂停，停止后按档位恢复', async () => {
    const { scrolling } = useCardVideoScrollPause()
    const w = mountCover({ ...baseEntity, videoAsset: 'http://asset.localhost/v.mp4', coverSource: 'video' })
    const settings = useSettingsStore()
    settings.videoCoverAutoplay = 'all'
    await nextTick()
    // jsdom 的 video 无真实播放态——守卫 shouldPlay 逻辑：scrolling 置真后 v.pause 被调（spy video 元素）
    const v = w.find('video.card-cover').element as HTMLVideoElement
    const pauseSpy = vi.spyOn(v, 'pause')
    const playSpy = vi.spyOn(v, 'play').mockResolvedValue(undefined)
    scrolling.value = true
    await nextTick()
    expect(pauseSpy).toHaveBeenCalled()
    scrolling.value = false
    await nextTick()
    expect(playSpy).toHaveBeenCalled() // all 档恢复播放
    settings.videoCoverAutoplay = 'off'
    w.unmount()
  })
})
