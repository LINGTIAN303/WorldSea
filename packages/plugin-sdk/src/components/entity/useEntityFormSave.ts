// 保存 composable：save 校验/收集（properties/tags/entityRef/autoLink/封面）、实体引用关系同步。
// autoLink 过滤逻辑仅出现在 save 内部，合并于此。详细说明见 docs/details/注释/packages/plugin-sdk/entity-form-modal.md
import type { Ref } from 'vue'
import { storage, useEntityStore, type Entity } from '@worldsmith/entity-core'
import type { FormFieldDef } from '../types'

export interface EntityFormSavePayload {
  name: string
  description: string
  properties: Record<string, any>
  tags: string[]
  _entityRefFields?: FormFieldDef[]
  _autoLinkFields?: FormFieldDef[]
  _coverPosition?: string
  _coverZoom?: number
}

export type EntityFormSaveEmitter = (event: 'save', data: EntityFormSavePayload) => void

export interface UseEntityFormSaveOptions {
  formData: Ref<Record<string, string>>
  nameError: Ref<string>
  sortedFields: Ref<FormFieldDef[]>
  entityStore: ReturnType<typeof useEntityStore>
  entity: () => Entity | null
  emit: EntityFormSaveEmitter
}

export function useEntityFormSave(options: UseEntityFormSaveOptions) {
  function save() {
    const nameField = options.sortedFields.value.find(f => f.key === 'name')
    if (nameField?.required && !options.formData.value.name?.trim()) {
      options.nameError.value = `${nameField.label}不能为空`
      return
    }
    options.nameError.value = ''

    const properties: Record<string, any> = {}
    for (const field of options.sortedFields.value) {
      if (field.key === 'name' || field.key === 'description' || field.key === 'tags') continue
      properties[field.key] = options.formData.value[field.key] ?? ''
    }

    const tagsStr = options.formData.value.tags ?? ''
    const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean)

    const entityRefFields = options.sortedFields.value.filter(f => f.type === 'entityRef' && f.relationType)

    const entityId = options.entity()?.id
    if (entityRefFields.length > 0 && entityId) {
      syncEntityRefRelations(entityId, entityRefFields)
    }

    const autoLinkFields = options.sortedFields.value.filter((f: any) => f.autoLink)

    const coverPosition = options.formData.value._coverPosition
    const coverZoom = options.formData.value._coverZoom ? Number(options.formData.value._coverZoom) : undefined

    options.emit('save', {
      name: options.formData.value.name ?? '',
      description: options.formData.value.description ?? '',
      properties,
      tags,
      _entityRefFields: entityRefFields.length > 0 ? entityRefFields : undefined,
      _autoLinkFields: autoLinkFields.length > 0 ? autoLinkFields : undefined,
      ...(coverPosition ? { _coverPosition: coverPosition } : {}),
      ...(coverZoom !== undefined ? { _coverZoom: coverZoom } : {}),
    })
  }

  async function syncEntityRefRelations(entityId: string, fields: FormFieldDef[]) {
    const now = new Date().toISOString()
    for (const field of fields) {
      const targetName = (options.formData.value[field.key] || '').trim()
      const targetEntity = options.entityStore.entities.find(
        e => e.name.toLowerCase() === targetName.toLowerCase() && (!field.refType || e.type === field.refType)
      )

      const existingRels = (await storage.getRelationsByEntity(entityId)).filter(r =>
        r.type === field.relationType
      )

      if (!targetEntity && existingRels.length > 0) {
        for (const rel of existingRels) {
          await storage.deleteRelation(rel.id)
        }
        continue
      }

      if (!targetEntity) continue

      const hasRel = existingRels.some(r =>
        r.sourceId === entityId && r.targetId === targetEntity.id ||
        r.sourceId === targetEntity.id && r.targetId === entityId
      )
      if (hasRel) continue

      const rel = {
        id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: field.relationType!,
        sourceId: entityId,
        targetId: targetEntity.id,
        properties: {},
        createdAt: now,
        updatedAt: now,
      }
      await storage.putRelation(rel)
    }
  }

  async function syncEntityRefAfterCreate(entityId: string) {
    const entityRefFields = options.sortedFields.value.filter(f => f.type === 'entityRef' && f.relationType)
    if (entityRefFields.length > 0) {
      await syncEntityRefRelations(entityId, entityRefFields)
    }
  }

  return { save, syncEntityRefAfterCreate }
}
