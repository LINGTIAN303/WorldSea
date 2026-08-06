import { ref } from 'vue'
import { getValidationApi } from '../core/serviceProvider'
import { useEntityStore } from '../stores'
import { useRelationStore } from '../stores'
import { entitySchemaRegistry } from '../core'

export interface DanglingRelation {
  relationId: string
  missingTarget: 'source' | 'target'
}

export interface DuplicateName {
  type: string
  name: string
  entityIds: string[]
}

export interface DiagnosticResult {
  orphanEntities: string[]
  danglingRelations: DanglingRelation[]
  duplicateNames: DuplicateName[]
  inconsistentTypes: string[]
}

export function useDataDiagnostics() {
  const result = ref<DiagnosticResult | null>(null)
  const isRunning = ref(false)
  const backendAvailable = ref(getValidationApi().getBackendType() !== 'none')

  async function run(): Promise<void> {
    isRunning.value = true
    try {
      if (backendAvailable.value) {
        await runWithBackend()
      } else {
        await runFallback()
      }
    } catch (e) {
      console.warn('[useDataDiagnostics] run failed, trying fallback:', e)
      await runFallback()
    } finally {
      isRunning.value = false
    }
  }

  async function runWithBackend(): Promise<void> {
    const entityStore = useEntityStore()
    const relationStore = useRelationStore()
    if (!entityStore.entities.length) await entityStore.loadAll()
    if (!relationStore.relations.length) await relationStore.loadAll()

    const report = await getValidationApi().checkReferences?.(
      JSON.stringify(entityStore.entities),
      JSON.stringify(relationStore.relations)
    )

    if (report) {
      result.value = {
        orphanEntities: report.orphanEntities || [],
        danglingRelations: (report.danglingRelations || []).map((dr: any) => ({
          relationId: dr.relationId || '',
          missingTarget: dr.missing === 'source' ? 'source' : 'target',
        })),
        duplicateNames: findDuplicateNames(entityStore.entities),
        inconsistentTypes: findInconsistentTypes(entityStore.entities),
      }
    } else {
      await runFallback()
    }
  }

  async function runFallback(): Promise<void> {
    const entityStore = useEntityStore()
    const relationStore = useRelationStore()
    if (!entityStore.entities.length) await entityStore.loadAll()
    if (!relationStore.relations.length) await relationStore.loadAll()

    const entityIds = new Set(entityStore.entities.map(e => e.id))
    const connectedIds = new Set<string>()

    const danglingRelations: DanglingRelation[] = []
    for (const r of relationStore.relations) {
      if (!entityIds.has(r.sourceId)) {
        danglingRelations.push({ relationId: r.id, missingTarget: 'source' })
      } else {
        connectedIds.add(r.sourceId)
      }
      if (!entityIds.has(r.targetId)) {
        danglingRelations.push({ relationId: r.id, missingTarget: 'target' })
      } else {
        connectedIds.add(r.targetId)
      }
    }

    const orphanEntities = entityStore.entities
      .filter(e => !connectedIds.has(e.id))
      .map(e => e.id)

    result.value = {
      orphanEntities,
      danglingRelations,
      duplicateNames: findDuplicateNames(entityStore.entities),
      inconsistentTypes: findInconsistentTypes(entityStore.entities),
    }
  }

  function findDuplicateNames(entities: Array<{ id: string; type: string; name: string }>): DuplicateName[] {
    const byType = new Map<string, Map<string, string[]>>()
    for (const e of entities) {
      if (!byType.has(e.type)) byType.set(e.type, new Map())
      const nameMap = byType.get(e.type)!
      if (!nameMap.has(e.name)) nameMap.set(e.name, [])
      nameMap.get(e.name)!.push(e.id)
    }
    const dupes: DuplicateName[] = []
    for (const [type, nameMap] of byType) {
      for (const [name, ids] of nameMap) {
        if (ids.length > 1) {
          dupes.push({ type, name, entityIds: ids })
        }
      }
    }
    return dupes
  }

  function findInconsistentTypes(entities: Array<{ id: string; type: string }>): string[] {
    const inconsistent: string[] = []
    const knownTypes = new Set(entitySchemaRegistry.getAll().map(s => s.typeKey))
    for (const e of entities) {
      if (!knownTypes.has(e.type)) {
        inconsistent.push(e.id)
      }
    }
    return inconsistent
  }

  return { result, isRunning, backendAvailable, run }
}
