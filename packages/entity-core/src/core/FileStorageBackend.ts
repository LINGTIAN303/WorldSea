/** 基于本地文件系统的存储后端（实体/关系/KV/文件 JSON 落盘，未绑定目录时降级 fallback），详细见 docs/details/注释/packages/entity-core/core/FileStorageBackend.md */

import type { Entity } from '../types'
import type { Relation } from '../types'
import type { ProjectFile, ProjectFileContent } from '../types'
import type { StorageBackend, EntityPageQuery, EntityPageResult, EntitySearchFilter } from './StorageBackend'
import { paginateEntitiesInMemory, filterEntitiesInMemory } from './StorageBackend'

/* ════════════════════════════════════════
   Tauri 文件系统操作封装
   ════════════════════════════════════════ */

let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null

async function getInvoke() {
  if (_invoke) return _invoke
  try {
    const api = await import('@tauri-apps/api/core')
    _invoke = api.invoke
    return _invoke
  } catch {
    return null
  }
}

async function writeTextFile(path: string, content: string, createDirs = true): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用')
  await invoke('cmd_fs_write', { path, content, createDirs })
}

async function readTextFile(path: string): Promise<string> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用')
  return invoke('cmd_fs_read', { path, encoding: 'utf-8' }) as Promise<string>
}

async function listDir(path: string, recursive = false): Promise<Array<{
  name: string
  path: string
  isDir: boolean
  size: number
}>> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用')
  return invoke('cmd_fs_list', { path, recursive }) as Promise<any[]>
}

async function deleteFile(path: string): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用')
  await invoke('cmd_fs_delete', { path })
}

/* ════════════════════════════════════════
   辅助函数
   ════════════════════════════════════════ */

/** 将实体名称转为安全的文件名 */
function toSafeFileName(name: string, id: string): string {
  const safe = name
    .slice(0, 30)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  const shortId = id.slice(0, 8)
  return safe ? `${safe}_${shortId}.json` : `${shortId}.json`
}

/** 从文件路径中提取实体 ID（从文件内容中获取，不从文件名解析） */

/* ════════════════════════════════════════
   索引条目
   ════════════════════════════════════════ */

interface EntityIndexEntry {
  type: string
  name: string
  path: string
}

/* ════════════════════════════════════════
   FileStorageBackend
   ════════════════════════════════════════ */

export class FileStorageBackend implements StorageBackend {
  private _projectDir: string | null = null
  private _entityIndex = new Map<string, EntityIndexEntry>()
  private _entityCache = new Map<string, Entity>()
  private _relations: Relation[] = []
  private _relationsLoaded = false
  private _kvCache = new Map<string, string>()
  private _kvLoaded = false
  private _filesMeta: ProjectFile[] = []
  private _filesMetaLoaded = false
  private _fallback: StorageBackend | null = null
  private _ready = false

  /**
   * 自身写入静默期截止时间。
   * FileStorageBackend 写操作时设置此值，useFsWatcher 检测到
   * 文件变更时如果处于静默期内则跳过 reload，避免自身写入触发 UI 闪烁。
   */
  private _selfWriteUntil = 0

  /**
   * 正在进行的异步写入 Promise 集合。
   * isInSelfWriteWindow 会覆盖所有 pending 写入，确保大文件/批量写入期间
   * 文件监听不会触发 reload 读到半成品 JSON。
   */
  private _pendingWrites = new Set<Promise<unknown>>()

  /**
   * 每实体写操作队列（tail promise）。
   * 键为实体 id，值为该实体最后一次写操作的尾部 promise。
   * 用于删除前等待同实体 in-flight 写入落盘，消除"写入尚未完成、删除已执行、
   * 随后 in-flight 写入把文件写回"的竞态（实体删除后复活的根因）。
   */
  private _entityWriteQueues = new Map<string, Promise<unknown>>()

