/**
 * 选择器与键盘导航的选择语义（从 useFilePickerBrowse 抽出，避免单文件超 400 行门禁）。
 *
 * 只处理「选哪些」，不碰目录读取与历史栈：调用方注入可见条目、请求参数与确认回调。
 * 单选 / Ctrl 增删 / Shift 区间 / 全选 的口径集中在这里，避免散落成多份判断。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  moveFocusIndex,
  overLimitReason,
  rangeWindow,
  selectionSummary,
  type FsEntry,
} from '@/components/files/filePickerModel'
import type { FilePickerRequest } from '@worldsea/entity-core/core'

/** 一行渲染数据：条目 + 超限原因（与视图层同名类型保持一致的结构） */
export interface SelectableRow {
  entry: FsEntry
  index: number
  limit: string | null
}

export function useFilePickerSelection(deps: {
  /** 当前可见（已过滤排序）的条目 */
  visible: ComputedRef<FsEntry[]>
  /** 当前请求（null = 面板关闭） */
  request: () => FilePickerRequest | null
  /** 目录模式：选中的是「当前目录」而非条目 */
  isDirMode: ComputedRef<boolean>
  /** 多选模式 */
  multiple: ComputedRef<boolean>
  /** 当前目录路径（目录模式确认时用） */
  currentPath: Ref<string>
  /** 焦点行下标 */
  focusIndex: Ref<number>
}) {
  const selected = ref(new Set<string>())
  /** Shift 区间锚点（最后一次非 Shift 操作的行索引；-1 = 未建立） */
  const rangeAnchor = ref(-1)

  const maxBytes = (): number | undefined => deps.request()?.maxBytes

  const summary = computed(() => selectionSummary(deps.visible.value, selected.value))

  const overLimitCount = computed(
    () => deps.visible.value.filter(e => selected.value.has(e.path) && overLimitReason(e, maxBytes())).length,
  )

  /** 目录模式恒可确认（选当前目录）；文件模式要求至少一项有效选择 */
  const canConfirm = computed(() => {
    if (!deps.request()) return false
    if (deps.isDirMode.value) return !!deps.currentPath.value
    if (summary.value.count === 0) return false
    return overLimitCount.value === 0
  })

  /** 当前选中条目的绝对路径列表 */
  const selectedPaths = computed(() => [...selected.value])

  /** 把 [from, to] 区间内的可选项并入选择（Shift 语义：保留既有选择） */
  function selectRange(from: number, to: number): void {
    const all = deps.visible.value
    const win = rangeWindow(all.length, from, to)
    if (!win) return
    const next = new Set(selected.value)
    for (let i = win.lo; i <= win.hi; i++) {
      const entry = all[i]
      // 超限文件不可选（与单选口径一致）
      if (!entry.isDir && overLimitReason(entry, maxBytes())) continue
      next.add(entry.path)
    }
    selected.value = next
  }

  /** 行点击/键盘选中（Shift = 区间，否则按 Ctrl 语义增删） */
  function onRowClick(row: SelectableRow, opts: { shift?: boolean } = {}): void {
    const prevFocus = deps.focusIndex.value
    deps.focusIndex.value = row.index
    // 目录模式与目录行：单选语义（目录不可多选，避免「选一堆文件再加一个目录」的歧义）
    if (deps.isDirMode.value || row.entry.isDir) {
      selected.value = new Set([row.entry.path])
      rangeAnchor.value = row.index
      return
    }
    if (row.limit) return
    if (!deps.multiple.value) {
      selected.value = new Set([row.entry.path])
      rangeAnchor.value = row.index
      return
    }
    if (opts.shift) {
      selectRange(rangeAnchor.value >= 0 ? rangeAnchor.value : prevFocus, row.index)
      return
    }
    const next = new Set(selected.value)
    if (next.has(row.entry.path)) next.delete(row.entry.path)
    else next.add(row.entry.path)
    selected.value = next
    rangeAnchor.value = row.index
  }

  /** 移动焦点行（clamp 到边界；滚入视口由视图层负责） */
  function moveFocus(delta: number): void {
    deps.focusIndex.value = moveFocusIndex(deps.focusIndex.value, delta, deps.visible.value.length)
  }

  /** 选中当前焦点行 */
  function focusSelect(opts: { shift?: boolean } = {}): void {
    const entry = deps.visible.value[deps.focusIndex.value]
    if (!entry) return
    if (opts.shift) {
      selectRange(rangeAnchor.value >= 0 ? rangeAnchor.value : deps.focusIndex.value, deps.focusIndex.value)
      return
    }
    onRowClick({ entry, index: deps.focusIndex.value, limit: overLimitReason(entry, maxBytes()) })
  }

  /** 全选当前可见项（跳过超限文件） */
  function selectAll(): void {
    const next = new Set<string>()
    for (const entry of deps.visible.value) {
      if (!entry.isDir && overLimitReason(entry, maxBytes())) continue
      next.add(entry.path)
    }
    selected.value = next
    rangeAnchor.value = -1
  }

  /** 清空选择 */
  function clearSelection(): void {
    selected.value = new Set()
    rangeAnchor.value = -1
  }

  /** 重置（新请求进来时） */
  function resetSelection(): void {
    clearSelection()
    deps.focusIndex.value = 0
  }

  return {
    selected,
    rangeAnchor,
    summary,
    overLimitCount,
    canConfirm,
    selectedPaths,
    selectRange,
    onRowClick,
    moveFocus,
    focusSelect,
    selectAll,
    clearSelection,
    resetSelection,
  }
}
