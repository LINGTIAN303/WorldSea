/**
 * 选择器的视图模式与网格虚拟化（从 useFilePickerBrowse 抽出，控制单文件规模）。
 *
 * 职责：列表/网格模式状态与持久化、导航方向（过渡方向感）、模式行高、
 * 网格列数（依赖视图层上报的主区宽度）、两种模式统一的虚拟窗口。
 * 目录数据与过滤仍归 useFilePickerBrowse，这里只消费「可见条目」。
 */

import { computed, ref } from 'vue'
import { GRID, gridColumns, gridRowCount } from '@/components/files/filePickerModel'
import type { PickerViewMode } from '@/components/files/filePickerModel'
import { loadViewMode, saveViewMode } from './filePickerRecent'

/** 列表模式行高（虚拟窗口强依赖固定值，与样式 .fp-row 高度一致） */
export const ROW_HEIGHT = 30
/** 视口外多渲染的行数（快速滚动时不露白） */
export const OVERSCAN = 6

/** 与 ui-kit computeVirtualWindow 同义的窗口区间 */
export interface VirtualWindowRange {
  start: number
  end: number
}

export function useFilePickerView(deps: {
  /** 当前可见（已过滤排序）条目数 */
  visibleCount: () => number
}) {
  /** 视图模式（持久化偏好；网格 = 大缩略图，选图场景用） */
  const viewMode = ref<PickerViewMode>(loadViewMode())

  function setViewMode(mode: PickerViewMode): void {
    viewMode.value = mode
    saveViewMode(mode)
  }

  /**
   * 最近一次导航的方向（过渡动画的方向感用）：
   * navigate = forward，goBack = back，前进/原地刷新/快捷位置跳转 = jump（纯淡入）。
   */
  const navDirection = ref<'forward' | 'back' | 'jump'>('jump')

  /** 滚动与视口（虚拟窗口输入；由视图层 onScroll / ResizeObserver 上报） */
  const scrollTop = ref(0)
  const viewportHeight = ref(400)
  const viewportWidth = ref(640)

  /** 当前模式下的虚拟行高（列表 30px 行 / 网格 122px 格） */
  const rowHeight = computed(() => (viewMode.value === 'grid' ? GRID.CELL_H : ROW_HEIGHT))

  /** 网格列数（按主区内容宽度取整） */
  const cols = computed(() => gridColumns(viewportWidth.value))

  /** 网格模式的总行数（条目按行折算；列表模式不用） */
  const gridRowsTotal = computed(() => gridRowCount(deps.visibleCount(), cols.value))

  /** 当前模式下的虚拟窗口（行号区间；列表按条目行、网格按格子行） */
  const virtualWindow = computed<VirtualWindowRange>(() => {
    const total = viewMode.value === 'grid' ? gridRowsTotal.value : deps.visibleCount()
    return computeWindow(total, scrollTop.value, viewportHeight.value, rowHeight.value)
  })

  /** 虚拟窗口切片（与 ui-kit computeVirtualWindow 同义；固定行高 + overscan） */
  function computeWindow(total: number, top: number, viewport: number, h: number): VirtualWindowRange {
    if (total <= 0) return { start: 0, end: 0 }
    const visible = Math.ceil(Math.max(1, viewport) / h)
    const first = Math.floor(Math.max(0, top) / h)
    const start = Math.max(0, Math.min(total - 1, first - OVERSCAN))
    return { start, end: Math.min(total, first + visible + OVERSCAN) }
  }

  /** 视图层滚动事件上报 */
  function onScroll(el: HTMLElement): void {
    scrollTop.value = el.scrollTop
    viewportHeight.value = el.clientHeight || viewportHeight.value
  }

  /** 视图层宽度上报（ResizeObserver） */
  function setViewportWidth(w: number): void {
    viewportWidth.value = w
  }

  /** 新请求/导航后重置滚动（保持窗口从顶部计算） */
  function resetScroll(): void {
    scrollTop.value = 0
  }

  return {
    viewMode,
    setViewMode,
    navDirection,
    rowHeight,
    cols,
    gridRowsTotal,
    virtualWindow,
    scrollTop,
    onScroll,
    setViewportWidth,
    resetScroll,
  }
}
