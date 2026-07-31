/**
 * 知识库存储层
 *
 * 基于 IndexedDB 的知识库存储，支持双层作用域：
 * - global: 跨项目持久（用户画像、偏好、模式）
 * - project: 项目级持久（世界观知识、实体洞察、决策记录）
 *
 * 数据模型：
 * - KBEntry: 知识条目（id/path/scope/content/tags/entityId/时间戳/访问统计）
 * - 存储在 IndexedDB 'worldsmith_kb' 数据库中
 * - 按 scope + path 唯一索引
 */

export type KBScope = 'global' | 'project'

export interface KBEntry {
  id: string
  path: string
  scope: KBScope
  content: string
  mimeType: string
  tags: string[]
  entityId?: string
  summary?: string
  createdAt: number
  updatedAt: number
  accessCount: number
  lastAccessedAt: number
}

const DB_NAME = 'worldsmith_kb'
const DB_VERSION = 1
const ENTRY_STORE = 'entries'
const CONTENT_STORE = 'contents'

let dbInstance: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(ENTRY_STORE)) {
        const entryStore = db.createObjectStore(ENTRY_STORE, { keyPath: 'id' })
        entryStore.createIndex('scope_path', ['scope', 'path'], { unique: true })
        entryStore.createIndex('scope', 'scope', { unique: false })
        entryStore.createIndex('entityId', 'entityId', { unique: false })
        entryStore.createIndex('tags', 'tags', { unique: false, multiEntry: true })
      }
      if (!db.objectStoreNames.contains(CONTENT_STORE)) {
        db.createObjectStore(CONTENT_STORE, { keyPath: 'id' })
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

export interface KBContentRecord {
  id: string
  content: string
}

async function putEntry(entry: KBEntry, includeContent: boolean = true): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ENTRY_STORE, CONTENT_STORE], 'readwrite')
    const { content: _content, ...meta } = entry
    tx.objectStore(ENTRY_STORE).put(meta as any)
    if (includeContent) {
      tx.objectStore(CONTENT_STORE).put({ id: entry.id, content: entry.content })
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function getEntry(id: string): Promise<KBEntry | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, 'readonly')
    const req = tx.objectStore(ENTRY_STORE).get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getEntryByPath(scope: KBScope, path: string): Promise<KBEntry | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, 'readonly')
    const idx = tx.objectStore(ENTRY_STORE).index('scope_path')
    const req = idx.get([scope, path])
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getContent(id: string): Promise<string | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTENT_STORE, 'readonly')
    const req = tx.objectStore(CONTENT_STORE).get(id)
    req.onsuccess = () => resolve(req.result?.content)
    req.onerror = () => reject(req.error)
  })
}

async function deleteEntry(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ENTRY_STORE, CONTENT_STORE], 'readwrite')
    tx.objectStore(ENTRY_STORE).delete(id)
    tx.objectStore(CONTENT_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function listEntries(scope?: KBScope, pathPrefix?: string): Promise<KBEntry[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, 'readonly')
    const req = scope
      ? tx.objectStore(ENTRY_STORE).index('scope').getAll(scope)
      : tx.objectStore(ENTRY_STORE).getAll()
    req.onsuccess = () => {
      let results: KBEntry[] = req.result || []
      if (pathPrefix) {
        results = results.filter(e => e.path.startsWith(pathPrefix))
      }
      resolve(results)
    }
    req.onerror = () => reject(req.error)
  })
}

async function getEntriesByEntity(entityId: string): Promise<KBEntry[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, 'readonly')
    const idx = tx.objectStore(ENTRY_STORE).index('entityId')
    const req = idx.getAll(entityId)
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

