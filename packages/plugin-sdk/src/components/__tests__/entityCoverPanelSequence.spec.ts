// F4 守卫：模型动作序列配置——有序标签追加/移除，保留单动作绑定，序列优先。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('../AssetField.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'AssetField',
      props: { value: String, kind: String, category: String },
      setup(_, { expose }) {
        expose({ availableAnimations: ['Come', 'Idleshow'] })
        return () => h('div', { class: 'asset-field-stub' })
      },
    }),
  }
})

import EntityCoverPanel from '../EntityCoverPanel.vue'

const modelEntity = {
  id: 'chr-1', type: 'character', name: '剑', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
  portrait: 'http://asset.localhost/hero.glb', portraitKind: 'model',
} as never

let wrapper: VueWrapper | undefined
let updateSpy: ReturnType<typeof vi.fn>

beforeEach(async () => {
  localStorage.clear()
  setActivePinia(createPinia())
  const store = (await import('@worldsea/entity-core')).useEntityStore()
  updateSpy = vi.spyOn(store, 'update').mockResolvedValue(undefined)
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

async function mountPanel(entity: Record<string, unknown>) {
  wrapper = mount(EntityCoverPanel, { props: { entity: entity as never } })
  await nextTick()
  return wrapper
}

describe('EntityCoverPanel —— 模型动作序列（F4）', () => {
  it('从下拉追加动作：写序列并保留 hover/click 绑定', async () => {
    const w = await mountPanel({
      ...modelEntity,
      portraitMeta: { model: { hover: 'Come', click: 'random' } },
    })
    const select = w.find('.ecp-seq-add select')
    expect(select.exists()).toBe(true)
    await select.setValue('Idleshow')
    expect(updateSpy).toHaveBeenCalledWith('chr-1', {
      portraitMeta: {
        model: { hover: 'Come', click: 'random', sequence: ['Idleshow'] },
      },
    })
  })

  it('已有序列显示有序标签；点标签移除并写回', async () => {
    const w = await mountPanel({
      ...modelEntity,
      portraitMeta: { model: { sequence: ['Come', 'Idleshow'] } },
    })
    const tags = w.findAll('.ecp-seq-tag')
    expect(tags.map((t) => t.text())).toEqual(['Come×', 'Idleshow×'])

    await tags[0].trigger('click')
    expect(updateSpy).toHaveBeenCalledWith('chr-1', {
      portraitMeta: { model: { sequence: ['Idleshow'] } },
    })
  })

  it('非模型类不显示序列配置', async () => {
    const w = await mountPanel({
      ...modelEntity,
      portraitKind: 'animated',
      portrait: 'http://x/a.gif',
    })
    expect(w.find('.ecp-seq-add').exists()).toBe(false)
    expect(w.find('.ecp-seq-tag').exists()).toBe(false)
  })
})
