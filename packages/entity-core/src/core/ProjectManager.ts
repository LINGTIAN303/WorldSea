/**
 * ProjectManager — 项目空间管理器
 * 管理项目列表、当前活跃项目、项目级数据库实例池。
 * 全局元数据存于 WorldSea-Meta IndexedDB，各项目数据存于 WorldSea-Project-${projectId}。
 */

import Dexie, { type Table } from 'dexie'

import { WorldDatabase } from './database'
import { acquireProjectDb, releaseProjectDb as releasePooledProjectDb } from './projectDbPool'

/* ════════════════════════════════════════
   类型定义
   ════════════════════════════════════════ */

export interface ProjectInfo {
  id: string
  name: string
  description: string
  createdAt: string
  lastOpenedAt: string
  /** 项目关联的本地目录路径（文件系统主存储） */
  dirPath?: string
  /** 系统默认项目（无项目/未选目录时的全局兜底，2026-09-03）：不可移除，dirPath 恒为全局实体目录 */
  isDefault?: boolean
}

interface AppState {
  key: string
  value: string
}

/* ════════════════════════════════════════
   全局元数据库
   ════════════════════════════════════════ */

class MetaDB extends Dexie {
  projects!: Table<ProjectInfo, string>
  appState!: Table<AppState, string>

  constructor() {
    super('WorldSea-Meta')
    this.version(1).stores({
      projects: 'id, name, createdAt, lastOpenedAt',
      appState: 'key',
    })
  }
}

let metaDb: MetaDB | null = null

function getMetaDb(): MetaDB {
  if (!metaDb) {
    metaDb = new MetaDB()
  }
  return metaDb
}

/* ════════════════════════════════════════
   ProjectManager 单例
   ════════════════════════════════════════ */

class ProjectManager {
  private currentProjectId: string | null = null
  private initialized = false

  /* ─── 初始化 ─── */

  /**
   * 应用启动时调用。确保至少有一个项目存在，
   * 恢复上次打开的项目。
   */
  async initialize(): Promise<string> {
    if (this.initialized) return this.currentProjectId!

    const db = getMetaDb()

    // 检查是否有项目
    const projects = await db.projects.toArray()
    if (projects.length === 0) {
      // 首次启动（或迁移后）：创建默认项目（系统兜底，isDefault=true 不可移除）
      const defaultProject = await this.createProject('默认工作区', '自动创建的默认项目空间', undefined, true)
      this.currentProjectId = defaultProject.id
    } else {
      // 恢复上次打开的项目
      const savedId = await this.getAppState('currentProjectId')
      if (savedId && projects.find(p => p.id === savedId)) {
        this.currentProjectId = savedId
      } else {
        // 按 lastOpenedAt 排序取最近的项目
        const sorted = [...projects].sort(
          (a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt),
        )
        this.currentProjectId = sorted[0].id
      }
    }

    await this.setAppState('currentProjectId', this.currentProjectId)
    this.initialized = true
    return this.currentProjectId
  }

  /* ─── 项目 CRUD ─── */

  async listProjects(): Promise<ProjectInfo[]> {
    const db = getMetaDb()
    return db.projects.orderBy('lastOpenedAt').reverse().toArray()
  }

  async getProject(id: string): Promise<ProjectInfo | undefined> {
    const db = getMetaDb()
    return db.projects.get(id)
  }

  async createProject(name: string, description?: string, dirPath?: string, isDefault?: boolean): Promise<ProjectInfo> {
    const db = getMetaDb()
    const now = new Date().toISOString()
    const project: ProjectInfo = {
      id: crypto.randomUUID(),
      name,
      description: description ?? '',
      createdAt: now,
      lastOpenedAt: now,
      dirPath,
      isDefault: isDefault ?? false,
    }
    await db.projects.put(project)
    return project
  }

  async renameProject(id: string, name: string): Promise<void> {
    const db = getMetaDb()
    await db.projects.update(id, { name })
  }

