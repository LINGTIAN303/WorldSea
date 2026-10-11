import { storage } from '../StorageBackend'
import type { Relation } from '../../types'
import type { Serializer, ImportStrategy, ImportReportItem } from './types'

export const relationSerializer: Serializer = {
  id: 'relations',
  label: '关系实例',
  dependsOn: ['relation-types', 'entities'],

  async collect(): Promise<Record<string, unknown>> {
    const relations = await storage.getAllRelations()
    return {
      version: 2,
      total: relations.length,
      relations,
    }
  },

  async import(data: Record<string, unknown>, strategy: ImportStrategy): Promise<ImportReportItem> {
    const relations = data.relations as Relation[] | undefined
    if (!relations || !Array.isArray(relations)) {
      return { serializerId: 'relations', total: 0, added: 0, skipped: 0, updated: 0, errors: [] }
    }

    const report: ImportReportItem = {
      serializerId: 'relations',
      total: relations.length,
      added: 0, skipped: 0, updated: 0, errors: [],
    }

    if (strategy === 'overwrite') {
      await storage.clearRelations()
      await storage.importRelations(relations.map(r => ({ ...r, pairId: r.pairId || undefined })))
      report.added = relations.length
    } else {
      const existing = await storage.getAllRelations()
      const existingIds = new Set(existing.map(r => r.id))
      for (const r of relations) {
        const record = { ...r, pairId: r.pairId || undefined }
        if (existingIds.has(r.id)) {
          await storage.updateRelation(r.id, record)
          report.updated++
        } else {
          await storage.putRelation(record)
          report.added++
        }
      }
    }

    return report
  },
}
