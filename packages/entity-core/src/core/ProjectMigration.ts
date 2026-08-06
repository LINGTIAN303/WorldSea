/** 一次性数据迁移（旧全局数据库 → 项目级数据库，增量拷贝/分批/失败降级），详细见 docs/details/注释/packages/entity-core/core/ProjectMigration.md */

import Dexie from 'dexie'
import { WorldDatabase } from './database'
import { getProjectManager } from './ProjectManager'

const BATCH_SIZE = 500

interface MigrationResult {
  success: boolean
  projectId: string | null
  entitiesMigrated: number
  relationsMigrated: number
  modulesMigrated: number
  kvMigrated: number
  filesMigrated: number
  fileContentsMigrated: number
  sessionsMigrated: number
  agentProfilesMigrated: number
  groupSessionsMigrated: number
  error?: string
}

/**
 * 检查是否需要迁移，如果需要则执行。
 * 返回迁移后的默认项目 ID。
 */
export async function migrateIfNeeded(): Promise<string | null> {
  const pm = getProjectManager()

  // 检查迁移标记
  const migrationDone = await pm.getAppState('projectMigrationDone')
  if (migrationDone === 'true') {
    return null // 已迁移
  }

  // 检查旧数据库是否存在
  const oldDbExists = await databaseExists('WorldSmith')
  const oldAgentDbExists = await databaseExists('worldsmith-agent')

  if (!oldDbExists && !oldAgentDbExists) {
    // 没有旧数据，标记为已迁移
    await pm.setAppState('projectMigrationDone', 'true')
    return null
  }

  console.log('[ProjectMigration] 检测到旧数据库，开始迁移...')

  try {
    const result = await performMigration()
    await pm.setAppState('projectMigrationDone', 'true')
    console.log('[ProjectMigration] 迁移完成:', result)
    return result.projectId
  } catch (err) {
    console.error('[ProjectMigration] 迁移失败:', err)
    // 标记为已尝试，避免反复失败
    await pm.setAppState('projectMigrationDone', 'error')
    return null
  }
}

/**
 * 执行实际的数据迁移。
 */
