import { fieldRegistry, type RegisteredField } from '../FieldRegistry'
import type { Serializer } from './types'

export const customFieldSerializer: Serializer = {
  id: 'custom-fields',
  label: '自定义字段',
  dependsOn: ['entity-types'],

  async collect(): Promise<Record<string, unknown>> {
    const data = fieldRegistry.exportData()
    const totalFields = Object.values(data).reduce((sum, fields) => sum + fields.length, 0)
    return {
      version: 1,
      total: totalFields,
      fields: data,
    }
  },

  async import(data: Record<string, unknown>, strategy): Promise<void> {
    const fields = data.fields as Record<string, RegisteredField[]> | undefined
    if (!fields) return

    if (strategy === 'overwrite') {
      for (const [entityType, fieldList] of Object.entries(fields)) {
        for (const f of fieldList) {
          const existing = fieldRegistry.getField(entityType, f.key)
          if (existing?.source === 'builtin') continue
          if (existing) {
            fieldRegistry.updateUserField(entityType, f.key, f)
          } else {
            fieldRegistry.addUserField(entityType, f)
          }
        }
      }
    } else {
      for (const [entityType, fieldList] of Object.entries(fields)) {
        for (const f of fieldList) {
          if (fieldRegistry.getField(entityType, f.key)) continue
          fieldRegistry.addUserField(entityType, f)
        }
      }
    }
  },
}
