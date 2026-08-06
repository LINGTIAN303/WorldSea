import { relationSchemaRegistry } from '../RelationSchema'
import type { RelationTypeSchema } from '../../types'
import type { Serializer } from './types'

export const relationTypeSerializer: Serializer = {
  id: 'relation-types',
  label: '关系类型定义',
  dependsOn: ['custom-modules', 'entity-types'],

  async collect(): Promise<Record<string, unknown>> {
    const schemas = relationSchemaRegistry.getAll()
    return {
      version: 1,
      total: schemas.length,
      schemas: schemas.map(s => ({
        typeKey: s.typeKey,
        label: s.label,
        sourceTypes: s.sourceTypes,
        targetTypes: s.targetTypes,
        directed: s.directed,
        properties: s.properties,
        pluginId: s.pluginId,
      })),
    }
  },

  async import(data: Record<string, unknown>): Promise<void> {
    const schemas = data.schemas as RelationTypeSchema[] | undefined
    if (!schemas || !Array.isArray(schemas)) return

    for (const s of schemas) {
      relationSchemaRegistry.register(s)
    }
  },
}
