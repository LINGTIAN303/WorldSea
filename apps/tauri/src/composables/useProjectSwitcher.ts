/** useProjectSwitcher：项目切换编排器（D2-b2 同源版，2026-09-28）。
 *  **项目 = dsh 工作区**（真同源，id 即 workspace id）——项目元数据的真相源 = 壳转发的
 *  dsh 工作区清单（`cmd_dsh_workspace_list`），IndexedDB（ProjectManager）只承载
 *  「当前指针 + 记录镜像」。新建/删除/重命名项目归 dsh 侧管理，本层不再提供。
 *  详细设计见 docs/plans/2026-09-27-D2-Agent操作产品域-重设计批计划.md §1.1。 */

import { computed, ref } from 'vue'
import { useAsyncTask } from '@worldsea/ui-kit/composables/useAsyncTask'
import { getProjectManager, setStorageProjectDir } from '@worldsea/entity-core/core'
import type { ProjectInfo } from '@worldsea/entity-core/core'
import { entitySchemaRegistry, relationSchemaRegistry, entitySchemaRegistryV2 } from '@worldsea/entity-core/core'
import { usePluginStore, useEntityStore, useRelationStore, useFileStore, useIconOverrideStore, useIconAssetStore } from '@worldsea/entity-core/stores'

import { pluginAPI } from '@worldsea/entity-core'
import { bootstrapShell } from '@/plugins/boot'
import { isTauri, hasTauriInvoke } from '@worldsea/entity-core/core'
import { useFsWatcher } from './useFsWatcher'
import { setSpaceSwitchBlocked } from './shellSwitch'

/** 项目切换的 4 个用户可见阶段（实现步骤归并，避免面板过长）。 */
export const PROJECT_SWITCH_STAGES = [
  { short: '数据源', full: '切换数据源…', detail: '绑定工作区指针' },
  { short: '实体', full: '装载实体 / 关系 / 文件…', detail: '正在读取工作区数据' },
  { short: '芽', full: '重装芽与视图…', detail: '卸载 / 重装视图' },
  { short: '关联', full: '恢复文件关联…', detail: '文件监听 / 导图 / 章节迁移' },
]

const switching = ref(false)
const currentProject = ref<ProjectInfo | null>(null)
const projectList = ref<ProjectInfo[]>([])
const switchTask = useAsyncTask({ delay: 200, minVisible: 400, successHold: 300 })
const switchStage = ref(0)
const switchTargetId = ref('')
const switchTargetName = ref('')
const switchStatus = computed<'loading' | 'success' | 'error'>(() => {
  const status = switchTask.status.value
  return status === 'success' ? 'success' : status === 'error' ? 'error' : 'loading'
})

/** dsh 工作区清单条目（`cmd_dsh_workspace_list` 的返回形状）。 */
interface DshWorkspaceInfo {
  id: string
  title: string
  path: string
  isDefault: boolean
}

