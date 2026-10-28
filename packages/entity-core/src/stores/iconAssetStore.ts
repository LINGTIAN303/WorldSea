import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { convertFileSrc } from '@tauri-apps/api/core'
import { homeDir, join } from '@tauri-apps/api/path'
import { getProjectManager } from '../core/ProjectManager'
import {
  ICON_ASSETS_DIR_NAME,
  currentProjectId,
  defaultIconAssetState,
  deleteIconAssetFile,
  pickNewerIconAssetState,
  projectIconsDirOf,
  readGlobalAssetState,
  readIconAssetFile,
  readProjectAssetFallback,
  readProjectAssetState,
  resolveProjectRoot,
  writeGlobalAssetState,
  writeIconAssetFile,
  writeProjectAssetFallback,
  writeProjectAssetState,
  type IconAssetScope,
  type IconAssetState,
} from '../core/iconAssetIO'
import {
  base64ToBytes,
  bytesToBase64,
  customIconId,
  customIconValue,
  iconExtOf,
  isSafeIconAssetId,
  validateIconAsset,
  type IconAsset,
  type IconAssetExportEntry,
} from '../core/customIcons'
import { sanitizeOverrides, useIconOverrideStore } from './iconOverrideStore'

export {
  ICON_ASSETS_GLOBAL_KEY,
  ICON_ASSETS_PROJECT_KEY,
  ICON_ASSETS_PROJECT_FALLBACK_PREFIX,
  ICON_ASSETS_DIR_NAME,
  sanitizeIconAssets,
  pickNewerIconAssetState,
} from '../core/iconAssetIO'
export type { IconAssetScope, IconAssetState } from '../core/iconAssetIO'

export interface ScopedIconAsset {
  asset: IconAsset
  scope: IconAssetScope
}

export interface IconAssetWriteResult {
  ok: boolean
  asset?: IconAsset
  reason?: string
}

export interface IconAssetUsage {
  projectId: string
  projectName: string
  current: boolean
  slots: string[]
}

