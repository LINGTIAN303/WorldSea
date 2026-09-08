/**
 * IndexedDB 存储适配器（Web 环境回退实现）
 *
 * 当无文件系统访问时（如纯 Web 模式），使用 IndexedDB 作为存储后端。
 * 数据结构与 FsStorageAdapter 一致，但存储在 IndexedDB Object Stores 中。
 *
 * Object Stores:
 * - hooks: 钩子（keyPath: 'id'）
 * - memoryFiles: 记忆文件头（keyPath: 'fileId'）
 * - memoryChunks: 记忆文件分块（keyPath: ['fileId', 'chunkId']）
 * - indices: 汇总索引（keyPath: 'id', index: 'type'）
 * - trashHooks: H5.2 回收站钩子（keyPath: 'id'）
 * - trashFiles: H5.2 回收站记忆文件头（keyPath: 'fileId'）
 * - trashChunks: H5.2 回收站记忆文件分块（keyPath: ['fileId', 'chunkId']）
 */

import type { StorageAdapter } from '../adapters/StorageAdapter'
import type { ArchiveIndex, Hook, MemoryChunk, MemoryFileHeader } from '../types'

const DB_NAME = 'worldsea-memory-archive'
const DB_VERSION = 2
const STORE_HOOKS = 'hooks'
const STORE_FILES = 'memoryFiles'
const STORE_CHUNKS = 'memoryChunks'
const STORE_INDICES = 'indices'
const STORE_TRASH_HOOKS = 'trashHooks'
const STORE_TRASH_FILES = 'trashFiles'
const STORE_TRASH_CHUNKS = 'trashChunks'

export class IdbStorageAdapter implements StorageAdapter {
  private dbName: string
  private dbVersion: number
  private db: IDBDatabase | null = null

  constructor(options?: { dbName?: string; dbVersion?: number }) {
    this.dbName = options?.dbName || DB_NAME
    this.dbVersion = options?.dbVersion || DB_VERSION
  }

  // ===== DB 初始化 =====

