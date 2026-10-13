import type { Entity } from '../types'
import type { Relation } from '../types'
import type { ProjectFile, ProjectFileContent } from '../types'
import Dexie from 'dexie'
import { type WorldDatabase, db as legacyDb } from './database'
import { getProjectManager } from './ProjectManager'
import { FileStorageBackend } from './FileStorageBackend'

/**
 * 结构化存储错误 — Tauri IPC 和 Web 端通用
 */
export class StorageError extends Error {
  /** 错误分类，便于 UI 层展示不同的提示 */
  readonly category: 'permission' | 'corruption' | 'disk_full' | 'not_found' | 'network' | 'unknown'
  /** 原始命令（仅 Tauri 端） */
  readonly command?: string
  /** 是否可重试 */
  readonly retryable: boolean

  constructor(options: {
    message: string
    category?: StorageError['category']
    command?: string
    retryable?: boolean
    cause?: unknown
  }) {
    super(options.message, { cause: options.cause })
    this.name = 'StorageError'
    this.category = options.category ?? 'unknown'
    this.command = options.command
    this.retryable = options.retryable ?? false
  }
}

/**
 * 从 Tauri IPC 错误中提取分类
 */
function classifyTauriError(error: unknown, cmd: string): StorageError {
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()

  let category: StorageError['category'] = 'unknown'
  let retryable = false

  if (lower.includes('permission') || lower.includes('access denied') || lower.includes('权限')) {
    category = 'permission'
  } else if (lower.includes('disk full') || lower.includes('no space') || lower.includes('磁盘满') || lower.includes('空间不足')) {
    category = 'disk_full'
  } else if (lower.includes('corrupt') || lower.includes('损坏') || lower.includes('malformed')) {
    category = 'corruption'
  } else if (lower.includes('not found') || lower.includes('未找到') || lower.includes('不存在')) {
    category = 'not_found'
  } else if (lower.includes('network') || lower.includes('timeout') || lower.includes('网络') || lower.includes('超时')) {
    category = 'network'
    retryable = true
  }

  return new StorageError({
    message: `[Storage] ${cmd} 失败: ${msg}`,
    category,
    command: cmd,
    retryable,
    cause: error,
  })
}

/** 实体分页查询参数（对应 entityStore.loadByPage） */
export interface EntityPageQuery {
  type?: string
  offset: number
  limit: number
  sortBy?: 'updatedAt' | 'createdAt' | 'name'
  sortDir?: 'asc' | 'desc'
}

/** 实体分页查询结果 */
export interface EntityPageResult {
  items: Entity[]
  total: number
}

/**
 * 实体搜索的 DB 可下推过滤条件。
 * 仅包含能被 Dexie 索引处理的字段（type / updatedAt 范围）；
 * 子串 / tags / properties / createdAt 等无法下推的条件由调用方在 JS 层过滤。
 */
export interface EntitySearchFilter {
  type?: string
  updatedAfter?: string
  updatedBefore?: string
}

/**
 * 内存分页 + 排序的通用实现。
 * 用于 Tauri / File 后端（无 DB 索引），以及 Web 端 createdAt 等无索引字段的回退。
 */
export function paginateEntitiesInMemory(
  raw: Entity[],
  query: EntityPageQuery,
): EntityPageResult {
  const all = raw.filter((e): e is Entity => e != null && typeof e.id === 'string')
  const sortKey = query.sortBy ?? 'updatedAt'
  const sorted = [...all].sort((a, b) => {
    const av = String((a as any)[sortKey] ?? '')
    const bv = String((b as any)[sortKey] ?? '')
    return query.sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
  })
  return {
    items: sorted.slice(query.offset, query.offset + query.limit),
    total: sorted.length,
  }
}

/**
 * 内存版搜索过滤，用于 Tauri / File 后端（无 DB 索引）。
 * 与 Web 端 Dexie 索引下推保持一致的过滤语义。
 */
export function filterEntitiesInMemory(raw: Entity[], filter: EntitySearchFilter): Entity[] {
  return raw.filter((e): e is Entity => {
    if (e == null || typeof e.id !== 'string') return false
    if (filter.type && e.type !== filter.type) return false
    if (filter.updatedAfter && (e.updatedAt ?? '') < filter.updatedAfter) return false
    if (filter.updatedBefore && (e.updatedAt ?? '') > filter.updatedBefore) return false
    return true
  })
}