async function performMigration(): Promise<MigrationResult> {
  const pm = getProjectManager()
  const result: MigrationResult = {
    success: false,
    projectId: null,
    entitiesMigrated: 0,
    relationsMigrated: 0,
    modulesMigrated: 0,
    kvMigrated: 0,
    filesMigrated: 0,
    fileContentsMigrated: 0,
    sessionsMigrated: 0,
    agentProfilesMigrated: 0,
    groupSessionsMigrated: 0,
  }

  // 1. 创建默认项目
  const defaultProject = await pm.createProject('默认项目', '从旧数据自动迁移的默认项目空间')
  result.projectId = defaultProject.id

  // 2. 迁移 WorldSmith 数据库
  const oldDbExists = await databaseExists('WorldSmith')
  if (oldDbExists) {
    const oldDb = new WorldDatabase() // 不传 projectId，使用旧的全局数据库名
    const newDb = pm.getProjectDb(defaultProject.id)

    try {
      // 分批拷贝各表
      result.entitiesMigrated = await copyTable(oldDb.entities, newDb.entities)
      result.relationsMigrated = await copyTable(oldDb.relations, newDb.relations)
      result.modulesMigrated = await copyTable(oldDb.modules, newDb.modules)
      result.kvMigrated = await copyTable(oldDb.table('kv_store'), newDb.table('kv_store'))
      result.filesMigrated = await copyTable(oldDb.files, newDb.files)
      result.fileContentsMigrated = await copyTable(oldDb.file_contents, newDb.file_contents)
    } finally {
      oldDb.close()
    }
  }

  // 3. 迁移 worldsmith-agent 数据库
  const oldAgentDbExists = await databaseExists('worldsmith-agent')
  if (oldAgentDbExists) {
    // 使用 Dexie 直接打开旧数据库
    const oldAgentDb = new Dexie('worldsmith-agent')
    try {
      // 声明已知的 schema 版本，Dexie 会自动检测并打开
      oldAgentDb.version(2).stores({
        sessions: 'id, name, updatedAt, providerMode',
        agentProfiles: 'id, name, enabled, createdAt',
        groupSessions: 'id, name, updatedAt',
      })
      await oldAgentDb.open()

      const newAgentDbName = `worldsmith-agent-${defaultProject.id}`
      const newAgentDb = new Dexie(newAgentDbName)
      newAgentDb.version(2).stores({
        sessions: 'id, name, updatedAt, providerMode',
        agentProfiles: 'id, name, enabled, createdAt',
        groupSessions: 'id, name, updatedAt',
      })
      await newAgentDb.open()

      try {
        if (oldAgentDb.tables.some(t => t.name === 'sessions')) {
          result.sessionsMigrated = await copyTable(
            oldAgentDb.table('sessions'),
            newAgentDb.table('sessions'),
          )
        }
        if (oldAgentDb.tables.some(t => t.name === 'agentProfiles')) {
          result.agentProfilesMigrated = await copyTable(
            oldAgentDb.table('agentProfiles'),
            newAgentDb.table('agentProfiles'),
          )
        }
        if (oldAgentDb.tables.some(t => t.name === 'groupSessions')) {
          result.groupSessionsMigrated = await copyTable(
            oldAgentDb.table('groupSessions'),
            newAgentDb.table('groupSessions'),
          )
        }
      } finally {
        newAgentDb.close()
      }
    } catch (err) {
      console.warn('[ProjectMigration] Agent 数据库迁移失败:', err)
    } finally {
      oldAgentDb.close()
    }
  }

  // 4. 迁移 localStorage 中的插件开关到 project_settings
  await migratePluginToggles(pm, defaultProject.id)

  // 5. 设置当前项目
  await pm.setAppState('currentProjectId', defaultProject.id)

  result.success = true
  return result
}

/**
 * 分批拷贝 Dexie 表数据。
 * 使用 bulkPut 而非逐条 put，提高性能。
 */
async function copyTable(
  sourceTable: Dexie.Table<any, string>,
  targetTable: Dexie.Table<any, string>,
): Promise<number> {
  let totalCopied = 0
  let offset = 0

  while (true) {
    const batch = await sourceTable.offset(offset).limit(BATCH_SIZE).toArray()
    if (batch.length === 0) break

    await targetTable.bulkPut(batch)
    totalCopied += batch.length
    offset += BATCH_SIZE

    // 让出主线程，避免阻塞 UI
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  return totalCopied
}

/**
 * 迁移 localStorage 中的插件开关到项目级 project_settings 表。
 */
async function migratePluginToggles(pm: ReturnType<typeof getProjectManager>, projectId: string): Promise<void> {
  try {
    const raw = localStorage.getItem('worldsmith_plugin_toggles')
    if (!raw) return

    const toggles = JSON.parse(raw)
    if (!Array.isArray(toggles)) return

    const db = pm.getProjectDb(projectId)
    await db.table('project_settings').put({
      key: 'plugin_toggles',
      value: raw,
    })

    console.log(`[ProjectMigration] 插件开关已迁移: ${toggles.length} 项`)
  } catch (err) {
    console.warn('[ProjectMigration] 插件开关迁移失败:', err)
  }
}

/**
 * 检查 IndexedDB 数据库是否存在。
 * 使用 indexedDB.databases() API 检测（如果可用），
 * 否则通过尝试打开数据库来检测。
 */
async function databaseExists(dbName: string): Promise<boolean> {
  // 优先使用 indexedDB.databases() API
  if (indexedDB.databases) {
    const dbs = await indexedDB.databases()
    return dbs.some(db => db.name === dbName)
  }
  // 回退：尝试打开数据库
  try {
    const db = new Dexie(dbName)
    await db.open()
    const exists = db.tables.length > 0
    db.close()
    return exists
  } catch {
    return false
  }
}