  /**
   * **全量替换**项目记录表（「项目 = dsh workspace」同源模型，2026-09-28）：真相源 = dsh 工作区清单
   * （壳 `cmd_dsh_workspace_list` 转发），由 useProjectSwitcher 同步逻辑调用做**镜像**——清表后按清单重写（**id 即 workspace id**）；
   * 全量替换（而非逐条增删）绕开 removeProjectRecord 的活跃/默认守卫，旧记录退役由指针校验处理（指针不在清单 → 回落默认工作区）。
   */
  async replaceAllProjects(projects: ProjectInfo[]): Promise<void> {
    const db = getMetaDb()
    await db.projects.clear()
    for (const project of projects) {
      await db.projects.put(project)
    }
  }

  /**
   * 将既有项目标记为系统默认项目（一次性迁移用：旧「默认项目」补 isDefault 标记）。
   */
  async markAsDefaultProject(id: string): Promise<void> {
    const db = getMetaDb()
    await db.projects.update(id, { isDefault: true })
  }

  async updateProjectDescription(id: string, description: string): Promise<void> {
    const db = getMetaDb()
    await db.projects.update(id, { description })
  }

  async deleteProject(id: string): Promise<void> {
    if (id === this.currentProjectId) {
      throw new Error('不能删除当前活跃项目，请先切换到其他项目')
    }
    const db = getMetaDb()
    const project = await db.projects.get(id)
    if (project?.isDefault) {
      throw new Error('默认项目为系统的全局兜底项目，不可删除')
    }

    // 删除项目元数据
    await db.projects.delete(id)

    // 关闭并删除项目数据库
    this.releaseProjectDb(id)

    // 删除项目级 IndexedDB
    await this.deleteProjectDatabase(id)

    // 从最近列表中移除
    const recentIds = await this.getRecentProjectIds()
    if (recentIds.includes(id)) {
      await this.setAppState(
        'recentProjectIds',
        JSON.stringify(recentIds.filter(rid => rid !== id)),
      )
    }
  }

  /**
   * 移除最近项目记录（项目=目录语义，2026-09-03）：仅删 IndexedDB 元数据 + 最近列表剔除，
   * **不关闭/不删项目 DB、不删目录/实体文件**——目录数据与会话（按 workdir）均保留可回。
   */
  async removeProjectRecord(id: string): Promise<void> {
    if (id === this.currentProjectId) {
      throw new Error('不能移除当前活跃项目，请先切换到其他项目')
    }
    const db = getMetaDb()
    const project = await db.projects.get(id)
    if (project?.isDefault) {
      throw new Error('默认项目为系统的全局兜底项目，不可移除')
    }
    await db.projects.delete(id)
    const recentIds = await this.getRecentProjectIds()
    if (recentIds.includes(id)) {
      await this.setAppState(
        'recentProjectIds',
        JSON.stringify(recentIds.filter(rid => rid !== id)),
      )
    }
  }

  /* ─── 项目目录管理 ─── */

  /**
   * 设置项目关联的本地目录路径。
   * 设置后，该项目将使用 FileStorageBackend 以文件系统为主存储。
   */
  async setProjectDir(projectId: string, dirPath: string | null): Promise<void> {
    const db = getMetaDb()
    await db.projects.update(projectId, { dirPath: dirPath ?? undefined })
  }

  /**
   * 获取项目关联的本地目录路径。
   */
  async getProjectDir(projectId: string): Promise<string | null> {
    const db = getMetaDb()
    const project = await db.projects.get(projectId)
    return project?.dirPath ?? null
  }

  /**
   * 获取当前项目的目录路径。
   */
  async getCurrentProjectDir(): Promise<string | null> {
    if (!this.currentProjectId) return null
    return this.getProjectDir(this.currentProjectId)
  }

  /* ─── 当前项目 ─── */

  getCurrentProjectId(): string | null {
    return this.currentProjectId
  }

