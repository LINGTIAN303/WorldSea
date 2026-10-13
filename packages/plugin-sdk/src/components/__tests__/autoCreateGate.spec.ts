/**
 * 建实体入口子开关门控护栏（2026-10-07）
 * 实体引用控件按 autoCreateEntityRefEnabled、关系选择器按 autoCreateSelectorEnabled：
 * 关闭时「+ 创建」入口不出现。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { getProjectManager, registerSettingsApi } from '@worldsea/entity-core'
import EntityRefControl from '../../detail/EntityRefControl.vue'
import EntityRelationSelector from '../EntityRelationSelector.vue'

const flags = { entityRef: ref(true), selector: ref(true) }

beforeEach(async () => {
  setActivePinia(createPinia())
  flags.entityRef.value = true
  flags.selector.value = true
  registerSettingsApi({
    get autoCreateEntityEnabled() { return true },
    get autoCreateEntityRefEnabled() { return flags.entityRef.value },
    get autoCreateSelectorEnabled() { return flags.selector.value },
    get undoHistoryLimit() { return 20 },
    get highlight_spreadHops() { return 3 },
    get highlight_dimmingEnabled() { return false },
  })
  await getProjectManager().initialize()
})

describe('建实体入口子开关门控', () => {
  it('EntityRefControl：开关关 → 入口消失；开 → 入口出现', async () => {
    flags.entityRef.value = false
    const w = mount(EntityRefControl, {
      props: { modelValue: '', label: '来源', editing: true },
    })
    await w.find('input').trigger('focus')
    await w.find('input').setValue('不存在的实体')
    await nextTick()
    expect(w.find('.erf-create').exists()).toBe(false)

    flags.entityRef.value = true
    await nextTick()
    expect(w.find('.erf-create').exists()).toBe(true)
  })

  it('EntityRelationSelector：开关关 → 入口消失；开 → 入口出现', async () => {
    flags.selector.value = false
    const w = mount(EntityRelationSelector, {
      props: { entityId: 'gate-probe' },
    })
    await w.find('.rel-s-input').setValue('不存在的实体')
    await nextTick()
    expect(w.find('.rel-s-create-hint').exists()).toBe(false)

    flags.selector.value = true
    await nextTick()
    expect(w.find('.rel-s-create-hint').exists()).toBe(true)
  })
})
