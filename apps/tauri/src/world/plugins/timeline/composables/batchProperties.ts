/** 批量编辑属性：只把补丁里非空的字段合并进每个选中事件（properties 是整体替换语义）。 */
import type { Entity } from '@worldsea/entity-core'

export interface BatchPatch {
  importance?: string
  status?: string
}

export interface BatchUpdate {
  id: string
  properties: Record<string, unknown>
}

export function applyBatchProperties(
  entities: Entity[],
  ids: Iterable<string>,
  patch: BatchPatch,
): BatchUpdate[] {
  const wanted = new Set(ids)
  const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => !!value))
  if (Object.keys(clean).length === 0) return []
  const updates: BatchUpdate[] = []
  for (const entity of entities) {
    if (!wanted.has(entity.id) || entity.type !== 'event') continue
    updates.push({ id: entity.id, properties: { ...(entity.properties ?? {}), ...clean } })
  }
  return updates
}
