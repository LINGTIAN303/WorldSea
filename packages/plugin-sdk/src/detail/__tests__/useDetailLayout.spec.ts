import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import { useDetailLayout } from '../useDetailLayout'
import { DEFAULT_CONTENT_FORM } from '../detailLayout'

const FIELDS = ['a', 'b', 'c']

function mk(sprout = ref(undefined)) {
  const type = ref('character')
  const available = ref([...FIELDS])
  return { type, available, ...useDetailLayout(type, available, sprout) }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('useDetailLayout —— 读通与落盘', () => {
  it('无覆写时按可用字段原序、默认内容形态', () => {
    const { layout, visibleFieldKeys } = mk()
    expect(layout.value.order).toEqual(FIELDS)
    expect(layout.value.contentForm).toBe(DEFAULT_CONTENT_FORM)
    expect(visibleFieldKeys.value).toEqual(FIELDS)
  })

  it('setOrder 覆写落盘并即时反映（重开仍保持＝写进 localStorage）', () => {
    const { layout, setOrder } = mk()
    setOrder(['c', 'b', 'a'])
    expect(layout.value.order).toEqual(['c', 'b', 'a'])
    expect(JSON.parse(localStorage.getItem('worldsea_detail_layouts') || '{}').character.order).toEqual(['c', 'b', 'a'])
  })

  it('toggleHidden 往返：隐藏后不出现在可见字段，但仍在 order 里', () => {
    const { layout, visibleFieldKeys, toggleHidden } = mk()
    toggleHidden('b')
    expect(layout.value.hidden).toEqual(['b'])
    expect(visibleFieldKeys.value).toEqual(['a', 'c'])
    toggleHidden('b')
    expect(layout.value.hidden).toEqual([])
    expect(visibleFieldKeys.value).toEqual(FIELDS)
  })

  it('setContentForm 与 setGroups 各写各的键，互不覆盖', () => {
    const { layout, setContentForm, setGroups, setOrder } = mk()
    setContentForm('table')
    setGroups([{ key: 'g1', label: '一组', fieldKeys: ['a'] }])
    setOrder(['b', 'a', 'c'])
    expect(layout.value.contentForm).toBe('table')
    expect(layout.value.groups[0].key).toBe('g1')
    expect(layout.value.groups[0].fieldKeys).toEqual(['a'])
    expect(layout.value.order).toEqual(['b', 'a', 'c'])
  })

  it('芽默认参与合并，reset 后回到芽默认', () => {
    const sprout = ref({ order: ['b', 'c', 'a'], contentForm: 'narrative' })
    const { layout, reset, setContentForm } = mk(sprout)
    expect(layout.value.order).toEqual(['b', 'c', 'a'])
    expect(layout.value.contentForm).toBe('narrative')
    setContentForm('table')
    expect(layout.value.contentForm).toBe('table')
    reset()
    expect(layout.value.contentForm).toBe('narrative')
    expect(layout.value.order).toEqual(['b', 'c', 'a'])
  })

  it('字段新增后自动补在末尾，不被旧覆写吞掉', () => {
    const { layout, available, setOrder } = mk()
    setOrder(['c', 'a'])
    available.value = [...FIELDS, 'd']
    expect(layout.value.order).toEqual(['c', 'a', 'b', 'd'])
  })
})
