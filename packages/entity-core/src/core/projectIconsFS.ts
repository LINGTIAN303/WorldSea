/** 项目文件夹导出的图标分区：`.worldsea/icons` ↔ `icons/` + settings 元数据。 */
import type { IconAssetExportEntry } from './customIcons'
import { iconExtOf, isSafeIconAssetId } from './customIcons'
import { useIconAssetStore } from '../stores/iconAssetStore'
import { useIconOverrideStore } from '../stores/iconOverrideStore'

async function getInvoke() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke
  } catch {
    return null
  }
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

async function readText(path: string): Promise<string> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用，无法读取文件')
  return invoke('cmd_fs_read', { path, encoding: 'utf-8' }) as Promise<string>
}

async function readBase64(path: string): Promise<string> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用，无法读取文件')
  return invoke('cmd_fs_read', { path, encoding: 'base64' }) as Promise<string>
}

async function writeText(path: string, content: string): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用，无法写入文件')
  await invoke('cmd_fs_write', { path, content, createDirs: true })
}

async function writeBase64(path: string, content: string): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) throw new Error('Tauri 环境不可用，无法写入文件')
  await invoke('cmd_fs_write', { path, content, createDirs: true, encoding: 'base64' })
}

export type IconFileProgress = (done: number, total: number) => void

/** 导出当前项目的自定义图标与图标覆盖；失败由调用方决定是否阻断。 */
export async function exportProjectIcons(projectDir: string, onProgress?: IconFileProgress): Promise<void> {
  const root = toPosix(projectDir)
  const assets = await useIconAssetStore().collectExportAssets()
  let done = 0
  for (const entry of assets) {
    await writeBase64(`${root}/icons/${entry.id}.${entry.ext}`, entry.data)
    onProgress?.(++done, assets.length)
  }
  const meta = assets.map(entry => ({
    id: entry.id,
    name: entry.name,
    ext: entry.ext,
    bytes: entry.bytes,
    createdAt: entry.createdAt,
  }))
  await writeText(`${root}/settings/icon-assets.json`, JSON.stringify({ version: 1, assets: meta }, null, 2))
  await writeText(`${root}/settings/icon-overrides.json`, JSON.stringify(useIconOverrideStore().exportProjectState(), null, 2))
}

/** 导入图标文件、项目覆盖；缺失文件按可选分区跳过单个条目。 */
export async function importProjectIcons(sourceDir: string, onProgress?: IconFileProgress): Promise<void> {
  const root = toPosix(sourceDir)
  try {
    const meta = JSON.parse(await readText(`${root}/settings/icon-assets.json`)) as {
      assets?: Array<{ id?: unknown; ext?: unknown }>
    }
    const listed = Array.isArray(meta.assets) ? meta.assets : []
    const entries: Array<Partial<IconAssetExportEntry>> = []
    let done = 0
    for (const item of listed) {
      const id = typeof item.id === 'string' ? item.id : ''
      const ext = typeof item.ext === 'string' ? iconExtOf(`x.${item.ext}`) : null
      if (!isSafeIconAssetId(id) || !ext) continue
      try {
        entries.push({ ...item, id, ext, data: await readBase64(`${root}/icons/${id}.${ext}`) })
      } catch {
        // 单文件缺失不阻断其余图标
      }
      onProgress?.(++done, listed.length)
    }
    const store = useIconAssetStore()
    await store.loadProjectIconAssets()
    await store.importExportAssets(entries, 'overwrite')
  } catch {
    // 源目录无自定义图标：跳过
  }

  try {
    const state = JSON.parse(await readText(`${root}/settings/icon-overrides.json`)) as {
      followGlobal?: unknown
      overrides?: unknown
    }
    const store = useIconOverrideStore()
    await store.loadProjectIconOverrides()
    store.replaceProjectState(state)
  } catch {
    // 源目录无项目图标覆盖：跳过
  }
}
