import { cosineSimilarity } from './service'

const DB_NAME = 'worldsmith_vectors'
const DB_VERSION = 1
const STORE_NAME = 'vectors'

export interface VectorRecord {
  id: string
  collection: string
  vector: number[]
  metadata: Record<string, any>
  updatedAt: number
}

let dbInstance: IDBDatabase | null = null

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

export async function putVector(record: VectorRecord): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function putVectors(records: VectorRecord[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    for (const r of records) {
      store.put(r)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getVector(id: string): Promise<VectorRecord | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteVector(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getCollection(collection: string): Promise<VectorRecord[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const idx = tx.objectStore(STORE_NAME).index('collection')
    const req = idx.getAll(collection)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface SearchResult {
  id: string
  score: number
  metadata: Record<string, any>
}

export async function searchSimilar(
  queryVector: number[],
  collection: string,
  topK: number = 10,
  minScore: number = 0.3,
): Promise<SearchResult[]> {
  const records = await getCollection(collection)
  const scored = records.map(r => ({
    id: r.id,
    score: cosineSimilarity(queryVector, r.vector),
    metadata: r.metadata,
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.filter(s => s.score >= minScore).slice(0, topK)
}

export async function deleteCollection(collection: string): Promise<void> {
  const records = await getCollection(collection)
  if (records.length === 0) return
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    for (const r of records) {
      store.delete(r.id)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getCollectionSize(collection: string): Promise<number> {
  const records = await getCollection(collection)
  return records.length
}