  /**
   * 将实体的写操作串行化排队，返回本次操作的 promise。
   * 队列尾部吞掉错误避免中断后续操作，错误由调用方（task 内部）自行处理。
   */
  private enqueueEntityWrite<T>(id: string, task: () => Promise<T>): Promise<T> {
    const prev = this._entityWriteQueues.get(id) ?? Promise.resolve()
    const run = prev.then(task)
    this._entityWriteQueues.set(id, run.catch(() => {}))
    return run
  }

  /** 等待某实体的所有 in-flight 写操作完成 */
  private async waitEntityWrites(id: string): Promise<void> {
    const tail = this._entityWriteQueues.get(id)
    if (tail) await tail.catch(() => {})
  }

  constructor(fallback: StorageBackend) {
    this._fallback = fallback
  }

  /** 是否处于自身写入静默期（文件监听应跳过 reload） */
  get isInSelfWriteWindow(): boolean {
    return Date.now() < this._selfWriteUntil || this._pendingWrites.size > 0
  }

  /**
   * 标记自身写入开始，设置静默期。
   * 使用 Math.max 避免后续短窗口缩短已有长窗口。
   */
  private markSelfWrite(duration = 2000): void {
    this._selfWriteUntil = Math.max(this._selfWriteUntil, Date.now() + duration)
  }

  /**
   * 跟踪一个异步写操作：加入 pending 集合，完成后移除并延长静默期。
   * - 写入期间 isInSelfWriteWindow 返回 true（覆盖大文件/批量写入）
   * - 写入完成后延长 500ms 静默期，吸收 notify → 前端事件的传播延迟
   */
  private trackWrite<T>(p: Promise<T>): Promise<T> {
    this._pendingWrites.add(p)
    p.finally(() => {
      this._pendingWrites.delete(p)
      this.markSelfWrite(500)
    })
    return p
  }

  /** 当前是否已绑定项目目录 */
  get isReady(): boolean {
    return this._ready && this._projectDir !== null
  }

  /** 获取当前项目目录路径 */
  get projectDir(): string | null {
    return this._projectDir
  }

  /**
   * 设置项目目录并加载索引。
   * 传入 null 表示取消目录绑定，降级到 fallback。
   */
  async setProjectDir(dir: string | null): Promise<void> {
    this._projectDir = dir
    this._entityIndex.clear()
    this._entityCache.clear()
    this._relations = []
    this._relationsLoaded = false
    this._kvCache.clear()
    this._kvLoaded = false
    this._filesMeta = []
    this._filesMetaLoaded = false

    if (dir) {
      await this.loadIndex()
      this._ready = true
    } else {
      this._ready = false
    }
  }

  /**
   * 重新加载索引（文件监听触发外部变更时使用）。
   * 增量更新：只处理变更的文件路径，不清空全部缓存。
   */
  async reloadIndex(): Promise<void> {
    if (!this._projectDir) return
    // 标记关系需要重新加载
    this._relationsLoaded = false
  }

  /**
   * 增量更新指定路径的实体缓存。
   * 由 useFsWatcher 调用，只读取变更的文件，不全量重建。
   */
  async reloadPaths(paths: string[]): Promise<void> {
    if (!this._projectDir) return

    const dir = this._projectDir.replace(/\\/g, '/')
    const entitiesPrefix = `${dir}/entities/`

    for (const rawPath of paths) {
      const normalizedPath = rawPath.replace(/\\/g, '/')
      if (!normalizedPath.startsWith(entitiesPrefix)) continue
      if (!normalizedPath.endsWith('.json')) continue

      // 读取层：区分"文件不存在"与"读取错误"
      let content: string
      try {
        content = await readTextFile(rawPath)
      } catch (readErr) {
        const msg = String((readErr as Error)?.message ?? readErr)
        const isNotFound =
          msg.includes('not found') ||
          msg.includes('No such file') ||
          msg.includes('不存在') ||
          msg.includes('系统找不到') ||
          msg.includes('cannot find')
        if (isNotFound) {
          // 文件确实被删除，移除索引
          for (const [id, entry] of this._entityIndex) {
            if (entry.path.replace(/\\/g, '/') === normalizedPath) {
              this._entityIndex.delete(id)
              this._entityCache.delete(id)
              break
            }
          }
        } else {
          // 其他读取错误（权限/IO），保留索引避免误删
          console.warn('[FileStorageBackend] 实体文件读取失败，保留索引:', rawPath, readErr)
        }
        continue
      }

      // 解析层：JSON 损坏不删除索引，避免数据丢失
      let entity: Entity
      try {
        entity = JSON.parse(content)
      } catch (parseErr) {
        console.warn('[FileStorageBackend] 实体文件 JSON 损坏，保留索引:', rawPath, parseErr)
        continue
      }

      // 从路径提取 type: entities/{type}/{name_id}.json
      const relPath = normalizedPath.slice(entitiesPrefix.length)
      const type = relPath.split('/')[0]
      this._entityIndex.set(entity.id, {
        type,
        name: entity.name,
        path: rawPath,
      })
      this._entityCache.set(entity.id, entity)
    }

    // 标记关系需要重新加载
    this._relationsLoaded = false
  }