  async getCurrentProject(): Promise<ProjectInfo | undefined> {
    if (!this.currentProjectId) return undefined
    return this.getProject(this.currentProjectId)
  }

  /**
   * 切换当前项目，返回 true 表示切换成功。
   * 注意：调用方需在切换后自行处理 Store 重载、模块重初始化等。ProjectManager 只负责：
   * 更新 currentProjectId / 更新 lastOpenedAt / 准备新项目的数据库实例。
   */
  async switchProject(id: string): Promise<boolean> {
    if (id === this.currentProjectId) return false

    const db = getMetaDb()
    const project = await db.projects.get(id)
    if (!project) {
      console.error(`[ProjectManager] 项目不存在: ${id}`)
      return false
    }

    // 更新旧项目的 lastOpenedAt
    if (this.currentProjectId) {
      await db.projects.update(this.currentProjectId, {
        lastOpenedAt: new Date().toISOString(),
      })
    }

    // 切换
    this.currentProjectId = id
    await db.projects.update(id, {
      lastOpenedAt: new Date().toISOString(),
    })
    await this.setAppState('currentProjectId', id)

    // 添加到最近列表
    await this.addToRecentProjects(id)

    return true
  }

  /* ─── 数据库实例池（实现外迁 projectDbPool.ts）─── */

  /** 获取指定项目的 WorldDatabase 实例（LRU 池见 projectDbPool.acquireProjectDb）。 */
  getProjectDb(projectId: string): WorldDatabase {
    return acquireProjectDb(projectId)
  }

  /**
   * 获取当前项目的 WorldDatabase 实例。
   */
  getCurrentProjectDb(): WorldDatabase {
    if (!this.currentProjectId) {
      throw new Error('[ProjectManager] 没有活跃项目，请先调用 initialize()')
    }
    return this.getProjectDb(this.currentProjectId)
  }

  /** 释放指定项目的数据库连接。 */
  releaseProjectDb(projectId: string): void {
    releasePooledProjectDb(projectId)
  }

  /* ─── 最近项目 ─── */

  async getRecentProjectIds(): Promise<string[]> {
    const raw = await this.getAppState('recentProjectIds')
    if (!raw) return []
    try {
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  /* ─── 应用全局状态 (KV) ─── */

  async getAppState(key: string): Promise<string | null> {
    const db = getMetaDb()
    const entry = await db.appState.get(key)
    return entry?.value ?? null
  }

  async setAppState(key: string, value: string): Promise<void> {
    const db = getMetaDb()
    await db.appState.put({ key, value })
  }

  async deleteAppState(key: string): Promise<void> {
    const db = getMetaDb()
    await db.appState.delete(key)
  }

  /* ─── 内部方法 ─── */

  private async addToRecentProjects(id: string): Promise<void> {
    const ids = await this.getRecentProjectIds()
    const filtered = ids.filter(rid => rid !== id)
    filtered.unshift(id)
    // 最多保留 10 个
    await this.setAppState('recentProjectIds', JSON.stringify(filtered.slice(0, 10)))
  }

  private async deleteProjectDatabase(projectId: string): Promise<void> {
    const dbName = `WorldSea-Project-${projectId}`
    try {
      await Dexie.delete(dbName)
    } catch (err) {
      console.warn(`[ProjectManager] 删除项目数据库失败: ${dbName}`, err)
    }
    // 同时删除 Agent 会话数据库
    const agentDbName = `worldsea-agent-${projectId}`
    try {
      await Dexie.delete(agentDbName)
    } catch (err) {
      console.warn(`[ProjectManager] 删除 Agent 数据库失败: ${agentDbName}`, err)
    }
  }
}

/* ════════════════════════════════════════
   单例导出
   ════════════════════════════════════════ */

let _instance: ProjectManager | null = null

export function getProjectManager(): ProjectManager {
  if (!_instance) {
    _instance = new ProjectManager()
  }
  return _instance
}

export type { ProjectManager as ProjectManagerClass }
