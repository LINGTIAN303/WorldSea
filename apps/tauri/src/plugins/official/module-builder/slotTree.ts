import type { Slot, PlacedComponent, SlotArrangement } from './types/layoutSchema'

/** 深度克隆（供撤销/重做快照） */
export function cloneSchema(root: Slot): Slot {
  return JSON.parse(JSON.stringify(root))
}

/** 收集所有叶子槽位 */
export function collectLeafSlots(root: Slot): Slot[] {
  const out: Slot[] = []
  function walk(s: Slot) {
    if (s.kind === 'leaf') out.push(s)
    else for (const c of s.children || []) walk(c)
  }
  walk(root)
  return out
}

/** 收集所有槽位（含 container） */
export function collectAllSlots(root: Slot): Slot[] {
  const out: Slot[] = []
  function walk(s: Slot) {
    out.push(s)
    for (const c of s.children || []) walk(c)
  }
  walk(root)
  return out
}

/** 按 id 查找槽位 */
export function findSlot(root: Slot, slotId: string): Slot | null {
  if (root.id === slotId) return root
  for (const c of root.children || []) {
    const hit = findSlot(c, slotId)
    if (hit) return hit
  }
  return null
}

/** 查找组件所在槽位 */
export function findComponentSlot(root: Slot, componentId: string): Slot | null {
  if (root.kind === 'leaf' && root.components?.some(c => c.id === componentId)) return root
  for (const c of root.children || []) {
    const hit = findComponentSlot(c, componentId)
    if (hit) return hit
  }
  return null
}

/** 向指定槽位添加组件（仅 leaf 槽位） */
export function addComponent(root: Slot, slotId: string, comp: PlacedComponent): void {
  const slot = findSlot(root, slotId)
  if (slot && slot.kind === 'leaf') {
    if (!slot.components) slot.components = []
    slot.components.push(comp)
  }
}

/** 移除组件（递归查找） */
export function removeComponent(root: Slot, componentId: string): boolean {
  const slot = findComponentSlot(root, componentId)
  if (!slot || !slot.components) return false
  const idx = slot.components.findIndex(c => c.id === componentId)
  if (idx === -1) return false
  slot.components.splice(idx, 1)
  return true
}

/** 组件在同一 leaf 槽位内上移/下移（dir = -1 | 1） */
export function reorderComponent(root: Slot, componentId: string, dir: number): boolean {
  const slot = findComponentSlot(root, componentId)
  if (!slot || !slot.components) return false
  const idx = slot.components.findIndex(c => c.id === componentId)
  const target = idx + dir
  if (idx === -1 || target < 0 || target >= slot.components.length) return false
  const comps = slot.components
  ;[comps[idx], comps[target]] = [comps[target], comps[idx]]
  return true
}

/** 在容器槽位下新增子槽位 */
export function addChildSlot(root: Slot, parentId: string, slot: Slot): void {
  const parent = findSlot(root, parentId)
  if (parent && parent.kind === 'container') {
    if (!parent.children) parent.children = []
    parent.children.push(slot)
  }
}

/** 移除槽位（递归；container 移除会连带移除其所有后代） */
export function removeSlot(root: Slot, slotId: string): boolean {
  if (root.id === slotId) return false // 不允许删根
  function walk(s: Slot): boolean {
    const children = s.children || []
    const idx = children.findIndex(c => c.id === slotId)
    if (idx !== -1) {
      children.splice(idx, 1)
      return true
    }
    for (const c of children) if (walk(c)) return true
    return false
  }
  return walk(root)
}

export function makeSlotId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`
}

export function makeComponentId(): string {
  return `comp-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`
}

const ARRANGEMENT_ICON: Record<SlotArrangement, string> = {
  horizontal: 'grip',
  vertical: 'chevron-down',
  tabs: 'dashboard',
  grid: 'grid',
  accordion: 'chevron-down',
  carousel: 'refresh',
  split: 'grip',
  free: 'move',
}

const ARRANGEMENT_LABEL: Record<SlotArrangement, string> = {
  horizontal: '栏（横排）',
  vertical: '堆（纵排）',
  tabs: '页签',
  grid: '网格',
  accordion: '手风琴',
  carousel: '轮播',
  split: '分割',
  free: '自由',
}

export { ARRANGEMENT_ICON, ARRANGEMENT_LABEL }
