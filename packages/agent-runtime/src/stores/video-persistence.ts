/**
 * 视频持久化存储模块
 * 基于 IndexedDB 实现，用于存储通过 AI 生成的视频元数据和 Blob
 *
 * 数据库: worldsmith_videos (v1)
 * 对象仓库: videos (keyPath: id)
 * 索引: createdAt, provider, path
 *
 * 虚拟路径格式: /videos/generated/{date}/{caption}-{blockId}.mp4
 */

const DB_NAME = 'worldsmith_videos'
const DB_VERSION = 1
const STORE_NAME = 'videos'

/** 持久化存储的视频记录 */
export interface PersistedVideo {
  /** 唯一标识 */
  id: string
  /** 虚拟文件路径 */
  path: string
  /** 视频二进制数据（可能为空，异步下载后填充） */
  blob?: Blob
  /** 生成视频时使用的提示词 */
  prompt: string
  /** 视频生成模型 ID */
  model: string
  /** 视频生成供应商 */
  provider: string
  /** 视频尺寸，例如 1152x768 */
  size: string
  /** 创建时间戳 (ms) */
  createdAt: number
  /** 视频说明文字 (可选) */
  caption?: string
  /** 视频时长（秒） */
  duration?: number
  /** 远程视频 URL（下载前暂存） */
  remoteUrl?: string
  /** 异步任务 ID */
  taskId?: string
  /** 任务状态: pending / processing / completed / failed */
  taskStatus?: string
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
        store.createIndex('provider', 'provider', { unique: false })
        store.createIndex('path', 'path', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 存储或更新一条视频记录 */
export async function persistVideo(video: PersistedVideo): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(video)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

/** 根据 ID 获取单条视频记录 */
export async function getVideo(id: string): Promise<PersistedVideo | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(id)
    req.onsuccess = () => { db.close(); resolve(req.result ?? undefined) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

/** 按虚拟路径前缀查询视频 */
export async function getVideosByPathPrefix(prefix: string): Promise<PersistedVideo[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('path')
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff')
    const req = index.getAll(range)
    req.onsuccess = () => { db.close(); resolve(req.result ?? []) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

/** 获取所有已存储的视频 */
export async function getAllVideos(): Promise<PersistedVideo[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('createdAt')
    const req = index.getAll()
    req.onsuccess = () => { db.close(); resolve(req.result ?? []) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

/** 根据 ID 删除单条视频记录 */
export async function deleteVideo(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

/** 获取已存储的视频总数 */
export async function getVideoCount(): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.count()
    req.onsuccess = () => { db.close(); resolve(req.result) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

/** 将远程 URL 下载为 Blob */
export async function urlToBlob(url: string): Promise<Blob> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`下载视频失败: ${resp.status}`)
  return resp.blob()
}

/** 将 Blob 转换为 Data URL */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
