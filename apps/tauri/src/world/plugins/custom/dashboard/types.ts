/**
 * DashboardView 相关共用类型
 */

/** 单个面板的运行时数据结构 */
export interface Panel {
  id: string
  viewId: string
  icon: string
  label: string
  width: number
}

/** 布局方向：水平 / 垂直 / 网格 */
export type LayoutDirection = 'row' | 'column' | 'grid'

/** localStorage 持久化的根 key */
export const STORAGE_KEY = 'worldsea_dashboard'
