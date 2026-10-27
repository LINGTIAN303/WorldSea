import { SPROUT_DOMAINS, type IconOverrideSource } from '@worldsea/entity-core'
import type { IconDomain } from '@worldsea/ui-kit'
import type { IconSlot, IconSlotManifest } from './iconSlots'

export interface IconPickerTarget {
  key: string
  kind: 'sprout' | 'entityType'
  label: string
  current: string
  source: IconOverrideSource
  domain?: IconDomain
  syncCount: number
  syncDefault: boolean
  canResetProject: boolean
}

export interface IconPickerConfirm {
  icon: string
  applyGlobal: boolean
  syncTypes: boolean
}

export interface IconSlotListGroup {
  id: string
  label: string
  icon?: string
  items: IconSlot[]
}

export const UNCLASSIFIED_SLOT_DOMAIN = 'unclassified'

export interface SproutSlotGroup {
  id: string
  label: string
  icon: string
  items: IconSlot[]
}

export interface EntityTypeSlotGroup {
  pluginId: string
  label: string
  items: IconSlot[]
}

export function iconSourceLabel(source: IconOverrideSource): string {
  if (source === 'project') return '项目'
  if (source === 'global') return '全局'
  return '默认'
}

/** 芽槽位按 8 域分组；未分类最后。 */
export function groupSproutSlots(slots: ReadonlyArray<IconSlot>): SproutSlotGroup[] {
  const byDomain = new Map<string, IconSlot[]>()
  for (const slot of slots) {
    if (slot.kind !== 'sprout') continue
    const domain = SPROUT_DOMAINS.some(item => item.id === slot.domain) ? slot.domain! : UNCLASSIFIED_SLOT_DOMAIN
    const list = byDomain.get(domain) ?? []
    list.push(slot)
    byDomain.set(domain, list)
  }
  const groups: SproutSlotGroup[] = SPROUT_DOMAINS
    .filter(domain => byDomain.has(domain.id))
    .map(domain => ({
      id: domain.id,
      label: domain.label,
      icon: domain.icon,
      items: sortSlots(byDomain.get(domain.id) ?? []),
    }))
  const extra = byDomain.get(UNCLASSIFIED_SLOT_DOMAIN)
  if (extra?.length) {
    groups.push({ id: UNCLASSIFIED_SLOT_DOMAIN, label: '未分类', icon: 'puzzle', items: sortSlots(extra) })
  }
  return groups
}

/** 实体类型槽位按所属芽分组；没有归属的排最后。 */
export function groupEntityTypeSlots(
  slots: ReadonlyArray<IconSlot>,
  plugins: ReadonlyArray<{ manifest: IconSlotManifest }>,
): EntityTypeSlotGroup[] {
  const names = new Map(plugins.map(plugin => [plugin.manifest.id, plugin.manifest.name ?? plugin.manifest.id]))
  const byPlugin = new Map<string, IconSlot[]>()
  for (const slot of slots) {
    if (slot.kind !== 'entityType') continue
    const pluginId = slot.pluginId ?? ''
    const list = byPlugin.get(pluginId) ?? []
    list.push(slot)
    byPlugin.set(pluginId, list)
  }
  const groups = [...byPlugin.entries()].map(([pluginId, items]) => ({
    pluginId,
    label: names.get(pluginId) ?? (pluginId || '未分类'),
    items: sortSlots(items),
  }))
  return groups.sort((a, b) => {
    if (!a.pluginId) return 1
    if (!b.pluginId) return -1
    return a.label.localeCompare(b.label, 'zh-CN')
  })
}

/** 同步控件默认只在「唯一实体类型且仍为默认/仍跟随本芽」时勾选。 */
export function defaultSyncFor(
  typeSlots: ReadonlyArray<IconSlot>,
  sourceOf: (key: string) => IconOverrideSource,
  iconOf?: (slot: IconSlot) => string,
  sproutIcon?: string,
): boolean {
  return typeSlots.length === 1 && isFollowingSync(typeSlots[0], sourceOf, iconOf, sproutIcon)
}

/** 联动目标：默认或仍跟随本芽的实体类型；已单独设置成别的图标的不动。 */
export function syncTargetKeys(
  typeSlots: ReadonlyArray<IconSlot>,
  sourceOf: (key: string) => IconOverrideSource,
  iconOf?: (slot: IconSlot) => string,
  sproutIcon?: string,
): string[] {
  return typeSlots
    .filter(slot => isFollowingSync(slot, sourceOf, iconOf, sproutIcon))
    .map(slot => slot.key)
}

function isFollowingSync(
  slot: IconSlot,
  sourceOf: (key: string) => IconOverrideSource,
  iconOf?: (slot: IconSlot) => string,
  sproutIcon?: string,
): boolean {
  if (sourceOf(slot.key) === 'default') return true
  return Boolean(sproutIcon && iconOf?.(slot) === sproutIcon)
}

function sortSlots(slots: IconSlot[]): IconSlot[] {
  return [...slots].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}
