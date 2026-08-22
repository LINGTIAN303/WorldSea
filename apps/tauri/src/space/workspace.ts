/**
 * workspace.ts — 工作区目录解析工具（Phase 4：Agent 接入本地文件系统）
 *
 * 会话绑定一个标准工作区根目录（对齐 OpenClaw `~/.openclaw/workspace` 惯例），
 * 默认目录**固定**为 `~/.worldsmith/workspace`（不跟随项目，由输入栏 WorkdirSelect 选择）；
 * 若传入显式非默认 path（Phase 5 选择器选中），则返回该 path。浏览器 preview 返回可读假路径。
 * 前端所有 invoke 走 transport（`@/agent/composables/transport`），不直接调 Tauri。
 */

import { homeDir, join } from '@tauri-apps/api/path'
import { invoke } from '@/agent/composables/transport'

/** 是否为 Tauri 运行时（浏览器 preview 无 __TAURI_INTERNALS__） */
function isTauriRuntime(): boolean {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

/**
 * 解析会话工作区根目录（异步：Tauri path API 的 homeDir/join 均为 Promise）
 *
 * - `customPath`：显式传入的非默认路径（Phase 5 WorkdirSelect 选中）→ 原样返回
 * - 其余情况：
 *   - Tauri 环境：固定默认目录 `~/.worldsmith/workspace`（不跟随项目）
 *   - 浏览器 preview：返回可读的假路径（仅用于展示，不落盘）
 */
export async function resolveWorkspaceDir(customPath?: string): Promise<string> {
  if (customPath) return customPath
  if (isTauriRuntime()) {
    const home = await homeDir()
    return await join(home, '.worldsmith', 'workspace')
  }
  // 浏览器 preview 兜底：返回一个可读的假路径（仅用于展示，不落盘）
  return '/worldsmith/workspace'
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
