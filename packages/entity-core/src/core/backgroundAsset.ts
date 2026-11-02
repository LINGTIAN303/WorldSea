/** 工作台全局背景图：选择、长边归一化、写入 app data、删除/解析；不进入项目目录。 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { pickLocalFiles } from './pickLocalFiles'
import { isTauri } from './StorageBackend'
import { bytesToBase64 } from './customIcons'

export const BACKGROUND_MAX_BYTES = 20 * 1024 * 1024
export const BACKGROUND_MAX_EDGE = 2560
const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp'])

export interface BackgroundImportResult {
  ok: boolean
  path?: string
  src?: string
  reason?: string
}

export function fitLongEdge(width: number, height: number, max = BACKGROUND_MAX_EDGE): { width: number; height: number } {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

export function backgroundFileName(ext: string, now = Date.now()): string {
  const safe = (ext || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return `workspace-${now}.${ALLOWED_EXTS.has(safe) ? safe : 'webp'}`
}

async function encodeBackground(file: File): Promise<{ bytes: Uint8Array; ext: string } | null> {
  if (!file.type.startsWith('image/')) return null
  const bitmap = await createImageBitmap(file)
  try {
    const size = fitLongEdge(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)
    const toBlob = (type: string, quality: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
    let blob = await toBlob('image/webp', 0.9)
    let ext = 'webp'
    if (!blob) {
      blob = await toBlob('image/jpeg', 0.85)
      ext = 'jpg'
    }
    if (!blob) return null
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext }
  } finally {
    bitmap.close()
  }
}

export async function pickAndSaveWorkspaceBackground(): Promise<BackgroundImportResult | null> {
  if (!isTauri()) return { ok: false, reason: '当前环境不支持选择文件' }
  const picked = await pickLocalFiles({
    multiple: false,
    title: '选择工作台背景',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    maxBytes: BACKGROUND_MAX_BYTES,
  })
  if (picked.cancelled) return null
  const file = picked.items[0]
  if (!file) return { ok: false, reason: picked.reasons[0] ?? '没有可用的图片' }
  let encoded: { bytes: Uint8Array; ext: string } | null = null
  try {
    encoded = await encodeBackground(file)
  } catch {
    encoded = null
  }
  if (!encoded) return { ok: false, reason: '图片解码失败，请换一张 PNG/JPG/WebP' }
  try {
    const dir = await join(await appDataDir(), 'worldsea', 'backgrounds')
    await invoke('cmd_fs_mkdir', { path: dir })
    const path = await join(dir, backgroundFileName(encoded.ext))
    await invoke('cmd_fs_write', { path, content: bytesToBase64(encoded.bytes), createDirs: true, encoding: 'base64' })
    return { ok: true, path, src: convertFileSrc(path) }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export async function removeWorkspaceBackground(path: string): Promise<void> {
  if (!path) return
  try {
    await invoke('cmd_fs_delete', { path })
  } catch (err) {
    console.warn('[background] 删除背景文件失败:', err)
  }
}

const STAT_RETRY_DELAYS = [0, 250, 500] as const
const BACKGROUND_FILE_RE = /^(?:workspace|background)-[a-z0-9._-]+\.(?:png|jpe?g|webp)$/i

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function resolveWorkspaceBackgroundSrc(path: string): Promise<string | null> {
  if (!path) return null
  let lastError: unknown = null
  for (const delay of STAT_RETRY_DELAYS) {
    if (delay > 0) await sleep(delay)
    try {
      await invoke('cmd_fs_stat', { path })
      return convertFileSrc(path)
    } catch (err) {
      lastError = err
    }
  }
  console.warn('[background] 背景文件校验失败:', lastError)
  return null
}

function pathKey(path: string) {
  return path.replace(/\\/g, '/').toLowerCase()
}

export async function cleanupWorkspaceBackgroundOrphans(
  referencedPaths: string[] | (() => string[]),
): Promise<void> {
  if (!isTauri()) return
  try {
    const dir = await join(await appDataDir(), 'worldsea', 'backgrounds')
    const entries = await invoke('cmd_fs_list', { path: dir, recursive: false }) as Array<{
      name: string; path: string; isDir: boolean
    }>
    const keep = () => new Set(
      (typeof referencedPaths === 'function' ? referencedPaths() : referencedPaths)
        .filter(Boolean).map(pathKey),
    )
    for (const entry of entries) {
      if (entry.isDir || !BACKGROUND_FILE_RE.test(entry.name)) continue
      if (keep().has(pathKey(entry.path))) continue
      try {
        await invoke('cmd_fs_delete', { path: entry.path })
      } catch (err) {
        console.warn('[background] 清理孤儿背景失败:', entry.path, err)
      }
    }
  } catch {
    // 目录不存在或读取失败：无孤儿可清，静默跳过
  }
}
