/** useProjectSwitcher：项目切换编排器（Web 端迁移版，完整流程见文档），详细见 docs/details/注释/web/composables/useProjectSwitcher.md */

import { ref } from 'vue'
import { getProjectManager, setStorageProjectDir } from '@worldsmith/entity-core/core'
import type { ProjectInfo } from '@worldsmith/entity-core/core'
import { entitySchemaRegistry, relationSchemaRegistry } from '@worldsmith/entity-core/core'
import { usePluginStore, useEntityStore, useRelationStore, useFileStore } from '@worldsmith/entity-core/stores'
import { setAgentCurrentProjectId } from '@agent/session/manager'
import { moduleRegistry } from '@/modules/registry'
import { pluginAPI } from '@worldsmith/entity-core'
import { isTauri, hasTauriInvoke } from '@worldsmith/entity-core/core'
import { useFsWatcher } from './useFsWatcher'

const switching = ref(false)
const currentProject = ref<ProjectInfo | null>(null)
const projectList = ref<ProjectInfo[]>([])

export function useProjectSwitcher() {
  const pm = getProjectManager()
  const { startWatching, stopWatching } = useFsWatcher()

  /**
   * 刷新项目列表缓存。
   */
  async function refreshProjectList(): Promise<ProjectInfo[]> {
    projectList.value = await pm.listProjects()
    return projectList.value
  }

  /**
   * 初始化项目系统。
   * 应用启动时调用一次。
   */
  async function initialize(): Promise<string> {
    // 1. 执行数据迁移（如果需要）
    const { migrateIfNeeded } = await import('@worldsmith/entity-core/core')
    await migrateIfNeeded()

    // 2. 初始化 ProjectManager
    const projectId = await pm.initialize()

    // 3. Tauri 环境：切换后端 SQLite 数据库（P3-W4 续恢复）
    if (isTauri() && hasTauriInvoke()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('cmd_switch_project', { projectId })
      } catch (err) {
        console.error('[ProjectSwitcher] Tauri cmd_switch_project 失败:', err)
      }
    }

    // 2.5 设置 FileStorageBackend 目录绑定
    let dirPath = await pm.getProjectDir(projectId)
    // Tauri 兜底：旧项目无目录时自动绑定应用数据目录下的子目录，避免降级到不可用的 TauriStorageBackend
    if (!dirPath && isTauri() && hasTauriInvoke()) {
      const dataDir = await getTauriDataDir()
      if (dataDir) {
        const autoDir = `${dataDir}/projects/${projectId}`
        await pm.setProjectDir(projectId, autoDir)
        dirPath = autoDir
      }
    }
    await setStorageProjectDir(dirPath)

    // 2.6 启动文件监听（有目录绑定时）
    if (dirPath) {
      await startWatching()
    }

    // 3. 同步 Agent 会话数据库
    setAgentCurrentProjectId(projectId)

    // 4. 加载当前项目信息
    currentProject.value = (await pm.getCurrentProject()) ?? null

    // 5. 加载项目列表
    await refreshProjectList()

    return projectId
  }

  /**
   * 切换到指定项目。
   * @returns true 表示切换成功
   */
  async function switchProject(targetProjectId: string): Promise<boolean> {
    if (switching.value) {
      console.warn('[ProjectSwitcher] 正在切换中，忽略重复请求')
      return false
    }

    if (targetProjectId === pm.getCurrentProjectId()) {
      return false
    }

    switching.value = true

    try {
      console.log(`[ProjectSwitcher] 开始切换项目: ${targetProjectId}`)

      // 1. 切换 ProjectManager 的当前项目
      const switched = await pm.switchProject(targetProjectId)
      if (!switched) {
        console.warn('[ProjectSwitcher] ProjectManager 拒绝切换')
        return false
      }

      // 2. Tauri 环境：切换后端 SQLite 数据库（P3-W4 续恢复）
      if (isTauri() && hasTauriInvoke()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('cmd_switch_project', { projectId: targetProjectId })
        } catch (err) {
          console.error('[ProjectSwitcher] Tauri cmd_switch_project 失败:', err)
        }
      }

      // 2. 设置 FileStorageBackend 目录绑定
      let dirPath = await pm.getProjectDir(targetProjectId)
      // Tauri 兜底：旧项目无目录时自动绑定应用数据目录下的子目录
      if (!dirPath && isTauri() && hasTauriInvoke()) {
        const dataDir = await getTauriDataDir()
        if (dataDir) {
          const autoDir = `${dataDir}/projects/${targetProjectId}`
          await pm.setProjectDir(targetProjectId, autoDir)
          dirPath = autoDir
        }
      }
      await setStorageProjectDir(dirPath)

      // 2.5 停止旧监听 + 启动新监听
      await stopWatching()
      if (dirPath) {
        await startWatching()
      }

      // 3. 同步 Agent 会话数据库
      setAgentCurrentProjectId(targetProjectId)

      // 4. 重新加载所有 Store
      await reloadStores()

      // 5. 重新初始化模块系统
      await reinitializeModules()

      // 6. 恢复文件系统关联（P3-W4 续恢复）
      const { useFileSystemProject } = await import('@/composables/useFileSystemProject')
      const fsProject = useFileSystemProject()
      await fsProject.onProjectSwitched()

      // 6. 更新当前项目信息
      currentProject.value = (await pm.getCurrentProject()) ?? null

      // 7. 刷新项目列表
      await refreshProjectList()

      // 8. 发射全局事件
      window.dispatchEvent(new CustomEvent('project:switched', {
        detail: { projectId: targetProjectId },
      }))

      console.log(`[ProjectSwitcher] 项目切换完成: ${currentProject.value?.name}`)
      return true
    } catch (err) {
      console.error('[ProjectSwitcher] 项目切换失败:', err)
      return false
    } finally {
      switching.value = false
    }
  }

  /**
   * 重新加载所有 Store 数据。
   * 切换项目后，底层 StorageBackend 已指向新数据库，
   * 只需清空内存缓存并重新 loadAll()。
   */
  async function reloadStores(): Promise<void> {
    const entityStore = useEntityStore()
    const relationStore = useRelationStore()
    const fileStore = useFileStore()

    // 并行重新加载
    await Promise.all([
      entityStore.loadAll(),
      relationStore.loadAll(),
      fileStore.loadAll(),
    ])

    // 加载项目级插件开关
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const settings = useSettingsStore()
    const projectPlugins = await settings.loadProjectPlugins()
    if (projectPlugins) {
      settings.plugins = projectPlugins
    }
  }

  /**
   * 重新初始化模块系统。
   * 切换项目后，需要从新项目的 DB 加载模块配置，
   * 重新注册所有 entity/relation schema。
   */
  async function reinitializeModules(): Promise<void> {
    // 1. 清空当前注册的 schema
    entitySchemaRegistry.clear()
    relationSchemaRegistry.clear()
    const pluginStore = usePluginStore()
    pluginStore.clearViews()
    pluginStore.clearPlugins()

    // 2. 重新初始化模块注册表（从新项目 DB 加载模块并注册 schema）
    await moduleRegistry.initialize()

    // 3. 将 pluginAPI 中的视图全量同步到 pluginStore
    //    官方插件视图在 pluginAPI._views 中始终存在（不会被清空），
    //    自定义模块视图由 moduleRegistry.initialize() 重新注册。
    //    但 moduleRegistry.initialize() 只写 pluginAPI._views，
    //    不会触发 pluginManager.viewHook → pluginStore.registerView，
    //    所以需要手动同步。
    for (const view of pluginAPI.getViews()) {
      pluginStore.registerView(view)
    }
  }

  /**
   * Tauri 环境：获取应用数据目录，用于自动绑定项目存储目录。
   * 仅在 isTauri() 且命令存在时返回目录路径，否则返回 null。
   */
  async function getTauriDataDir(): Promise<string | null> {
    if (!(isTauri() && hasTauriInvoke())) return null
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return (await invoke('cmd_get_app_data_dir')) as string
    } catch (err) {
      console.error('[ProjectSwitcher] Tauri cmd_get_app_data_dir 失败:', err)
      return null
    }
  }

  /**
   * 创建新项目并切换到它。
   * Tauri 环境：自动绑定应用数据目录下的项目子目录，使 FileStorageBackend 以文件系统为主存储。
   */
  async function createAndSwitch(name: string, description?: string): Promise<ProjectInfo | null> {
    const project = await pm.createProject(name, description)
    // Tauri 环境：用项目 id 作为子目录名，绑定到应用数据目录下，避免降级到不可用的 TauriStorageBackend
    const dataDir = await getTauriDataDir()
    if (dataDir && project) {
      await pm.setProjectDir(project.id, `${dataDir}/projects/${project.id}`)
    }
    const switched = await switchProject(project.id)
    return switched ? project : null
  }

  /**
   * 删除指定项目（不能删除当前项目）。
   */
  async function deleteProject(id: string): Promise<void> {
    await pm.deleteProject(id)
    // Tauri 环境：删除后端 SQLite 文件（P3-W4 续恢复）
    if (isTauri() && hasTauriInvoke()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('cmd_delete_project_db', { projectId: id })
      } catch (err) {
        console.error('[ProjectSwitcher] Tauri cmd_delete_project_db 失败:', err)
      }
    }
    await refreshProjectList()
  }

  /**
   * 重命名指定项目。
   */
  async function renameProject(id: string, name: string): Promise<void> {
    await pm.renameProject(id, name)
    await refreshProjectList()
    // 如果重命名的是当前项目，更新 currentProject
    if (id === pm.getCurrentProjectId()) {
      currentProject.value = (await pm.getCurrentProject()) ?? null
    }
  }

  /**
   * 获取项目列表。
   */
  async function listProjects(): Promise<ProjectInfo[]> {
    return refreshProjectList()
  }

  return {
    switching,
    currentProject,
    projectList,
    initialize,
    switchProject,
    createAndSwitch,
    deleteProject,
    renameProject,
    listProjects,
    refreshProjectList,
  }
}