  private async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_HOOKS)) {
          db.createObjectStore(STORE_HOOKS, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          db.createObjectStore(STORE_FILES, { keyPath: 'fileId' })
        }
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          const store = db.createObjectStore(STORE_CHUNKS, {
            keyPath: ['fileId', 'chunkId'],
          })
          store.createIndex('fileId', 'fileId', { unique: false })
        }
        if (!db.objectStoreNames.contains(STORE_INDICES)) {
          const store = db.createObjectStore(STORE_INDICES, { keyPath: 'id' })
          store.createIndex('type', 'type', { unique: false })
        }
        // H5.2 回收站 stores
        if (!db.objectStoreNames.contains(STORE_TRASH_HOOKS)) {
          db.createObjectStore(STORE_TRASH_HOOKS, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORE_TRASH_FILES)) {
          db.createObjectStore(STORE_TRASH_FILES, { keyPath: 'fileId' })
        }
        if (!db.objectStoreNames.contains(STORE_TRASH_CHUNKS)) {
          const store = db.createObjectStore(STORE_TRASH_CHUNKS, {
            keyPath: ['fileId', 'chunkId'],
          })
          store.createIndex('fileId', 'fileId', { unique: false })
        }
      }
    })
  }

  private async transaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      const store = tx.objectStore(storeName)
      const request = fn(store)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  // ===== 钩子操作 =====

  async saveHook(hook: Hook): Promise<void> {
    await this.transaction(STORE_HOOKS, 'readwrite', store => store.put(hook))
  }

  async loadHook(hookId: string): Promise<Hook | null> {
    const result = await this.transaction<Hook | undefined>(
      STORE_HOOKS,
      'readonly',
      store => store.get(hookId)
    )
    return result || null
  }

  async loadAllHooks(): Promise<Hook[]> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HOOKS, 'readonly')
      const store = tx.objectStore(STORE_HOOKS)
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result as Hook[])
      request.onerror = () => reject(request.error)
    })
  }

  async deleteHook(hookId: string): Promise<void> {
    await this.transaction(STORE_HOOKS, 'readwrite', store => store.delete(hookId))
  }

  // ===== 记忆文件操作 =====

  async saveMemoryFile(
    fileId: string,
    header: MemoryFileHeader,
    chunks: MemoryChunk[]
  ): Promise<void> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_CHUNKS], 'readwrite')
      const fileStore = tx.objectStore(STORE_FILES)
      const chunkStore = tx.objectStore(STORE_CHUNKS)

      // 写入 header
      fileStore.put(header)

      // 写入每个 chunk（附带 fileId 用于索引）
      for (const chunk of chunks) {
        chunkStore.put({ ...chunk, fileId })
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async loadMemoryFileChunk(fileId: string, chunkId: string): Promise<MemoryChunk> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly')
      const store = tx.objectStore(STORE_CHUNKS)
      const request = store.get([fileId, chunkId])
      request.onsuccess = () => {
        const result = request.result
        if (!result) {
          reject(new Error(`Chunk not found: fileId=${fileId}, chunkId=${chunkId}`))
          return
        }
        // 移除附加的 fileId 字段
        const { fileId: _, ...chunk } = result
        resolve(chunk as MemoryChunk)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async deleteMemoryFile(fileId: string): Promise<void> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_CHUNKS], 'readwrite')
      const fileStore = tx.objectStore(STORE_FILES)
      const chunkStore = tx.objectStore(STORE_CHUNKS)
      const chunkIndex = chunkStore.index('fileId')

      // 删除 header
      fileStore.delete(fileId)

      // 删除所有关联的 chunks
      const cursorRequest = chunkIndex.openCursor(IDBKeyRange.only(fileId))
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async listMemoryFiles(): Promise<{ id: string; size: number }[]> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly')
      const store = tx.objectStore(STORE_FILES)
      const request = store.getAll()
      request.onsuccess = () => {
        const headers = request.result as MemoryFileHeader[]
        resolve(headers.map(h => ({ id: h.fileId, size: h.totalTokens })))
      }
      request.onerror = () => reject(request.error)
    })
  }

  // ===== 索引操作 =====

  async saveIndex(index: ArchiveIndex): Promise<void> {
    await this.transaction(STORE_INDICES, 'readwrite', store => store.put(index))
  }

  async loadIndices(type: 'daily' | 'weekly'): Promise<ArchiveIndex[]> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INDICES, 'readonly')
      const store = tx.objectStore(STORE_INDICES)
      const index = store.index('type')
      const request = index.getAll(IDBKeyRange.only(type))
      request.onsuccess = () => resolve(request.result as ArchiveIndex[])
      request.onerror = () => reject(request.error)
    })
  }

  // ===== 统计 =====

  async getStorageStats(): Promise<{
    totalHooks: number
    totalFiles: number
    totalBytes: number
  }> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_HOOKS, STORE_FILES, STORE_CHUNKS], 'readonly')
      const hookStore = tx.objectStore(STORE_HOOKS)
      const fileStore = tx.objectStore(STORE_FILES)

      let totalHooks = 0
      let totalFiles = 0
      let totalBytes = 0

      const hookCountReq = hookStore.count()
      hookCountReq.onsuccess = () => {
        totalHooks = hookCountReq.result
      }

      const fileCountReq = fileStore.count()
      fileCountReq.onsuccess = () => {
        totalFiles = fileCountReq.result
      }

      // 估算字节数（通过遍历所有 hooks 的 summary 长度）
      const hookReq = hookStore.getAll()
      hookReq.onsuccess = () => {
        const hooks = hookReq.result as Hook[]
        totalBytes = hooks.reduce(
          (sum, h) => sum + (h.summary?.length || 0) * 2,
          0
        )
      }

      tx.oncomplete = () => resolve({ totalHooks, totalFiles, totalBytes })
      tx.onerror = () => reject(tx.error)
    })
  }

  // ===== 回收站（H5.2 新增） =====

  async moveToTrash(hookId: string): Promise<void> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_HOOKS, STORE_TRASH_HOOKS], 'readwrite')
      const hookStore = tx.objectStore(STORE_HOOKS)
      const trashHookStore = tx.objectStore(STORE_TRASH_HOOKS)

      const getReq = hookStore.get(hookId)
      getReq.onsuccess = () => {
        const hook = getReq.result as Hook | undefined
        if (!hook) {
          // 钩子不存在，跳过
          return
        }
        trashHookStore.put(hook)
        hookStore.delete(hookId)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async moveMemoryFileToTrash(fileId: string): Promise<void> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_FILES, STORE_CHUNKS, STORE_TRASH_FILES, STORE_TRASH_CHUNKS],
        'readwrite'
      )
      const fileStore = tx.objectStore(STORE_FILES)
      const chunkStore = tx.objectStore(STORE_CHUNKS)
      const trashFileStore = tx.objectStore(STORE_TRASH_FILES)
      const trashChunkStore = tx.objectStore(STORE_TRASH_CHUNKS)

      // 移动 header
      const headerReq = fileStore.get(fileId)
      headerReq.onsuccess = () => {
        const header = headerReq.result
        if (header) {
          trashFileStore.put(header)
          fileStore.delete(fileId)
        }
      }

      // 移动 chunks
      const chunkIndex = chunkStore.index('fileId')
      const chunkCursorReq = chunkIndex.openCursor(IDBKeyRange.only(fileId))
      chunkCursorReq.onsuccess = () => {
        const cursor = chunkCursorReq.result
        if (cursor) {
          trashChunkStore.put(cursor.value)
          cursor.delete()
          cursor.continue()
        }
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async restoreFromTrash(hookId: string): Promise<void> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_TRASH_HOOKS, STORE_HOOKS, STORE_TRASH_FILES, STORE_TRASH_CHUNKS, STORE_FILES, STORE_CHUNKS],
        'readwrite'
      )
      const trashHookStore = tx.objectStore(STORE_TRASH_HOOKS)
      const hookStore = tx.objectStore(STORE_HOOKS)
      const trashFileStore = tx.objectStore(STORE_TRASH_FILES)
      const trashChunkStore = tx.objectStore(STORE_TRASH_CHUNKS)
      const fileStore = tx.objectStore(STORE_FILES)
      const chunkStore = tx.objectStore(STORE_CHUNKS)

      let hook: Hook | undefined

      const getReq = trashHookStore.get(hookId)
      getReq.onsuccess = () => {
        hook = getReq.result as Hook | undefined
        if (!hook) {
          return
        }
        hookStore.put(hook)
        trashHookStore.delete(hookId)

        // 恢复关联的记忆文件
        const fileId = hook.fileId
        const headerReq = trashFileStore.get(fileId)
        headerReq.onsuccess = () => {
          const header = headerReq.result
          if (header) {
            fileStore.put(header)
            trashFileStore.delete(fileId)
          }
        }

        const chunkIndex = trashChunkStore.index('fileId')
        const chunkCursorReq = chunkIndex.openCursor(IDBKeyRange.only(fileId))
        chunkCursorReq.onsuccess = () => {
          const cursor = chunkCursorReq.result
          if (cursor) {
            chunkStore.put(cursor.value)
            cursor.delete()
            cursor.continue()
          }
        }
      }

      tx.oncomplete = () => {
        if (!hook) {
          reject(new Error(`Trashed hook not found: ${hookId}`))
        } else {
          resolve()
        }
      }
      tx.onerror = () => reject(tx.error)
    })
  }

  async listTrashedHooks(): Promise<Hook[]> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRASH_HOOKS, 'readonly')
      const store = tx.objectStore(STORE_TRASH_HOOKS)
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result as Hook[])
      req.onerror = () => reject(req.error)
    })
  }

  async emptyTrash(beforeTimestamp?: number): Promise<{ hooks: number; files: number }> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_TRASH_HOOKS, STORE_TRASH_FILES, STORE_TRASH_CHUNKS],
        'readwrite'
      )
      const trashHookStore = tx.objectStore(STORE_TRASH_HOOKS)
      const trashFileStore = tx.objectStore(STORE_TRASH_FILES)
      const trashChunkStore = tx.objectStore(STORE_TRASH_CHUNKS)

      let hooksDeleted = 0
      let filesDeleted = 0
      const fileIdsToClean: string[] = []

      const cursorReq = trashHookStore.openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor) {
          const hook = cursor.value as Hook
          // 按时间戳过滤
          if (!beforeTimestamp || !hook.trashedAt || hook.trashedAt <= beforeTimestamp) {
            fileIdsToClean.push(hook.fileId)
            cursor.delete()
            hooksDeleted++
          }
          cursor.continue()
        }
      }

      // 清理 trashFiles 和 trashChunks
      const fileCursorReq = trashFileStore.openCursor()
      fileCursorReq.onsuccess = () => {
        const cursor = fileCursorReq.result
        if (cursor) {
          const fileId = (cursor.value as MemoryFileHeader).fileId
          if (fileIdsToClean.includes(fileId) || !beforeTimestamp) {
            // 删除关联的 chunks
            const chunkIndex = trashChunkStore.index('fileId')
            const chunkCursorReq = chunkIndex.openCursor(IDBKeyRange.only(fileId))
            chunkCursorReq.onsuccess = () => {
              const chunkCursor = chunkCursorReq.result
              if (chunkCursor) {
                chunkCursor.delete()
                chunkCursor.continue()
              }
            }
            cursor.delete()
            filesDeleted++
          }
          cursor.continue()
        }
      }

      tx.oncomplete = () => resolve({ hooks: hooksDeleted, files: filesDeleted })
      tx.onerror = () => reject(tx.error)
    })
  }
}
