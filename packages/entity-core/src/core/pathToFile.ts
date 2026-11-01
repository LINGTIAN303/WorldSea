/**
 * pathToFile —— 磁盘绝对路径 → 浏览器 `File` 对象。
 *
 * 自绘选择器返回的是绝对路径；而存量 13 处 `<input type="file">` 的业务链路吃 `File`。
 * 本适配器让这些链路「选择步骤换掉、业务逻辑一行不改」，代价是一次 base64 IPC 读盘，
 * 因此受 `FILE_LINK_MAX_BYTES`（30MB）上限约束——超过的文件必须走路径直传链路
 * （资产已有 importAssetByPath / cmd_fs_copy_progress；字体需要 font-kit 侧新增入口）。
 *
 * 依赖方向：pathToFile → assetImport（取上限常量）→ FilePickerApi，无环。
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core'

/**
 * base64 IPC 链路的单文件上限（30MB）——`pathToFile` 专用。
 * 与 `assetImport.ts` 的 `FILE_LINK_MAX_BYTES` 同口径，此处独立声明而**不反向 import**：
 * 反向 import 会让 mock `assetImport` 的测试因缺导出而失败，且两模块无实质依赖。
 */
export const PATH_FILE_MAX_BYTES = 30 * 1024 * 1024

/** 常见扩展名 → MIME（覆盖项目内实际会选的类型；未知归 application/octet-stream） */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  apng: 'image/apng',
  json: 'application/json',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

/** 路径末段（同时认正反斜杠） */
export function baseNameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

/** 扩展名（小写、无点；无扩展名返回空串） */
function extOf(path: string): string {
  const name = baseNameOf(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 按扩展名推断 MIME */
export function mimeOf(path: string): string {
  return MIME_BY_EXT[extOf(path)] ?? 'application/octet-stream'
}

/** base64 通道上限的 MB 数值（提示文案共用） */
export const FILE_LINK_MAX_MB = PATH_FILE_MAX_BYTES / 1024 / 1024

/** base64 → 字节（分块解码避免大字符串一次性分配峰值） */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * 读盘并包装为 File。
 * @returns 成功返回 File；超过 PATH_FILE_MAX_BYTES / 读盘失败 / 非 Tauri 均返回 null（附告警）
 */
export async function pathToFile(path: string): Promise<File | null> {
  try {
    const stat = await invoke<{ size: number }>('cmd_fs_stat', { path })
    if (stat.size > PATH_FILE_MAX_BYTES) {
      console.warn(
        `[pathToFile] 「${path}」${(stat.size / 1024 / 1024).toFixed(1)}MB 超过 ${FILE_LINK_MAX_MB}MB base64 通道上限`,
      )
      return null
    }
    const base64 = await invoke<string>('cmd_fs_read', { path, encoding: 'base64' })
    const bytes = base64ToBytes(base64)
    return new File([bytes], baseNameOf(path), { type: mimeOf(path) })
  } catch (err) {
    console.warn(`[pathToFile] 读取「${path}」失败:`, err)
    return null
  }
}

/** 批量版（任一失败即整批失败；多选场景下失败项进 skipped 便于提示） */
export async function pathsToFiles(
  paths: string[],
): Promise<{ files: File[]; skipped: string[] }> {
  const files: File[] = []
  const skipped: string[] = []
  for (const path of paths) {
    const file = await pathToFile(path)
    if (file) files.push(file)
    else skipped.push(path)
  }
  return { files, skipped }
}

/**
 * 读盘为 ArrayBuffer —— 大文件通道（不受 30MB base64 IPC 上限约束）。
 *
 * 走 asset 协议（`convertFileSrc` → `fetch`）而非 `cmd_fs_read`：协议层直接流式读盘，
 * 不经 IPC 字符串编解码，因此适合字体包（200MB）、视频（1GB）这类体积。
 * 需要 `tauri.conf.json` 的 `assetProtocol.scope` 覆盖目标路径（当前为 `**`）。
 *
 * @returns 成功返回 ArrayBuffer；非 Tauri / 读盘失败返回 null（附告警）
 */
export async function pathToArrayBuffer(path: string): Promise<ArrayBuffer | null> {
  try {
    const url = convertFileSrc(path)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.arrayBuffer()
  } catch (err) {
    console.warn(`[pathToArrayBuffer] 读取「${path}」失败:`, err)
    return null
  }
}

/** 批量读盘为 ArrayBuffer（失败项进 skipped） */
export async function pathsToArrayBuffers(
  paths: string[],
): Promise<{ buffers: Array<{ path: string; buffer: ArrayBuffer }>; skipped: string[] }> {
  const buffers: Array<{ path: string; buffer: ArrayBuffer }> = []
  const skipped: string[] = []
  for (const path of paths) {
    const buffer = await pathToArrayBuffer(path)
    if (buffer) buffers.push({ path, buffer })
    else skipped.push(path)
  }
  return { buffers, skipped }
}
