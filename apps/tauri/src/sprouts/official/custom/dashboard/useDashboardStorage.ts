import type { Ref } from 'vue'
import type { Panel, LayoutDirection } from './types'
import { STORAGE_KEY } from './types'

/**
 * Dashboard localStorage 持久化
 * - 面板列表 / 方向 / 网格模板
 * - 通过传入响应式引用，使调用方与持久化逻辑解耦
 */
export function useDashboardStorage(
  panels: Ref<Panel[]>,
  direction: Ref<LayoutDirection>,
  gridCols: Ref<number[]>,
  gridRows: Ref<number[]>
) {
  /** 读取面板列表，失败返回空数组 */
  function loadPanels(): Panel[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }

  /** 写入面板列表 */
  function savePanels() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panels.value))
  }

  /** 读取布局方向，异常时回退到 'row' */
  function loadDirection(): LayoutDirection {
    try {
      const val = localStorage.getItem(STORAGE_KEY + '_dir')
      if (val === 'row' || val === 'column' || val === 'grid') return val
      return 'row'
    } catch {
      return 'row'
    }
  }

  /** 写入布局方向 */
  function saveLayout() {
    localStorage.setItem(STORAGE_KEY + '_dir', direction.value)
  }

  /** 读取网格行列模板，异常时清空 */
  function loadGridTemplate() {
    try {
      const colsRaw = localStorage.getItem(STORAGE_KEY + '_gcols')
      const rowsRaw = localStorage.getItem(STORAGE_KEY + '_grows')
      gridCols.value = colsRaw ? JSON.parse(colsRaw) : []
      gridRows.value = rowsRaw ? JSON.parse(rowsRaw) : []
    } catch {
      gridCols.value = []
      gridRows.value = []
    }
  }

  /** 写入网格行列模板 */
  function saveGridTemplate() {
    localStorage.setItem(STORAGE_KEY + '_gcols', JSON.stringify(gridCols.value))
    localStorage.setItem(STORAGE_KEY + '_grows', JSON.stringify(gridRows.value))
  }

  return {
    loadPanels,
    savePanels,
    loadDirection,
    saveLayout,
    loadGridTemplate,
    saveGridTemplate
  }
}