export interface StorageBackend {
  getAllEntities(): Promise<Entity[]>
  getEntity(id: string): Promise<Entity | undefined>
  getEntitiesByType(type: string): Promise<Entity[]>
  /**
   * 分页查询实体（排序 + 分页）。
   * Web 端利用 updatedAt/name 索引做 DB 层分页；Tauri/File 端回退为全量读取 + JS 排序。
   */
  loadEntitiesPage(query: EntityPageQuery): Promise<EntityPageResult>
  /**
   * 按 DB 可索引条件（type / updatedAt 范围）缩小候选实体集。
   * 子串 / tags / properties / createdAt 等无法下推的条件由调用方在 JS 层过滤。
   * Web 端走 Dexie 索引；Tauri/File 端回退全量读取 + JS 过滤。
   */
  searchEntities(filter: EntitySearchFilter): Promise<Entity[]>
  /** 按 facet 名称过滤实体（仅返回包含指定 facet 的实体） */
  getEntitiesByFacet(type: string, facetName: string): Promise<Entity[]>
  putEntity(entity: Entity): Promise<void>
  updateEntity(id: string, changes: Partial<Entity>): Promise<void>
  deleteEntity(id: string): Promise<void>
  deleteEntityAtomic(id: string): Promise<{ success: boolean; error?: string }>
  countEntitiesByType(): Promise<Map<string, number>>
  clearEntities(): Promise<void>
  importEntities(entities: Entity[]): Promise<number>

  getAllRelations(): Promise<Relation[]>
  getRelationsByEntity(entityId: string): Promise<Relation[]>
  putRelation(relation: Relation): Promise<void>
  updateRelation(id: string, changes: Partial<Relation>): Promise<void>
  deleteRelation(id: string): Promise<void>
  deleteRelationsByEntity(entityId: string): Promise<number>
  clearRelations(): Promise<void>
  importRelations(relations: Relation[]): Promise<number>

  kvGet(key: string): Promise<string | null>
  kvSet(key: string, value: string): Promise<void>
  kvDelete(key: string): Promise<void>
  kvGetAll(): Promise<[string, string][]>

  getAllFiles(): Promise<ProjectFile[]>
  getFile(id: string): Promise<ProjectFile | undefined>
  getFileByPath(path: string): Promise<ProjectFile | undefined>
  getFilesByEntity(entityId: string): Promise<ProjectFile[]>
  putFile(file: ProjectFile, content: ProjectFileContent): Promise<void>
  updateFile(id: string, changes: Partial<ProjectFile>): Promise<void>
  deleteFile(id: string): Promise<void>
  getFileContent(id: string): Promise<ProjectFileContent | undefined>
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
}

/**
 * Tauri IPC 桥是否真正可用（invoke 函数存在）。
 * isTauri() 只检测环境标志（预览器/占位可能注入标志但无完整桥），
 * 调用 invoke 前必须用本函数确认，否则会触发 undefined.invoke 崩溃。
 */
export function hasTauriInvoke(): boolean {
  if (typeof window === 'undefined') return false
  const bridge = (window as any).__TAURI_INTERNALS__
  return typeof bridge?.invoke === 'function'
}

