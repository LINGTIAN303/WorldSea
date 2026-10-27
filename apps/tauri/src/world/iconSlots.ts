import {
  entitySchemaRegistry,
  entityTypeIconSlot,
  sproutIconSlot,
} from '@worldsea/entity-core'
import type { SproutToggle } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core/types'

export type IconSlotKind = 'sprout' | 'entityType'

export interface IconSlot {
  key: string
  kind: IconSlotKind
  label: string
  defaultIcon: string
  pluginId?: string
  domain?: string
  /** 芽槽位：该芽声明的实体类型（含未注册的，用于同步计数）。 */
  entityTypes: string[]
}

export interface IconSlotManifest {
  id: string
  name?: string
  domain?: string
  entityTypes?: string[]
}

type ViewLike = Pick<PluginView, 'id' | 'label' | 'icon' | 'pluginId'>
type SproutLike = Pick<SproutToggle, 'id' | 'label' | 'icon'>
type SchemaLike = { type: string; label: string; icon?: string; pluginId?: string }

export interface BuildIconSlotsInput {
  views: ReadonlyArray<ViewLike>
  sprouts: ReadonlyArray<SproutLike>
  plugins: ReadonlyArray<{ manifest: IconSlotManifest }>
  schemas: ReadonlyArray<SchemaLike>
}

/** 从视图/芽/manifest/schema 构建唯一槽位表；芽槽位与实体类型槽位分开。 */
export function buildIconSlots(input: BuildIconSlotsInput): IconSlot[] {
  const manifests = new Map(input.plugins.map(plugin => [plugin.manifest.id, plugin.manifest]))
  const viewsByPlugin = new Map<string, ViewLike>()
  for (const view of input.views) {
    if (view.pluginId && !viewsByPlugin.has(view.pluginId)) viewsByPlugin.set(view.pluginId, view)
  }
  const schemaTypesByPlugin = new Map<string, string[]>()
  for (const schema of input.schemas) {
    if (!schema.pluginId) continue
    const list = schemaTypesByPlugin.get(schema.pluginId) ?? []
    list.push(schema.type)
    schemaTypesByPlugin.set(schema.pluginId, list)
  }

  const slots: IconSlot[] = []
  for (const sprout of input.sprouts) {
    const manifest = manifests.get(sprout.id)
    const view = viewsByPlugin.get(sprout.id)
    slots.push({
      key: sproutIconSlot(sprout.id),
      kind: 'sprout',
      label: view?.label ?? manifest?.name ?? sprout.label,
      defaultIcon: view?.icon || sprout.icon || 'puzzle',
      pluginId: sprout.id,
      domain: manifest?.domain,
      entityTypes: [...(manifest?.entityTypes ?? schemaTypesByPlugin.get(sprout.id) ?? [])],
    })
  }

  for (const schema of input.schemas) {
    const manifest = schema.pluginId ? manifests.get(schema.pluginId) : undefined
    slots.push({
      key: entityTypeIconSlot(schema.type),
      kind: 'entityType',
      label: schema.label,
      defaultIcon: schema.icon || entitySchemaRegistry.getDefaultIconName(schema.type),
      pluginId: schema.pluginId,
      domain: manifest?.domain,
      entityTypes: [],
    })
  }

  return slots
}

/** 某个芽名下的实体类型槽位（同步控件只作用于这些槽位）。 */
export function entityTypeSlotsOf(slots: ReadonlyArray<IconSlot>, pluginId: string | undefined): IconSlot[] {
  if (!pluginId) return []
  return slots.filter(slot => slot.kind === 'entityType' && slot.pluginId === pluginId)
}
