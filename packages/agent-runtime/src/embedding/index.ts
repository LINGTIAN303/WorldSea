import type { EntityLike } from '../tools/types'
import { generateEmbedding, generateEmbeddings, getEmbeddingConfig } from './service'
import { putVectorsV2, deleteVectorV2, getCollectionV2, searchSimilarV2, getCollectionSizeV2, type VectorRecordV2, type SearchResultV2 } from './vector-store-v2'

const ENTITY_COLLECTION = 'entities'
const MEMORY_COLLECTION = 'memory'

const BATCH_SIZE = 20

function entityToText(e: EntityLike): string {
  const parts = [e.name]
  if (e.description) parts.push(e.description)
  if (e.properties) {
    for (const [k, v] of Object.entries(e.properties)) {
      if (v != null && v !== '') parts.push(`${k}: ${v}`)
    }
  }
  if (e.tags?.length) parts.push(e.tags.join(' '))
  return parts.join(' ').slice(0, 2000)
}

function memoryToText(key: string, value: string, tags: string[]): string {
  const parts = [`${key}: ${value}`]
  if (tags.length) parts.push(tags.join(' '))
  return parts.join(' ').slice(0, 2000)
}

export function isEmbeddingReady(): boolean {
  const cfg = getEmbeddingConfig()
  return !!(cfg && cfg.apiKey)
}

export async function indexEntity(entity: EntityLike): Promise<void> {
  if (!isEmbeddingReady()) return
  try {
    const text = entityToText(entity)
    const vector = await generateEmbedding(text)
    await putVectorsV2([{
      id: `entity_${entity.id}`,
      collection: ENTITY_COLLECTION,
      vector,
      metadata: {
        entityId: entity.id,
        name: entity.name,
        type: entity.type,
        updatedAt: entity.updatedAt,
      },
      updatedAt: Date.now(),
    }] as VectorRecordV2[])
  } catch (err) {
    console.warn('[EmbeddingIndex] indexEntity failed:', err)
  }
}

export async function indexEntities(entities: EntityLike[]): Promise<void> {
  if (!isEmbeddingReady() || entities.length === 0) return
  try {
    const texts = entities.map(e => entityToText(e))
    const vectors = await generateEmbeddings(texts)
    const records: VectorRecordV2[] = entities.map((e, i) => ({
      id: `entity_${e.id}`,
      collection: ENTITY_COLLECTION,
      vector: vectors[i],
      metadata: {
        entityId: e.id,
        name: e.name,
        type: e.type,
        updatedAt: e.updatedAt,
      },
      updatedAt: Date.now(),
    }))
    for (let b = 0; b < records.length; b += BATCH_SIZE) {
      await putVectorsV2(records.slice(b, b + BATCH_SIZE))
    }
  } catch (err) {
    console.warn('[EmbeddingIndex] indexEntities failed:', err)
  }
}

export async function removeEntityIndex(entityId: string): Promise<void> {
  if (!isEmbeddingReady()) return
  try {
    await deleteVectorV2(`entity_${entityId}`)
  } catch (err) {
    console.warn('[EmbeddingIndex] removeEntityIndex failed:', err)
  }
}

