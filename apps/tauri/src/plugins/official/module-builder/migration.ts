import type {
  LayoutSlot,
  LayoutSlotChild,
  PlacedComponent,
  Slot,
  ModuleLayoutSchema,
} from './types/layoutSchema'
import { createEmptyLayoutSchema } from './types/layoutSchema'

/**
 * 将旧布局结构（v1：layout 树 + components 平铺 + zoneId 关联）
 * 迁移为新的槽位模型（v2：递归 Slot 树，组件内嵌 leaf 槽位）。
 * 旧数据视为可用资源：zone → leaf 槽位，组件按 order 归入对应 leaf。
 */

function migrateComponent(c: PlacedComponent, components: PlacedComponent[]): PlacedComponent {
  const { zoneId: _z, childSlot, ...rest } = c
  const out: PlacedComponent = { ...rest }
  if (childSlot) out.childSlot = migrateSlotNode(childSlot as unknown as LayoutSlot, components)
  return out
}

function migrateLeafComponents(zoneId: string, components: PlacedComponent[]): PlacedComponent[] {
  return components
    .filter(c => c.zoneId === zoneId)
    .sort((a, b) => a.order - b.order)
    .map(c => migrateComponent(c, components))
}

function migrateChild(child: LayoutSlotChild, components: PlacedComponent[]): Slot {
  if (child.type === 'slot') return migrateSlotNode(child.slot, components)
  // zone → leaf 槽位
  return {
    id: child.zoneId,
    name: child.zoneId,
    arrangement: 'vertical',
    kind: 'leaf',
    size: { width: child.width, height: child.height, flex: child.flex },
    components: migrateLeafComponents(child.zoneId, components),
  }
}

function migrateSlotNode(slot: LayoutSlot, components: PlacedComponent[]): Slot {
  return {
    id: slot.id || 'slot',
    arrangement: slot.direction || 'vertical',
    kind: 'container',
    children: (slot.children || []).map(child => migrateChild(child, components)),
  }
}

export function migrateLayoutSchema(old: unknown): ModuleLayoutSchema {
  if (!old) return createEmptyLayoutSchema()
  const o = old as { version?: number; root?: Slot; layout?: LayoutSlot; components?: PlacedComponent[] }
  // 已是新模型
  if (o.version === 2 && o.root) return { version: 2, root: o.root }
  // v1 / 历史数据
  const layout = o.layout as LayoutSlot
  if (!layout) return createEmptyLayoutSchema()
  const components = o.components || []
  return { version: 2, root: migrateSlotNode(layout, components) }
}
