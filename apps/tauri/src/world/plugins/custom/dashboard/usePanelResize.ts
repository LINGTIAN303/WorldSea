import type { Ref } from 'vue'
import type { Panel, LayoutDirection } from './types'

/**
 * 面板 resize 逻辑
 * - 行/列布局：相邻两个面板之间拖拽分隔条调整宽度
 * - 网格布局：行/列/十字三种 resize 方式
 *
 * 注意：resize 状态使用闭包变量（非响应式），避免无谓的渲染开销
 */
export function usePanelResize(
  panels: Ref<Panel[]>,
  direction: Ref<LayoutDirection>,
  gridCols: Ref<number[]>,
  gridRows: Ref<number[]>,
  layoutRef: Ref<HTMLElement | null>,
  savePanels: () => void,
  saveGridTemplate: () => void
) {
  // ===== 行/列 resize 状态 =====
  let resizingPanelId: string | null = null
  let resizeStartX = 0
  let resizeStartY = 0
  let resizeStartWidth = 0
  let resizeNeighborWidth = 0
  let resizeNeighborId: string | null = null

  // ===== 网格 resize 状态 =====
  let gridResizingType: 'col' | 'row' | 'cross' | null = null
  let gridResizingIdx = -1
  let gridResizeStartPos = 0
  let gridResizeStartValue = 0
  let gridResizeNeighborValue = 0
  let gridCrossStartX = 0
  let gridCrossStartY = 0
  let gridCrossColIdx = -1
  let gridCrossRowIdx = -1
  let gridCrossColStart = 0
  let gridCrossColNeighbor = 0
  let gridCrossRowStart = 0
  let gridCrossRowNeighbor = 0

  /** 行/列布局：开始 resize（鼠标按下面板间的分隔条） */
  function startResize(panelId: string, e: MouseEvent) {
    e.preventDefault()
    resizingPanelId = panelId
    resizeStartX = e.clientX
    resizeStartY = e.clientY
    const panelIdx = panels.value.findIndex(p => p.id === panelId)
    const panel = panels.value[panelIdx]
    resizeStartWidth = panel?.width || 50
    if (panelIdx < panels.value.length - 1) {
      resizeNeighborId = panels.value[panelIdx + 1].id
      resizeNeighborWidth = panels.value[panelIdx + 1].width
    } else {
      resizeNeighborId = null
      resizeNeighborWidth = 0
    }
    document.addEventListener('mousemove', onResize)
    document.addEventListener('mouseup', stopResize)
  }

  function onResize(e: MouseEvent) {
    if (!resizingPanelId) return
    const container = layoutRef.value
    if (!container) return
    const isHorizontal = direction.value === 'row'
    const containerSize = isHorizontal ? container.clientWidth : container.clientHeight
    const delta = isHorizontal
      ? ((e.clientX - resizeStartX) / containerSize) * 100
      : ((e.clientY - resizeStartY) / containerSize) * 100

    const panel = panels.value.find(p => p.id === resizingPanelId)
    if (panel) {
      const newWidth = Math.max(15, Math.min(85, resizeStartWidth + delta))
      const actualDelta = newWidth - resizeStartWidth
      panel.width = newWidth

      if (resizeNeighborId) {
        const neighbor = panels.value.find(p => p.id === resizeNeighborId)
        if (neighbor) {
          neighbor.width = Math.max(15, resizeNeighborWidth - actualDelta)
        }
      }
    }
  }

  function stopResize() {
    resizingPanelId = null
    resizeNeighborId = null
    document.removeEventListener('mousemove', onResize)
    document.removeEventListener('mouseup', stopResize)
    savePanels()
  }

  /** 网格布局：开始单行或单列 resize */
  function startGridResize(type: 'col' | 'row', idx: number, e: MouseEvent) {
    e.preventDefault()
    gridResizingType = type
    gridResizingIdx = idx
    if (type === 'col') {
      gridResizeStartPos = e.clientX
      gridResizeStartValue = gridCols.value[idx]
      gridResizeNeighborValue = gridCols.value[idx + 1]
    } else {
      gridResizeStartPos = e.clientY
      gridResizeStartValue = gridRows.value[idx]
      gridResizeNeighborValue = gridRows.value[idx + 1]
    }
    document.addEventListener('mousemove', onGridResize)
    document.addEventListener('mouseup', stopGridResize)
  }

  /** 网格布局：开始十字 resize（同时调整行列） */
  function startGridCrossResize(colIdx: number, rowIdx: number, e: MouseEvent) {
    e.preventDefault()
    gridResizingType = 'cross'
    gridCrossStartX = e.clientX
    gridCrossStartY = e.clientY
    gridCrossColIdx = colIdx
    gridCrossRowIdx = rowIdx
    gridCrossColStart = gridCols.value[colIdx]
    gridCrossColNeighbor = gridCols.value[colIdx + 1]
    gridCrossRowStart = gridRows.value[rowIdx]
    gridCrossRowNeighbor = gridRows.value[rowIdx + 1]
    document.addEventListener('mousemove', onGridResize)
    document.addEventListener('mouseup', stopGridResize)
  }

  function onGridResize(e: MouseEvent) {
    if (!gridResizingType) return
    const container = layoutRef.value
    if (!container) return
    if (gridResizingType === 'col') {
      const delta = ((e.clientX - gridResizeStartPos) / container.clientWidth) * 100
      const newVal = Math.max(10, gridResizeStartValue + delta)
      const actualDelta = newVal - gridResizeStartValue
      gridCols.value[gridResizingIdx] = newVal
      gridCols.value[gridResizingIdx + 1] = Math.max(10, gridResizeNeighborValue - actualDelta)
    } else if (gridResizingType === 'row') {
      const delta = ((e.clientY - gridResizeStartPos) / container.clientHeight) * 100
      const newVal = Math.max(10, gridResizeStartValue + delta)
      const actualDelta = newVal - gridResizeStartValue
      gridRows.value[gridResizingIdx] = newVal
      gridRows.value[gridResizingIdx + 1] = Math.max(10, gridResizeNeighborValue - actualDelta)
    } else if (gridResizingType === 'cross') {
      const dx = ((e.clientX - gridCrossStartX) / container.clientWidth) * 100
      const dy = ((e.clientY - gridCrossStartY) / container.clientHeight) * 100
      const newColVal = Math.max(10, gridCrossColStart + dx)
      const colDelta = newColVal - gridCrossColStart
      gridCols.value[gridCrossColIdx] = newColVal
      gridCols.value[gridCrossColIdx + 1] = Math.max(10, gridCrossColNeighbor - colDelta)
      const newRowVal = Math.max(10, gridCrossRowStart + dy)
      const rowDelta = newRowVal - gridCrossRowStart
      gridRows.value[gridCrossRowIdx] = newRowVal
      gridRows.value[gridCrossRowIdx + 1] = Math.max(10, gridCrossRowNeighbor - rowDelta)
    }
  }

  function stopGridResize() {
    gridResizingType = null
    gridResizingIdx = -1
    document.removeEventListener('mousemove', onGridResize)
    document.removeEventListener('mouseup', stopGridResize)
    saveGridTemplate()
  }

  /** 卸载时清理所有事件监听 */
  function cleanup() {
    document.removeEventListener('mousemove', onResize)
    document.removeEventListener('mouseup', stopResize)
    document.removeEventListener('mousemove', onGridResize)
    document.removeEventListener('mouseup', stopGridResize)
  }

  return {
    startResize,
    startGridResize,
    startGridCrossResize,
    cleanup
  }
}
