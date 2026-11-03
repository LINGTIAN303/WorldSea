// ProjectFS 的共享类型、Tauri 文件系统封装与工具函数：导出/导入两条链共用。
// 下沉到此是为了让两条链各自独立成文件，同时避免二者互相依赖或重复实现。
// 目录规范见 docs/details/注释/packages/entity-core/core/ProjectFS.md
import { getFilePickerApi } from './FilePickerApi'
import { getFileStorageBackend } from './StorageBackend'

/* ════════════════════════════════════════
   类型定义
   ════════════════════════════════════════ */

/** project.json 的结构 */
export interface ProjectManifest {
  /** 格式版本号，当前为 1 */
  formatVersion: 1
  /** 项目 ID（UUID） */
  id: string
  /** 项目名称 */
  name: string
  /** 项目描述 */
  description: string
  /** 项目创建时间 */
  createdAt: string
  /** 导出时间 */
  exportedAt: string
  /** 应用版本 */
  appVersion?: string
}

/** .worldsea/cache.json 的结构 */
export interface ProjectCache {
  formatVersion: 1
  entityCount: number
  relationCount: number
  checksums: Record<string, string>
}

/** 导出进度回调 */
export type ExportProgressCallback = (
  phase: 'entities' | 'relations' | 'settings' | 'assets',
  current: number,
  total: number,
) => void

/** 导入进度回调 */
export type ImportProgressCallback = (
  phase: 'manifest' | 'entities' | 'relations' | 'settings' | 'assets',
  current: number,
  total: number,
) => void

/* ════════════════════════════════════════
   Tauri 文件系统操作封装
   ════════════════════════════════════════ */

export async function getInvoke() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke
  } catch {
    return null
  }
}

/** 读取文本文件 */
export async function readTextFile(path: string): Promise<string> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用，无法读取文件')
  return invoke('cmd_fs_read', { path, encoding: 'utf-8' }) as Promise<string>
}

/** 列出目录内容 */
export async function listDir(path: string, recursive = false): Promise<Array<{
  name: string
  path: string
  isDir: boolean
  size: number
}>> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用')
  return invoke('cmd_fs_list', { path, recursive }) as Promise<any[]>
}

/** 打开目录选择（自绘选择器；未注册或取消均返回 null） */
export async function openDirDialog(title: string): Promise<string | null> {
  const paths = await getFilePickerApi().pick({ mode: 'directory', title }).catch(() => null)
  return paths?.[0] ?? null
}

/** 写入文本文件（createDirs：目标目录不存在则创建） */
export async function writeTextFile(path: string, content: string): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用，无法写入文件')
  await invoke('cmd_fs_write', { path, content, createDirs: true })
}

/* ════════════════════════════════════════
   辅助函数
   ════════════════════════════════════════ */

/** 归一为正斜杠（导出/导入路径拼接口径） */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** 当前项目实体根下的首页 profile 路径（`.worldsea/home.json`，设计 §5.3） */
export function currentHomeProfilePath(): string | null {
  const projectDir = getFileStorageBackend()?.projectDir
  return projectDir ? `${toPosixPath(projectDir)}/.worldsea/home.json` : null
}

/** 将实体名称转为安全的文件名 */
export function toSafeFileName(name: string, id: string): string {
  // 取名称的前30个字符，替换不安全字符
  const safe = name
    .slice(0, 30)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  // 追加 ID 前8位确保唯一性
  const shortId = id.slice(0, 8)
  return safe ? `${safe}_${shortId}.json` : `${shortId}.json`
}

/** 简单 CRC32 校验（用于 cache.json） */
export function simpleChecksum(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
