import { RelationTypes } from '@worldsea/entity-core'
import { getNodeColor, getNodeTypeInfo, getEdgeColor } from '@worldsea/entity-core'

// 注：原 EMOJI_TO_ICON 兼容表已删（2026-09-13）——类型 icon 全链路已是 WsIcon id
// 体系（typeMappingRegistry 单源），emoji 映射层无实际命中，属历史遗留。

export function typeColor(type: string): string {
  return getNodeColor(type, 'warm')
}

export function edgeColor(relType: string): string {
  return getEdgeColor(relType, 'warm')
}

export function typeShape(type: string): string {
  return getNodeTypeInfo(type).shape
}

export function typeLabel(type: string): string {
  return getNodeTypeInfo(type).label
}

export function iconForType(type: string): string {
  return getNodeTypeInfo(type).icon
}

export function nodeSize(relCount: number): number {
  return Math.min(60, Math.max(32, 36 + relCount * 3))
}

export function guessRelType(src: string, tgt: string): string {
  const map: Record<string, string> = {
    [`character_item`]: RelationTypes.OWNS,
    [`item_character`]: RelationTypes.OWNED_BY,
    [`character_region`]: RelationTypes.RESIDES_IN,
    [`region_character`]: RelationTypes.NOTABLE_FOR,
    [`character_organization`]: RelationTypes.BELONGS_TO,
    [`organization_character`]: RelationTypes.MEMBER_OF,
    [`character_event`]: RelationTypes.PARTICIPATED_IN,
    [`character_concept`]: RelationTypes.ASSOCIATED_WITH,
  }
  return map[`${src}_${tgt}`] || map[`${tgt}_${src}`] || RelationTypes.ASSOCIATED_WITH
}

export const LAYOUT_OPTIONS = [
  { value: 'mindmapTree', label: '思维导图' },
  { value: 'force', label: '力导向布局' },
  { value: 'radial', label: '径向布局' },
  { value: 'tree', label: '树形布局' },
  { value: 'compact', label: '紧凑布局' },
]

export function getViewIdForEntity(node: { id: string; type: string }): string | null {
  const viewMap: Record<string, string> = {
    character: 'characters', region: 'regions', event: 'timeline',
    organization: 'organizations', concept: 'concepts', item: 'items',
  }
  return viewMap[node.type] || null
}

export type EdgeLineStyle = 'bezier' | 'straight' | 'taxi' | 'unbundled-bezier'

export function edgeLineStyle(relType: string): EdgeLineStyle {
  const map: Record<string, EdgeLineStyle> = {
    belongs_to: 'taxi',
    member_of: 'taxi',
    located_in: 'taxi',
    parent_of: 'taxi',
    controls: 'straight',
    hostile_to: 'straight',
  }
  return map[relType] || 'bezier'
}

export interface KeySequenceDef {
  sequence: string
  description: string
  category: string
}

/**
 * 连击序列键位（500ms 内依次按下；经 useShortcuts 注册表 kind='sequence' 分发）。
 * 维护约束：序列首键不得与已有单键命令键相同（否则单键先触发、序列带副作用）——
 * 原 'd n'（与 d=自由绘图冲突）已删，原 'f n' 与 f=适应视图冲突改为 'g n'。
 */
export const KEY_SEQUENCES: KeySequenceDef[] = [
  { sequence: 'n c', description: '新建角色', category: '新建' },
  { sequence: 'n r', description: '新建区域', category: '新建' },
  { sequence: 'n e', description: '新建事件', category: '新建' },
  { sequence: 'n t', description: '新建文本框', category: '新建' },
  { sequence: 'e n', description: '编辑名称', category: '编辑' },
  { sequence: 'e d', description: '编辑描述', category: '编辑' },
  { sequence: 'c l', description: '连接节点', category: '操作' },
  { sequence: 'g s', description: '创建分组框', category: '操作' },
  { sequence: 'g n', description: '聚焦节点', category: '视图' },
  { sequence: 'j i', description: '进入子图', category: '导航' },
]
