/**
 * 本文件于 Phase 3 从 src/memory-archive/adapters/TauriFsOperations.ts 迁移到 apps/tauri/src/memory-archive/adapters/TauriFsOperations.ts
 * 端分离：Tauri 端专用（依赖 @tauri-apps/api）
 */

/** TauriFsOperations：FsOperations 接口的 Tauri 实现（cmd_fs_* 命令映射），详细见 docs/details/注释/tauri/TauriFsOperations.md */

import type { FsOperations } from '@worldsmith/memory-archive/adapters'

/** 懒加载 Tauri invoke 函数（避免 Web 环境导入失败） */
async function getInvoke(): Promise<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>> {
  const mod = await import('@tauri-apps/api/core')
  return mod.invoke
}

/** FsStat 返回结构（对应 Rust 端 FsStat） */
interface FsStat {
  exists: boolean
  is_dir: boolean
  is_file: boolean
  size: number
  modified: string | null
  created: string | null
  readonly: boolean
}

/** FsEntry 返回结构（对应 Rust 端 FsEntry） */
interface FsEntry {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified: string | null
}

/**
 * 创建 Tauri 环境的 FsOperations 实例
 */
export function createTauriFsOperations(): FsOperations {
  return {
    async readFile(path: string): Promise<string> {
      const invoke = await getInvoke()
      return invoke('cmd_fs_read', { path, encoding: 'utf-8' }) as Promise<string>
    },

    async writeFile(path: string, content: string): Promise<void> {
      const invoke = await getInvoke()
      await invoke('cmd_fs_write', { path, content, createDirs: true })
    },

    async mkdir(path: string, recursive = true): Promise<void> {
      const invoke = await getInvoke()
      await invoke('cmd_fs_mkdir', { path, recursive })
    },

    async remove(path: string): Promise<void> {
      const invoke = await getInvoke()
      await invoke('cmd_fs_delete', { path, recursive: true })
    },

    async exists(path: string): Promise<boolean> {
      const invoke = await getInvoke()
      const stat = await invoke('cmd_fs_stat', { path }) as FsStat
      return stat.exists
    },

    async readDir(path: string): Promise<string[]> {
      const invoke = await getInvoke()
      const entries = await invoke('cmd_fs_list', { path, recursive: false }) as FsEntry[]
      return entries.map(e => e.name)
    },
  }
}