export function useProjectSwitcher() {
  const pm = getProjectManager()
  const { startWatching, stopWatching } = useFsWatcher()

  /** 拉取 dsh 工作区清单（壳转发）。非 Tauri（浏览器预览）或失败 → null（调用方回落 IndexedDB 既有记录）。 */
  async function fetchWorkspaces(): Promise<DshWorkspaceInfo[] | null> {
    if (!(isTauri() && hasTauriInvoke())) return null
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke('cmd_dsh_workspace_list')
    } catch (err) {
      console.warn('[ProjectSwitcher] 拉取 dsh 工作区清单失败（回落 IndexedDB 既有记录）:', err)
      return null
    }
  }

  /**
   * 工作区同步（D2-b2 同源核心）：workspace 清单 → **全量镜像**到 pm 记录表
   * （`replaceAllProjects`，**id 即 workspace id**；title/path/isDefault 跟随工作区，
   * createdAt/lastOpenedAt 保留既有）。旧记录（历史 uuid 项目 / 已删工作区）随全量替换退役——
   * 当前指针的回落由 initialize 的指针校验处理。
   * @returns 同步后的项目列表（按 dsh 工作区清单顺序）；拉取失败返回 null。
   */
  async function syncWorkspaces(): Promise<ProjectInfo[] | null> {
    const workspaces = await fetchWorkspaces()
    if (workspaces === null) return null
    const now = new Date().toISOString()
    const synced: ProjectInfo[] = []
    for (const workspace of workspaces) {
      const existing = await pm.getProject(workspace.id)
      synced.push({
        id: workspace.id,
        name: workspace.title,
        description: existing?.description ?? '',
        createdAt: existing?.createdAt ?? now,
        lastOpenedAt: existing?.lastOpenedAt ?? now,
        dirPath: workspace.path,
        isDefault: workspace.isDefault,
      })
    }
    await pm.replaceAllProjects(synced)
    return synced
  }

  /**
   * 刷新项目列表缓存（D2-b2：真相源 = dsh 工作区清单；拉取失败回落 IndexedDB 既有记录）。
   */
  async function refreshProjectList(): Promise<ProjectInfo[]> {
    const synced = await syncWorkspaces()
    projectList.value = synced ?? (await pm.listProjects())
    return projectList.value
  }

  /**
   * 工作台实体存储根（D2-b2 统一口径）：`<dirPath>/worlddata`——**所有项目同构**
   * （此前默认项目特判 worlddata、普通项目直落 dirPath；workspace 同源后统一）。
   * 防御性剥离历史残留的 worldentity/worlddata 段，避免双重嵌套路径。
   */
  function entityDirOf(dirPath: string | null): string | null {
    if (!dirPath) return null
    let root = dirPath
    while (/(worldentity|worlddata)$/i.test(root)) {
      root = root.replace(/[\\/]+(worldentity|worlddata)$/i, '')
    }
    return `${root.replace(/[\\/]+$/, '')}/worlddata`
  }

  /**
   * 初始化项目系统（应用启动时调用一次）。
   */
  async function initialize(): Promise<string> {
    // 1. 执行数据迁移（如果需要）
    const { migrateIfNeeded } = await import('@worldsea/entity-core/core')
    await migrateIfNeeded()

    // 2. 初始化 ProjectManager（无记录时会自动建旧式「默认工作区」——随后的同步会清理）
    await pm.initialize()

    // 3. D2-b2：工作区同步（真相源对齐 + 旧记录清理）
    const synced = await syncWorkspaces()

    // 4. 当前指针校验：指向已清理的旧记录 → 回落默认工作区（isDefault 优先，否则清单首项）
    let current = (await pm.getCurrentProject()) ?? null
    if (current && synced && !synced.some(p => p.id === current!.id)) {
      const fallback = synced.find(p => p.isDefault) ?? synced[0] ?? null
      if (fallback) {
        await pm.switchProject(fallback.id)
        current = fallback
        console.log(`[ProjectSwitcher] 当前指针指向已清理记录 → 回落默认工作区「${fallback.name}」`)
      }
    }

    // 5. 实体存储根绑定 + 启动文件监听
    const dirPath = current?.dirPath ?? null
    await setStorageProjectDir(entityDirOf(dirPath))
    if (dirPath) {
      await startWatching()
    }

    // 6. 加载当前项目信息与列表
    currentProject.value = current
    projectList.value = synced ?? (await pm.listProjects())

    // 7. 图标覆盖与自定义图标资产（项目库为主，分键 localStorage 回退）
    await useIconOverrideStore().loadProjectIconOverrides()
    const iconAssets = useIconAssetStore()
    await iconAssets.loadGlobalIconAssets()
    await iconAssets.loadProjectIconAssets()

    return current?.id ?? ''
  }

  async function resolveProjectName(targetId: string): Promise<string> {
    const known = projectList.value.find(p => p.id === targetId)
    if (known) return known.name
    try {
      const record = await pm.getProject(targetId)
      return record?.name ?? targetId
    } catch {
      return targetId
    }
  }

  async function performSwitch(targetId: string, allowSame = false): Promise<boolean> {
    if (switching.value) {
      console.warn('[ProjectSwitcher] 正在切换中，忽略重复请求')
      return false
    }

    if (!allowSame && targetId === pm.getCurrentProjectId()) {
      return false
    }

    switching.value = true
    setSpaceSwitchBlocked(true)
    switchTargetId.value = targetId
    switchStage.value = 0
    switchTargetName.value = projectList.value.find(p => p.id === targetId)?.name ?? targetId

    try {
      switchTargetName.value = await resolveProjectName(targetId)
      console.log(`[ProjectSwitcher] 开始切换项目: ${targetId}`)

      await switchTask.run(async () => {
        // 0 数据源：切指针 + 绑定存储根（重试时指针可能已是目标）
        if (targetId !== pm.getCurrentProjectId()) {
          const switched = await pm.switchProject(targetId)
          if (!switched) throw new Error('项目切换被拒绝')
        }
        const dirPath = await pm.getProjectDir(targetId)
        await setStorageProjectDir(entityDirOf(dirPath))

        // 1 实体：停旧监听 → 启新监听 → 重载三 Store + 项目设置/导图
        switchStage.value = 1
        await stopWatching()
        if (dirPath) {
          await startWatching()
        }
        await reloadStores()

        // 2 芽：卸载/重装 + 壳重装配
        switchStage.value = 2
        await reinitializeModules()

        // 3 关联：文件系统关联 + 当前项目/列表 + 全局事件
        switchStage.value = 3
        const { useFileSystemProject } = await import('@/composables/useFileSystemProject')
        const fsProject = useFileSystemProject()
        await fsProject.onProjectSwitched()
        currentProject.value = (await pm.getCurrentProject()) ?? null
        await refreshProjectList()
        window.dispatchEvent(new CustomEvent('project:switched', {
          detail: { projectId: targetId },
        }))
        return true
      })

      console.log(`[ProjectSwitcher] 项目切换完成: ${currentProject.value?.name}`)
      return true
    } catch (err) {
      console.error('[ProjectSwitcher] 项目切换失败:', err)
      return false
    } finally {
      switching.value = false
      setSpaceSwitchBlocked(false)
    }
  }

  /**
   * 切换到指定项目（id = workspace id）。
   * @returns true 表示切换成功
   */
  async function switchProject(targetProjectId: string): Promise<boolean> {
    return performSwitch(targetProjectId)
  }

  /** 错误浮层重试：允许目标已是当前指针（失败可能发生在指针已切换之后） */
  async function retrySwitch(): Promise<boolean> {
    if (!switchTargetId.value) return false
    return performSwitch(switchTargetId.value, true)
  }

  /** 关闭错误浮层：保留已完成步骤，提示可能处于部分状态 */
  function dismissSwitchError(): void {
    if (switchTask.status.value !== 'error') return
    console.warn('[ProjectSwitcher] 用户关闭切换错误浮层，当前可能处于部分切换状态:', switchTask.error.value)
    switchTask.reset()
    switchTargetId.value = ''
    switchTargetName.value = ''
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

    // R6-a：项目数据就绪后迁移旧「章节↔大纲节点」字段（幂等、skipUndo）
    try {
      const { migrateLegacyChapterLinks } = await import('@/entity/chapterLink')
      await migrateLegacyChapterLinks(entityStore, relationStore)
    } catch (err) {
      console.warn('[project] 章节关联迁移失败（不影响切项目）:', err)
    }

    // 加载项目级芽开关 + 芽分组（分组持久化模式与芽开关一致：localStorage 回退 + 项目 DB）
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const settings = useSettingsStore()
    const projectSprouts = await settings.loadProjectSprouts()
    if (projectSprouts) {
      settings.sprouts = projectSprouts
    }
    const projectSproutGroups = await settings.loadProjectSproutGroups()
    if (projectSproutGroups) {
      settings.sproutGroups = projectSproutGroups
    }

    // 图标覆盖与自定义资产（项目级；切项目必须重读，避免沿用上一项目）
    await useIconOverrideStore().loadProjectIconOverrides()
    await useIconAssetStore().loadProjectIconAssets()

    // 重载思维导图文档（项目级隔离：文档索引与内容都在项目 DB；C 批起模块在第二棵树内）
    const { useMindmapDocStore } = await import('@/world/plugins/mindmap/mindmapStore')
    const mindmapDocStore = useMindmapDocStore()
    await mindmapDocStore.loadAll()
  }

  /**
   * 重新播种项目级注册面。
   * 切换项目后，从新项目重新注册所有 entity/relation schema，并重播种官方芽视图。
   * （2026-09-25 剪除「自定义模块」后，项目 DB 已无模块配置可加载。）
   */
  async function reinitializeModules(): Promise<void> {
    // 1. 清空当前注册的 schema（旧版 + V2 + relation；V2 此前切项目不清空，2026-09-09 收口）
    entitySchemaRegistry.clear()
    entitySchemaRegistryV2.clear()
    relationSchemaRegistry.clear()
    // 视图清**真源**（pluginAPI）：显示侧（pluginStore）由 viewSync 订阅即时镜像；
    // sidebarOrder 是用户排序偏好，刻意保留——重播种后各视图回到原位置（2026-09-25 D 批）。
    pluginAPI.clearViews()
    usePluginStore().clearPlugins()

    // 1.5 树插件重装载（2026-09-28 走查修复）：clearViews 只清视图真源，树插件 fiber 仍在——
    //     setPluginEnabled(true) 对已装载插件是 no-op（tree.ts 的 fibers.has 幂等位），
    //     视图/实体类型/能力永远不会重新注册 → 侧栏全空、实体类型清空、快照导出空表，
    //     且需逐芽手动「关-开」才恢复单个芽。此处按已装载清单 unload→load（等效逐芽关-开），
    //     可见性沿用芽清单口径（isViewVisible），apply 重跑 = 视图 + schema 类型 + 能力全部重注册。
    const [{ worldTreeState, unloadPlugin, setPluginEnabled }, { isViewVisible }] = await Promise.all([
      import('@/world'),
      import('@worldsea/entity-core'),
    ])
    for (const pluginId of [...worldTreeState().plugins]) {
      unloadPlugin(pluginId)
      setPluginEnabled(pluginId, isViewVisible(pluginId))
    }

    // 2. 产品壳重装配（C2 起：官方芽全部在第二棵树内——树随页面常驻，项目切换只需重装视图同步 + 保视图选择）
    await bootstrapShell({ skipDefaultView: true })

    // 3. 视图无需手动同步：视图真源由树插件注册（pluginAPI.registerView），
    //    真源变更由 viewSync 的单一订阅镜像到 pluginStore（2026-09-25 D 批收敛，原全量重灌删除）。
  }

  /**
   * 获取项目列表（workspace 同源顺序）。
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
    listProjects,
    refreshProjectList,
    switchVisible: switchTask.visible,
    switchStatus,
    switchError: switchTask.error,
    switchStage,
    switchTargetId,
    switchTargetName,
    switchStages: PROJECT_SWITCH_STAGES,
    retrySwitch,
    dismissSwitchError,
  }
}