  /* ─── 索引加载 ─── */

  /**
   * 扫描项目目录，构建实体索引。
   * 同时加载关系、KV、文件元数据到内存。
   */
  private async loadIndex(): Promise<void> {
    if (!this._projectDir) return

    const dir = this._projectDir

    // 1. 扫描 entities/ 目录
    try {
      const typeDirs = await listDir(`${dir}/entities`)
      for (const typeDir of typeDirs) {
        if (!typeDir.isDir) continue
        const entityType = typeDir.name
        try {
          const files = await listDir(typeDir.path)
          for (const file of files) {
            if (file.isDir || !file.name.endsWith('.json')) continue
            // 读取实体文件获取 ID（首次加载）
            try {
              const content = await readTextFile(file.path)
              const entity: Entity = JSON.parse(content)
              this._entityIndex.set(entity.id, {
                type: entityType,
                name: entity.name,
                path: file.path,
              })
              this._entityCache.set(entity.id, entity)
            } catch {
              // 单个文件解析失败不影响整体
            }
          }
        } catch {
          // 类型目录读取失败跳过
        }
      }
    } catch {
      // entities/ 目录可能不存在（空项目）
    }

    // 2. 加载关系
    try {
      const relText = await readTextFile(`${dir}/relations/_index.json`)
      this._relations = JSON.parse(relText)
      this._relationsLoaded = true
    } catch {
      this._relations = []
      this._relationsLoaded = true
    }

    // 3. 加载 KV 存储
    try {
      const kvText = await readTextFile(`${dir}/.worldsmith/kv_store.json`)
      const kvPairs: [string, string][] = JSON.parse(kvText)
      for (const [k, v] of kvPairs) {
        this._kvCache.set(k, v)
      }
      this._kvLoaded = true
    } catch {
      this._kvLoaded = true
    }

    // 4. 加载文件元数据
    try {
      const metaText = await readTextFile(`${dir}/.worldsmith/files_meta.json`)
      this._filesMeta = JSON.parse(metaText)
      this._filesMetaLoaded = true
    } catch {
      this._filesMeta = []
      this._filesMetaLoaded = true
    }
  }

  /* ─── 路径构建 ─── */

  private entityFilePath(entity: Entity): string {
    const fileName = toSafeFileName(entity.name, entity.id)
    return `${this._projectDir}/entities/${entity.type}/${fileName}`
  }

  private entityFilePathById(id: string): string | null {
    const entry = this._entityIndex.get(id)
    return entry?.path ?? null
  }

  /* ─── 实体操作 ─── */

  async getAllEntities(): Promise<Entity[]> {
    if (!this.isReady) return this._fallback!.getAllEntities()
    return Array.from(this._entityCache.values())
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    if (!this.isReady) return this._fallback!.getEntity(id)
    // 先查缓存
    const cached = this._entityCache.get(id)
    if (cached) return cached
    // 缓存未命中，尝试从索引路径读取
    const path = this.entityFilePathById(id)
    if (!path) return undefined
    try {
      const content = await readTextFile(path)
      const entity: Entity = JSON.parse(content)
      this._entityCache.set(id, entity)
      return entity
    } catch {
      return undefined
    }
  }

