// 实体引用搜索 composable：entityRef 类型字段的搜索下拉状态与交互。
// 详细说明见 docs/details/注释/packages/plugin-sdk/entity-form-modal.md
import { ref, type Ref } from 'vue'
import { entitySchemaRegistry, useEntityStore } from '@worldsea/entity-core'
import type { FormFieldDef } from '../types'

export interface EntityRefResult {
  id: string
  name: string
  iconName: string
  typeLabel: string
  type: string
}

export interface UseEntityRefSearchOptions {
  formData: Ref<Record<string, string>>
  entityStore: ReturnType<typeof useEntityStore>
}

export function useEntityRefSearch(options: UseEntityRefSearchOptions) {
  const activeEntityRef = ref<string | null>(null)
  const entityRefResults = ref<EntityRefResult[]>([])

  function openEntityRef(field: FormFieldDef) {
    activeEntityRef.value = field.key
    searchEntityRef(field, '')
  }

  function onEntityRefSearch(field: FormFieldDef) {
    const query = options.formData.value[field.key] || ''
    searchEntityRef(field, query)
  }

  function searchEntityRef(field: FormFieldDef, query: string) {
    const refType = field.refType
    let entities = options.entityStore.entities
    if (refType) {
      entities = entities.filter(e => e.type === refType)
    }
    if (query) {
      const q = query.toLowerCase()
      entities = entities.filter(e => e.name.toLowerCase().includes(q))
    }
    entityRefResults.value = entities.slice(0, 8).map(e => {
      return {
        id: e.id,
        name: e.name,
        iconName: entitySchemaRegistry.getIconName(e.type),
        typeLabel: entitySchemaRegistry.getLabel(e.type),
        type: e.type,
      }
    })
  }

  function selectEntityRef(field: FormFieldDef, name: string) {
    options.formData.value[field.key] = name
    activeEntityRef.value = null
    entityRefResults.value = []
  }

  return { activeEntityRef, entityRefResults, openEntityRef, onEntityRefSearch, searchEntityRef, selectEntityRef }
}
