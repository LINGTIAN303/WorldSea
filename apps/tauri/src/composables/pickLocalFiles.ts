/**
 * apps 侧薄适配：`pickLocalFiles` 的实现在 entity-core（packages 三层都要用），
 * 这里只把返回字段名适配回 apps 存量调用点惯用的 `files`。
 *
 * 新增调用点请直接用 `@worldsea/entity-core/core` 的版本；本文件仅为兼容批 2 的 8 处调用点。
 */

import { pickLocalFiles as corePick } from '@worldsea/entity-core/core'
import type { FilePickerFilter } from '@worldsea/entity-core/core'

export interface PickLocalFilesOptions {
  filters?: FilePickerFilter[]
  multiple?: boolean
  title?: string
  maxBytes?: number
  defaultPath?: string | null
}

export interface PickLocalFilesResult {
  files: File[]
  cancelled: boolean
  reasons: string[]
}

/** 选择并转换（base64 通道，单文件 ≤ 30MB） */
export async function pickLocalFiles(options: PickLocalFilesOptions = {}): Promise<PickLocalFilesResult> {
  const r = await corePick(options)
  return { files: r.items, cancelled: r.cancelled, reasons: r.reasons }
}
