import type { Relation } from '@worldsea/entity-core'

/**
 * UniversalRelationPanel / RelationGroupList 共用的数据形状（2026-10-08 Tab 优化批抽件时提取）。
 * 放独立文件而非 SFC 内：`script setup` 不能 export 类型，抽件两侧都要 import。
 */

export interface EnhancedRelation extends Relation {
  direction: 'in' | 'out'
  counterpartId: string
  counterpartName: string
  counterpartIcon: string
  counterpartTypeLabel: string
  groupType: string
}

export interface RelationGroupState {
  type: string
  label: string
  relations: EnhancedRelation[]
  collapsed: boolean
}
