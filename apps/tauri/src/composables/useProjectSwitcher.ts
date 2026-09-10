/** useProjectSwitcher：项目切换编排器（Web 端迁移版，完整流程见文档），详细见 docs/details/注释/web/composables/useProjectSwitcher.md */

import { ref } from 'vue'
import { getProjectManager, setStorageProjectDir } from '@worldsea/entity-core/core'
import type { ProjectInfo } from '@worldsea/entity-core/core'
import { entitySchemaRegistry, relationSchemaRegistry, entitySchemaRegistryV2 } from '@worldsea/entity-core/core'
import { usePluginStore, useEntityStore, useRelationStore, useFileStore } from '@worldsea/entity-core/stores'
import { setAgentCurrentProjectId } from '@agent/session/manager'
import { moduleRegistry } from '@/modules/registry'
import { pluginAPI } from '@worldsea/entity-core'
import { pluginManager } from '@/plugins/PluginManager'
import { bootstrapSprouts } from '@/plugins/bootstrap'
import { isTauri, hasTauriInvoke } from '@worldsea/entity-core/core'
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

  /** 路径归一化：去掉尾部分隔符；Windows 大小写不敏感 */
  function normalizeDir(p: string): string {
    const norm = (p || '').replace(/[\\/]+$/g, '')
    return /^win/i.test(navigator.platform) ? norm.toLowerCase() : norm
  }

  /** 目录基名（兼容 / 与 \） */
  function baseNameOf(p: string): string {
    const segs = p.split(/[\\/]/).filter(Boolean)
    return segs[segs.length - 1] ?? p
  }

  /**
   * 工作台实体存储根解析（2026-09-03 拍板，默认项目三层分离）：
   * - 默认项目 dirPath = `~/.WorldSea` 根（显示/定位基准）→ 实体落 `根/worlddata`
   * - 普通项目 = dirPath 本身（打开目录即两边同源）
   * 防御性剥离历史残留的 worldentity/worlddata 段，避免双重嵌套路径（worldentity/worldentity）。
   */
  function entityDirOf(p: ProjectInfo | null | undefined, dirPath: string | null): string | null {
    if (!dirPath) return null
    if (!p?.isDefault) return dirPath
    let root = dirPath
    while (/(worldentity|worlddata)$/i.test(root)) {
      root = root.replace(/[\\/]+(worldentity|worlddata)$/i, '')
    }
    return `${root.replace(/[\\/]+$/, '')}/worlddata`
  }

  /**
   * 打开目录即打开项目（项目=目录语义，2026-09-03）：
   * 目录 → 若已有 dirPath 匹配的项目则切换，否则按目录基名新建项目并切换。
   * 切换经 switchProject 触发 `project:switched` → Agent 空间联动新建会话。
   */
  async function openProjectDir(dir: string): Promise<ProjectInfo | null> {
    const norm = normalizeDir(dir)
    const all = await pm.listProjects()
    const existing = all.find(p => p.dirPath && normalizeDir(p.dirPath) === norm)
    if (existing) {
      const switched = await switchProject(existing.id)
      return switched ? existing : null
    }
    const project = await pm.createProject(baseNameOf(dir), undefined, dir)
    const switched = await switchProject(project.id)
    return switched ? project : null
  }

  /**
   * 唯一目录选择入口：Tauri 系统目录选择器 → openProjectDir。
   * 非 Tauri（浏览器 preview）降级提示并返回 false。
   */
  async function openProjectFromDialog(): Promise<boolean> {
    if (!(isTauri() && hasTauriInvoke())) {
      console.warn('[ProjectSwitcher] 目录选择需要 Tauri 桌面端环境')
      return false
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      // 打开文件夹定位基准 = 全局根 ~/.WorldSea（2026-09-03 拍板）
      let defaultPath: string | undefined
      try {
        const { homeDir } = await import('@tauri-apps/api/path')
        const home = await homeDir()
        if (home) defaultPath = `${home.replace(/[\\/]+$/, '')}/.WorldSea`
      } catch { /* 定位失败仅回到系统默认位置 */ }
      const selected = await open({ directory: true, title: '打开项目目录', multiple: false, defaultPath })
      if (!selected) return false
      return !!(await openProjectDir(selected as string))
    } catch (err) {
      console.error('[ProjectSwitcher] 打开项目目录失败:', err)
      return false
    }
  }

  /**
   * 移除最近项目记录（仅删 IndexedDB 记录，不删目录/项目 DB/SQLite——会话按 workdir 可回）。
   */
  async function removeRecentProject(id: string): Promise<boolean> {
    try {
      await pm.removeProjectRecord(id)
      await refreshProjectList()
      return true
    } catch (err) {
      console.warn('[ProjectSwitcher] 移除最近项目失败:', err)
      return false
    }
  }

  /**
   * 初始化项目系统。
   * 应用启动时调用一次。
   */
  async function initialize(): Promise<string> {
    // 1. 执行数据迁移（如果需要）
    const { migrateIfNeeded } = await import('@worldsea/entity-core/core')
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

    // 2.5 默认项目兜底归位（无项目/未选目录 = 全局根，2026-09-03 拍板）
    //    · 系统默认项目（isDefault，或旧「默认项目」名——一次性补标记）不可移除；
    //    · 其 dirPath 恒为全局根 ~/.WorldSea（选择器显示 / 打开文件夹定位基准；
    //      修历史残留 dirPath 如 worldentity / tream_test）；
    //    · 默认项目数据分落子目录：工作台实体 → dirPath/worlddata（entityDirOf），
    //      Agent 工作路径 → dirPath/agent（workspace.ts resolveWorkspaceDir 特判）；
    //    · 非默认无目录项目不自动绑定（遗留 SQLite 降级，保持现状）
    let dirPath = await pm.getProjectDir(projectId)
    const currentProj = await pm.getCurrentProject()
    const isDefaultProj = !!(currentProj?.isDefault || currentProj?.name === '默认项目')
    if (isDefaultProj && !currentProj?.isDefault) {
      try { await pm.markAsDefaultProject(projectId) } catch { /* 标记失败不阻塞 */ }
    }
    if (isDefaultProj && isTauri() && hasTauriInvoke()) {
      try {
        const { homeDir } = await import('@tauri-apps/api/path')
        const home = await homeDir()
        if (home) {
          const rootDir = `${home.replace(/[\\/]+$/, '')}/.WorldSea`
          if (normalizeDir(dirPath ?? '') !== normalizeDir(rootDir)) {
            await pm.setProjectDir(projectId, rootDir)
            dirPath = rootDir
          }
        }
      } catch { /* home 不可得：保持现状（SQLite 兜底，仅浏览器/边缘态） */ }
    }
    // 工作台实体采集根：默认项目特判到根下 worlddata 子目录
    await setStorageProjectDir(entityDirOf(currentProj, dirPath))

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

      // 2. 设置 FileStorageBackend 目录绑定（默认项目特判到根/worlddata；
        //    no-dir 项目保持 null/既有 dirPath）
      let dirPath = await pm.getProjectDir(targetProjectId)
      const targetProj = await pm.getProject(targetProjectId)
      await setStorageProjectDir(entityDirOf(targetProj, dirPath))

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

    // 加载项目级芽开关
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const settings = useSettingsStore()
    const projectSprouts = await settings.loadProjectSprouts()
    if (projectSprouts) {
      settings.sprouts = projectSprouts
    }
  }

  /**
   * 重新初始化模块系统。
   * 切换项目后，需要从新项目的 DB 加载模块配置，
   * 重新注册所有 entity/relation schema。
   */
  async function reinitializeModules(): Promise<void> {
    // 1. 清空当前注册的 schema（旧版 + V2 + relation；V2 此前切项目不清空，2026-09-09 收口）
    entitySchemaRegistry.clear()
    entitySchemaRegistryV2.clear()
    relationSchemaRegistry.clear()
    const pluginStore = usePluginStore()
    pluginStore.clearViews()
    pluginStore.clearPlugins()

    // 2. 重新初始化模块注册表（从新项目 DB 加载模块并注册 schema）
    await moduleRegistry.initialize()

    // 3. 官方芽重播种（2026-09-09 收口：bootstrapSprouts 仅在启动时跑一次、activate 有 loaded 防重入，
    //    切项目后官方类型在旧版/V2 表均缺失——resetForProjectSwitch 清 loaded 后重跑激活，
    //    registerEntityV2 双写同时重填旧版 + V2 + fieldRegistry）
    pluginManager.resetForProjectSwitch()
    await bootstrapSprouts({ skipDefaultView: true })

    // 4. 将 pluginAPI 中的视图全量同步到 pluginStore
    //    官方芽视图在 pluginAPI._views 中始终存在（不会被清空），
    //    自定义模块视图由 moduleRegistry.initialize() 重新注册。
    //    但 moduleRegistry.initialize() 只写 pluginAPI._views，
    //    不会触发 pluginManager.viewHook → pluginStore.registerView，
    //    所以需要手动同步。
    for (const view of pluginAPI.getViews()) {
      pluginStore.registerView(view)
    }
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
    openProjectDir,
    openProjectFromDialog,
    removeRecentProject,
    deleteProject,
    renameProject,
    listProjects,
    refreshProjectList,
  }
}
