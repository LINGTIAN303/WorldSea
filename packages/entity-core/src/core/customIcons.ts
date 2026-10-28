/** 自定义图标：格式校验、`custom:` 引用与 base64 工具（无 Pinia / 无 IO 依赖）。 */

export const CUSTOM_ICON_PREFIX = 'custom:'
export const ICON_ASSET_EXTS = ['svg', 'png', 'webp'] as const
export type IconAssetExt = (typeof ICON_ASSET_EXTS)[number]

/** 单图标上限：SVG 体积小，位图允许更大；均为图标用途，不做大图。 */
export const ICON_ASSET_LIMITS: Record<IconAssetExt, number> = {
  svg: 256 * 1024,
  png: 512 * 1024,
  webp: 512 * 1024,
}

export interface IconAsset {
  id: string
  name: string
  ext: IconAssetExt
  bytes: number
  createdAt: number
}

export interface IconAssetExportEntry extends IconAsset {
  /** 文件内容（base64，无 data: 前缀）。 */
  data: string
}

export type IconAssetValidation =
  | { ok: true; ext: IconAssetExt; name: string; bytes: number }
  | { ok: false; reason: string }

export function customIconValue(id: string): string {
  return `${CUSTOM_ICON_PREFIX}${id}`
}

export function isCustomIconValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith(CUSTOM_ICON_PREFIX) && value.length > CUSTOM_ICON_PREFIX.length
}

export function customIconId(value: string): string | null {
  return isCustomIconValue(value) ? value.slice(CUSTOM_ICON_PREFIX.length) : null
}

export function iconExtOf(name: string): IconAssetExt | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return (ICON_ASSET_EXTS as readonly string[]).includes(ext) ? ext as IconAssetExt : null
}

/** 文件名由 id 生成；只允许字母数字/下划线/连字符，防导入包路径穿越。 */
export function isSafeIconAssetId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)
}

/** 展示名：去扩展名、压空白、截断；不用于文件名。 */
export function iconDisplayName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim()
  return (base || '自定义图标').slice(0, 40)
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((value, index) => bytes[offset + index] === value)
}

function isSvgBytes(bytes: Uint8Array): boolean {
  let text = ''
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return false
  }
  const head = text.replace(/^\uFEFF/, '').trimStart().slice(0, 1024).toLowerCase()
  if (!head.includes('<svg')) return false
  return !head.includes('<!doctype') && !head.includes('<script')
}

export function validateIconAsset(fileName: string, bytes: Uint8Array): IconAssetValidation {
  const ext = iconExtOf(fileName)
  if (!ext) return { ok: false, reason: '只支持 SVG / PNG / WebP 图标' }
  const limit = ICON_ASSET_LIMITS[ext]
  if (bytes.byteLength === 0) return { ok: false, reason: '文件为空' }
  if (bytes.byteLength > limit) {
    return { ok: false, reason: `图标超过 ${Math.round(limit / 1024)}KB 上限` }
  }
  if (ext === 'svg' && !isSvgBytes(bytes)) {
    return { ok: false, reason: 'SVG 内容无效或包含脚本/DOCTYPE' }
  }
  if (ext === 'png' && !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: false, reason: 'PNG 文件头无效' }
  }
  if (ext === 'webp' && !(startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))) {
    return { ok: false, reason: 'WebP 文件头无效' }
  }
  return { ok: true, ext, name: iconDisplayName(fileName), bytes: bytes.byteLength }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function formatIconBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  return `${Math.round(bytes / 1024)}KB`
}
