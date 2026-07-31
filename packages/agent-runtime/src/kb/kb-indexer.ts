/**
 * 知识库向量索引
 *
 * 将 KB 条目自动写入向量索引，支持语义搜索。
 * 复用 embedding/service.ts 的 Embedding API 和 embedding/vector-store.ts 的 IndexedDB 向量库。
 *
 * 集合名: 'knowledge'
 * ID 格式: 'kb_{entryId}'
 */

import { generateEmbedding } from '../embedding/service'
import { putVectors, deleteVector, searchSimilar, getCollectionSize, type SearchResult } from '../embedding/vector-store'
import { isEmbeddingReady } from '../embedding/index'
import type { KBEntry } from './kb-store'

const KB_COLLECTION = 'knowledge'

export { isEmbeddingReady }

function kbEntryToText(entry: KBEntry): string {
  const parts: string[] = []
  if (entry.summary) parts.push(entry.summary)
  parts.push(entry.path)
  for (const tag of entry.tags) parts.push(tag)
  if (entry.content) {
    parts.push(entry.content.slice(0, 1500))
  }
  return parts.join(' ').slice(0, 2000)
}

export async function indexKBEntry(entry: KBEntry): Promise<void> {
  if (!isEmbeddingReady()) return
  try {
    const text = kbEntryToText(entry)
    const vector = await generateEmbedding(text)
    await putVectors([{
      id: `kb_${entry.id}`,
      collection: KB_COLLECTION,
      vector,
      metadata: {
        entryId: entry.id,
        path: entry.path,
        scope: entry.scope,
        tags: entry.tags,
        entityId: entry.entityId,
        summary: entry.summary,
        updatedAt: entry.updatedAt,
      },
      updatedAt: Date.now(),
    }])
  } catch (err) {
    console.warn('[KB-Indexer] indexKBEntry failed:', err)
  }
}

export async function removeKBIndex(entryId: string): Promise<void> {
  try {
    await deleteVector(`kb_${entryId}`)
  } catch (err) {
    console.warn('[KB-Indexer] removeKBIndex failed:', err)
  }
}

export async function semanticSearchKB(
  query: string,
  topK: number = 10,
  minScore: number = 0.3,
  scope?: 'global' | 'project',
): Promise<SearchResult[]> {
  if (!isEmbeddingReady() || !query.trim()) return []
  try {
    const queryVector = await generateEmbedding(query)
    const results = await searchSimilar(queryVector, KB_COLLECTION, topK * 2, minScore)
    if (scope) {
      return results.filter(r => r.metadata?.scope === scope).slice(0, topK)
    }
    return results.slice(0, topK)
  } catch (err) {
    console.warn('[KB-Indexer] semanticSearchKB failed:', err)
    return []
  }
}

export async function getKBIndexStats(): Promise<number> {
  try {
    return await getCollectionSize(KB_COLLECTION)
  } catch {
    return 0
  }
}
