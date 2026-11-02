/**
 * ProjectFS 背景分区往返：导出复制 `.worldsea/background.json` 与被引用图片；导入复制文件并清洗缺失槽位；
 * 旧数据包无配置时静默跳过；背景步骤失败不阻断主体。用内存 Map 替换 Tauri invoke。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
const dirs = new Set<string>()
const backend = { dir: null as string | null }
const switcher = { ok: true }
const backgroundFail = { export: false, import: false }

function norm(path: unknown): string {
  return String(path ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1')
}

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/** 逐级登记目录，供「父目录必须存在」的拷贝语义使用 */
function ensureDir(path: string) {
  const parts = path.split('/').filter(Boolean)
  let cur = ''
  for (const part of parts) {
    cur += `/${part}`
    dirs.add(cur)
  }
}

function list(path: string): Array<{ name: string; path: string; isDir: boolean; size: number }> {
  const prefix = `${path}/`
  const out: Array<{ name: string; path: string; isDir: boolean; size: number }> = []
  const seenDirs = new Set<string>()
  for (const key of files.keys()) {
    if (!key.startsWith(prefix)) continue
    const rest = key.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) out.push({ name: rest, path: key, isDir: false, size: 1 })
    else if (!seenDirs.has(rest.slice(0, slash))) {
      const name = rest.slice(0, slash)
      seenDirs.add(name)
      out.push({ name, path: `${path}/${name}`, isDir: true, size: 0 })
    }
  }
  return out
}

