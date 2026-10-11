import { useEntityStore } from '../stores'
import { useRelationStore } from '../stores'
import { getSettingsApi } from '../core/serviceProvider'
import { useBidirectional } from './useBidirectional'
import { useAutoCreateEntity } from './useAutoCreateEntity'
import { getRelationLabel } from '../core'
import type { FieldSchema } from '../types'
import type { Entity } from '../types'

interface LinkStatus {
  matched: boolean
  entity?: Entity
  canCreate: boolean
}

export function useSmartFieldLink() {
  const entityStore = useEntityStore()
  const settingsApi = getSettingsApi()

  function checkFieldLink(value: string, autoLink: FieldSchema['autoLink']): LinkStatus {
    if (!value || !autoLink || !settingsApi.autoCreateEntityEnabled) {
      return { matched: false, canCreate: false }
    }

    const searchField = autoLink.searchField || 'name'
    const entities = entityStore.entities || []
    const matched = entities.find(e =>
      e.type === autoLink.targetType &&
      String((e as any)[searchField] || (e.properties as any)?.[searchField] || e.name).toLowerCase() === value.toLowerCase()
    )

    return {
      matched: !!matched,
      entity: matched,
      canCreate: autoLink.createIfMissing !== false,
    }
  }

  async function processAutoLinks(
    entityId: string,
    fieldValues: Record<string, unknown>,
    fields: FieldSchema[]
  ): Promise<{ linked: number; created: number; reminders: string[] }> {
    const result = { linked: 0, created: 0, reminders: [] as string[] }
    const { createBidirectional } = useBidirectional()
    const { promptAndCreate } = useAutoCreateEntity()

    for (const field of fields) {
      if (!field.autoLink) continue
      const value = String(fieldValues[field.key] || '').trim()
      if (!value) continue

      const status = checkFieldLink(value, field.autoLink)

      if (status.matched && status.entity) {
        const existing = await checkRelationExists(entityId, status.entity.id, field.autoLink.relationType)
        if (!existing) {
          await createBidirectional({
            type: field.autoLink.relationType,
            sourceId: entityId,
            targetId: status.entity.id,
          })
          result.linked++
          result.reminders.push(`${field.label}：已自动建立「${getRelationLabel(field.autoLink.relationType)}」关系，建议编辑关系属性`)
        }
      } else if (status.canCreate) {
        const entity = await promptAndCreate({
          name: value,
          entityType: field.autoLink.targetType,
          relationType: field.autoLink.relationType,
          sourceId: entityId,
        })
        if (entity) {
          result.created++
        }
      }
    }

    return result
  }

  async function checkRelationExists(sourceId: string, targetId: string, relationType: string): Promise<boolean> {
    const relationStore = useRelationStore()
    return relationStore.relations.some(r =>
      r.type === relationType &&
      ((r.sourceId === sourceId && r.targetId === targetId) ||
       (r.sourceId === targetId && r.targetId === sourceId))
    )
  }

  return { checkFieldLink, processAutoLinks }
}
