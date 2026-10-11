import { storage } from '../StorageBackend'
import type { Entity } from '../../types'
import type { Serializer, ImportStrategy, ImportReportItem } from './types'

export const entitySerializer: Serializer = {
  id: 'entities',
  label: '实体实例',
  dependsOn: ['entity-types'],

  async collect(): Promise<Record<string, unknown>> {
    const entities = await storage.getAllEntities()
    const grouped: Record<string, Entity[]> = {}
    for (const e of entities) {
      if (!grouped[e.type]) grouped[e.type] = []
      grouped[e.type].push(e)
    }
    return {
      version: 1,
      total: entities.length,
      entities,
      grouped,
    }
  },

  async import(data: Record<string, unknown>, strategy: ImportStrategy): Promise<ImportReportItem> {
    const entities = data.entities as Entity[] | undefined
    if (!entities || !Array.isArray(entities)) {
      return { serializerId: 'entities', total: 0, added: 0, skipped: 0, updated: 0, errors: [] }
    }

    const report: ImportReportItem = {
      serializerId: 'entities',
      total: entities.length,
      added: 0, skipped: 0, updated: 0, errors: [],
    }

    if (strategy === 'overwrite') {
      console.log(`[EntitySerializer] overwrite: importing ${entities.length} entities`)
      await storage.clearEntities()
      await storage.importEntities(entities)
      report.added = entities.length
      console.log(`[EntitySerializer] overwrite done: added=${report.added}`)
    } else {
      console.log(`[EntitySerializer] merge: importing ${entities.length} entities`)
      const existing = await storage.getAllEntities()
      const existingIds = new Set(existing.map(e => e.id))
      for (const e of entities) {
        if (existingIds.has(e.id)) {
          await storage.updateEntity(e.id, e)
          report.updated++
        } else {
          await storage.putEntity(e)
          report.added++
        }
      }
    }

    console.log(`[EntitySerializer] done: added=${report.added}, updated=${report.updated}, errors=${report.errors.length}`)
    return report
  },
}
