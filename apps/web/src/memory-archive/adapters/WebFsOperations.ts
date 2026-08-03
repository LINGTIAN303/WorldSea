/**
 * WebFsOperations — Web 端 FsOperations 实现（IndexedDB 路径 → 内容存储）
 *
 * 对应 Tauri 端 apps/tauri/src/memory-archive/adapters/TauriFsOperations.ts。
 * Web 端无文件系统，使用 IndexedDB 模拟"路径 → 文本内容"的扁平存储，
 * 供 MetaStorage（调度器元数据）持久化使用。归档主体数据走 IdbStorageAdapter。
 */

import type { FsOperations } from '@worldsmith/memory-archive'

const DB_NAME = 'worldsmith-memory-archive'
const DB_VERSION = 2
const STORE_META = 'fsMeta'

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      // 版本可能已由 IdbStorageAdapter 升级，此处确保 meta store 存在
      resolve(db)
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'path' })
      }
    }
  })
  return dbPromise
}

/** 确保 store 存在（IdbStorageAdapter 先升级数据库时可能缺少本 store） */
async function ensureStore(db: IDBDatabase): Promise<IDBObjectStore | null> {
  if (db.objectStoreNames.contains(STORE_META)) {
    return db.transaction(STORE_META, 'readwrite').objectStore(STORE_META)
  }
  // store 不存在（数据库版本由 IdbStorageAdapter 建立）：退化为内存存储
  return null
}

// 内存兜底（store 缺失时）
const memoryStore = new Map<string, string>()

async function get(path: string): Promise<string | null> {
  const db = await getDb()
  const store = await ensureStore(db)
  if (!store) return memoryStore.get(path) ?? null
  return new Promise((resolve) => {
    const req = store.get(path)
    req.onerror = () => resolve(null)
    req.onsuccess = () => {
      const record = req.result as { path: string; content: string } | undefined
      resolve(record?.content ?? null)
    }
  })
}

async function put(path: string, content: string): Promise<void> {
  const db = await getDb()
  const store = await ensureStore(db)
  if (!store) {
    memoryStore.set(path, content)
    return
  }
  return new Promise((resolve, reject) => {
    const req = store.put({ path, content })
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
}

async function del(path: string): Promise<void> {
  const db = await getDb()
  const store = await ensureStore(db)
  if (!store) {
    memoryStore.delete(path)
    return
  }
  return new Promise((resolve, reject) => {
    const req = store.delete(path)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
}

async function list(prefix: string): Promise<string[]> {
  const db = await getDb()
  const store = await ensureStore(db)
  if (!store) {
    return [...memoryStore.keys()].filter((k) => k.startsWith(prefix))
  }
  return new Promise((resolve, reject) => {
    const req = store.getAllKeys()
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const all = req.result as string[]
      resolve(all.filter((k) => k.startsWith(prefix)))
    }
  })
}

export function createWebFsOperations(): FsOperations {
  return {
    async readFile(path: string): Promise<string> {
      const content = await get(path)
      if (content === null) throw new Error(`[WebFsOperations] 文件不存在: ${path}`)
      return content
    },
    async writeFile(path: string, content: string): Promise<void> {
      await put(path, content)
    },
    async mkdir(): Promise<void> {
      // IndexedDB 扁平存储，无目录概念
    },
    async remove(path: string): Promise<void> {
      await del(path)
    },
    async exists(path: string): Promise<boolean> {
      const content = await get(path)
      return content !== null
    },
    async readDir(path: string): Promise<string[]> {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const all = await list(prefix)
      // 只返回直接子级（去掉更深层），并去除尾部斜杠
      const direct = new Set<string>()
      for (const k of all) {
        const rest = k.slice(prefix.length)
        const slash = rest.indexOf('/')
        direct.add(slash === -1 ? rest : rest.slice(0, slash))
      }
      return [...direct]
    },
  }
}
