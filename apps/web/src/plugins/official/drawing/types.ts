import type { Entity } from '@worldsmith/entity-core'

/** 画板实体 */
export interface DrawingEntity extends Entity {
  type: 'drawing'
  properties: {
    /** 画布数据（dataURL 或 JSON） */
    canvasData: string
    /** 画布宽度 */
    width: number
    /** 画布高度 */
    height: number
    /** 背景色 */
    backgroundColor: string
    /** 图层数据（JSON 序列化） */
    layers: string
    /** 当前活跃图层索引 */
    activeLayerIndex: number
    /** 缩放比例 */
    zoom: number
    /** 平移 X */
    panX: number
    /** 平移 Y */
    panY: number
    /** 缩略图 dataURL */
    thumbnail: string
  }
}

/** 图层定义 */
export interface DrawingLayer {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  /** 图层画布数据（dataURL） */
  data: string
}

/** 绘图工具类型 */
export type DrawingTool = 'brush' | 'eraser' | 'line' | 'rect' | 'circle' | 'arrow' | 'text' | 'select'

/** 形状填充模式 */
export type FillMode = 'none' | 'solid' | 'stroke'
