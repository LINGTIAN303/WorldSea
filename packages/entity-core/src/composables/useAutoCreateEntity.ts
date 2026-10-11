import { useEntityStore } from '../stores'
import { getSettingsApi, getConfirmApi } from '../core/serviceProvider'
import { useBidirectional } from './useBidirectional'
import { entitySchemaRegistry } from '../core'
import { getRelationLabel } from '../core'
import type { Entity } from '../types'

export function useAutoCreateEntity() {
  const entityStore = useEntityStore()
  const settingsApi = getSettingsApi()
  const confirmApi = getConfirmApi()

  async function promptAndCreate(params: {
    name: string
    entityType: string
    relationType?: string
    sourceId?: string
    onCreated?: (entity: Entity) => void
  }): Promise<Entity | null> {
    if (!settingsApi.autoCreateEntityEnabled) {
      return null
    }

    const { name, entityType, relationType, sourceId, onCreated } = params
    const typeLabel = entitySchemaRegistry.getLabel(entityType)
    const relLabel = relationType ? getRelationLabel(relationType) : ''

    const message = relationType
      ? `将创建${typeLabel}实体「${name}」并建立「${relLabel}」关系，确认？`
      : `将创建${typeLabel}实体「${name}」，确认？`

    const confirmed = await confirmApi.confirm({ type: 'warning', title: '自动创建实体', description: message })
    if (!confirmed) return null

    const now = new Date().toISOString()
    const entity: Entity = {
      id: `${entityType.slice(0, 3)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: entityType,
      name,
      description: '',
      properties: {},
      tags: [],
      createdAt: now,
      updatedAt: now,
    }
    await entityStore.add(entity)

    if (relationType && sourceId) {
      const { createBidirectional } = useBidirectional()
      await createBidirectional({
        type: relationType,
        sourceId,
        targetId: entity.id,
      })
    }

    onCreated?.(entity)
    return entity
  }

  return { promptAndCreate }
}