class TauriStorageBackend implements StorageBackend {
  private async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    // 桥守卫：环境声称是 Tauri 但 invoke 不可用（预览器/浏览器打开 devUrl）时，
    // 抛清晰分类错误，避免 @tauri-apps/api 内部访问 undefined.invoke 崩溃
    if (!hasTauriInvoke()) {
      throw new StorageError({
        message: `Tauri IPC 桥不可用（window.__TAURI_INTERNALS__.invoke 缺失）：${cmd} 无法执行，请在 Tauri 窗口内运行`,
        category: 'unknown',
        command: cmd,
      })
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<T>(cmd, args)
    } catch (e) {
      throw classifyTauriError(e, cmd)
    }
  }

  async getAllEntities(): Promise<Entity[]> {
    return this.invoke<Entity[]>('cmd_get_all_entities')
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    return this.invoke<Entity | undefined>('cmd_get_entity', { id })
  }

  async getEntitiesByType(type: string): Promise<Entity[]> {
    return this.invoke<Entity[]>('cmd_get_entities_by_type', { entityType: type })
  }

  async loadEntitiesPage(query: EntityPageQuery): Promise<EntityPageResult> {
    const raw = query.type
      ? await this.getEntitiesByType(query.type)
      : await this.getAllEntities()
    return paginateEntitiesInMemory(raw, query)
  }

  async searchEntities(filter: EntitySearchFilter): Promise<Entity[]> {
    const raw = filter.type
      ? await this.getEntitiesByType(filter.type)
      : await this.getAllEntities()
    return filterEntitiesInMemory(raw, filter)
  }

  async getEntitiesByFacet(type: string, facetName: string): Promise<Entity[]> {
    const entities = await this.getEntitiesByType(type)
    return entities.filter(e => e.facets && facetName in e.facets)
  }

  async putEntity(entity: Entity): Promise<void> {
    await this.invoke('cmd_put_entity', { entityJson: JSON.stringify(entity) })
  }

  async updateEntity(id: string, changes: Partial<Entity>): Promise<void> {
    await this.invoke('cmd_update_entity', { id, changesJson: JSON.stringify(changes) })
  }

  async deleteEntity(id: string): Promise<void> {
    await this.invoke('cmd_delete_entity', { id })
  }

  async deleteEntityAtomic(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const relations = await this.getRelationsByEntity(id)
      if (relations.length > 0) {
        await this.invoke('cmd_delete_relations_by_entity', { entityId: id })
      }
      await this.invoke('cmd_delete_entity', { id })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message ?? String(e) }
    }
  }

  async countEntitiesByType(): Promise<Map<string, number>> {
    const pairs = await this.invoke<[string, number][]>('cmd_count_entities_by_type')
    return new Map(pairs)
  }

  async clearEntities(): Promise<void> {
    await this.invoke('cmd_clear_entities')
  }

  async importEntities(entities: Entity[]): Promise<number> {
    return this.invoke<number>('cmd_import_entities', { entitiesJson: JSON.stringify(entities) })
  }

  async getAllRelations(): Promise<Relation[]> {
    return this.invoke<Relation[]>('cmd_get_all_relations')
  }

  async getRelationsByEntity(entityId: string): Promise<Relation[]> {
    return this.invoke<Relation[]>('cmd_get_relations_by_entity', { entityId })
  }

  async putRelation(relation: Relation): Promise<void> {
    await this.invoke('cmd_put_relation', { relationJson: JSON.stringify(relation) })
  }

  async updateRelation(id: string, changes: Partial<Relation>): Promise<void> {
    await this.invoke('cmd_update_relation', { id, changesJson: JSON.stringify(changes) })
  }

  async deleteRelation(id: string): Promise<void> {
    await this.invoke('cmd_delete_relation', { id })
  }

  async deleteRelationsByEntity(entityId: string): Promise<number> {
    return this.invoke<number>('cmd_delete_relations_by_entity', { entityId })
  }

  async clearRelations(): Promise<void> {
    await this.invoke('cmd_clear_relations')
  }

  async importRelations(relations: Relation[]): Promise<number> {
    return this.invoke<number>('cmd_import_relations', { relationsJson: JSON.stringify(relations) })
  }

  async kvGet(key: string): Promise<string | null> {
    return this.invoke<string | null>('cmd_kv_get', { key })
  }

  async kvSet(key: string, value: string): Promise<void> {
    await this.invoke('cmd_kv_set', { key, value })
  }

  async kvDelete(key: string): Promise<void> {
    await this.invoke('cmd_kv_delete', { key })
  }

  async kvGetAll(): Promise<[string, string][]> {
    return this.invoke<[string, string][]>('cmd_kv_get_all')
  }

  async getAllFiles(): Promise<ProjectFile[]> {
    return this.invoke<ProjectFile[]>('cmd_get_all_files')
  }

  async getFile(id: string): Promise<ProjectFile | undefined> {
    return this.invoke<ProjectFile | undefined>('cmd_get_file', { id })
  }

  async getFileByPath(path: string): Promise<ProjectFile | undefined> {
    return this.invoke<ProjectFile | undefined>('cmd_get_file_by_path', { path })
  }

  async getFilesByEntity(entityId: string): Promise<ProjectFile[]> {
    return this.invoke<ProjectFile[]>('cmd_get_files_by_entity', { entityId })
  }

  async putFile(file: ProjectFile, content: ProjectFileContent): Promise<void> {
    await this.invoke('cmd_put_file', { fileJson: JSON.stringify(file), contentJson: JSON.stringify(content) })
  }

  async updateFile(id: string, changes: Partial<ProjectFile>): Promise<void> {
    await this.invoke('cmd_update_file', { id, changesJson: JSON.stringify(changes) })
  }

  async deleteFile(id: string): Promise<void> {
    await this.invoke('cmd_delete_file', { id })
  }

  async getFileContent(id: string): Promise<ProjectFileContent | undefined> {
    return this.invoke<ProjectFileContent | undefined>('cmd_get_file_content', { id })
  }
}

