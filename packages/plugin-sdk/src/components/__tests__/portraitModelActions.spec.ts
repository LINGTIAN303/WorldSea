// 形象图批 D2 守卫（2026-10-25）：模型动作绑定——面板写 portraitMeta.model、
// play(trigger) 按绑定选动作（pickAction 纯逻辑经组件实例验证；model-viewer 真机走查覆盖）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import EntityCoverPanel from '../EntityCoverPanel.vue'
import AssetField from '../AssetField.vue'
import PortraitRenderer from '../PortraitRenderer.vue'

const baseEntity = {
  id: 'chr-1', type: 'character', name: '剑', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
  portrait: 'http://asset.localhost/hero.glb', portraitKind: 'model',
} as never

let wrapper: VueWrapper | undefined

beforeEach(() => { localStorage.clear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('PortraitRenderer —— play(trigger) 动作绑定（#7/#12/#13）', () => {
  it('animated 分支 play 无 lottie 实例不抛错；static no-op', () => {
    const w = mount(PortraitRenderer, { props: { src: 'https://x/a.gif', kind: 'animated' } })
    expect(() => w.vm.play('click')).not.toThrow()
    w.unmount()
  })
})

describe('EntityCoverPanel —— 模型动作配置区（D2）', () => {
  it('portraitKind=model 时显示两个动作下拉；选择写 portraitMeta.model', async () => {
    setActivePinia(createPinia())
    const store = (await import('@worldsea/entity-core')).useEntityStore()
    const spy = vi.spyOn(store, 'update').mockResolvedValue(undefined)
    wrapper = mount(EntityCoverPanel, { props: { entity: { ...baseEntity } } })

    const rows = wrapper.findAll('.ecp-action-row')
    expect(rows.length).toBe(2)
    expect(rows[0].text()).toContain('悬停时播放')
    expect(rows[1].text()).toContain('点击时播放')

    // jsdom 无真实模型加载（动作清单空），用恒存在的「随机动作」锁写路径；
    // 指定动作的选项渲染与写值逻辑同构（:value 绑定同一 onActionChange）
    const hoverSelect = rows[0].find('select')
    await hoverSelect.setValue('random')
    expect(spy).toHaveBeenCalledWith('chr-1', {
      portraitMeta: { model: { hover: 'random' } },
    })
  })

  it('非模型类不显示动作配置下拉（区域动效区同容器 class，以行断言）', () => {
    setActivePinia(createPinia())
    wrapper = mount(EntityCoverPanel, {
      props: { entity: { ...baseEntity, portraitKind: 'animated', portrait: 'http://x/a.gif' } },
    })
    expect(wrapper.find('.ecp-action-row').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('悬停时播放')
  })

  it('AssetField 透传 availableAnimations（computed 空数组兜底）', () => {
    setActivePinia(createPinia())
    wrapper = mount(EntityCoverPanel, { props: { entity: { ...baseEntity } } })
    expect(wrapper.findComponent(AssetField).vm.availableAnimations).toEqual([])
  })
})