export async function indexMemoryEntry(key: string, value: string, tags: string[]): Promise<void> {
  if (!isEmbeddingReady()) return
  try {
    const text = memoryToText(key, value, tags)
    const vector = await generateEmbedding(text)
    await putVectorsV2([{
      id: `memory_${key}`,
      collection: MEMORY_COLLECTION,
      vector,
      metadata: {
        key,
        tags,
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    }] as VectorRecordV2[])
  } catch (err) {
    console.warn('[EmbeddingIndex] indexMemoryEntry failed:', err)
  }
}

export async function removeMemoryIndex(key: string): Promise<void> {
  try {
    await deleteVectorV2(`memory_${key}`)
  } catch (err) {
    console.warn('[EmbeddingIndex] removeMemoryIndex failed:', err)
  }
}

export async function syncEntityIndex(
  getAllEntities: () => Promise<EntityLike[]>,
): Promise<{ indexed: number; skipped: number; removed: number }> {
  if (!isEmbeddingReady()) return { indexed: 0, skipped: 0, removed: 0 }

  try {
    const entities = await getAllEntities()
    const existingVectors = await getCollectionV2(ENTITY_COLLECTION)
    const existingMap = new Map<string, { updatedAt: string | number }>()
    for (const v of existingVectors) {
      const entityId = v.metadata?.entityId || v.id.replace('entity_', '')
      existingMap.set(entityId, { updatedAt: v.metadata?.updatedAt })
    }

    const toIndex: EntityLike[] = []
    let skipped = 0

    for (const e of entities) {
      const existing = existingMap.get(e.id)
      if (existing && existing.updatedAt === e.updatedAt) {
        skipped++
      } else {
        toIndex.push(e)
      }
    }

    const entityIds = new Set(entities.map(e => e.id))
    let removed = 0
    for (const v of existingVectors) {
      const entityId = v.metadata?.entityId || v.id.replace('entity_', '')
      if (!entityIds.has(entityId)) {
        await deleteVectorV2(v.id)
        removed++
      }
    }

    if (toIndex.length > 0) {
      await indexEntities(toIndex)
    }

    return { indexed: toIndex.length, skipped, removed }
  } catch (err) {
    console.warn('[EmbeddingIndex] syncEntityIndex failed:', err)
    return { indexed: 0, skipped: 0, removed: 0 }
  }
}

export interface SemanticSearchResult {
  id: string
  type: 'entity' | 'memory'
  score: number
  metadata: Record<string, any>
}

export async function semanticSearch(
  query: string,
  options?: {
    collections?: ('entity' | 'memory')[]
    topK?: number
    minScore?: number
  },
): Promise<SemanticSearchResult[]> {
  if (!isEmbeddingReady() || !query.trim()) return []

  const collections = options?.collections || ['entity', 'memory']
  const topK = options?.topK || 10
  const minScore = options?.minScore || 0.3

  try {
    const queryVector = await generateEmbedding(query)
    const allResults: SemanticSearchResult[] = []

    for (const col of collections) {
      const collectionName = col === 'entity' ? ENTITY_COLLECTION : MEMORY_COLLECTION
      const results = await searchSimilarV2(queryVector, collectionName, topK, minScore)
      for (const r of results) {
        allResults.push({
          id: r.metadata.entityId || r.metadata.key || r.id,
          type: col,
          score: r.score,
          metadata: r.metadata,
        })
      }
    }

    allResults.sort((a, b) => b.score - a.score)
    return allResults.slice(0, topK)
  } catch (err) {
    console.warn('[EmbeddingIndex] semanticSearch failed:', err)
    return []
  }
}

export async function semanticSearchEntities(
  query: string,
  topK: number = 10,
  minScore: number = 0.3,
): Promise<SearchResultV2[]> {
  if (!isEmbeddingReady() || !query.trim()) return []
  try {
    const queryVector = await generateEmbedding(query)
    return searchSimilarV2(queryVector, ENTITY_COLLECTION, topK, minScore)
  } catch (err) {
    console.warn('[EmbeddingIndex] semanticSearchEntities failed:', err)
    return []
  }
}

export async function semanticSearchMemory(
  query: string,
  topK: number = 5,
  minScore: number = 0.3,
): Promise<SearchResultV2[]> {
  if (!isEmbeddingReady() || !query.trim()) return []
  try {
    const queryVector = await generateEmbedding(query)
    return searchSimilarV2(queryVector, MEMORY_COLLECTION, topK, minScore)
  } catch (err) {
    console.warn('[EmbeddingIndex] semanticSearchMemory failed:', err)
    return []
  }
}

export async function getEmbeddingStats(): Promise<{ entities: number; memory: number }> {
  try {
    const [entities, memory] = await Promise.all([
      getCollectionSizeV2(ENTITY_COLLECTION),
      getCollectionSizeV2(MEMORY_COLLECTION),
    ])
    return { entities, memory }
  } catch {
    return { entities: 0, memory: 0 }
  }
}
