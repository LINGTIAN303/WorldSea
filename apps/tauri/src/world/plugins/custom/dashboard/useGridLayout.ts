import { computed, type Ref } from 'vue'
import type { Panel, LayoutDirection } from './types'

/**
 * 根据面板数量推导网格行列数
 * - 1: 1x1, 2: 1x2, 3: 1x3, 4: 2x2, 5-6: 2x3, 7-8: 2x4, 9+: 3x3
 */
export function getGridDims(count: number): { rows: number; cols: number } {
  if (count <= 1) return { rows: 1, cols: 1 }
  if (count === 2) return { rows: 1, cols: 2 }
  if (count === 3) return { rows: 1, cols: 3 }
  if (count === 4) return { rows: 2, cols: 2 }
  if (count <= 6) return { rows: 2, cols: 3 }
  if (count <= 8) return { rows: 2, cols: 4 }
  return { rows: 3, cols: 3 }
}

/**
 * 网格布局相关计算与模板维护
 * - gridPositions: 每个面板在网格中的位置及是否处于末行/末列
 * - gridStyle: grid-template-columns / grid-template-rows
 * - ensureGridTemplate: 当行列数变化时重置为均分
 */
export function useGridLayout(
  panels: Ref<Panel[]>,
  direction: Ref<LayoutDirection>,
  gridCols: Ref<number[]>,
  gridRows: Ref<number[]>
) {
  const gridPositions = computed(() => {
    if (direction.value !== 'grid') return []
    const dims = getGridDims(panels.value.length)
    return panels.value.map((_, idx) => ({
      col: idx % dims.cols,
      row: Math.floor(idx / dims.cols),
      isLastCol: (idx % dims.cols) === dims.cols - 1,
      isLastRow: Math.floor(idx / dims.cols) === dims.rows - 1
    }))
  })

  /** 行列数变化时，按均分重置模板（不破坏已存在的自定义比例） */
  function ensureGridTemplate() {
    const dims = getGridDims(panels.value.length)
    if (gridCols.value.length !== dims.cols) {
      gridCols.value = Array(dims.cols).fill(+(100 / dims.cols).toFixed(2))
    }
    if (gridRows.value.length !== dims.rows) {
      gridRows.value = Array(dims.rows).fill(+(100 / dims.rows).toFixed(2))
    }
  }

  const gridStyle = computed(() => {
    if (direction.value !== 'grid' || panels.value.length === 0) return {}
    const dims = getGridDims(panels.value.length)
    const cols = gridCols.value.length === dims.cols
      ? gridCols.value.map(v => v + '%').join(' ')
      : Array(dims.cols).fill(+(100 / dims.cols).toFixed(2) + '%').join(' ')
    const rows = gridRows.value.length === dims.rows
      ? gridRows.value.map(v => v + '%').join(' ')
      : Array(dims.rows).fill(+(100 / dims.rows).toFixed(2) + '%').join(' ')
    return { gridTemplateColumns: cols, gridTemplateRows: rows }
  })

  return {
    gridPositions,
    gridStyle,
    ensureGridTemplate
  }
}
