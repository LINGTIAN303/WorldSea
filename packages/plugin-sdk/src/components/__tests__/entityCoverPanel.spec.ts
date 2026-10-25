// EntityCoverPanel（详情「封面」Tab 内容件）守卫：变更即时持久化为**顶层**补丁。
// coverImage 是顶层承载字段（fieldAccessor.TOP_LEVEL_FIELD），不走 properties、不走编辑态草稿——
// 旧弹窗路径写 properties.coverImage 是死值，本 spec 锁定 Tab 写顶层这一条路（2026-10-05）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useEntityStore } from '@worldsea/entity-core'

import EntityCoverPanel from '../EntityCoverPanel.vue'
import ImageField from '../ImageField.vue'
import AssetField from '../AssetField.vue'

const entity = {
  id: 'bld-1', type: 'building', name: '黑鸦堡', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
} as never

let wrapper: VueWrapper | undefined

function mountPanel() {
  setActivePinia(createPinia())
  const store = useEntityStore()
  const spy = vi.spyOn(store, 'update').mockResolvedValue(undefined)
  wrapper = mount(EntityCoverPanel, { props: { entity } })
  return { wrapper, spy }
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('EntityCoverPanel —— 封面 Tab 即时持久化（顶层补丁）', () => {
  it('ImageField update:value → 顶层 coverImage；null（移除）归一为空串清空', () => {
    const { wrapper: w, spy } = mountPanel()
    w.findComponent(ImageField).vm.$emit('update:value', 'https://x/castle.png')
    expect(spy).toHaveBeenCalledWith('bld-1', { coverImage: 'https://x/castle.png' })
    w.findComponent(ImageField).vm.$emit('update:value', null)
    expect(spy).toHaveBeenLastCalledWith('bld-1', { coverImage: '' })
  })

  it('焦点/缩放 → coverPosition / coverZoom 顶层补丁', () => {
    const { wrapper: w, spy } = mountPanel()
    w.findComponent(ImageField).vm.$emit('update:coverPosition', '30% 40%')
    w.findComponent(ImageField).vm.$emit('update:coverZoom', 1.5)
    expect(spy).toHaveBeenCalledWith('bld-1', { coverPosition: '30% 40%' })
    expect(spy).toHaveBeenCalledWith('bld-1', { coverZoom: 1.5 })
  })
})

describe('EntityCoverPanel —— 形象图区（2026-10-25 形象图批 A）', () => {
  it('AssetField 上传 → 顶层 portrait + portraitKind', () => {
    const { wrapper: w, spy } = mountPanel()
    w.findComponent(AssetField).vm.$emit('update:value', 'https://asset.localhost/p_1.png')
    expect(spy).toHaveBeenCalledWith('bld-1', { portrait: 'https://asset.localhost/p_1.png' })
    w.findComponent(AssetField).vm.$emit('update:kind', 'static')
    expect(spy).toHaveBeenCalledWith('bld-1', { portraitKind: 'static' })
  })

  it('勾选「形象图作为卡片封面」→ coverSource=portrait；取消 → image', async () => {
    setActivePinia(createPinia())
    const store = useEntityStore()
    const spy = vi.spyOn(store, 'update').mockResolvedValue(undefined)
    wrapper = mount(EntityCoverPanel, {
      props: {
        entity: { ...entity, portrait: 'https://asset.localhost/p_1.png', portraitKind: 'static' },
      },
    })
    const box = wrapper.find('.ecp-check input')
    expect((box.element as HTMLInputElement).disabled).toBe(false)
    await box.setValue(true)
    expect(spy).toHaveBeenCalledWith('bld-1', { coverSource: 'portrait' })
    await box.setValue(false)
    expect(spy).toHaveBeenLastCalledWith('bld-1', { coverSource: 'image' })
  })

  it('移除形象图（null）→ portrait 清空；正作封面时 coverSource 回退 image', () => {
    // 直接用「正在作封面」的实体挂载（props.entity 是共享常量，构造新对象）
    setActivePinia(createPinia())
    const store = useEntityStore()
    const spy = vi.spyOn(store, 'update').mockResolvedValue(undefined)
    wrapper = mount(EntityCoverPanel, {
      props: {
        entity: {
          ...entity,
          portrait: 'https://asset.localhost/p_1.png',
          portraitKind: 'static',
          coverSource: 'portrait',
        },
      },
    })
    wrapper.findComponent(AssetField).vm.$emit('update:value', null)
    expect(spy).toHaveBeenCalledWith('bld-1', { portrait: '', coverSource: 'image' })
  })
})
