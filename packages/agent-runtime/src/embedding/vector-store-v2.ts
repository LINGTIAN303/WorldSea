/**
 * 优化版向量存储（int8 量化 + IndexedDB）
 *
 * 使用 int8 量化压缩向量存储空间（4x 压缩），
 * 搜索时直接在量化域计算余弦相似度，避免反量化开销。
 * 数据库名: worldsmith_vectors_v2, 存储对象: quantized_vectors
 */

import { quantizeInt8, cosineSimilarityInt8 } from './quantizer'

const DB_NAME = 'worldsmith_vectors_v2'
const DB_VERSION = 1
const STORE_NAME = 'quantized_vectors'

/** 写入时的向量记录格式 */
export interface VectorRecordV2 {
  id: string
  collection: string
  vector: Float32Array | number[]
  metadata: Record<string, any>
  updatedAt: number
}

/** 搜索结果 */
export interface SearchResultV2 {
  id: string
  score: number
  metadata: Record<string, any>
}

/** IndexedDB 内部存储格式（量化后） */
interface StoredRecord {
  id: string
  collection: string
  quantizedData: ArrayBuffer  // Int8Array 的底层 buffer
  scale: number
  offset: number
  dim: number
  metadata: Record<string, any>
  updatedAt: number
}

let dbInstance: IDBDatabase | null = null

/** 打开或创建 IndexedDB 数据库 */
function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('collection', 'collection', { unique: false })
      }
    }
    req.onsuccess = () => {
      dbInstance = req.result
      dbInstance.onclose = () => { dbInstance = null }
      dbInstance.onerror = () => { dbInstance = null }
      resolve(dbInstance)
    }
    req.onerror = () => reject(req.error)
  })
}

/** 将 Float32Array 或 number[] 统一转为 Float32Array */
function toFloat32(vec: Float32Array | number[]): Float32Array {
  return vec instanceof Float32Array ? vec : new Float32Array(vec)
}

/** 量化并存储单条向量记录 */
export async function putVectorV2(record: VectorRecordV2): Promise<void> {
  const vec = toFloat32(record.vector)
  const q = quantizeInt8(vec)
  const stored: StoredRecord = {
    id: record.id,
    collection: record.collection,
    quantizedData: q.data.buffer as ArrayBuffer,    scale: q.scale,
    offset: q.offset,
    dim: vec.length,
    metadata: record.metadata,
    updatedAt: record.updatedAt,
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(stored)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 批量量化并存储多条向量记录（单事务） */
export async function putVectorsV2(records: VectorRecordV2[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    for (const record of records) {
      const vec = toFloat32(record.vector)
      const q = quantizeInt8(vec)
      const stored: StoredRecord = {
        id: record.id,
        collection: record.collection,
        quantizedData: q.data.buffer as ArrayBuffer,        scale: q.scale,
        offset: q.offset,
        dim: vec.length,
        metadata: record.metadata,
        updatedAt: record.updatedAt,
      }
      store.put(stored)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 按 id 删除单条向量记录 */
export async function deleteVectorV2(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 获取指定集合的所有量化记录 */
export async function getCollectionV2(collection: string): Promise<StoredRecord[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const idx = tx.objectStore(STORE_NAME).index('collection')
    const req = idx.getAll(collection)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 获取指定集合的记录数量 */
export async function getCollectionSizeV2(collection: string): Promise<number> {
  const records = await getCollectionV2(collection)
  return records.length
}

/**
 * 量化相似度搜索
 *
 * 1. 将查询向量量化为 int8
 * 2. 从 IndexedDB 加载目标集合的所有量化记录
 * 3. 在量化域计算余弦相似度
 * 4. 按 score 降序排序，返回 topK 条结果
 */
export async function searchSimilarV2(
  queryVector: Float32Array | number[],
  collection: string,
  topK: number = 10,
  minScore: number = 0.3,
): Promise<SearchResultV2[]> {
  const query = quantizeInt8(toFloat32(queryVector))
  const records = await getCollectionV2(collection)

  const scored: SearchResultV2[] = []
  for (const r of records) {
    // 从 ArrayBuffer 重建 Int8Array
    const data = new Int8Array(r.quantizedData)
    const score = cosineSimilarityInt8(query, {
      data,
      scale: r.scale,
      offset: r.offset,
    })
    if (score >= minScore) {
      scored.push({ id: r.id, score, metadata: r.metadata })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
