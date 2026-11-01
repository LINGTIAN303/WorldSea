/**
 * pickLocalFiles —— 「选本地文件」的统一封装（选择器 → File[] / ArrayBuffer[]）。
 *
 * 存量调用点原本都是 `<input type="file">` → 取 `File` → 业务逻辑。本模块把第一步换成
 * 自绘选择器，再转回 `File`（或按大文件通道转 ArrayBuffer），下游业务逻辑不动。
 *
 * 下沉到 entity-core 而非留在 apps：调用点分布在 entity-core / plugin-sdk / ui-kit / apps
 * 四层，只放在 apps 会让前两层无法引用。
 *
 * 两条读取通道：
 * - `pickLocalFiles`：base64 IPC，受 `FILE_LINK_MAX_BYTES`（30MB）约束，适合图片/图标/正文插图
 * - `pickLocalBuffers`：asset 协议 `fetch`，无 30MB 限制，适合字体包（200MB）/ 视频（1GB）
 */

import { getFilePickerApi, hasFilePicker } from './FilePickerApi'
import type { FilePickerFilter } from './FilePickerApi'
import { pathToFile, pathToArrayBuffer, baseNameOf, FILE_LINK_MAX_MB } from './pathToFile'

export interface PickLocalOptions {
  /** 扩展名过滤器（如 [{ name:'图片', extensions:['png','jpg'] }]） */
  filters?: FilePickerFilter[]
  /** 是否多选（默认 false） */
  multiple?: boolean
  /** 面板标题 */
  title?: string
  /** 单文件大小上限；超过则在列表里置灰不可选 */
  maxBytes?: number
  /** 初始目录 */
  defaultPath?: string | null
}

/** 选择结果（取消与「选了但读不进来」分开表达，避免取消被当成错误） */
export interface PickLocalResult<T> {
  items: T[]
  /** 用户取消（未选任何文件）时为 true */
  cancelled: boolean
  /** 选了但读不进来的原因（超限 / 读盘失败），可直接展示 */
  reasons: string[]
  /** 与 items 一一对应的磁盘路径 */
  paths: string[]
}

/** 拉起选择器并取回路径；选择器不可用抛错、取消返回 null */
async function pickPaths(options: PickLocalOptions): Promise<string[] | null> {
  if (!hasFilePicker()) {
    throw new Error('文件选择器不可用（请使用桌面端）')
  }
  return getFilePickerApi().pick({
    mode: 'file',
    multiple: !!options.multiple,
    filters: options.filters,
    title: options.title,
    maxBytes: options.maxBytes,
    defaultPath: options.defaultPath,
  })
}

/** 选文件 → File[]（base64 通道，单文件 ≤ 30MB） */
export async function pickLocalFiles(options: PickLocalOptions = {}): Promise<PickLocalResult<File>> {
  let paths: string[] | null
  try {
    paths = await pickPaths(options)
  } catch (err) {
    return { items: [], cancelled: false, reasons: [err instanceof Error ? err.message : String(err)], paths: [] }
  }
  if (!paths || paths.length === 0) return { items: [], cancelled: true, reasons: [], paths: [] }
  const items: File[] = []
  const reasons: string[] = []
  const kept: string[] = []
  for (const path of paths) {
    const file = await pathToFile(path)
    if (file) {
      items.push(file)
      kept.push(path)
    } else {
      reasons.push(`「${baseNameOf(path)}」读取失败或超过 ${FILE_LINK_MAX_MB}MB 通道上限`)
    }
  }
  return { items, cancelled: false, reasons, paths: kept }
}

/** 选文件 → ArrayBuffer[]（asset 协议通道，无 30MB 限制；字体/视频用） */
export async function pickLocalBuffers(options: PickLocalOptions = {}): Promise<PickLocalResult<ArrayBuffer>> {
  let paths: string[] | null
  try {
    paths = await pickPaths(options)
  } catch (err) {
    return { items: [], cancelled: false, reasons: [err instanceof Error ? err.message : String(err)], paths: [] }
  }
  if (!paths || paths.length === 0) return { items: [], cancelled: true, reasons: [], paths: [] }
  const items: ArrayBuffer[] = []
  const reasons: string[] = []
  const kept: string[] = []
  for (const path of paths) {
    const buffer = await pathToArrayBuffer(path)
    if (buffer) {
      items.push(buffer)
      kept.push(path)
    } else {
      reasons.push(`「${baseNameOf(path)}」读取失败`)
    }
  }
  return { items, cancelled: false, reasons, paths: kept }
}