  async getEntitiesByType(type: string): Promise<Entity[]> {
    if (!this.isReady) return this._fallback!.getEntitiesByType(type)
    const result: Entity[] = []
    for (const [id, entry] of this._entityIndex) {
      if (entry.type === type) {
        const entity = this._entityCache.get(id)
        if (entity) result.push(entity)
      }
    }
    return result
  }

  async loadEntitiesPage(query: EntityPageQuery): Promise<EntityPageResult> {
    if (!this.isReady) return this._fallback!.loadEntitiesPage(query)
    const raw = query.type
      ? await this.getEntitiesByType(query.type)
      : await this.getAllEntities()
    return paginateEntitiesInMemory(raw, query)
  }

  async searchEntities(filter: EntitySearchFilter): Promise<Entity[]> {
    if (!this.isReady) return this._fallback!.searchEntities(filter)
    const raw = filter.type
      ? await this.getEntitiesByType(filter.type)
      : await this.getAllEntities()
    return filterEntitiesInMemory(raw, filter)
  }

  async getEntitiesByFacet(type: string, facetName: string): Promise<Entity[]> {
    if (!this.isReady) return this._fallback!.getEntitiesByFacet(type, facetName)
    const entities = await this.getEntitiesByType(type)
    return entities.filter(e => e.facets && facetName in e.facets)
  }

  async putEntity(entity: Entity): Promise<void> {
    if (!this.isReady) return this._fallback!.putEntity(entity)
    this.markSelfWrite()
    // 先更新内存索引和缓存（同步，零延迟）
    const filePath = this.entityFilePath(entity)
    // 保存旧值用于写盘失败时回滚
    const oldEntry = this._entityIndex.get(entity.id)
    const oldEntity = this._entityCache.get(entity.id)
    this._entityIndex.set(entity.id, {
      type: entity.type,
      name: entity.name,
      path: filePath,
    })
    this._entityCache.set(entity.id, entity)
    // 文件写入异步化（不阻塞调用方），失败时回滚内存保证一致性
    const content = JSON.stringify(entity)
    const write = this.enqueueEntityWrite(entity.id, () =>
      writeTextFile(filePath, content, true).catch(err => {
        console.error('[FileStorageBackend] putEntity 写入失败，回滚内存:', entity.id, err)
        if (oldEntry) this._entityIndex.set(entity.id, oldEntry)
        else this._entityIndex.delete(entity.id)
        if (oldEntity) this._entityCache.set(entity.id, oldEntity)
        else this._entityCache.delete(entity.id)
      }),
    )
    this.trackWrite(write)
  }

  async updateEntity(id: string, changes: Partial<Entity>): Promise<void> {
    if (!this.isReady) return this._fallback!.updateEntity(id, changes)
    this.markSelfWrite()
    const existing = await this.getEntity(id)
    if (!existing) throw new Error(`实体 ${id} 不存在`)
    const updated = { ...existing, ...changes }
    // 保存旧值用于写盘失败时回滚
    const oldPath = this.entityFilePathById(id)
    const newPath = this.entityFilePath(updated)
    const oldEntry = this._entityIndex.get(id)
    // 先更新内存索引和缓存
    this._entityIndex.set(id, {
      type: updated.type,
      name: updated.name,
      path: newPath,
    })
    this._entityCache.set(id, updated)
    // 文件写入异步化，失败时回滚内存
    const content = JSON.stringify(updated)
    const write = this.enqueueEntityWrite(id, async () => {
      try {
        await writeTextFile(newPath, content, true)
        // 写入成功后删除旧路径文件
        if (oldPath && oldPath !== newPath) {
          try { await deleteFile(oldPath) } catch { /* 旧文件删除失败可忽略 */ }
        }
      } catch (err) {
        console.error('[FileStorageBackend] updateEntity 写入失败，回滚内存:', id, err)
        if (oldEntry) this._entityIndex.set(id, oldEntry)
        this._entityCache.set(id, existing)
      }
    })
    this.trackWrite(write)
  }