function generateId(): string {
  return `kb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export interface KBWriteOptions {
  path: string
  scope: KBScope
  content: string
  mimeType?: string
  tags?: string[]
  entityId?: string
  summary?: string
}

export async function kbWrite(options: KBWriteOptions): Promise<KBEntry> {
  const existing = await getEntryByPath(options.scope, options.path)
  const now = Date.now()

  if (existing) {
    const updated: KBEntry = {
      ...existing,
      content: options.content,
      mimeType: options.mimeType || existing.mimeType,
      tags: options.tags || existing.tags,
      entityId: options.entityId ?? existing.entityId,
      summary: options.summary ?? existing.summary,
      updatedAt: now,
      lastAccessedAt: now,
    }
    await putEntry(updated)
    return updated
  }

  const entry: KBEntry = {
    id: generateId(),
    path: options.path,
    scope: options.scope,
    content: options.content,
    mimeType: options.mimeType || guessMimeType(options.path),
    tags: options.tags || [],
    entityId: options.entityId,
    summary: options.summary,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    lastAccessedAt: now,
  }
  await putEntry(entry)
  return entry
}

export async function kbRead(scope: KBScope, path: string): Promise<(KBEntry & { content: string }) | null> {
  const entry = await getEntryByPath(scope, path)
  if (!entry) return null
  const content = await getContent(entry.id)
  entry.accessCount++
  entry.lastAccessedAt = Date.now()
  await putEntry(entry)
  return { ...entry, content: content || '' }
}

export async function kbReadById(id: string): Promise<(KBEntry & { content: string }) | null> {
  const entry = await getEntry(id)
  if (!entry) return null
  const content = await getContent(entry.id)
  entry.accessCount++
  entry.lastAccessedAt = Date.now()
  await putEntry(entry)
  return { ...entry, content: content || '' }
}

export async function kbList(scope?: KBScope, pathPrefix?: string): Promise<KBEntry[]> {
  const entries = await listEntries(scope, pathPrefix)
  return entries.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function kbDelete(scope: KBScope, path: string): Promise<boolean> {
  const entry = await getEntryByPath(scope, path)
  if (!entry) return false
  await deleteEntry(entry.id)
  return true
}

export async function kbDeleteById(id: string): Promise<boolean> {
  const entry = await getEntry(id)
  if (!entry) return false
  await deleteEntry(id)
  return true
}

export async function kbSearchKeyword(query: string, scope?: KBScope, limit: number = 20): Promise<KBEntry[]> {
  const entries = await listEntries(scope)
  const q = query.toLowerCase()
  const scored = await Promise.all(entries.map(async e => {
    let score = 0
    if (e.path.toLowerCase().includes(q)) score += 3
    if (e.summary && e.summary.toLowerCase().includes(q)) score += 2
    for (const tag of e.tags) {
      if (tag.toLowerCase() === q) score += 4
      else if (tag.toLowerCase().includes(q)) score += 1
    }
    if (score === 0) {
      const content = await getContent(e.id)
      if (content && content.toLowerCase().includes(q)) score += 1
    }
    score += e.accessCount * 0.05
    return { entry: e, score }
  }))
  const filtered = scored.filter(s => s.score > 0)
  filtered.sort((a, b) => b.score - a.score)
  return filtered.slice(0, limit).map(s => s.entry)
}

export async function kbGetByEntity(entityId: string): Promise<KBEntry[]> {
  return getEntriesByEntity(entityId)
}

export async function kbLinkEntity(scope: KBScope, path: string, entityId: string): Promise<boolean> {
  const entry = await getEntryByPath(scope, path)
  if (!entry) return false
  entry.entityId = entityId
  entry.updatedAt = Date.now()
  await putEntry(entry)
  return true
}

export async function kbUnlinkEntity(scope: KBScope, path: string): Promise<boolean> {
  const entry = await getEntryByPath(scope, path)
  if (!entry) return false
  delete entry.entityId
  entry.updatedAt = Date.now()
  await putEntry(entry)
  return true
}

export async function kbGetStats(): Promise<{ global: number; project: number; totalSize: number }> {
  const all = await listEntries()
  let totalSize = 0
  let globalCount = 0
  let projectCount = 0
  for (const e of all) {
    if (e.scope === 'global') globalCount++
    else projectCount++
    const c = await getContent(e.id)
    totalSize += c?.length || 0
  }
  return { global: globalCount, project: projectCount, totalSize }
}

export async function kbGetTree(scope?: KBScope): Promise<Record<string, KBEntry[]>> {
  const entries = await listEntries(scope)
  const tree: Record<string, KBEntry[]> = {}
  for (const e of entries) {
    if (e.path.endsWith('/.dir')) continue
    const dir = e.path.includes('/') ? e.path.substring(0, e.path.lastIndexOf('/')) : ''
    if (!tree[dir]) tree[dir] = []
    tree[dir].push(e)
  }
  return tree
}

export async function kbEnsureStructure(scope: KBScope): Promise<void> {
  const dirs = [
    'profile',
    'project',
    'entities',
    'reflections',
    'reflections/weekly',
    'scratch',
  ]
  for (const dir of dirs) {
    const indexPath = `${dir}/.dir`
    const existing = await getEntryByPath(scope, indexPath)
    if (!existing) {
      await kbWrite({
        path: indexPath,
        scope,
        content: '',
        mimeType: 'text/plain',
        tags: ['_dir'],
      })
    }
  }
}

function guessMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    md: 'text/markdown',
    txt: 'text/plain',
    json: 'application/json',
    yaml: 'text/yaml',
    yml: 'text/yaml',
  }
  return map[ext || ''] || 'text/markdown'
}
