/**
 * Tauri 端知识库适配层（Phase D 迁入：知识墙依赖）
 *
 * 与共享包 @agent/kb/kb-store 保持同形 API（web 端为 IndexedDB），
 * 存储改为 Rust fs 落盘（用户决策：改为 Rust fs 落盘）：
 * - global 作用域 → {dataDir}/.worldsea/kb.json
 * - project 作用域 → {projectDir}/.worldsea/kb.json（与 entity-core 数据同目录）
 *
 * 读写复用现有命令层 cmd_fs_read / cmd_fs_write / cmd_get_app_data_dir，
 * 无新增 Rust 命令。数据在内存缓存 + 每次变更整体落盘（条目量级小，文件读写成本可接受）。
 */
import { invoke } from '../composables/transport'
import { getStorageBackend } from '@worldsea/entity-core'
import type { KBEntry, KBScope } from '@agent/kb/kb-store'

export interface KBWriteOptions {
  path: string
  scope: KBScope
  content: string
  mimeType?: string
  tags?: string[]
  entityId?: string
  summary?: string
}

interface KbFile {
  entries: KBEntry[]
  contents: Record<string, string>
}

// ── 内存缓存：scope → 文件内容（首次访问时从磁盘加载）──
const fileCache = new Map<KBScope, KbFile | null>()

/** 全局数据根目录（cmd_get_app_data_dir 结果缓存） */
let dataDirCache: string | null = null

async function getDataDir(): Promise<string> {
  if (dataDirCache) return dataDirCache
  dataDirCache = await invoke<string>('cmd_get_app_data_dir')
  return dataDirCache
}

/** 按作用域解析 kb.json 落盘路径 */
async function resolveKbPath(scope: KBScope): Promise<string> {
  const dataDir = await getDataDir()
  if (scope === 'global') {
    return `${dataDir}/.worldsea/kb.json`
  }
  // project scope：项目=目录（2026-09-03）——目录即项目，无独立绑定。
  // FileStorageBackend 绑定目录在项目 initialize/切换时已设置（无目录项目归 <home>/WorldSea/worlddata，E1）。
  const backend = getStorageBackend() as { projectDir?: string | null }
  const projectDir = backend.projectDir ?? null
  if (!projectDir) throw new Error('未绑定项目目录，无法访问项目知识库')
  return `${projectDir}/.worldsea/kb.json`
}

/** 读取 kb.json（不存在返回空结构） */
async function readFile(scope: KBScope): Promise<KbFile> {
  const path = await resolveKbPath(scope)
  try {
    const text = await invoke<string>('cmd_fs_read', { path })
    const parsed = JSON.parse(text) as KbFile
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      contents: parsed.contents && typeof parsed.contents === 'object' ? parsed.contents : {},
    }
  } catch {
    return { entries: [], contents: {} }
  }
}

/** 写入 kb.json（整体落盘，createDirs 保证目录存在） */
async function writeFile(scope: KBScope, data: KbFile): Promise<void> {
  const path = await resolveKbPath(scope)
  await invoke('cmd_fs_write', { path, content: JSON.stringify(data), createDirs: true })
}

/** 获取内存缓存（懒加载磁盘） */
async function getFile(scope: KBScope): Promise<KbFile> {
  if (!fileCache.has(scope)) {
    fileCache.set(scope, await readFile(scope))
  }
  return fileCache.get(scope)!
}

/** 变更后更新缓存并落盘 */
async function commit(scope: KBScope, data: KbFile): Promise<void> {
  fileCache.set(scope, data)
  await writeFile(scope, data)
}

