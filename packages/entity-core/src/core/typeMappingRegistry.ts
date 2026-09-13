import { entitySchemaRegistry } from './EntitySchema'
import { relationSchemaRegistry } from './RelationSchema'

export interface TypeInfo {
  type: string
  label: string
  icon: string
  shape: string
  coolColor: string
  warmColor: string
}

export interface EdgeTypeInfo {
  type: string
  label: string
  coolColor: string
  warmColor: string
  dashed: boolean
  noArrow: boolean
  curveStyle: 'bezier' | 'straight' | 'taxi'
}

const nodeTypeMap = new Map<string, TypeInfo>()

const defaultNodeTypes: Omit<TypeInfo, 'label'>[] = [
  { type: 'character', icon: 'character', shape: 'round-rectangle', coolColor: '#ff4081', warmColor: '#4a6cf7' },
  { type: 'region', icon: 'region', shape: 'round-triangle', coolColor: '#69f0ae', warmColor: '#27ae60' },
  { type: 'event', icon: 'event', shape: 'round-diamond', coolColor: '#ffd740', warmColor: '#e67e22' },
  { type: 'organization', icon: 'organization', shape: 'round-hexagon', coolColor: '#ffab40', warmColor: '#e74c3c' },
  { type: 'concept', icon: 'concept', shape: 'ellipse', coolColor: '#e040fb', warmColor: '#9b59b6' },
  { type: 'item', icon: 'item', shape: 'diamond', coolColor: '#40c4ff', warmColor: '#f39c12' },
  { type: 'building', icon: 'building', shape: 'round-rectangle', coolColor: '#ff6e40', warmColor: '#ef5350' },
  { type: 'species', icon: 'species', shape: 'ellipse', coolColor: '#b2ff59', warmColor: '#66bb6a' },
  { type: 'magic', icon: 'magic', shape: 'round-hexagon', coolColor: '#ea80fc', warmColor: '#ab47bc' },
  { type: 'outline_node', icon: 'outline', shape: 'round-rectangle', coolColor: '#80d8ff', warmColor: '#42a5f5' },
  { type: 'language', icon: 'language', shape: 'round-rectangle', coolColor: '#a7ffeb', warmColor: '#26a69a' },
  { type: 'culture', icon: 'culture', shape: 'round-rectangle', coolColor: '#ffcc80', warmColor: '#ffa726' },
  { type: 'conflict', icon: 'combat', shape: 'round-diamond', coolColor: '#ff8a80', warmColor: '#e53935' },
  { type: 'inspiration', icon: 'inspiration', shape: 'round-rectangle', coolColor: '#b388ff', warmColor: '#7e57c2' },
  { type: 'plant', icon: 'plant', shape: 'ellipse', coolColor: '#ccff90', warmColor: '#9ccc65' },
  { type: 'combat_stat', icon: 'target', shape: 'round-hexagon', coolColor: '#ffe57f', warmColor: '#ffca28' },
  { type: 'weapon', icon: 'weapon', shape: 'diamond', coolColor: '#84ffff', warmColor: '#26c6da' },
  { type: 'manuscript', icon: 'manuscript', shape: 'round-rectangle', coolColor: '#ffd180', warmColor: '#ffb74d' },
  { type: 'apparel', icon: 'apparel', shape: 'round-rectangle', coolColor: '#f8bbd0', warmColor: '#ec407a' },
  { type: 'textbox', icon: 'edit', shape: 'round-rectangle', coolColor: '#b0bec5', warmColor: '#78909c' },
  { type: 'image', icon: 'image', shape: 'round-rectangle', coolColor: '#b0bec5', warmColor: '#78909c' },
  { type: 'note', icon: 'outline', shape: 'round-rectangle', coolColor: '#b0bec5', warmColor: '#78909c' },
  { type: 'link', icon: 'link', shape: 'round-rectangle', coolColor: '#b0bec5', warmColor: '#78909c' },
  { type: 'group', icon: 'item', shape: 'round-rectangle', coolColor: '#b0bec5', warmColor: '#78909c' },
  { type: 'center', icon: 'star', shape: 'round-rectangle', coolColor: '#b0bec5', warmColor: '#78909c' },
  { type: 'section', icon: 'folder', shape: 'round-rectangle', coolColor: '#b0bec5', warmColor: '#78909c' },
]

for (const entry of defaultNodeTypes) {
  nodeTypeMap.set(entry.type, {
    ...entry,
    label: entitySchemaRegistry.getLabel(entry.type),
  })
}

export function registerNodeType(info: Partial<TypeInfo> & { type: string }): void {
  const existing = nodeTypeMap.get(info.type)
  nodeTypeMap.set(info.type, {
    type: info.type,
    label: info.label || existing?.label || entitySchemaRegistry.getLabel(info.type),
    icon: info.icon || existing?.icon || 'pin',
    shape: info.shape || existing?.shape || 'ellipse',
    coolColor: info.coolColor || existing?.coolColor || '#95a5a6',
    warmColor: info.warmColor || existing?.warmColor || '#95a5a6',
  })
}

export function getNodeTypeInfo(type: string): TypeInfo {
  return nodeTypeMap.get(type) || {
    type,
    label: entitySchemaRegistry.getLabel(type),
    icon: entitySchemaRegistry.getIconName(type),
    shape: 'ellipse',
    coolColor: '#95a5a6',
    warmColor: '#95a5a6',
  }
}

