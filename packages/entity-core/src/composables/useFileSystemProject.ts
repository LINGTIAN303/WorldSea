/** 项目目录状态与导出（项目=目录语义，2026-09-03：无独立"绑定"概念；目录即项目），详细见 docs/details/注释/packages/entity-core/composables/useFileSystemProject.md */

import { ref, computed } from 'vue'
import { getProjectManager, isTauri } from '../core'

/** 当前项目目录路径 */
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

/** 是否在 Tauri 桌面端（支持文件系统操作） */
const isSupported = computed(() => isTauri())

export function useFileSystemProject() {
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
   * 项目切换时调用。从 ProjectManager 读取新项目的目录状态（项目=目录）。
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
    isSupported,
    saving,
    loading,
    lastError,
    saveToFolder,
    tryRestoreProject,
    onProjectSwitched,
  }
}
