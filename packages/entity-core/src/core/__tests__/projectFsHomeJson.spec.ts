/**
 * ProjectFS 首页 profile 往返（2026-10-23 终审 Important #3）：
 * 导出/导入白名单必须包含 `.worldsea/home.json`，否则换机器/换项目后首页简介与封面丢失。
 * 以内存文件系统替换 Tauri invoke，覆盖「有 home.json 往返」与「无 home.json 不报错」两条路径。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
const backend = { dir: null as string | null }
const switcher = { ok: true }
const iconAssets = { entries: [] as any[], imported: [] as any[] }
const iconOverrides = { version: 1, followGlobal: true, overrides: {} as Record<string, string>, updatedAt: 0 }

const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
  const path = String(args?.path ?? '').replace(/\\/g, '/')
  if (cmd === 'cmd_fs_read') {
    const content = files.get(path)
    if (content === undefined) throw new Error(`ENOENT ${path}`)
    return content
  }
  if (cmd === 'cmd_fs_write') {
    files.set(path, String(args.content))
    return undefined
  }
  if (cmd === 'cmd_fs_list') return list(path)
  throw new Error(`未预期的命令 ${cmd}`)
})

/** 目录列表（由内存键推导：浅层文件 + 一级子目录） */
function list(path: string): Array<{ name: string; path: string; isDir: boolean; size: number }> {
  const prefix = `${path}/`
  const out: Array<{ name: string; path: string; isDir: boolean; size: number }> = []
  const dirs = new Set<string>()
  for (const key of files.keys()) {
    if (!key.startsWith(prefix)) continue
    const rest = key.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) out.push({ name: rest, path: key, isDir: false, size: 1 })
    else if (!dirs.has(rest.slice(0, slash))) {
      const name = rest.slice(0, slash)
      dirs.add(name)
      out.push({ name, path: `${path}/${name}`, isDir: true, size: 0 })
    }
  }
  return out
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, Record<string, unknown>])),
}))
vi.mock('../ProjectManager', () => ({
  getProjectManager: () => ({
    getCurrentProjectId: () => 'p1',
    getCurrentProject: async () => ({ id: 'p1', name: '纯真', description: '' }),
    createProject: async () => ({ id: 'p2', name: '纯真', description: '' }),
  }),
}))
vi.mock('../../stores', () => ({
  useEntityStore: () => ({ getAllEntities: async () => [], importBatch: vi.fn() }),
  useRelationStore: () => ({ getAllRelations: async () => [], importBatch: vi.fn() }),
  useSettingsStore: () => ({ sprouts: [], toggleSprout: vi.fn() }),
}))
vi.mock('../../stores/iconAssetStore', () => ({
  useIconAssetStore: () => ({
    collectExportAssets: async () => iconAssets.entries,
    importExportAssets: async (entries: any[]) => { iconAssets.imported = entries; return { imported: entries.length, skipped: 0 } },
    loadProjectIconAssets: async () => {},
  }),
}))
vi.mock('../../stores/iconOverrideStore', () => ({
  useIconOverrideStore: () => ({
    exportProjectState: () => iconOverrides,
    loadProjectIconOverrides: async () => {},
    replaceProjectState: (next: typeof iconOverrides) => { Object.assign(iconOverrides, next) },
  }),
}))
vi.mock('../ProjectSwitcherApi', () => ({
  getProjectSwitcherApi: () => ({
    switchProject: async () => {
      if (switcher.ok) backend.dir = 'D:/new/worlddata'
      return switcher.ok
    },
  }),
}))
vi.mock('../StorageBackend', () => ({
  getFileStorageBackend: () => (backend.dir ? { projectDir: backend.dir } : null),
}))

import { exportProjectToDir, importProjectFromDir } from '../ProjectFS'

const HOME_JSON = JSON.stringify({ version: 1, tagline: '一句话', about: '', coverImage: '', updatedAt: null })

beforeEach(() => {
  files.clear()
  backend.dir = null
  switcher.ok = true
  iconAssets.entries = []
  iconAssets.imported = []
  iconOverrides.followGlobal = true
  iconOverrides.overrides = {}
  invokeMock.mockClear()
})

