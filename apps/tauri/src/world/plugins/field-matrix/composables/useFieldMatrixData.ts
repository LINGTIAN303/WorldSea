import { onBeforeUnmount, ref, watch } from 'vue'
import {
  entitySchemaRegistryV2,
  facetRegistry,
  fieldRegistry,
  pluginAPI,
  relationshipRegistry,
  traitRegistry,
} from '@worldsea/entity-core'
import type { FieldSchema } from '@worldsea/entity-core'
import { buildMatrixModel } from '../model/buildMatrixModel'
import type { FieldMatrixModel, FieldMatrixSources } from '../model/types'

function readSources(): FieldMatrixSources {
  return {
    schemas: entitySchemaRegistryV2.getAll(),
    traits: traitRegistry.getAll(),
    facets: facetRegistry.getAll(),
    relations: relationshipRegistry.getAll(),
    views: pluginAPI.getViews(),
    userFields: (type: string) => fieldRegistry.getFields(type)
      .filter(field => field.source === 'user') as FieldSchema[],
  }
}

export function useFieldMatrixData() {
  const model = ref<FieldMatrixModel>(buildMatrixModel(readSources()))
  const refresh = () => { model.value = buildMatrixModel(readSources()) }

  const stopFieldWatch = watch(fieldRegistry.version, refresh)
  const stopViewWatch = pluginAPI.onViewChange(() => refresh())

  onBeforeUnmount(() => {
    stopFieldWatch()
    stopViewWatch()
  })

  return { model, refresh }
}
