/** 背景图资产：选择、长边归一化、全局/项目落盘、删除/解析、孤儿清理；v1 工作台包装保留。 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { pickLocalFiles } from './pickLocalFiles'
import { isTauri } from './StorageBackend'
import { bytesToBase64 } from './customIcons'

export const BACKGROUND_MAX_BYTES = 20 * 1024 * 1024
export const BACKGROUND_MAX_EDGE = 2560
const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp'])

/** 与 style-kit 的 BackgroundTarget / BackgroundTheme 结构兼容，不引入包依赖 */
export type BackgroundTargetKey = 'canvas' | 'home' | 'titlebar' | 'sidebar' | 'content'
export type BackgroundThemeKey = 'light' | 'dark'

export interface BackgroundSaveRequest {
  scope: 'global' | 'project'
  projectDir?: string
  target: BackgroundTargetKey
  theme: BackgroundThemeKey
}

export interface BackgroundImportResult {
  ok: boolean
  path?: string
  /** 项目范围返回相对 POSIX 路径（写进项目配置）；全局范围无此字段 */
  relativePath?: string
  src?: string
  reason?: string
}

export function fitLongEdge(width: number, height: number, max = BACKGROUND_MAX_EDGE): { width: number; height: number } {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

export function backgroundFileName(target: string, theme: string, ext: string, now = Date.now()): string {
  const safe = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')
  const normalized = String(ext ?? '').toLowerCase()
  return `background-${safe(target)}-${safe(theme)}-${now}.${ALLOWED_EXTS.has(normalized) ? normalized : 'webp'}`
}

/** 项目范围背景图写进项目配置的相对 POSIX 路径 */
export function backgroundRelativePath(fileName: string): string {
  return `.worldsea/backgrounds/${fileName}`
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

export async function pickAndSaveBackground(req: BackgroundSaveRequest): Promise<BackgroundImportResult | null> {
  if (!isTauri()) return { ok: false, reason: '当前环境不支持选择文件' }
  if (req.scope === 'project' && !req.projectDir) return { ok: false, reason: '未打开项目' }
  const picked = await pickLocalFiles({
    multiple: false,
    title: '选择背景图',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    maxBytes: BACKGROUND_MAX_BYTES,
  })
  if (picked.cancelled) return null
  const file = picked.items[0]
  if (!file) return { ok: false, reason: picked.reasons[0] ?? '没有可用的图片' }
  const encoded = await encodeBackground(file).catch(() => null)
  if (!encoded) return { ok: false, reason: '图片解码失败，请换一张 PNG/JPG/WebP' }
  try {
    const dir = req.scope === 'project'
      ? await join(req.projectDir!, '.worldsea', 'backgrounds')
      : await join(await appDataDir(), 'worldsea', 'backgrounds')
    await invoke('cmd_fs_mkdir', { path: dir })
    const name = backgroundFileName(req.target, req.theme, encoded.ext)
    const path = await join(dir, name)
    await invoke('cmd_fs_write', { path, content: bytesToBase64(encoded.bytes), createDirs: true, encoding: 'base64' })
    return {
      ok: true,
      path,
      relativePath: req.scope === 'project' ? backgroundRelativePath(name) : undefined,
      src: convertFileSrc(path),
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export async function removeBackgroundFile(path: string): Promise<void> {
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

export async function resolveBackgroundSrc(path: string): Promise<string | null> {
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

const PROJECT_BG_PREFIX = '.worldsea/backgrounds/'

/** 引用值可能是项目配置里的相对路径，按 dir 还原为绝对路径后再比对，避免误删在用文件 */
function referencedPathKey(path: string, dir: string): string {
  const posix = path.replace(/\\/g, '/')
  if (/^(?:[a-z]:\/|\/)/i.test(posix)) return pathKey(posix)
  const relative = posix.toLowerCase().startsWith(PROJECT_BG_PREFIX)
    ? posix.slice(PROJECT_BG_PREFIX.length)
    : posix.replace(/^\.\//, '')
  return pathKey(`${dir.replace(/\\/g, '/').replace(/\/+$/, '')}/${relative}`)
}

export async function cleanupBackgroundOrphans(
  dir: string,
  referenced: string[] | (() => string[]),
): Promise<void> {
  if (!dir || !isTauri()) return
  try {
    const entries = await invoke('cmd_fs_list', { path: dir, recursive: false }) as Array<{
      name: string; path: string; isDir: boolean
    }>
    const keep = new Set(
      (typeof referenced === 'function' ? referenced() : referenced)
        .filter(Boolean).map((path) => referencedPathKey(path, dir)),
    )
    for (const entry of entries) {
      if (entry.isDir || !BACKGROUND_FILE_RE.test(entry.name)) continue
      if (keep.has(pathKey(entry.path))) continue
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

export async function cleanupGlobalBackgroundOrphans(
  referenced: string[] | (() => string[]),
): Promise<void> {
  try {
    await cleanupBackgroundOrphans(await join(await appDataDir(), 'worldsea', 'backgrounds'), referenced)
  } catch {
    // 全局目录不可用：无孤儿可清，静默跳过
  }
}

// v1 工作台包装：旧设置卡与启动引导按「全局 · 画布 · 亮色」消费
export async function pickAndSaveWorkspaceBackground(): Promise<BackgroundImportResult | null> {
  return pickAndSaveBackground({ scope: 'global', target: 'canvas', theme: 'light' })
}
export const removeWorkspaceBackground = removeBackgroundFile
export const resolveWorkspaceBackgroundSrc = resolveBackgroundSrc
export async function cleanupWorkspaceBackgroundOrphans(
  referenced: string[] | (() => string[]),
): Promise<void> {
  await cleanupGlobalBackgroundOrphans(referenced)
}