  async deleteEntity(id: string): Promise<void> {
    if (!this.isReady) return this._fallback!.deleteEntity(id)
    this.markSelfWrite()
    // 保存旧值用于删除失败时回滚
    const path = this.entityFilePathById(id)
    const oldEntry = this._entityIndex.get(id)
    const oldEntity = this._entityCache.get(id)
    // 先等待该实体的 in-flight 写入落盘，避免"写入未完成、删除已执行、
    // 随后写入把文件写回"的竞态（实体删除后复活的根因）
    await this.waitEntityWrites(id)
    // 从内存索引和缓存移除
    this._entityIndex.delete(id)
    this._entityCache.delete(id)
    // 清空该实体的写队列，防止删除后遗留引用
    this._entityWriteQueues.delete(id)
    // 文件删除必须真正等待；失败时回滚内存并向上抛错，
    // 使 deleteEntityAtomic 能感知删除失败，而非"假成功"
    if (path) {
      try {
        await deleteFile(path)
      } catch (err) {
        console.error('[FileStorageBackend] deleteEntity 删除失败，回滚内存:', id, err)
        if (oldEntry) this._entityIndex.set(id, oldEntry)
        if (oldEntity) this._entityCache.set(id, oldEntity)
        throw err
      }
    }
  }

  async deleteEntityAtomic(id: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isReady) return this._fallback!.deleteEntityAtomic(id)
    try {
      // 删除关联关系
      await this.deleteRelationsByEntity(id)
      // 删除实体
      await this.deleteEntity(id)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message ?? String(e) }
    }
  }

  async countEntitiesByType(): Promise<Map<string, number>> {
    if (!this.isReady) return this._fallback!.countEntitiesByType()
    const map = new Map<string, number>()
    for (const entry of this._entityIndex.values()) {
      map.set(entry.type, (map.get(entry.type) || 0) + 1)
    }
    return map
  }

  async clearEntities(): Promise<void> {
    if (!this.isReady) return this._fallback!.clearEntities()
    // 删除所有实体文件
    for (const entry of this._entityIndex.values()) {
      try { await deleteFile(entry.path) } catch { /* 忽略 */ }
    }
    this._entityIndex.clear()
    this._entityCache.clear()
  }

  async importEntities(entities: Entity[]): Promise<number> {
    if (!this.isReady) return this._fallback!.importEntities(entities)
    for (const entity of entities) {
      await this.putEntity(entity)
    }
    return entities.length
  }

  /* ─── 关系操作 ─── */

  async getAllRelations(): Promise<Relation[]> {
    if (!this.isReady) return this._fallback!.getAllRelations()
    if (!this._relationsLoaded) {
      await this.loadRelations()
    }
    return [...this._relations]
  }

  async getRelationsByEntity(entityId: string): Promise<Relation[]> {
    if (!this.isReady) return this._fallback!.getRelationsByEntity(entityId)
    if (!this._relationsLoaded) {
      await this.loadRelations()
    }
    return this._relations.filter(
      r => r.sourceId === entityId || r.targetId === entityId,
    )
  }

  async putRelation(relation: Relation): Promise<void> {
    if (!this.isReady) return this._fallback!.putRelation(relation)
    this.markSelfWrite()
    if (!this._relationsLoaded) {
      await this.loadRelations()
    }
    // 替换或追加（先更新内存）
    const idx = this._relations.findIndex(r => r.id === relation.id)
    if (idx >= 0) {
      this._relations[idx] = relation
    } else {
      this._relations.push(relation)
    }
    // 文件写入异步化
    this.flushRelationsAsync()
  }

  async updateRelation(id: string, changes: Partial<Relation>): Promise<void> {
    if (!this.isReady) return this._fallback!.updateRelation(id, changes)
    this.markSelfWrite()
    if (!this._relationsLoaded) {
      await this.loadRelations()
    }
    const idx = this._relations.findIndex(r => r.id === id)
    if (idx >= 0) {
      this._relations[idx] = { ...this._relations[idx], ...changes }
      this.flushRelationsAsync()
    }
  }

  async deleteRelation(id: string): Promise<void> {
    if (!this.isReady) return this._fallback!.deleteRelation(id)
    this.markSelfWrite()
    if (!this._relationsLoaded) {
      await this.loadRelations()
    }
    this._relations = this._relations.filter(r => r.id !== id)
    this.flushRelationsAsync()
  }

  async deleteRelationsByEntity(entityId: string): Promise<number> {
    if (!this.isReady) return this._fallback!.deleteRelationsByEntity(entityId)
    this.markSelfWrite()
    if (!this._relationsLoaded) {
      await this.loadRelations()
    }
    const before = this._relations.length
    this._relations = this._relations.filter(
      r => r.sourceId !== entityId && r.targetId !== entityId,
    )
    const deleted = before - this._relations.length
    if (deleted > 0) {
      this.flushRelationsAsync()
    }
    return deleted
  }

  async clearRelations(): Promise<void> {
    if (!this.isReady) return this._fallback!.clearRelations()
    this.markSelfWrite()
    this._relations = []
    this.flushRelationsAsync()
  }

  async importRelations(relations: Relation[]): Promise<number> {
    if (!this.isReady) return this._fallback!.importRelations(relations)
    this.markSelfWrite()
    if (!this._relationsLoaded) {
      await this.loadRelations()
    }
    this._relations.push(...relations)
    await this.flushRelations()
    return relations.length
  }

  /** 将关系持久化到文件 */
  private async flushRelations(): Promise<void> {
    if (!this._projectDir) return
    const content = JSON.stringify(this._relations)
    await writeTextFile(`${this._projectDir}/relations/_index.json`, content, true)
  }

  /** 异步将关系持久化到文件（requestIdleCallback 防抖，避免在主线程上做大 JSON 序列化抢占动画帧） */
  private _flushRelationsIdle: number | ReturnType<typeof setTimeout> | null = null
  private flushRelationsAsync(): void {
    if (this._flushRelationsIdle != null) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this._flushRelationsIdle as number)
      else clearTimeout(this._flushRelationsIdle)
      this._flushRelationsIdle = null
    }
    const run = () => {
      this._flushRelationsIdle = null
      this.trackWrite(
        this.flushRelations().catch(err => {
          console.error('[FileStorageBackend] 关系文件写入失败，标记需重载:', err)
          this._relationsLoaded = false
        }),
      )
    }
    if (typeof requestIdleCallback === 'function') {
      this._flushRelationsIdle = requestIdleCallback(run, { timeout: 500 }) as unknown as number
    } else {
      this._flushRelationsIdle = setTimeout(run, 150)
    }
  }

  /** 从文件加载关系 */
  private async loadRelations(): Promise<void> {
    if (!this._projectDir) return
    try {
      const text = await readTextFile(`${this._projectDir}/relations/_index.json`)
      this._relations = JSON.parse(text)
    } catch {
      this._relations = []
    }
    this._relationsLoaded = true
  }

  /* ─── KV 存储 ─── */

  async kvGet(key: string): Promise<string | null> {
    if (!this.isReady) return this._fallback!.kvGet(key)
    if (!this._kvLoaded) {
      await this.loadKv()
    }
    return this._kvCache.get(key) ?? null
  }

  async kvSet(key: string, value: string): Promise<void> {
    if (!this.isReady) return this._fallback!.kvSet(key, value)
    if (!this._kvLoaded) {
      await this.loadKv()
    }
    this._kvCache.set(key, value)
    this.markSelfWrite()
    // 防抖异步持久化（不阻塞调用方）
    this.flushKvAsync()
  }

  async kvDelete(key: string): Promise<void> {
    if (!this.isReady) return this._fallback!.kvDelete(key)
    if (!this._kvLoaded) {
      await this.loadKv()
    }
    this._kvCache.delete(key)
    this.markSelfWrite()
    // 防抖异步持久化（不阻塞调用方）
    this.flushKvAsync()
  }

  async kvGetAll(): Promise<[string, string][]> {
    if (!this.isReady) return this._fallback!.kvGetAll()
    if (!this._kvLoaded) {
      await this.loadKv()
    }
    return Array.from(this._kvCache.entries())
  }

  private async flushKv(): Promise<void> {
    if (!this._projectDir) return
    const pairs = Array.from(this._kvCache.entries())
    await writeTextFile(`${this._projectDir}/.worldsmith/kv_store.json`, JSON.stringify(pairs), true)
  }

  /** 异步将 KV 存储持久化到文件（requestIdleCallback 防抖，避免主线程阻塞） */
  private _flushKvIdle: number | ReturnType<typeof setTimeout> | null = null
  private flushKvAsync(): void {
    if (this._flushKvIdle != null) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this._flushKvIdle as number)
      else clearTimeout(this._flushKvIdle)
      this._flushKvIdle = null
    }
    const run = () => {
      this._flushKvIdle = null
      this.trackWrite(
        this.flushKv().catch(err => {
          console.error('[FileStorageBackend] KV 文件写入失败，标记需重载:', err)
          this._kvLoaded = false
        }),
      )
    }
    if (typeof requestIdleCallback === 'function') {
      this._flushKvIdle = requestIdleCallback(run, { timeout: 500 }) as unknown as number
    } else {
      this._flushKvIdle = setTimeout(run, 150)
    }
  }

  private async loadKv(): Promise<void> {
    if (!this._projectDir) return
    try {
      const text = await readTextFile(`${this._projectDir}/.worldsmith/kv_store.json`)
      const pairs: [string, string][] = JSON.parse(text)
      this._kvCache.clear()
      for (const [k, v] of pairs) {
        this._kvCache.set(k, v)
      }
    } catch {
      this._kvCache.clear()
    }
    this._kvLoaded = true
  }

  /* ─── 文件操作 ─── */

  async getAllFiles(): Promise<ProjectFile[]> {
    if (!this.isReady) return this._fallback!.getAllFiles()
    if (!this._filesMetaLoaded) {
      await this.loadFilesMeta()
    }
    return [...this._filesMeta]
  }

  async getFile(id: string): Promise<ProjectFile | undefined> {
    if (!this.isReady) return this._fallback!.getFile(id)
    if (!this._filesMetaLoaded) {
      await this.loadFilesMeta()
    }
    return this._filesMeta.find(f => f.id === id)
  }

  async getFileByPath(path: string): Promise<ProjectFile | undefined> {
    if (!this.isReady) return this._fallback!.getFileByPath(path)
    if (!this._filesMetaLoaded) {
      await this.loadFilesMeta()
    }
    return this._filesMeta.find(f => f.path === path)
  }

  async getFilesByEntity(entityId: string): Promise<ProjectFile[]> {
    if (!this.isReady) return this._fallback!.getFilesByEntity(entityId)
    if (!this._filesMetaLoaded) {
      await this.loadFilesMeta()
    }
    return this._filesMeta.filter(f => f.entityId === entityId)
  }

  async putFile(file: ProjectFile, content: ProjectFileContent): Promise<void> {
    if (!this.isReady) return this._fallback!.putFile(file, content)
    if (!this._filesMetaLoaded) {
      await this.loadFilesMeta()
    }
    this.markSelfWrite()
    // 保存旧元数据用于回滚
    const idx = this._filesMeta.findIndex(f => f.id === file.id)
    const oldFile = idx >= 0 ? this._filesMeta[idx] : null
    // 更新元数据（内存同步）
    if (idx >= 0) {
      this._filesMeta[idx] = file
    } else {
      this._filesMeta.push(file)
    }
    // 写文件内容（异步化），失败时回滚元数据
    this.trackWrite(
      writeTextFile(
        `${this._projectDir}/.worldsmith/files_content/${file.id}.json`,
        JSON.stringify(content),
        true,
      ).catch(err => {
        console.error('[FileStorageBackend] putFile 内容写入失败，回滚元数据:', file.id, err)
        if (oldFile) {
          const i = this._filesMeta.findIndex(f => f.id === file.id)
          if (i >= 0) this._filesMeta[i] = oldFile
        } else {
          this._filesMeta = this._filesMeta.filter(f => f.id !== file.id)
        }
      }),
    )
    // 防抖异步持久化元数据
    this.flushFilesMetaAsync()
  }

  async updateFile(id: string, changes: Partial<ProjectFile>): Promise<void> {
    if (!this.isReady) return this._fallback!.updateFile(id, changes)
    if (!this._filesMetaLoaded) {
      await this.loadFilesMeta()
    }
    const idx = this._filesMeta.findIndex(f => f.id === id)
    if (idx >= 0) {
      this._filesMeta[idx] = { ...this._filesMeta[idx], ...changes }
      this.markSelfWrite()
      // 防抖异步持久化元数据
      this.flushFilesMetaAsync()
    }
  }

  async deleteFile(id: string): Promise<void> {
    if (!this.isReady) return this._fallback!.deleteFile(id)
    if (!this._filesMetaLoaded) {
      await this.loadFilesMeta()
    }
    this.markSelfWrite()
    // 保存被删除的元数据用于回滚
    const deletedFile = this._filesMeta.find(f => f.id === id) ?? null
    // 删除内容文件（异步化），失败时回滚元数据
    this.trackWrite(
      deleteFile(`${this._projectDir}/.worldsmith/files_content/${id}.json`).catch(err => {
        console.error('[FileStorageBackend] deleteFile 内容删除失败，回滚元数据:', id, err)
        if (deletedFile && !this._filesMeta.some(f => f.id === id)) {
          this._filesMeta.push(deletedFile)
        }
      }),
    )
    // 更新元数据（内存同步）
    this._filesMeta = this._filesMeta.filter(f => f.id !== id)
    // 防抖异步持久化元数据
    this.flushFilesMetaAsync()
  }

  async getFileContent(id: string): Promise<ProjectFileContent | undefined> {
    if (!this.isReady) return this._fallback!.getFileContent(id)
    try {
      const text = await readTextFile(`${this._projectDir}/.worldsmith/files_content/${id}.json`)
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  private async flushFilesMeta(): Promise<void> {
    if (!this._projectDir) return
    await writeTextFile(
      `${this._projectDir}/.worldsmith/files_meta.json`,
      JSON.stringify(this._filesMeta),
      true,
    )
  }

  /** 异步将文件元数据持久化到文件（requestIdleCallback 防抖，避免主线程阻塞） */
  private _flushFilesMetaIdle: number | ReturnType<typeof setTimeout> | null = null
  private flushFilesMetaAsync(): void {
    if (this._flushFilesMetaIdle != null) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this._flushFilesMetaIdle as number)
      else clearTimeout(this._flushFilesMetaIdle)
      this._flushFilesMetaIdle = null
    }
    const run = () => {
      this._flushFilesMetaIdle = null
      this.trackWrite(
        this.flushFilesMeta().catch(err => {
          console.error('[FileStorageBackend] 文件元数据写入失败，标记需重载:', err)
          this._filesMetaLoaded = false
        }),
      )
    }
    if (typeof requestIdleCallback === 'function') {
      this._flushFilesMetaIdle = requestIdleCallback(run, { timeout: 500 }) as unknown as number
    } else {
      this._flushFilesMetaIdle = setTimeout(run, 150)
    }
  }

  private async loadFilesMeta(): Promise<void> {
    if (!this._projectDir) return
    try {
      const text = await readTextFile(`${this._projectDir}/.worldsmith/files_meta.json`)
      this._filesMeta = JSON.parse(text)
    } catch {
      this._filesMeta = []
    }
    this._filesMetaLoaded = true
  }
}
