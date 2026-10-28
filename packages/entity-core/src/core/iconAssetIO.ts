/** 自定义图标资产的持久化与文件 IO（store 只保留状态与业务编排）。 */
import { invoke } from '@tauri-apps/api/core'
import { getProjectManager } from './ProjectManager'
import { resolveEntityDataDir } from './assetImport'
import { getFileStorageBackend } from './StorageBackend'
import { isSafeIconAssetId, type IconAsset } from './customIcons'

export const ICON_ASSETS_GLOBAL_KEY = 'worldsea_icon_assets_global'
export const ICON_ASSETS_PROJECT_KEY = 'icon_assets'
export const ICON_ASSETS_PROJECT_FALLBACK_PREFIX = 'worldsea_icon_assets_project:'
export const ICON_ASSETS_DIR_NAME = 'icons'

export type IconAssetScope = 'project' | 'global'

export interface IconAssetState {
  version: 1
  assets: IconAsset[]
  updatedAt?: number
}

export function defaultIconAssetState(): IconAssetState {
  return { version: 1, assets: [], updatedAt: 0 }
}

export function sanitizeIconAssets(raw: unknown): IconAsset[] {
  if (!Array.isArray(raw)) return []
  const out: IconAsset[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!isSafeIconAssetId(id) || seen.has(id)) continue
    const ext = typeof row.ext === 'string' && ['svg', 'png', 'webp'].includes(row.ext)
      ? row.ext as IconAsset['ext']
      : null
    if (!ext) continue
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 40) : '自定义图标'
    const bytes = typeof row.bytes === 'number' && row.bytes >= 0 ? Math.floor(row.bytes) : 0
    const createdAt = typeof row.createdAt === 'number' ? row.createdAt : 0
    seen.add(id)
    out.push({ id, name, ext, bytes, createdAt })
  }
  return out
}

export function pickNewerIconAssetState(
  fromDb: IconAssetState | null,
  fallback: IconAssetState | null,
): IconAssetState | null {
  if (!fromDb) return fallback
  if (!fallback) return fromDb
  return (fallback.updatedAt ?? 0) > (fromDb.updatedAt ?? 0) ? fallback : fromDb
}

export function readGlobalAssetState(): IconAssetState {
  try {
    const raw = localStorage.getItem(ICON_ASSETS_GLOBAL_KEY)
    if (!raw) return defaultIconAssetState()
    const parsed = JSON.parse(raw) as { assets?: unknown; updatedAt?: unknown }
    return {
      version: 1,
      assets: sanitizeIconAssets(parsed?.assets),
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return defaultIconAssetState()
  }
}

export function writeGlobalAssetState(state: IconAssetState): void {
  try {
    localStorage.setItem(ICON_ASSETS_GLOBAL_KEY, JSON.stringify(state))
  } catch {
    // 配额/隐私模式不可用：内存态继续
  }
}

export function currentProjectId(): string | null {
  try {
    return getProjectManager().getCurrentProjectId()
  } catch {
    return null
  }
}

export function readProjectAssetFallback(projectId: string | null): IconAssetState | null {
  if (!projectId) return null
  try {
    const raw = localStorage.getItem(`${ICON_ASSETS_PROJECT_FALLBACK_PREFIX}${projectId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { assets?: unknown; updatedAt?: unknown }
    return {
      version: 1,
      assets: sanitizeIconAssets(parsed?.assets),
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return null
  }
}

export function writeProjectAssetFallback(projectId: string | null, state: IconAssetState): void {
  if (!projectId) return
  try {
    localStorage.setItem(`${ICON_ASSETS_PROJECT_FALLBACK_PREFIX}${projectId}`, JSON.stringify(state))
  } catch {
    // 项目库为主存，回退失败不阻断
  }
}

export async function readProjectAssetState(): Promise<IconAssetState | null> {
  try {
    const db = getProjectManager().getCurrentProjectDb()
    const entry = await db.table('project_settings').get(ICON_ASSETS_PROJECT_KEY)
    if (!entry) return null
    const parsed = JSON.parse((entry as { value: string }).value) as { assets?: unknown; updatedAt?: unknown }
    return {
      version: 1,
      assets: sanitizeIconAssets(parsed?.assets),
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return null
  }
}

export function writeProjectAssetState(state: IconAssetState): void {
  try {
    const db = getProjectManager().getCurrentProjectDb()
    void db.table('project_settings')
      .put({ key: ICON_ASSETS_PROJECT_KEY, value: JSON.stringify(state) })
      .catch(() => {})
  } catch {
    // 项目库不可用：localStorage 分键回退兜底
  }
}

export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function projectIconsDirOf(root: string | null): string | null {
  return root ? `${toPosixPath(root)}/.worldsea/${ICON_ASSETS_DIR_NAME}` : null
}

export function assetFilePath(dir: string, asset: IconAsset): string {
  return `${toPosixPath(dir)}/${asset.id}.${asset.ext}`
}

/** 图标目录必须与实体文件同根：FileStorageBackend.projectDir 优先，退回项目目录解析。 */
export async function resolveProjectRoot(): Promise<string | null> {
  return getFileStorageBackend()?.projectDir ?? await resolveEntityDataDir()
}

export async function writeIconAssetFile(dir: string, asset: IconAsset, base64: string): Promise<void> {
  await invoke('cmd_fs_mkdir', { path: dir }).catch(() => {})
  await invoke('cmd_fs_write', {
    path: assetFilePath(dir, asset),
    content: base64,
    createDirs: true,
    encoding: 'base64',
  })
}

export async function readIconAssetFile(dir: string, asset: IconAsset): Promise<string | null> {
  try {
    return await invoke<string>('cmd_fs_read', { path: assetFilePath(dir, asset), encoding: 'base64' })
  } catch {
    return null
  }
}

export async function deleteIconAssetFile(dir: string, asset: IconAsset): Promise<void> {
  await invoke('cmd_fs_delete', { path: assetFilePath(dir, asset) }).catch(() => {})
}
