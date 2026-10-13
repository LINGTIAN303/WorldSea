import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fieldRegistry } from '../../core/FieldRegistry'
import { useFieldOrderStore } from '../fieldOrderStore'

/**
 * 命名预设的**并入不抹除**语义（2026-10-03 裁定：预设管「字段集 + 基准序」，详情覆写管呈现）。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §7.2。锁的是原实现那条破坏性副作用：
 * 应用预设先 resetToBuiltin 再只放回预设里存的字段，「存过预设之后新增的自定义字段」会凭空消失。
 */

const TYPE = 'character'

function builtin() {
  fieldRegistry.resetToBuiltin(TYPE)
  fieldRegistry.registerBuiltin(TYPE, [
    { key: 'title', label: '名称', fieldType: 'text' },
    { key: 'age', label: '年龄', fieldType: 'number' },
    { key: 'origin', label: '出身', fieldType: 'text' },
  ] as never)
}

function keys(): string[] {
  return fieldRegistry.getFields(TYPE).map(f => f.key)
}

let store: ReturnType<typeof useFieldOrderStore>

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  builtin()
  store = useFieldOrderStore()
})

describe('loadPreset —— 并入不抹除', () => {
  it('存预设后新增的自定义字段，应用预设后仍在（原实现会抹掉）', () => {
    fieldRegistry.addUserField(TYPE, { key: 'vow', label: '誓言', fieldType: 'text' } as never)
    store.savePreset(TYPE, '设定资料', ['origin', 'title', 'age', 'vow'])

    fieldRegistry.addUserField(TYPE, { key: 'sigil', label: '纹章', fieldType: 'text' } as never)
    store.loadPreset(TYPE, '设定资料')

    expect(keys()).toContain('sigil')
    expect(keys()).toContain('vow')
  })

  it('旧 localStorage 里的 customFields 快照被忽略（不复活、不新增字段）', () => {
    // 必须**先铺 localStorage 再建 store**：pinia 按实例缓存，同一实例第二次拿到的还是旧 state
    setActivePinia(createPinia())
    builtin()
    localStorage.setItem('worldsea_field_orders', JSON.stringify({
      [TYPE]: { active: '老档', presets: { '老档': {
        order: ['title', 'vow'],
        customFields: [{ key: 'vow', label: '誓言', fieldType: 'text', source: 'user' }],
      } } },
    }))
    const legacy = useFieldOrderStore()

    legacy.loadPreset(TYPE, '老档')
    expect(keys()).not.toContain('vow')
    expect(keys()).toEqual(['title', 'age', 'origin'])
  })

  it('基准序按预设排，预设没见过的现有字段补在末尾而不是被吞', () => {
    store.savePreset(TYPE, '重序', ['origin', 'age', 'title'])
    fieldRegistry.addUserField(TYPE, { key: 'sigil', label: '纹章', fieldType: 'text' } as never)

    store.loadPreset(TYPE, '重序')
    expect(keys()).toEqual(['origin', 'age', 'title', 'sigil'])
    expect(store.getActivePreset(TYPE)).toBe('重序')
  })

  it('预设里已删除的字段不复活', () => {
    fieldRegistry.addUserField(TYPE, { key: 'vow', label: '誓言', fieldType: 'text' } as never)
    store.savePreset(TYPE, '含誓', ['title', 'vow'])
    fieldRegistry.removeField(TYPE, 'vow')

    store.loadPreset(TYPE, '含誓')
    expect(keys()).not.toContain('vow')
  })

  it('resetToDefault 是明示的重置：清掉用户预设、回到芽原序', () => {
    store.savePreset(TYPE, '重序', ['origin', 'age', 'title'])
    fieldRegistry.addUserField(TYPE, { key: 'sigil', label: '纹章', fieldType: 'text' } as never)
    store.loadPreset(TYPE, '重序')

    store.resetToDefault(TYPE)
    expect(store.getPresetNames(TYPE)).toEqual([])
    expect(keys()).toEqual(['title', 'age', 'origin'])
  })
})

describe('deletePreset', () => {
  it('删掉活动预设后 active 落到剩下的那个，字段集不受影响', () => {
    store.savePreset(TYPE, '重序', ['origin', 'title', 'age'])
    const before = keys()
    store.deletePreset(TYPE, '重序')
    expect(store.getPresetNames(TYPE)).not.toContain('重序')
    expect(keys()).toEqual(before)
  })
})
