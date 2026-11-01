/**
 * 选择器的键盘导航（从 FilePickerHost 抽出，控制单文件规模）。
 *
 * 只接管方向键 / Enter / Space / Backspace / Home / End / Ctrl+A，
 * 其余键放行给搜索框与路径框。网格模式下 ↑↓ 跨一整行、←→ 邻格。
 */

import { nextTick } from 'vue'
import { gridFocusDelta } from '@/components/files/filePickerModel'
import type { PickerViewMode } from '@/components/files/filePickerModel'

export function useFilePickerKeys(deps: {
  /** 视图模式（决定方向键语义） */
  viewMode: () => PickerViewMode
  /** 网格列数 */
  cols: () => number
  /** 当前模式行高（滚动跟随用） */
  rowHeight: () => number
  /** 可见条目数（Home/End 跳转用） */
  visibleCount: () => number
  /** 当前焦点下标 */
  focusIndex: { value: number }
  /** 是否多选（Shift 区间语义只在多选下有效） */
  hasSelection: () => boolean
  /** 移动焦点 */
  moveFocus: (delta: number) => void
  /** 选中焦点（Shift 区间） */
  focusSelect: (opts: { shift?: boolean }) => void
  /** Enter：进目录或确认 */
  focusEnter: () => void
  /** 全选 */
  selectAll: () => void
  /** 返回上级 */
  goUp: () => void
  /** 清空选择（Ctrl+A 的反面：Shift+Ctrl+A 未用；保留给将来） */
  clearSelection: () => void
}) {
  /** 焦点行/格滚入视口（键盘移动后调用；虚拟窗口下只保证目标行可见） */
  function revealFocus(listEl: HTMLElement | null): void {
    if (!listEl) return
    // 列表行 = 条目行；网格 = 焦点格所在行（每行 cols 格），行高由模式决定
    const rowIndex = deps.viewMode() === 'grid'
      ? Math.floor(deps.focusIndex.value / Math.max(1, deps.cols()))
      : deps.focusIndex.value
    const top = rowIndex * deps.rowHeight()
    const bottom = top + deps.rowHeight()
    if (top < listEl.scrollTop) listEl.scrollTop = top
    else if (bottom > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = bottom - listEl.clientHeight
  }

  /** 键盘处理（绑定在列表容器上） */
  function onListKeydown(e: KeyboardEvent, listEl: HTMLElement | null): void {
    const before = deps.focusIndex.value
    const isGrid = deps.viewMode() === 'grid'
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        deps.moveFocus(isGrid ? gridFocusDelta('ArrowDown', deps.cols()) : 1)
        if (e.shiftKey) deps.focusSelect({ shift: true })
        break
      case 'ArrowUp':
        e.preventDefault()
        deps.moveFocus(isGrid ? gridFocusDelta('ArrowUp', deps.cols()) : -1)
        if (e.shiftKey) deps.focusSelect({ shift: true })
        break
      case 'ArrowLeft':
        if (!isGrid) return
        e.preventDefault()
        deps.moveFocus(gridFocusDelta('ArrowLeft', deps.cols()))
        break
      case 'ArrowRight':
        if (!isGrid) return
        e.preventDefault()
        deps.moveFocus(gridFocusDelta('ArrowRight', deps.cols()))
        break
      case 'Home':
        e.preventDefault()
        deps.moveFocus(-deps.visibleCount())
        break
      case 'End':
        e.preventDefault()
        deps.moveFocus(deps.visibleCount())
        break
      case ' ':
        // Space 只用于切换选中，不触发页面滚动
        e.preventDefault()
        deps.focusSelect({ shift: e.shiftKey })
        break
      case 'Enter':
        e.preventDefault()
        deps.focusEnter()
        break
      case 'Backspace':
        e.preventDefault()
        deps.goUp()
        break
      case 'a':
      case 'A':
        if (!e.ctrlKey && !e.metaKey) return
        e.preventDefault()
        deps.selectAll()
        break
      default:
        return
    }
    if (deps.focusIndex.value !== before) void nextTick().then(() => revealFocus(listEl))
  }

  return { revealFocus, onListKeydown }
}
