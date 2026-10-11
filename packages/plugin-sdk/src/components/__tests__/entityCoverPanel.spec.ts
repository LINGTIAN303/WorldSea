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
