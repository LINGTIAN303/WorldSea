/**
 * workspace.ts — 工作区目录解析工具（Phase 4：Agent 接入本地文件系统）
 *
 * 无项目/未选目录（默认项目）态路径约定（2026-09-03 拍板，三层分离）：
 * - 默认项目 dirPath = `<home>/WorldSea`（E1 单一可见根；两侧选择器显示 / 打开文件夹定位基准）
 * - Agent 工作路径 = `<home>/WorldSea/agent`（本文件 resolveDefaultWorkspaceDir / resolveWorkspaceDir 特判）
 * - 工作台实体存储 = `<home>/WorldSea/worlddata`（useProjectSwitcher entityDirOf 特判）
 * Agent 工作区 = 项目数据存储为「项目=目录」；普通项目打开目录即两边同源。
 * 浏览器 preview 返回可读假路径。前端所有 invoke 走 transport，不直接调 Tauri。
 */

import { homeDir, join } from '@tauri-apps/api/path'
import { invoke } from '@/agent/composables/transport'

/** 是否为 Tauri 运行时（浏览器 preview 无 __TAURI_INTERNALS__） */
function isTauriRuntime(): boolean {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

/** 追加单一可见根（`<home>/WorldSea`，E1）下子路径（统一尾分隔符） */
async function homeRootSub(sub: string): Promise<string> {
  const home = await homeDir()
  return await join(home, 'WorldSea', sub)
}

/** 兜底 Agent 工作路径（`<home>/WorldSea/agent`；默认项目 / 早期启动兜底） */
export async function resolveDefaultWorkspaceDir(): Promise<string> {
  if (isTauriRuntime()) {
    return await homeRootSub('agent')
  }
  // 浏览器 preview 兜底：返回一个可读的假路径（仅用于展示，不落盘）
  return '/worldsea/agent'
}

/**
 * 解析会话工作区根目录（异步：Tauri path API 与项目目录读取均为 Promise）
 *
 * 优先级：显式 `customPath` → 当前项目目录（项目=目录，普通项目 dirPath 本身；
 * 默认项目特判 `<home>/WorldSea/agent`）→ 兜底同路径（E1）。
 * 项目系统未初始化时静默走兜底，不阻塞会话创建主流程。
 */
export async function resolveWorkspaceDir(customPath?: string): Promise<string> {
  if (customPath) return customPath
  if (isTauriRuntime()) {
    try {
      const { getProjectManager } = await import('@worldsea/entity-core/core')
      const pm = getProjectManager()
      // 默认项目（无项目/未选目录兜底）：Agent 工作路径恒为 <home>/WorldSea/agent
      const project = pm.getCurrentProjectId() ? await pm.getCurrentProject() : undefined
      if (project?.isDefault) {
        return await homeRootSub('agent')
      }
      const projectDir = await pm.getCurrentProjectDir()
      if (projectDir) return projectDir
    } catch {
      // 项目系统未就绪（启动早期）：兜底默认工作区
    }
  }
  return resolveDefaultWorkspaceDir()
}

/**
 * 解析工作台实体存储根（2026-09-03 拍板，与 useProjectSwitcher.entityDirOf 同语义）：
 * - 默认项目（无项目/未选目录兜底）→ `<home>/WorldSea/worlddata`（工作台实体落此）
 * - 普通项目（项目=目录）→ dirPath 本身（Agent 会话 workdir 与工作台实体同源 `{dirPath}/entities`）
 * 浏览器 preview / 项目系统未就绪 → null（调用方回退到会话 workdir 语义，不特判）。
 * 默认项目 dirPath 由 useProjectSwitcher 启动时恒归位根 `<home>/WorldSea`（E1 单一可见根），故此处直接拼子目录；
 * 与 entityDirOf 的防御性剥离（历史 worldentity/worlddata 段）在归位后等价。
 */
export async function resolveEntityDataDir(): Promise<string | null> {
  if (!isTauriRuntime()) return null
  try {
    const { getProjectManager } = await import('@worldsea/entity-core/core')
    const pm = getProjectManager()
    const project = pm.getCurrentProjectId() ? await pm.getCurrentProject() : undefined
    if (project?.isDefault) {
      return await homeRootSub('worlddata')
    }
    return await pm.getCurrentProjectDir()
  } catch {
    return null
  }
}

/**
 * 确保工作区目录存在（不存在则创建；已存在则幂等成功）
 *
 * 复用 cmd_fs_mkdir（Rust 侧 create_dir_all），失败静默忽略——
 * 首次建目录属最佳努力，不阻塞会话创建主流程。
 */
export async function ensureWorkspaceDir(dir: string): Promise<void> {
  try {
    await invoke('cmd_fs_mkdir', { path: dir })
  } catch {
    // 静默：目录已存在/无权限时忽略，交由后续 FS 命令报错
  }
}
