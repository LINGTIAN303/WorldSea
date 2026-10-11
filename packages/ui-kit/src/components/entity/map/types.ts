/**
 * RegionMap 共用类型定义
 *
 * 注：RegionEntity 此处保留 any，是为了与父组件 props.regions: any[]
 * 保持一致，避免在地图模块内引入 entity-core 的完整类型链。
 */

// 2D 点
export interface Point {
  x: number
  y: number
}

// 地图模式
export type MapMode = 'pan' | 'edit' | 'draw'

// 区域实体（保留 any 兼容性）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegionEntity = any

// 命中测试结果
export interface HitTestResult {
  region: RegionEntity
  /** >=0: 顶点索引；-1: 多边形内部；-2: 边上 */
  vertexIdx: number
  /** 当 vertexIdx === -2 时表示边的索引 */
  edgeIdx?: number
}

// Tooltip 状态
export interface TooltipState {
  show: boolean
  x: number
  y: number
  name: string
  type: string
}

// 主上下文菜单状态
export interface CtxMenuState {
  show: boolean
  x: number
  y: number
  region: RegionEntity | null
}

// 抹除上下文菜单状态
export interface EraseCtxMenuState {
  show: boolean
  x: number
  y: number
  region1: RegionEntity | null
  region2: RegionEntity | null
  sharedEdge: { startIdx1: number; startIdx2: number } | null
}

// 共享边查找结果
export interface SharedEdge {
  region1: RegionEntity
  region2: RegionEntity
  startIdx1: number
  startIdx2: number
}

// 图例项
export interface LegendItem {
  type: string
  color: string
}

// 抹除模式
export type EraseMode = 'offset' | 'redraw' | null

// 边境线模式
export type BorderlineMode = 'split' | 'augment' | null
