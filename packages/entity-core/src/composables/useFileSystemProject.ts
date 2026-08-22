/** 项目目录绑定与导出（绑定本地目录/导出到文件夹，对接 FileStorageBackend 体系），详细见 docs/details/注释/packages/entity-core/composables/useFileSystemProject.md */

import { ref, computed } from 'vue'
import { getProjectManager, setStorageProjectDir, getFileStorageBackend, isTauri } from '../core'
import { useEntityStore, useRelationStore } from '../stores'
import { useFsWatcher } from './useFsWatcher'

/** 当前绑定的项目目录路径 */
const boundDir = ref<string | null>(null)
const saving = ref(false)
const loading = ref(false)
const lastError = ref('')

const dirName = computed(() => {
  if (!boundDir.value) return ''
  const sep = boundDir.value.includes('\\') ? '\\' : '/'
  const parts = boundDir.value.split(sep).filter(Boolean)
  return parts[parts.length - 1] || ''
})

const isProjectOpen = computed(() => boundDir.value !== null)

/** 是否在 Tauri 桌面端（支持文件系统操作） */
const isSupported = computed(() => isTauri())

/** 打开 Tauri 目录选择对话框 */
async function openDirDialog(title: string): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, title, multiple: false })
    return selected as string | null
  } catch {
    return null
  }
}

export function useFileSystemProject() {
  /**
   * 绑定本地目录到当前项目。
   * 选择目录后，调用 setStorageProjectDir 激活 FileStorageBackend，
   * 并启动文件监听。如果目录中已有数据，FileStorageBackend 会自动加载。
   */
  async function openFolder(): Promise<boolean> {
    if (!isSupported.value) {
      lastError.value = '文件系统操作需要 Tauri 桌面端环境'
      return false
    }
    lastError.value = ''
    try {
      const dirPath = await openDirDialog('选择项目目录')
      if (!dirPath) return false // 用户取消

      const pm = getProjectManager()
      const projectId = pm.getCurrentProjectId()
      if (!projectId) {
        lastError.value = '请先创建或选择一个项目'
        return false
      }

      // 绑定目录到项目
      await pm.setProjectDir(projectId, dirPath)
      // 激活 FileStorageBackend
      await setStorageProjectDir(dirPath)
      // 启动文件监听
      const { startWatching } = useFsWatcher()
      await startWatching()

      // 更新内存状态
      boundDir.value = dirPath

      // 如果 FileStorageBackend 已就绪，重新加载数据
      const fsb = getFileStorageBackend()
      if (fsb?.isReady) {
        const entityStore = useEntityStore()
        const relationStore = useRelationStore()
        await entityStore.loadAll()
        await relationStore.loadAll()
      }

      return true
    } catch (err: any) {
      lastError.value = err.message ?? '绑定目录失败'
      return false
    }
  }

  /**
   * 将指定目录直接绑定为当前项目的存储目录（统一根目录）。
   * 与 openFolder 的绑定逻辑一致，但不弹系统目录对话框——由调用方传入已选目录
   * （如 Agent 工作区「打开文件夹」选中的目录），使 Agent 工作区与项目数据存储共享同一根目录。
   */
  async function bindDirToProject(dirPath: string): Promise<boolean> {
    if (!isSupported.value) {
      lastError.value = '文件系统操作需要 Tauri 桌面端环境'
      return false
    }
    lastError.value = ''
    try {
      const pm = getProjectManager()
      const projectId = pm.getCurrentProjectId()
      if (!projectId) {
        lastError.value = '请先创建或选择一个项目'
        return false
      }
      await pm.setProjectDir(projectId, dirPath)
      await setStorageProjectDir(dirPath)
      const { startWatching } = useFsWatcher()
      await startWatching()
      boundDir.value = dirPath
      const fsb = getFileStorageBackend()
      if (fsb?.isReady) {
        const entityStore = useEntityStore()
        const relationStore = useRelationStore()
        await entityStore.loadAll()
        await relationStore.loadAll()
      }
      return true
    } catch (err: any) {
      lastError.value = err.message ?? '绑定目录失败'
      return false
    }
  }

  /**
   * 导出当前项目到指定目录。
   * 使用 ProjectFS.exportProjectToDir 格式（entities/ + relations/ 目录结构）。
   */
  async function saveToFolder(): Promise<boolean> {
    if (!isSupported.value) {
      lastError.value = '文件系统操作需要 Tauri 桌面端环境'
      return false
    }
    saving.value = true
    lastError.value = ''
    try {
      const { exportProjectToDir } = await import('../core/ProjectFS')
      const result = await exportProjectToDir()
      if (result) {
        return true
      }
      lastError.value = '导出取消或失败'
      return false
    } catch (err: any) {
      lastError.value = err.message ?? '导出失败'
      return false
    } finally {
      saving.value = false
    }
  }

  /**
   * 取消当前项目的目录绑定。
   */
  async function closeProject(): Promise<void> {
    const pm = getProjectManager()
    const projectId = pm.getCurrentProjectId()
    if (projectId) {
      await pm.setProjectDir(projectId, null)
    }
    await setStorageProjectDir(null)
    const { stopWatching } = useFsWatcher()
    await stopWatching()
    boundDir.value = null
  }

  /**
   * 项目切换时调用。从 ProjectManager 读取新项目的目录绑定状态。
   */
  async function onProjectSwitched(): Promise<void> {
    const pm = getProjectManager()
    const projectId = pm.getCurrentProjectId()
    if (!projectId) {
      boundDir.value = null
      return
    }

    const dirPath = await pm.getProjectDir(projectId)
    boundDir.value = dirPath ?? null
  }

  /**
   * 初始化时尝试恢复当前项目的目录绑定状态。
   * 由 Shell.vue onMounted 调用。
   */
  async function tryRestoreProject(): Promise<boolean> {
    if (!isSupported.value) return false
    try {
      const pm = getProjectManager()
      const projectId = pm.getCurrentProjectId()
      if (!projectId) return false

      const dirPath = await pm.getProjectDir(projectId)
      if (!dirPath) return false

      boundDir.value = dirPath
      return true
    } catch {
      return false
    }
  }

  return {
    dirName,
    isProjectOpen,
    isSupported,
    saving,
    loading,
    lastError,
    openFolder,
    bindDirToProject,
    saveToFolder,
    closeProject,
    tryRestoreProject,
    onProjectSwitched,
  }
}
