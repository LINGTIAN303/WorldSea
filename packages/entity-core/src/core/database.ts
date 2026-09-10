import Dexie, { type Table } from 'dexie'
import type { Entity } from '../types'
import type { Relation } from '../types'
import type { ProjectFile, ProjectFileContent } from '../types'
import type { Artifact, ArtifactVersion } from '../types'

export interface ModuleInstance {
  id: string
  active: boolean
  source: 'local' | 'builtin' | 'remote'
}

/**
 * 项目级设置 KV 条目
 * 用于存储项目级芽开关、自定义配置等
 */
export interface ProjectSetting {
  key: string
  value: string
}

export class WorldDatabase extends Dexie {
  entities!: Table<Entity, string>
  relations!: Table<Relation, string>
  modules!: Table<ModuleInstance, string>
  files!: Table<ProjectFile, string>
  file_contents!: Table<ProjectFileContent, string>
  project_settings!: Table<ProjectSetting, string>
  artifacts!: Table<Artifact, string>
  artifact_versions!: Table<ArtifactVersion, string>

  /**
   * @param projectId 项目 ID。传入时数据库名为 `WorldSea-Project-${projectId}`；
   * 不传时使用旧的全局数据库名 `WorldSea`（仅用于数据迁移）。
   */
  constructor(projectId?: string) {
    const dbName = projectId
      ? `WorldSea-Project-${projectId}`
      : 'WorldSea'
    super(dbName)

    this.version(1).stores({
      entities: 'id, type, name, *tags',
      relations: 'id, type, sourceId, targetId, createdAt',
      modules: 'id, active, source',
    })
    this.version(2).stores({
      entities: 'id, type, name, *tags',
      relations: 'id, type, sourceId, targetId, createdAt',
      modules: 'id, active, source',
    })
    this.version(3).stores({
      entities: 'id, type, name, *tags',
      relations: 'id, type, sourceId, targetId, pairId, createdAt',
      modules: 'id, active, source',
      kv_store: 'key',
    })
    this.version(4).stores({
      entities: 'id, type, name, *tags',
      relations: 'id, type, sourceId, targetId, pairId, createdAt',
      modules: 'id, active, source',
      kv_store: 'key',
      files: 'id, path, name, entityId, *tags, createdAt',
      file_contents: 'id',
    })
    // v5: 加 updatedAt 索引，支持"最近修改"排序与时间范围筛选
    this.version(5).stores({
      entities: 'id, type, name, *tags, updatedAt',
      relations: 'id, type, sourceId, targetId, pairId, createdAt',
      modules: 'id, active, source',
      kv_store: 'key',
      files: 'id, path, name, entityId, *tags, createdAt',
      file_contents: 'id',
    }).upgrade(async tx => {
      // 旧记录没有 updatedAt，回填为 createdAt（批量 bulkPut）
      const entities = await tx.table('entities').toArray()
      const toUpdate = entities.filter(e => !e.updatedAt)
      if (toUpdate.length > 0) {
        for (const e of toUpdate) {
          e.updatedAt = e.createdAt || new Date(0).toISOString()
        }
        await tx.table('entities').bulkPut(toUpdate)
      }
    })
    // v6: facets 字段支持（Trait 系统），无需新索引——facets 存储在 properties 内
    this.version(6).stores({
      entities: 'id, type, name, *tags, updatedAt',
      relations: 'id, type, sourceId, targetId, pairId, createdAt',
      modules: 'id, active, source',
      kv_store: 'key',
      files: 'id, path, name, entityId, *tags, createdAt',
      file_contents: 'id',
    })
    // v7: 项目空间隔离 — 新增 project_settings 表
    this.version(7).stores({
      entities: 'id, type, name, *tags, updatedAt',
      relations: 'id, type, sourceId, targetId, pairId, createdAt',
      modules: 'id, active, source',
      kv_store: 'key',
      files: 'id, path, name, entityId, *tags, createdAt',
      file_contents: 'id',
      project_settings: 'key',
    })
    // v8: 复合索引 [type+updatedAt] / [type+name]，支持 type 筛选 + 排序的 DB 层分页（PERF-09）
    this.version(8).stores({
      entities: 'id, type, name, *tags, updatedAt, [type+updatedAt], [type+name]',
      relations: 'id, type, sourceId, targetId, pairId, createdAt',
      modules: 'id, active, source',
      kv_store: 'key',
      files: 'id, path, name, entityId, *tags, createdAt',
      file_contents: 'id',
      project_settings: 'key',
    })
    // v9: Artifact 多版本 + 回滚（C1）— 新增 artifacts + artifact_versions 表
    this.version(9).stores({
      entities: 'id, type, name, *tags, updatedAt, [type+updatedAt], [type+name]',
      relations: 'id, type, sourceId, targetId, pairId, createdAt',
      modules: 'id, active, source',
      kv_store: 'key',
      files: 'id, path, name, entityId, *tags, createdAt',
      file_contents: 'id',
      project_settings: 'key',
      artifacts: 'id, title, artifact_type, project_id, version, updatedAt',
      artifact_versions: 'id, artifact_id, version, createdAt, [artifact_id+version]',
    })
  }
}

/**
 * 旧的全局数据库实例。
 *
 * ⚠️ 仅用于数据迁移（ProjectMigration.ts），新代码不应直接使用。
 * 新代码应通过 ProjectManager.getCurrentProjectDb() 获取项目级数据库。
 */
export const db = new WorldDatabase()
