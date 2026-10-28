import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const files = new Map<string, string>()
const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
  const path = String(args?.path ?? '').replace(/\\/g, '/')
  if (cmd === 'cmd_fs_mkdir') return undefined
  if (cmd === 'cmd_fs_write') {
    files.set(path, String(args.content))
    return undefined
  }
  if (cmd === 'cmd_fs_read') {
    const content = files.get(path)
    if (content === undefined) throw new Error(`ENOENT ${path}`)
    return content
  }
  if (cmd === 'cmd_fs_delete') {
    files.delete(path)
    return undefined
  }
  return undefined
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, Record<string, unknown>])),
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}))
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: async () => 'C:/Users/tester',
  join: async (...parts: string[]) => parts.join('/'),
}))
vi.mock('../../core/ProjectManager', () => ({
  getProjectManager: () => ({
    getCurrentProjectId: () => 'p1',
    getCurrentProjectDb: () => ({
      table: () => ({
        get: async () => null,
        put: async () => undefined,
      }),
    }),
    listProjects: async () => [{ id: 'p1', name: '项目一' }],
    getProjectDb: () => ({
      table: () => ({ get: async () => null }),
    }),
  }),
}))
vi.mock('../../core/assetImport', () => ({
  resolveEntityDataDir: async () => 'C:/WorldSea/worlddata',
}))
vi.mock('../../core/StorageBackend', () => ({
  getFileStorageBackend: () => ({ projectDir: 'C:/WorldSea/worlddata' }),
}))

import { customIconValue, useIconAssetStore } from '../iconAssetStore'
import { useIconOverrideStore } from '../iconOverrideStore'

const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>')
const SVG_B64 = btoa(String.fromCharCode(...SVG))

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  files.clear()
  invokeMock.mockClear()
})

async function readyStore() {
  const store = useIconAssetStore()
  await store.loadGlobalIconAssets()
  await store.loadProjectIconAssets()
  return store
}

describe('iconAssetStore', () => {
  it('项目上传落 .worldsea/icons，并写入回退登记与运行时 URL', async () => {
    const store = await readyStore()
    const result = await store.addProjectAsset({ fileName: '徽章.svg', bytes: SVG })
    expect(result.ok).toBe(true)
    const asset = result.asset!
    expect(files.get(`C:/WorldSea/worlddata/.worldsea/icons/${asset.id}.svg`)).toBe(SVG_B64)
    expect(store.projectAssets).toHaveLength(1)
    expect(store.resolveRuntimeUrl(asset.id)).toContain('asset://localhost/')
    const fallback = JSON.parse(localStorage.getItem('worldsea_icon_assets_project:p1') ?? '{}')
    expect(fallback.assets[0].id).toBe(asset.id)
  })

  it('提升全局生成新 id，并写入 WorldSea/icons', async () => {
    const store = await readyStore()
    const projectAsset = (await store.addProjectAsset({ fileName: '徽章.svg', bytes: SVG })).asset!
    const globalAsset = await store.promoteToGlobal(projectAsset.id)
    expect(globalAsset).toBeTruthy()
    expect(globalAsset!.id).not.toBe(projectAsset.id)
    expect(files.get(`C:/Users/tester/WorldSea/icons/${globalAsset!.id}.svg`)).toBe(SVG_B64)
    expect(store.globalAssets.map(asset => asset.id)).toContain(globalAsset!.id)
  })

  it('引用统计覆盖当前项目；删除后文件与登记一起消失', async () => {
    const store = await readyStore()
    const asset = (await store.addProjectAsset({ fileName: '徽章.svg', bytes: SVG })).asset!
    const overrideStore = useIconOverrideStore()
    overrideStore.setProjectIcon('sprout:official.characters', customIconValue(asset.id))
    const usage = await store.usageOf(asset.id)
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ projectId: 'p1', current: true, slots: ['sprout:official.characters'] })
    expect(store.currentUsageCount(asset.id)).toBe(1)

    overrideStore.clearProjectIcon('sprout:official.characters')
    await store.deleteProjectAsset(asset.id)
    expect(store.projectAssets).toHaveLength(0)
    expect(files.has(`C:/WorldSea/worlddata/.worldsea/icons/${asset.id}.svg`)).toBe(false)
  })

  it('导入资产写文件并恢复登记（保留原 id，覆盖值可继续引用）', async () => {
    const store = await readyStore()
    const result = await store.importExportAssets([{
      id: 'imported-1', name: '导入徽章', ext: 'svg', bytes: SVG.length, createdAt: 1, data: SVG_B64,
    }], 'merge')
    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(store.projectAssets.map(asset => asset.id)).toContain('imported-1')
    expect(files.has('C:/WorldSea/worlddata/.worldsea/icons/imported-1.svg')).toBe(true)
  })
})