class WebStorageBackend implements StorageBackend {
  /**
   * 获取当前项目的数据库实例。
   * 每次操作动态获取，确保切换项目后立即生效。
   */
  private get db(): WorldDatabase {
    try {
      return getProjectManager().getCurrentProjectDb()
    } catch {
      // 项目系统未初始化时，回退到旧的全局数据库（迁移过程中使用）
      return legacyDb
    }
  }

  async getAllEntities(): Promise<Entity[]> {
    return this.db.entities.toArray()
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    return this.db.entities.get(id)
  }

  async getEntitiesByType(type: string): Promise<Entity[]> {
    return this.db.entities.where('type').equals(type).toArray()
  }

  async loadEntitiesPage(query: EntityPageQuery): Promise<EntityPageResult> {
    const table = this.db.entities
    const { type, offset, limit, sortBy = 'updatedAt', sortDir = 'desc' } = query

    // updatedAt / name 有索引：带 type 用复合索引 [type+sortBy]，否则用 table.orderBy，
    // 均走 DB 层排序 + 分页，避免全量加载
    if (sortBy === 'updatedAt' || sortBy === 'name') {
      let collection = type
        ? table.where(`[type+${sortBy}]`).between([type, Dexie.minKey], [type, Dexie.maxKey])
        : table.orderBy(sortBy)
      collection = sortDir === 'desc' ? collection.reverse() : collection
      const total = await collection.count()
      const items = await collection.offset(offset).limit(limit).toArray()
      return { items, total }
    }

    // createdAt 无索引，回退全量读取 + JS 排序
    const raw = type ? await this.getEntitiesByType(type) : await this.getAllEntities()
    return paginateEntitiesInMemory(raw, query)
  }

  async searchEntities(filter: EntitySearchFilter): Promise<Entity[]> {
    const table = this.db.entities
    const { type, updatedAfter, updatedBefore } = filter
    const hasUpdatedRange = !!(updatedAfter || updatedBefore)

    // type + updatedAt 范围：走复合索引 [type+updatedAt] 范围查询
    if (type && hasUpdatedRange) {
      const lo: [string, string] = [type, updatedAfter ?? '']
      const hi: [string, string] = [type, updatedBefore ?? '\uffff']
      return table.where('[type+updatedAt]').between(lo, hi, true, true).toArray()
    }
    // 仅 type：走 type 索引
    if (type) return table.where('type').equals(type).toArray()
    // 仅 updatedAt 范围：走 updatedAt 索引
    if (hasUpdatedRange) {
      const lo = updatedAfter ?? ''
      const hi = updatedBefore ?? '\uffff'
      return table.where('updatedAt').between(lo, hi, true, true).toArray()
    }
    // 无条件：全量
    return table.toArray()
  }

  async getEntitiesByFacet(type: string, facetName: string): Promise<Entity[]> {
    const entities = await this.db.entities.where('type').equals(type).toArray()
    return entities.filter(e => e.facets && facetName in e.facets)
  }

  async putEntity(entity: Entity): Promise<void> {
    await this.db.entities.put(entity)
  }

  async updateEntity(id: string, changes: Partial<Entity>): Promise<void> {
    await this.db.entities.update(id, changes)
  }

  async deleteEntity(id: string): Promise<void> {
    await this.db.entities.delete(id)
  }

