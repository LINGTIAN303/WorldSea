import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { fieldRegistry, useFieldOrderStore } from '@worldsea/entity-core'

import { useFieldPresets } from '../useFieldPresets'

/**
 * 弹窗侧预设面**只剩切换**的守卫（增删改搬到设置「实体详情」Tab）。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §7.2
 *
 * 锁两件事：切换预设确实落到 `loadPreset`（下拉不是纯装饰），
 * 以及 CRUD 没有再以第二个面回到弹窗里。
 */

function mk() {
  const store = useFieldOrderStore()
  const api = useFieldPresets({
    fields: () => [
      { key: 'name', label: '名称', type: 'text' },
      { key: 'description', label: '描述', type: 'textarea' },
      { key: 'weight', label: '重量', type: 'number' },
    ] as never,
    entityType: () => 'item',
    entity: () => null,
    fieldOrderStore: store,
    getFormData: () => ({ value: {} as Record<string, unknown> }),
  })
  return { store, api }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  fieldRegistry.resetToBuiltin()
  fieldRegistry.registerBuiltin('item', [
    { key: 'weight', label: '重量', fieldType: 'number' },
    { key: 'rarity', label: '稀有度', fieldType: 'text' },
  ] as never)
})

describe('预设切换', () => {
  it('切换 activePreset 会真的调 loadPreset（下拉不是装饰）', async () => {
    const { store, api } = mk()
    const spy = vi.spyOn(store, 'loadPreset')
    store.savePreset('item', '轻装', ['rarity', 'weight'])

    api.activePreset.value = '轻装'
    await nextTick()
    expect(spy).toHaveBeenCalledWith('item', '轻装')
    expect(fieldRegistry.getFields('item').map(f => f.key)).toEqual(['rarity', 'weight'])
  })

  it('预设选项来自 store，且没有预设时给一个「默认」占位', () => {
    const { api } = mk()
    expect(api.presetOptions.value.map(o => o.value)).toEqual(['默认'])
  })
})

describe('CRUD 已搬走', () => {
  it('弹窗面不再暴露 save/apply/delete 三个预设动作', () => {
    const { api } = mk()
    const keys = Object.keys(api)
    expect(keys).not.toContain('saveCurrentPreset')
    expect(keys).not.toContain('applyCurrentPreset')
    expect(keys).not.toContain('deleteCurrentPreset')
  })

  it('字段拖拽仍写 registry 基准序（弹窗里唯一保留的排序动作）', () => {
    const { api } = mk()
    // sortedFields = [名称, 描述, 重量, 稀有度]；把「重量」拖到「稀有度」之后
    api.onDragStart(2, { dataTransfer: null } as unknown as DragEvent)
    api.onDrop(3)
    expect(fieldRegistry.getFields('item').map(f => f.key)).toEqual(['rarity', 'weight'])
  })
})