function generateId(): string {
  return `kb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function guessMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    md: 'text/markdown', txt: 'text/plain', json: 'application/json',
    yml: 'text/yaml', yaml: 'text/yaml', html: 'text/html', css: 'text/css',
  }
  return map[ext] ?? 'text/plain'
}

/** 按 scope+path 找条目 */
function findEntry(data: KbFile, scope: KBScope, path: string): KBEntry | undefined {
  return data.entries.find(e => e.scope === scope && e.path === path)
}

/** 按 id 找条目（跨 scope） */
function findById(data: KbFile, id: string): KBEntry | undefined {
  return data.entries.find(e => e.id === id)
}

// ────────────────────────── 对外 API（与 @agent/kb/kb-store 同形）──────────────────────────

export async function getEntryByPath(scope: KBScope, path: string): Promise<KBEntry | undefined> {
  const data = await getFile(scope)
  return findEntry(data, scope, path)
}

export async function kbWrite(options: KBWriteOptions): Promise<KBEntry> {
  const data = await getFile(options.scope)
  const existing = findEntry(data, options.scope, options.path)
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
    data.entries = data.entries.map(e => (e.id === updated.id ? updated : e))
    data.contents[updated.id] = options.content
    await commit(options.scope, data)
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
  data.entries.push(entry)
  data.contents[entry.id] = options.content
  await commit(options.scope, data)
  return entry
}

export async function kbRead(scope: KBScope, path: string): Promise<(KBEntry & { content: string }) | null> {
  const data = await getFile(scope)
  const entry = findEntry(data, scope, path)
  if (!entry) return null
  entry.accessCount++
  entry.lastAccessedAt = Date.now()
  await commit(scope, data)
  return { ...entry, content: data.contents[entry.id] || '' }
}

export async function kbReadById(id: string): Promise<(KBEntry & { content: string }) | null> {
  // 跨 scope 读取：需在全局与项目两个文件中查找
  for (const scope of ['global', 'project'] as KBScope[]) {
    const data = await getFile(scope)
    const entry = findById(data, id)
    if (entry) {
      entry.accessCount++
      entry.lastAccessedAt = Date.now()
      await commit(scope, data)
      return { ...entry, content: data.contents[entry.id] || '' }
    }
  }
  return null
}

export async function kbList(scope?: KBScope, pathPrefix?: string): Promise<KBEntry[]> {
  const scopes: KBScope[] = scope ? [scope] : ['global', 'project']
  let results: KBEntry[] = []
  for (const s of scopes) {
    const data = await getFile(s)
    results = results.concat(data.entries.filter(e => e.scope === s))
  }
  if (pathPrefix) {
    results = results.filter(e => e.path.startsWith(pathPrefix))
  }
  return results
}

export async function kbDelete(scope: KBScope, path: string): Promise<boolean> {
  const data = await getFile(scope)
  const entry = findEntry(data, scope, path)
  if (!entry) return false
  data.entries = data.entries.filter(e => e.id !== entry.id)
  delete data.contents[entry.id]
  await commit(scope, data)
  return true
}

export async function kbDeleteById(id: string): Promise<boolean> {
  for (const scope of ['global', 'project'] as KBScope[]) {
    const data = await getFile(scope)
    if (findById(data, id)) {
      data.entries = data.entries.filter(e => e.id !== id)
      delete data.contents[id]
      await commit(scope, data)
      return true
    }
  }
  return false
}

export async function kbSearchKeyword(query: string, scope?: KBScope, limit: number = 20): Promise<KBEntry[]> {
  const q = query.toLowerCase()
  const all = await kbList(scope)
  return all
    .filter(e =>
      e.path.toLowerCase().includes(q) ||
      (e.summary && e.summary.toLowerCase().includes(q)) ||
      e.tags.some(t => t.toLowerCase().includes(q)),
    )
    .slice(0, limit)
}

export async function kbGetByEntity(entityId: string): Promise<KBEntry[]> {
  const all = await kbList()
  return all.filter(e => e.entityId === entityId)
}

export async function kbLinkEntity(scope: KBScope, path: string, entityId: string): Promise<boolean> {
  const data = await getFile(scope)
  const entry = findEntry(data, scope, path)
  if (!entry) return false
  entry.entityId = entityId
  await commit(scope, data)
  return true
}

export async function kbUnlinkEntity(scope: KBScope, path: string): Promise<boolean> {
  const data = await getFile(scope)
  const entry = findEntry(data, scope, path)
  if (!entry) return false
  delete entry.entityId
  await commit(scope, data)
  return true
}

export async function kbGetStats(): Promise<{ global: number; project: number; totalSize: number }> {
  const g = await getFile('global')
  const p = await getFile('project')
  let totalSize = 0
  for (const data of [g, p]) {
    for (const id of Object.keys(data.contents)) totalSize += (data.contents[id]?.length ?? 0) * 2
  }
  return { global: g.entries.length, project: p.entries.length, totalSize }
}

export async function kbGetTree(scope?: KBScope): Promise<Record<string, KBEntry[]>> {
  const all = await kbList(scope)
  const tree: Record<string, KBEntry[]> = {}
  for (const e of all) {
    const prefix = e.path.includes('/') ? e.path.substring(0, e.path.lastIndexOf('/')) : ''
    if (!tree[prefix]) tree[prefix] = []
    tree[prefix].push(e)
  }
  return tree
}

export async function kbEnsureStructure(scope: KBScope): Promise<void> {
  await getFile(scope)
}
