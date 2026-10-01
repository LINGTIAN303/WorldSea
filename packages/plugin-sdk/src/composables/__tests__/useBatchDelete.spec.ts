import { describe, it, expect } from 'vitest'
import { useBatchDelete } from '../useBatchDelete'

// 2026-10-01 批量选择态改造：常驻复选框退役，「清空 ≠ 退出」为硬约定
// （清空后留在批量态可继续选；退出只能靠 toggleSelectMode / Esc）
describe('useBatchDelete 批量态', () => {
  it('初始：非批量态、空选中', () => {
    const { selecting, selectedIds } = useBatchDelete()
    expect(selecting.value).toBe(false)
    expect(selectedIds.value.size).toBe(0)
  })

  it('toggleSelectMode 往返：进出都清空选中（选中只活在批量会话内）', () => {
    const { selecting, selectedIds, toggleSelect, toggleSelectMode } = useBatchDelete()
    toggleSelect('a')
    expect(selectedIds.value.has('a')).toBe(true)

    toggleSelectMode()
    expect(selecting.value).toBe(true)
    expect(selectedIds.value.size).toBe(0)

    toggleSelect('b')
    toggleSelectMode()
    expect(selecting.value).toBe(false)
    expect(selectedIds.value.size).toBe(0)
  })

  it('clearSelection 只清空选中、不改批量态（清空 ≠ 退出）', () => {
    const { selecting, selectedIds, toggleSelect, toggleSelectMode, clearSelection } = useBatchDelete()
    toggleSelectMode()
    toggleSelect('a')
    toggleSelect('b')

    clearSelection()
    expect(selectedIds.value.size).toBe(0)
    expect(selecting.value).toBe(true)
  })

  it('toggleSelect 幂等切换单条', () => {
    const { selectedIds, toggleSelect } = useBatchDelete()
    toggleSelect('a')
    expect(selectedIds.value.has('a')).toBe(true)
    toggleSelect('a')
    expect(selectedIds.value.has('a')).toBe(false)
  })
})