describe('ProjectFS / 首页 profile 往返', () => {
  it('导出包含 .worldsea/home.json', async () => {
    backend.dir = 'D:/src/worlddata'
    files.set('D:/src/worlddata/.worldsea/home.json', HOME_JSON)

    expect(await exportProjectToDir('D:/export')).toBe('D:/export/纯真')
    expect(files.get('D:/export/纯真/.worldsea/home.json')).toBe(HOME_JSON)
    expect(files.has('D:/export/纯真/.worldsea/cache.json')).toBe(true)
  })

  it('无 home.json 时导出照常（可选文件，不报错）', async () => {
    backend.dir = 'D:/src/worlddata'
    expect(await exportProjectToDir('D:/export2')).toBe('D:/export2/纯真')
    expect(files.has('D:/export2/纯真/.worldsea/home.json')).toBe(false)
    expect(files.has('D:/export2/纯真/.worldsea/cache.json')).toBe(true)
  })

  it('导入把 home.json 写进新项目目录', async () => {
    files.set('D:/pkg/纯真/project.json', JSON.stringify({ formatVersion: 1, id: 'p1', name: '纯真', description: '', createdAt: '', exportedAt: '' }))
    files.set('D:/pkg/纯真/.worldsea/home.json', HOME_JSON)
    files.set('D:/pkg/纯真/entities/character/乔_abcd1234.json', JSON.stringify({ id: 'abcd1234', type: 'character', name: '乔' }))

    const changed = vi.fn()
    window.addEventListener('ws-home-profile-changed', changed, { once: true })
    const result = await importProjectFromDir('D:/pkg/纯真')
    expect(result).toMatchObject({ projectName: '纯真', entityCount: 1 })
    expect(files.get('D:/new/worlddata/.worldsea/home.json')).toBe(HOME_JSON)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('切换新项目失败时中止导入，不写入 home.json', async () => {
    switcher.ok = false
    files.set('D:/pkg3/纯真/project.json', JSON.stringify({ formatVersion: 1, id: 'p1', name: '纯真', description: '', createdAt: '', exportedAt: '' }))
    files.set('D:/pkg3/纯真/.worldsea/home.json', HOME_JSON)

    await expect(importProjectFromDir('D:/pkg3/纯真')).rejects.toThrow('切换到导入项目失败')
    expect(files.has('D:/new/worlddata/.worldsea/home.json')).toBe(false)
  })

  it('导入包无 home.json 时跳过（不影响主体）', async () => {
    files.set('D:/pkg2/纯真/project.json', JSON.stringify({ formatVersion: 1, id: 'p1', name: '纯真', description: '', createdAt: '', exportedAt: '' }))
    const result = await importProjectFromDir('D:/pkg2/纯真')
    expect(result).toMatchObject({ projectName: '纯真', entityCount: 0 })
    expect(files.has('D:/new/worlddata/.worldsea/home.json')).toBe(false)
  })
})

describe('ProjectFS / 自定义图标往返', () => {
  it('导出写 icons/ 与 settings/icon-assets.json，且元数据不含 base64', async () => {
    backend.dir = 'D:/src/worlddata'
    iconAssets.entries = [{
      id: 'ic1', name: '徽章', ext: 'svg', bytes: 4, createdAt: 1, data: 'c3Zn',
    }]
    await exportProjectToDir('D:/export-icons')
    expect(files.get('D:/export-icons/纯真/icons/ic1.svg')).toBe('c3Zn')
    const meta = JSON.parse(files.get('D:/export-icons/纯真/settings/icon-assets.json') ?? '{}')
    expect(meta.assets).toEqual([{ id: 'ic1', name: '徽章', ext: 'svg', bytes: 4, createdAt: 1 }])
  })

  it('导入读回图标文件并恢复项目覆盖', async () => {
    files.set('D:/pkg-icons/纯真/project.json', JSON.stringify({ formatVersion: 1, id: 'p1', name: '纯真', description: '', createdAt: '', exportedAt: '' }))
    files.set('D:/pkg-icons/纯真/settings/icon-assets.json', JSON.stringify({
      version: 1,
      assets: [{ id: 'ic1', name: '徽章', ext: 'svg', bytes: 4, createdAt: 1 }],
    }))
    files.set('D:/pkg-icons/纯真/icons/ic1.svg', 'c3Zn')
    files.set('D:/pkg-icons/纯真/settings/icon-overrides.json', JSON.stringify({
      version: 1, followGlobal: false, overrides: { 'sprout:official.characters': 'custom:ic1' },
    }))

    await importProjectFromDir('D:/pkg-icons/纯真')
    expect(iconAssets.imported).toHaveLength(1)
    expect(iconAssets.imported[0]).toMatchObject({ id: 'ic1', ext: 'svg', data: 'c3Zn' })
    expect(iconOverrides.followGlobal).toBe(false)
    expect(iconOverrides.overrides).toEqual({ 'sprout:official.characters': 'custom:ic1' })
  })
})
