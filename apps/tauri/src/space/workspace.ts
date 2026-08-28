/**
 * workspace.ts — 工作区目录解析工具（Phase 4：Agent 接入本地文件系统）
 *
 * 任务29/A1 统一根：会话默认 workdir = **当前项目目录**（Agent 工作区 = 项目数据存储，
 * 见 docs/plans/workspace-unification-plan.md）；未绑定项目时兜底固定目录
 * `~/.worldsmith/workspace`。显式传入 customPath 时原样返回（用户主动选择优先）。
 * 浏览器 preview 返回可读假路径。
 * 前端所有 invoke 走 transport（`@/agent/composables/transport`），不直接调 Tauri。
 */

import { homeDir, join } from '@tauri-apps/api/path'
import { invoke } from '@/agent/composables/transport'

/** 是否为 Tauri 运行时（浏览器 preview 无 __TAURI_INTERNALS__） */
function isTauriRuntime(): boolean {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

/** 兜底默认工作区路径（`~/.worldsmith/workspace`；A1 后仅作为未绑定项目时的回退根） */
export async function resolveDefaultWorkspaceDir(): Promise<string> {
  if (isTauriRuntime()) {
    const home = await homeDir()
    return await join(home, '.worldsmith', 'workspace')
  }
  // 浏览器 preview 兜底：返回一个可读的假路径（仅用于展示，不落盘）
  return '/worldsmith/workspace'
}

/**
 * 解析会话工作区根目录（异步：Tauri path API 与项目目录读取均为 Promise）
 *
 * 优先级：显式 `customPath`（WorkdirSelect 主动选择）→ 当前项目目录（A1 统一根，
 * 持久化于 ProjectManager 的 dirPath）→ 兜底默认工作区 `~/.worldsmith/workspace`。
 * 项目系统未初始化时静默走兜底，不阻塞会话创建主流程。
 */
export async function resolveWorkspaceDir(customPath?: string): Promise<string> {
  if (customPath) return customPath
  if (isTauriRuntime()) {
    try {
      const { getProjectManager } = await import('@worldsmith/entity-core/core')
      const projectDir = await getProjectManager().getCurrentProjectDir()
      if (projectDir) return projectDir
    } catch {
      // 项目系统未就绪（启动早期）：兜底默认工作区
    }
  }
  return resolveDefaultWorkspaceDir()
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