export const useIconAssetStore = defineStore('iconAssets', () => {
  const globalState = ref<IconAssetState>(readGlobalAssetState())
  const projectState = ref<IconAssetState>(defaultIconAssetState())
  const projectDir = ref<string | null>(null)
  const globalDir = ref<string | null>(null)

  const projectAssets = computed(() => projectState.value.assets)
  const globalAssets = computed(() => globalState.value.assets)
  const allAssets = computed<ScopedIconAsset[]>(() => [
    ...projectAssets.value.map(asset => ({ asset, scope: 'project' as const })),
    ...globalAssets.value.map(asset => ({ asset, scope: 'global' as const })),
  ])

  function projectIconsDir(): string | null {
    return projectIconsDirOf(projectDir.value)
  }

  function assetById(id: string): ScopedIconAsset | null {
    const project = projectAssets.value.find(asset => asset.id === id)
    if (project) return { asset: project, scope: 'project' }
    const global = globalAssets.value.find(asset => asset.id === id)
    return global ? { asset: global, scope: 'global' } : null
  }

  /** WsIcon 的自定义解析器只认运行时 URL；目录未就绪或非 Tauri 返回 null。 */
  function resolveRuntimeUrl(id: string): string | null {
    const found = assetById(id)
    if (!found) return null
    const dir = found.scope === 'project' ? projectIconsDir() : globalDir.value
    if (!dir) return null
    try {
      return convertFileSrc(`${dir}/${found.asset.id}.${found.asset.ext}`)
    } catch {
      return null
    }
  }

  async function ensureGlobalDir(): Promise<string | null> {
    if (globalDir.value) return globalDir.value
    try {
      globalDir.value = await join(await homeDir(), 'WorldSea', ICON_ASSETS_DIR_NAME)
      return globalDir.value
    } catch {
      return null
    }
  }

  async function loadGlobalIconAssets(): Promise<void> {
    globalState.value = readGlobalAssetState()
    await ensureGlobalDir()
  }

  async function loadProjectIconAssets(): Promise<void> {
    projectDir.value = await resolveProjectRoot()
    const fallback = readProjectAssetFallback(currentProjectId())
    const fromDb = await readProjectAssetState()
    projectState.value = pickNewerIconAssetState(fromDb, fallback) ?? defaultIconAssetState()
  }

  function persistProject(): void {
    const stamped = { ...projectState.value, updatedAt: Date.now() }
    projectState.value = stamped
    writeProjectAssetState(stamped)
    writeProjectAssetFallback(currentProjectId(), stamped)
  }

  function persistGlobal(): void {
    const stamped = { ...globalState.value, updatedAt: Date.now() }
    globalState.value = stamped
    writeGlobalAssetState(stamped)
  }

  async function addProjectAsset(input: { fileName: string; bytes: Uint8Array }): Promise<IconAssetWriteResult> {
    const checked = validateIconAsset(input.fileName, input.bytes)
    if (!checked.ok) return { ok: false, reason: checked.reason }
    const dir = projectIconsDir()
    if (!dir) return { ok: false, reason: '项目目录未就绪，无法保存图标' }
    const asset: IconAsset = {
      id: crypto.randomUUID(),
      name: checked.name,
      ext: checked.ext,
      bytes: checked.bytes,
      createdAt: Date.now(),
    }
    try {
      await writeIconAssetFile(dir, asset, bytesToBase64(input.bytes))
    } catch (err) {
      return { ok: false, reason: `图标写入失败：${String(err)}` }
    }
    projectState.value = { ...projectState.value, assets: [...projectState.value.assets, asset] }
    persistProject()
    return { ok: true, asset }
  }

  /** 项目图标提升为全局：复制文件并生成新的全局 id，返回新资产。 */
  async function promoteToGlobal(id: string): Promise<IconAsset | null> {
    const existingGlobal = globalAssets.value.find(asset => asset.id === id)
    if (existingGlobal) return existingGlobal
    const projectAsset = projectAssets.value.find(asset => asset.id === id)
    const sourceDir = projectIconsDir()
    if (!projectAsset || !sourceDir) return null
    const data = await readIconAssetFile(sourceDir, projectAsset)
    if (!data) return null
    const dir = await ensureGlobalDir()
    if (!dir) return null
    const globalAsset: IconAsset = {
      ...projectAsset,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    try {
      await writeIconAssetFile(dir, globalAsset, data)
    } catch {
      return null
    }
    globalState.value = { ...globalState.value, assets: [...globalState.value.assets, globalAsset] }
    persistGlobal()
    return globalAsset
  }

  async function deleteProjectAsset(id: string): Promise<void> {
    const asset = projectAssets.value.find(item => item.id === id)
    if (!asset) return
    projectState.value = { ...projectState.value, assets: projectAssets.value.filter(item => item.id !== id) }
    persistProject()
    const dir = projectIconsDir()
    if (dir) await deleteIconAssetFile(dir, asset)
  }

  async function deleteGlobalAsset(id: string): Promise<void> {
    const asset = globalAssets.value.find(item => item.id === id)
    if (!asset) return
    globalState.value = { ...globalState.value, assets: globalAssets.value.filter(item => item.id !== id) }
    persistGlobal()
    const dir = globalDir.value ?? await ensureGlobalDir()
    if (dir) await deleteIconAssetFile(dir, asset)
  }

  function currentUsageCount(id: string): number {
    const target = customIconValue(id)
    const overrideStore = useIconOverrideStore()
    const keys = new Set(
      Object.entries(overrideStore.project.overrides)
        .filter(([, value]) => value === target)
        .map(([key]) => key),
    )
    if (overrideStore.project.followGlobal) {
      for (const [key, value] of Object.entries(overrideStore.global.overrides)) {
        if (value === target && !overrideStore.project.overrides[key]) keys.add(key)
      }
    }
    return keys.size
  }

  async function projectOverrideKeys(projectId: string, current: boolean, value: string): Promise<string[]> {
    if (current) {
      const overrides = useIconOverrideStore().project.overrides
      return Object.entries(overrides).filter(([, icon]) => icon === value).map(([key]) => key)
    }
    try {
      const db = getProjectManager().getProjectDb(projectId)
      const entry = await db.table('project_settings').get('icon_overrides')
      if (!entry) return []
      const parsed = JSON.parse((entry as { value: string }).value) as { overrides?: unknown }
      return Object.entries(sanitizeOverrides(parsed?.overrides))
        .filter(([, icon]) => icon === value)
        .map(([key]) => key)
    } catch {
      return []
    }
  }

  /** 删除守卫：扫全局覆盖 + 全部项目覆盖，列出引用。 */
  async function usageOf(id: string): Promise<IconAssetUsage[]> {
    const target = customIconValue(id)
    const overrideStore = useIconOverrideStore()
    const usage: IconAssetUsage[] = []
    const globalSlots = Object.entries(overrideStore.global.overrides)
      .filter(([, icon]) => icon === target)
      .map(([key]) => key)
    if (globalSlots.length) {
      usage.push({ projectId: '__global__', projectName: '全局', current: false, slots: globalSlots })
    }
    try {
      const pm = getProjectManager()
      const currentId = pm.getCurrentProjectId()
      for (const project of await pm.listProjects()) {
        const slots = await projectOverrideKeys(project.id, project.id === currentId, target)
        if (slots.length) {
          usage.push({
            projectId: project.id,
            projectName: project.name,
            current: project.id === currentId,
            slots,
          })
        }
      }
    } catch {
      const slots = Object.entries(overrideStore.project.overrides)
        .filter(([, icon]) => icon === target)
        .map(([key]) => key)
      if (slots.length) {
        usage.push({
          projectId: currentProjectId() ?? '',
          projectName: '当前项目',
          current: true,
          slots,
        })
      }
    }
    return usage
  }

  /** 导出集合：项目全部资产 + 被本项目覆盖引用的全局资产（物化为项目本地）。 */
  async function collectExportAssets(): Promise<IconAssetExportEntry[]> {
    const overrideStore = useIconOverrideStore()
    const referenced = new Set<string>()
    const collectIds = (values: string[]): void => {
      for (const value of values) {
        const id = customIconId(value)
        if (id) referenced.add(id)
      }
    }
    collectIds(Object.values(overrideStore.project.overrides))
    if (overrideStore.project.followGlobal) collectIds(Object.values(overrideStore.global.overrides))

    const targets: Array<{ asset: IconAsset; scope: IconAssetScope }> = [
      ...projectAssets.value.map(asset => ({ asset, scope: 'project' as const })),
      ...globalAssets.value.filter(asset => referenced.has(asset.id)).map(asset => ({ asset, scope: 'global' as const })),
    ]
    const out: IconAssetExportEntry[] = []
    for (const { asset, scope } of targets) {
      const dir = scope === 'project' ? projectIconsDir() : (globalDir.value ?? await ensureGlobalDir())
      if (!dir) continue
      const data = await readIconAssetFile(dir, asset)
      if (!data) continue
      out.push({ ...asset, data })
    }
    return out
  }

  /** 导入资产到当前项目；overwrite 覆盖现有项目图标，merge 按 id 合并。 */
  async function importExportAssets(
    entries: ReadonlyArray<Partial<IconAssetExportEntry>>,
    strategy: 'overwrite' | 'merge',
  ): Promise<{ imported: number; skipped: number }> {
    if (!projectDir.value) projectDir.value = await resolveProjectRoot()
    const dir = projectIconsDir()
    if (!dir) return { imported: 0, skipped: entries.length }

    if (strategy === 'overwrite') {
      for (const asset of projectAssets.value) await deleteIconAssetFile(dir, asset)
    }

    const next = strategy === 'overwrite' ? new Map<string, IconAsset>() : new Map(projectAssets.value.map(asset => [asset.id, asset]))
    let imported = 0
    let skipped = 0
    for (const raw of entries) {
      const id = typeof raw.id === 'string' ? raw.id.trim() : ''
      const ext = typeof raw.ext === 'string' ? iconExtOf(`x.${raw.ext}`) : null
      const data = typeof raw.data === 'string' ? raw.data : ''
      const bytes = data ? base64ToBytes(data) : null
      if (!isSafeIconAssetId(id) || !ext || !bytes) { skipped++; continue }
      const checked = validateIconAsset(`x.${ext}`, bytes)
      if (!checked.ok) { skipped++; continue }
      const asset: IconAsset = {
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : '自定义图标',
        ext,
        bytes: bytes.byteLength,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      }
      try {
        await writeIconAssetFile(dir, asset, data)
      } catch {
        skipped++
        continue
      }
      next.set(asset.id, asset)
      imported++
    }
    projectState.value = { ...projectState.value, assets: [...next.values()] }
    persistProject()
    return { imported, skipped }
  }

  return {
    projectAssets,
    globalAssets,
    allAssets,
    projectDir,
    globalDir,
    assetById,
    resolveRuntimeUrl,
    loadGlobalIconAssets,
    loadProjectIconAssets,
    addProjectAsset,
    promoteToGlobal,
    deleteProjectAsset,
    deleteGlobalAsset,
    currentUsageCount,
    usageOf,
    collectExportAssets,
    importExportAssets,
  }
})

export { customIconValue, customIconId }
