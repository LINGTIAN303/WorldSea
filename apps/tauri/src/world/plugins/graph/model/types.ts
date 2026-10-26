/**
 * 全局图谱重构（2026-10-26）的领域类型。
 *
 * 数据侧只依赖实体/关系的形状字段，不依赖 G6；G6 的样式装配在 `g6Data.ts` 收敛，
 * 纯函数（分量/布局/策略）可直测。
 */

export interface EntityNodeInput {
  id: string
  name: string
  type: string
  label: string
  icon: string
  shape: string
  tags: string[]
  description: string
  degree: number
}

export interface RelationEdgeInput {
  id: string
  source: string
  target: string
  relType: string
  relLabel: string
  bidirectional: boolean
  symmetric: boolean
  noArrow: boolean
  dashed: boolean
  relationIds: string[]
}

export interface TypeMeta {
  label: string
  icon: string
  shape: string
}

export type GroupKind = 'core' | 'island'

export interface OverviewGroup {
  /** `core` 或 `island:<type>` */
  id: string
  kind: GroupKind
  type: string | null
  label: string
  icon: string
  count: number
  nodeIds: string[]
}

export interface OverviewNode extends EntityNodeInput {
  /** 所属分组：关系核心或类型星座 */
  groupId: string
  isolated: boolean
  typeLabel: string
  typeIcon: string
  typeShape: string
}

export interface OverviewEdge extends RelationEdgeInput {
  /** 关系语义族（由 policy/edgeStyle 推导） */
  family: EdgeFamily
}

export interface TypeSummary {
  type: string
  label: string
  icon: string
  shape: string
  total: number
  connected: number
  isolated: number
}

export interface OverviewStats {
  entities: number
  relations: number
  connected: number
  isolated: number
  types: number
  components: number
  /** 已连接实体占比（0..1） */
  connectedRatio: number
}

export interface Overview {
  nodes: OverviewNode[]
  edges: OverviewEdge[]
  groups: OverviewGroup[]
  types: TypeSummary[]
  stats: OverviewStats
}

export interface Point {
  x: number
  y: number
}

export interface GroupLayout {
  id: string
  kind: GroupKind
  type: string | null
  x: number
  y: number
  /** 星座圆盘半径（含节点尺寸留白） */
  radius: number
}

export interface OverviewLayout {
  positions: Record<string, Point>
  groups: Record<string, GroupLayout>
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/** 关系语义族：视觉上只分 6 类，替代 27 种关系色等高噪点 */
export type EdgeFamily = 'structural' | 'social' | 'spatial' | 'causal' | 'narrative' | 'other'

/** 实体语义族：图着色只分 6 族 + 中性辅助，形状承担类型区分 */
export type SemanticFamily = 'being' | 'place' | 'narrative' | 'society' | 'artifact' | 'concept' | 'meta'