  async deleteEntityAtomic(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const db = this.db
      await db.transaction('rw', db.entities, db.relations, async () => {
        await db.relations.where('sourceId').equals(id).delete()
        await db.relations.where('targetId').equals(id).delete()
        await db.entities.delete(id)
      })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message ?? String(e) }
    }
  }

  async countEntitiesByType(): Promise<Map<string, number>> {
    const all = await this.db.entities.toArray()
    const map = new Map<string, number>()
    for (const e of all) {
      map.set(e.type, (map.get(e.type) || 0) + 1)
    }
    return map
  }

  async clearEntities(): Promise<void> {
    await this.db.entities.clear()
  }

  async importEntities(entities: Entity[]): Promise<number> {
    await this.db.entities.bulkPut(entities)
    return entities.length
  }

  async getAllRelations(): Promise<Relation[]> {
    return this.db.relations.toArray()
  }

  async getRelationsByEntity(entityId: string): Promise<Relation[]> {
    const db = this.db
    const [sources, targets] = await Promise.all([
      db.relations.where('sourceId').equals(entityId).toArray(),
      db.relations.where('targetId').equals(entityId).toArray(),
    ])
    return [...sources, ...targets]
  }

  async putRelation(relation: Relation): Promise<void> {
    await this.db.relations.put(relation)
  }

  async updateRelation(id: string, changes: Partial<Relation>): Promise<void> {
    await this.db.relations.update(id, changes)
  }

  async deleteRelation(id: string): Promise<void> {
    await this.db.relations.delete(id)
  }

  async deleteRelationsByEntity(entityId: string): Promise<number> {
    const db = this.db
    const sourceDeleted = await db.relations.where('sourceId').equals(entityId).delete()
    const targetDeleted = await db.relations.where('targetId').equals(entityId).delete()
    return sourceDeleted + targetDeleted
  }

  async clearRelations(): Promise<void> {
    await this.db.relations.clear()
  }

  async importRelations(relations: Relation[]): Promise<number> {
    await this.db.relations.bulkPut(relations)
    return relations.length
  }

  async kvGet(key: string): Promise<string | null> {
    const val = await this.db.table('kv_store').get(key)
    return val ? (val as any).value ?? null : null
  }

  async kvSet(key: string, value: string): Promise<void> {
    await this.db.table('kv_store').put({ key, value })
  }

  async kvDelete(key: string): Promise<void> {
    await this.db.table('kv_store').delete(key)
  }

  async kvGetAll(): Promise<[string, string][]> {
    const all = await this.db.table('kv_store').toArray()
    return all.map((r: any) => [r.key as string, r.value as string])
  }

  async getAllFiles(): Promise<ProjectFile[]> {
    return this.db.files.toArray()
  }

  async getFile(id: string): Promise<ProjectFile | undefined> {
    return this.db.files.get(id)
  }

  async getFileByPath(path: string): Promise<ProjectFile | undefined> {
    return this.db.files.where('path').equals(path).first()
  }

  async getFilesByEntity(entityId: string): Promise<ProjectFile[]> {
    return this.db.files.where('entityId').equals(entityId).toArray()
  }

  async putFile(file: ProjectFile, content: ProjectFileContent): Promise<void> {
    await this.db.files.put(file)
    await this.db.file_contents.put(content)
  }

  async updateFile(id: string, changes: Partial<ProjectFile>): Promise<void> {
    await this.db.files.update(id, changes)
  }

  async deleteFile(id: string): Promise<void> {
    await this.db.files.delete(id)
    await this.db.file_contents.delete(id)
  }

  async getFileContent(id: string): Promise<ProjectFileContent | undefined> {
    return this.db.file_contents.get(id)
  }
}

let _backend: StorageBackend | null = null
let _fileBackend: FileStorageBackend | null = null

export function getStorageBackend(): StorageBackend {
  if (_backend) return _backend
  if (isTauri() && hasTauriInvoke()) {
    // Tauri 模式：FileStorageBackend（有目录时用文件系统，否则降级到 TauriStorageBackend）
    const fallback = new TauriStorageBackend()
    _fileBackend = new FileStorageBackend(fallback)
    _backend = _fileBackend
  } else {
    // 非 Tauri 或 Tauri 桥不可用（浏览器/预览器打开 devUrl）→ Web 存储兜底（IndexedDB/Dexie）
    if (isTauri() && !hasTauriInvoke()) {
      console.warn('[Storage] 检测到 Tauri 标志但 IPC 桥不可用，降级到 Web 存储（IndexedDB）。浏览器预览仅支持 UI 调试。')
    }
    _backend = new WebStorageBackend()
  }
  return _backend
}

export const storage = getStorageBackend()

/**
 * 设置当前项目的存储目录，由 useProjectSwitcher 在项目切换时调用。
 * - dir 非空：FileStorageBackend 以文件系统为主存储
 * - dir 为 null：降级到 fallback（IndexedDB/SQLite）
 */
export async function setStorageProjectDir(dir: string | null): Promise<void> {
  if (_fileBackend) {
    await _fileBackend.setProjectDir(dir)
  }
}

/**
 * 获取 FileStorageBackend 实例（如果存在）。
 */
export function getFileStorageBackend(): FileStorageBackend | null {
  return _fileBackend
}
