export interface CanvasNode {
  id: string
  name: string
  type: string
  x: number
  y: number
  vx: number
  vy: number
  fx: number | null
  fy: number | null
  width: number
  height: number
  color: string
  icon: string
  label: string
  tags: string[]
  description: string
  degree: number
  customColor: string
  isRoot: boolean
  isCollapsed: boolean
  childCount: number
  centerStyle: string
  textboxSize: string
  textboxStyle: string
  imageUrl: string
  linkUrl: string
  hidden: boolean
  selected: boolean
  highlighted: boolean
  searchHighlight: boolean
  sectionColor: string
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
  /** useTreeCanvas 兼容 — source 的别名 */
  sourceId: string
  /** useTreeCanvas 兼容 — target 的别名 */
  targetId: string
  /** 边标签（useTreeCanvas 的 label 字段） */
  label?: string
  /** 是否有箭头（useTreeCanvas 兼容） */
  arrow?: boolean
  /** 是否双向（useTreeCanvas 兼容 — bidir = bidirectional || symmetric） */
  bidir?: boolean
  relType: string
  relLabel: string
  bidirectional: boolean
  symmetric: boolean
  /** 是否为有向关系（默认 true；symmetric=false 时使用） */
  directional?: boolean
  color: string
  curveStyle: 'bezier' | 'straight' | 'taxi'
  dashed: boolean
  noArrow: boolean
  hidden: boolean
  selected: boolean
  /** AI 候选虚线（半透青色） */
  isAISuggestion?: boolean
}

export interface CameraState {
  x: number
  y: number
  k: number
}