export function getNodeColor(type: string, theme: 'cool' | 'warm'): string {
  return theme === 'cool' ? getNodeTypeInfo(type).coolColor : getNodeTypeInfo(type).warmColor
}

export function getAllNodeTypes(): TypeInfo[] {
  return Array.from(nodeTypeMap.values())
}

const edgeTypeMap = new Map<string, EdgeTypeInfo>()

const defaultEdgeTypes: Omit<EdgeTypeInfo, 'label'>[] = [
  { type: 'owns', coolColor: '#7c4dff', warmColor: '#f39c12', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'resides_in', coolColor: '#00bcd4', warmColor: '#27ae60', dashed: false, noArrow: false, curveStyle: 'taxi' },
  { type: 'belongs_to', coolColor: '#7c4dff', warmColor: '#e67e22', dashed: false, noArrow: false, curveStyle: 'taxi' },
  { type: 'parent_of', coolColor: '#7c4dff', warmColor: '#f39c12', dashed: false, noArrow: false, curveStyle: 'taxi' },
  { type: 'ally_of', coolColor: '#69f0ae', warmColor: '#27ae60', dashed: false, noArrow: true, curveStyle: 'bezier' },
  { type: 'allied_with', coolColor: '#69f0ae', warmColor: '#27ae60', dashed: false, noArrow: true, curveStyle: 'bezier' },
  { type: 'rival_of', coolColor: '#ff5252', warmColor: '#e74c3c', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'hostile_to', coolColor: '#ff5252', warmColor: '#e74c3c', dashed: false, noArrow: true, curveStyle: 'straight' },
  { type: 'knows', coolColor: '#78909c', warmColor: '#a0aec0', dashed: true, noArrow: true, curveStyle: 'bezier' },
  { type: 'participated_in', coolColor: '#448aff', warmColor: '#4a6cf7', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'associated_with', coolColor: '#78909c', warmColor: '#a0aec0', dashed: true, noArrow: true, curveStyle: 'bezier' },
  { type: 'contains', coolColor: '#00bcd4', warmColor: '#27ae60', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'capital_of', coolColor: '#ffd740', warmColor: '#ffa726', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'notable_for', coolColor: '#e040fb', warmColor: '#9b59b6', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'owned_by', coolColor: '#7c4dff', warmColor: '#f39c12', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'located_at', coolColor: '#00bcd4', warmColor: '#27ae60', dashed: false, noArrow: false, curveStyle: 'taxi' },
  { type: 'created_by', coolColor: '#ffab40', warmColor: '#ffa726', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'member_of', coolColor: '#ffd740', warmColor: '#e67e22', dashed: false, noArrow: false, curveStyle: 'taxi' },
  { type: 'involved_in', coolColor: '#448aff', warmColor: '#4a6cf7', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'occurred_at', coolColor: '#ffd740', warmColor: '#e67e22', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'caused_by', coolColor: '#ff5252', warmColor: '#e74c3c', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'broader_than', coolColor: '#78909c', warmColor: '#a0aec0', dashed: true, noArrow: true, curveStyle: 'bezier' },
  { type: 'inspired_by', coolColor: '#e040fb', warmColor: '#9b59b6', dashed: true, noArrow: true, curveStyle: 'bezier' },
  { type: 'references', coolColor: '#e040fb', warmColor: '#9b59b6', dashed: false, noArrow: false, curveStyle: 'bezier' },
  { type: 'controls', coolColor: '#ff5252', warmColor: '#e74c3c', dashed: false, noArrow: false, curveStyle: 'straight' },
  { type: 'located_in', coolColor: '#00bcd4', warmColor: '#27ae60', dashed: false, noArrow: false, curveStyle: 'taxi' },
  { type: 'happens_in', coolColor: '#ffab40', warmColor: '#e67e22', dashed: false, noArrow: false, curveStyle: 'bezier' },
]

for (const entry of defaultEdgeTypes) {
  edgeTypeMap.set(entry.type, {
    ...entry,
    label: relationSchemaRegistry.get(entry.type)?.label || entry.type,
  })
}

export function registerEdgeType(info: Partial<EdgeTypeInfo> & { type: string }): void {
  const existing = edgeTypeMap.get(info.type)
  edgeTypeMap.set(info.type, {
    type: info.type,
    label: info.label || relationSchemaRegistry.get(info.type)?.label || info.type,
    coolColor: info.coolColor || existing?.coolColor || '#5a5a7a',
    warmColor: info.warmColor || existing?.warmColor || '#5a5a7a',
    dashed: info.dashed ?? existing?.dashed ?? false,
    noArrow: info.noArrow ?? existing?.noArrow ?? false,
    curveStyle: info.curveStyle || existing?.curveStyle || 'bezier',
  })
}

export function getEdgeTypeInfo(type: string): EdgeTypeInfo {
  return edgeTypeMap.get(type) || {
    type,
    label: relationSchemaRegistry.get(type)?.label || type,
    coolColor: '#5a5a7a',
    warmColor: '#5a5a7a',
    dashed: false,
    noArrow: false,
    curveStyle: 'bezier',
  }
}

export function getEdgeColor(type: string, theme: 'cool' | 'warm'): string {
  return theme === 'cool' ? getEdgeTypeInfo(type).coolColor : getEdgeTypeInfo(type).warmColor
}

export function getAllEdgeTypes(): EdgeTypeInfo[] {
  return Array.from(edgeTypeMap.values())
}
