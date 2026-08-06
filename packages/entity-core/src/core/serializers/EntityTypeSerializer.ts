import { entitySchemaRegistry } from '../EntitySchema'
import type { EntityTypeSchema } from '../../types'
import type { Serializer } from './types'

export const entityTypeSerializer: Serializer = {
  id: 'entity-types',
  label: '实体类型定义',
  dependsOn: ['custom-modules'],

  async collect(): Promise<Record<string, unknown>> {
    const schemas = entitySchemaRegistry.getAll()
    return {
      version: 1,
      total: schemas.length,
      schemas: schemas.map(s => ({
        typeKey: s.typeKey,
        label: s.label,
        icon: s.icon,
        fields: s.fields,
        pluginId: s.pluginId,
        customFields: s.customFields,
      })),
    }
  },

  async import(data: Record<string, unknown>): Promise<void> {
    const schemas = data.schemas as EntityTypeSchema[] | undefined
    if (!schemas || !Array.isArray(schemas)) return

    for (const s of schemas) {
      entitySchemaRegistry.register(s)
    }
  },
}