const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const path = norm(args.path)
  if (cmd === 'cmd_fs_read') {
    const text = files.get(path)
    if (text === undefined) throw new Error(`ENOENT ${path}`)
    return text
  }
  if (cmd === 'cmd_fs_write') {
    files.set(path, String(args.content))
    ensureDir(parentOf(path))
    return undefined
  }
  if (cmd === 'cmd_fs_copy') {
    const src = norm(args.src)
    const dest = norm(args.dest)
    const text = files.get(src)
    if (text === undefined) throw new Error(`ENOENT ${src}`)
    ensureDir(parentOf(dest))
    files.set(dest, text)
    return undefined
  }
  if (cmd === 'cmd_fs_mkdir') {
    ensureDir(path)
    return undefined
  }
  if (cmd === 'cmd_fs_stat') {
    if (!files.has(path) && !dirs.has(path)) throw new Error(`ENOENT ${path}`)
    return { size: 1, isDir: !files.has(path) }
  }
  if (cmd === 'cmd_fs_list') return list(path)
  throw new Error(`未预期的命令 ${cmd}`)
})

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
    collectExportAssets: async () => [],
    importExportAssets: async () => ({ imported: 0, skipped: 0 }),
    loadProjectIconAssets: async () => {},
  }),
}))
vi.mock('../../stores/iconOverrideStore', () => ({
  useIconOverrideStore: () => ({
    exportProjectState: () => ({ version: 1, followGlobal: true, overrides: {}, updatedAt: 0 }),
    loadProjectIconOverrides: async () => {},
    replaceProjectState: () => {},
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
// 仅用于隔离失败路径：开关打开时背景步骤直接 reject，验证 ProjectFS 只告警不阻断主体
vi.mock('../backgroundProject', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../backgroundProject')>()
  return {
    ...actual,
    exportProjectBackgrounds: (...args: Parameters<typeof actual.exportProjectBackgrounds>) =>
      (backgroundFail.export ? Promise.reject(new Error('bg export boom')) : actual.exportProjectBackgrounds(...args)),
    importProjectBackgrounds: (...args: Parameters<typeof actual.importProjectBackgrounds>) =>
      (backgroundFail.import ? Promise.reject(new Error('bg import boom')) : actual.importProjectBackgrounds(...args)),
  }
})

import { exportProjectToDir, importProjectFromDir } from '../ProjectFS'

const MANIFEST = JSON.stringify({ formatVersion: 1, id: 'p1', name: '纯真', description: '', createdAt: '', exportedAt: '' })
const CONFIG = {
  version: 1,
  targets: {
    canvas: {
      enabled: true,
      paths: {
        light: '.worldsea/backgrounds/background-canvas-light-1.webp',
        dark: '.worldsea/backgrounds/background-canvas-dark-1.webp',
      },
    },
  },
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  files.clear()
  dirs.clear()
  backend.dir = null
  switcher.ok = true
  backgroundFail.export = false
  backgroundFail.import = false
  invokeMock.mockClear()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('ProjectFS / 项目背景导出', () => {
  it('复制被引用图片与配置到导出根，进度走 assets', async () => {
    backend.dir = 'D:/src/worlddata'
    files.set('D:/src/worlddata/.worldsea/background.json', JSON.stringify(CONFIG))
    files.set('D:/src/worlddata/.worldsea/backgrounds/background-canvas-light-1.webp', 'bin-light')
    const progress = vi.fn()

    expect(await exportProjectToDir('D:/export', progress)).toBe('D:/export/纯真')

    const src = 'D:/src/worlddata/.worldsea/backgrounds/background-canvas-light-1.webp'
    const dest = 'D:/export/纯真/.worldsea/backgrounds/background-canvas-light-1.webp'
    expect(invokeMock).toHaveBeenCalledWith('cmd_fs_copy', { src, dest })
    expect(files.get(dest)).toBe('bin-light')
    expect(JSON.parse(files.get('D:/export/纯真/.worldsea/background.json') ?? 'null')).toEqual(CONFIG)
    // 缺失的暗图也计入进度（1/2、2/2），phase 复用 assets
    expect(progress).toHaveBeenCalledWith('assets', 1, 2)
    expect(progress).toHaveBeenCalledWith('assets', 2, 2)
  })

  it('无背景配置时静默跳过，不复制不写配置，主体照常导出', async () => {
    backend.dir = 'D:/src/worlddata'

    expect(await exportProjectToDir('D:/export-old')).toBe('D:/export-old/纯真')

    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'cmd_fs_copy')).toHaveLength(0)
    expect(files.has('D:/export-old/纯真/.worldsea/background.json')).toBe(false)
    expect(files.has('D:/export-old/纯真/project.json')).toBe(true)
    expect(files.has('D:/export-old/纯真/.worldsea/cache.json')).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })

  it('背景步骤抛错只告警，导出主体仍成功', async () => {
    backend.dir = 'D:/src/worlddata'
    files.set('D:/src/worlddata/.worldsea/background.json', JSON.stringify(CONFIG))
    backgroundFail.export = true

    expect(await exportProjectToDir('D:/export-fail')).toBe('D:/export-fail/纯真')

    expect(files.has('D:/export-fail/纯真/project.json')).toBe(true)
    expect(files.has('D:/export-fail/纯真/.worldsea/background.json')).toBe(false)
    expect(warn).toHaveBeenCalled()
  })
})

describe('ProjectFS / 项目背景导入', () => {
  it('复制背景文件并清洗缺失槽位，无图目标剔除', async () => {
    files.set('D:/pkg/纯真/project.json', MANIFEST)
    files.set('D:/pkg/纯真/.worldsea/background.json', JSON.stringify({
      version: 1,
      targets: {
        canvas: {
          enabled: true,
          paths: {
            light: '.worldsea/backgrounds/canvas-light.webp',
            dark: '.worldsea/backgrounds/gone.webp',
          },
        },
        home: { enabled: true, paths: { light: '.worldsea/backgrounds/gone-home.webp', dark: '' } },
      },
    }))
    files.set('D:/pkg/纯真/.worldsea/backgrounds/canvas-light.webp', 'bin')
    const progress = vi.fn()

    const result = await importProjectFromDir('D:/pkg/纯真', progress)

    expect(result).toMatchObject({ projectName: '纯真', entityCount: 0 })
    const dest = 'D:/new/worlddata/.worldsea/backgrounds/canvas-light.webp'
    expect(invokeMock).toHaveBeenCalledWith('cmd_fs_copy', {
      src: 'D:/pkg/纯真/.worldsea/backgrounds/canvas-light.webp',
      dest,
    })
    expect(files.get(dest)).toBe('bin')
    const written = JSON.parse(files.get('D:/new/worlddata/.worldsea/background.json') ?? 'null')
    expect(written).toEqual({
      version: 1,
      targets: {
        canvas: {
          enabled: true,
          paths: { light: '.worldsea/backgrounds/canvas-light.webp', dark: '' },
        },
      },
    })
    expect(progress).toHaveBeenCalledWith('assets', expect.any(Number), 4)
  })

  it('旧包无背景配置时静默跳过，导入主体仍成功', async () => {
    files.set('D:/pkg-old/纯真/project.json', MANIFEST)

    const result = await importProjectFromDir('D:/pkg-old/纯真')

    expect(result).toMatchObject({ projectName: '纯真', entityCount: 0 })
    expect(files.has('D:/new/worlddata/.worldsea/background.json')).toBe(false)
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'cmd_fs_copy')).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('背景配置损坏时跳过背景，导入主体仍成功', async () => {
    files.set('D:/pkg-bad/纯真/project.json', MANIFEST)
    files.set('D:/pkg-bad/纯真/.worldsea/background.json', '{ 不是 JSON')

    const result = await importProjectFromDir('D:/pkg-bad/纯真')

    expect(result).toMatchObject({ projectName: '纯真', entityCount: 0 })
    expect(files.has('D:/new/worlddata/.worldsea/background.json')).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('背景步骤抛错只告警，导入主体仍成功', async () => {
    files.set('D:/pkg-fail/纯真/project.json', MANIFEST)
    backgroundFail.import = true

    const result = await importProjectFromDir('D:/pkg-fail/纯真')

    expect(result).toMatchObject({ projectName: '纯真', entityCount: 0 })
    expect(warn).toHaveBeenCalled()
  })
})
