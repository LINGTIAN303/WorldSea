/**
 * FileStorageBackend 的 Tauri 文件 IO 封装（从该文件迁出，控制单文件规模）。
 *
 * 只做「调 cmd_fs_* 并处理环境缺失」，不含业务语义；错误一律抛出让调用方决定降级策略。
 */

let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null

/** 懒加载 Tauri invoke（非 Tauri 环境返回 null） */
export async function getInvoke(): Promise<
  ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null
> {
  if (_invoke) return _invoke
  try {
    const api = await import('@tauri-apps/api/core')
    _invoke = api.invoke
    return _invoke
  } catch {
    return null
  }
}

export async function writeTextFile(path: string, content: string, createDirs = true): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用')
  await invoke('cmd_fs_write', { path, content, createDirs })
}

export async function readTextFile(path: string): Promise<string> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用')
  return invoke('cmd_fs_read', { path, encoding: 'utf-8' }) as Promise<string>
}

export async function listDir(
  path: string,
  recursive = false,
): Promise<Array<{ name: string; path: string; isDir: boolean; size: number }>> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用')
  return invoke('cmd_fs_list', { path, recursive }) as Promise<Array<{ name: string; path: string; isDir: boolean; size: number }>>
}

export async function deleteFile(path: string): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用')
  await invoke('cmd_fs_delete', { path })
}
