/**
 * 项目背景配置（`.worldsea/background.json`）：路径校验、读写、资产解析、孤儿清理、导出/导入。
 * 用内存 Map 替换 Tauri invoke，覆盖整条项目背景链路而不触盘。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
const dirs = new Set<string>()

function norm(path: unknown): string {
  return String(path ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1')
}

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
  const parentOf = (value: string) => value.slice(0, value.lastIndexOf('/'))
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
  if (cmd === 'cmd_fs_stat') {
    if (!files.has(path) && !dirs.has(path)) throw new Error(`ENOENT ${path}`)
    return { size: 1, isDir: !files.has(path) }
  }
  if (cmd === 'cmd_fs_copy') {
    const src = norm(args.src)
    const dest = norm(args.dest)
    const text = files.get(src)
    if (text === undefined) throw new Error(`ENOENT ${src}`)
    if (!dirs.has(parentOf(dest))) throw new Error(`父目录不存在 ${parentOf(dest)}`)
    files.set(dest, text)
    return undefined
  }
  if (cmd === 'cmd_fs_mkdir') {
    ensureDir(path)
    return undefined
  }
  if (cmd === 'cmd_fs_delete') {
    files.delete(path)
    return undefined
  }
  if (cmd === 'cmd_fs_list') return list(path)
  throw new Error(`未预期的命令 ${cmd}`)
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, Record<string, unknown>])),
  convertFileSrc: (path: string) => `asset://${path}`,
}))
vi.mock('../StorageBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../StorageBackend')>()),
  isTauri: () => true,
}))

import {
  PROJECT_BACKGROUND_PREFIX,
  cleanupProjectBackgroundOrphans,
  deleteProjectBackground,
  exportProjectBackgrounds,
  importProjectBackgrounds,
  normalizeProjectBackgroundPath,
  readProjectBackground,
  resolveProjectBackgroundAssets,
  writeProjectBackground,
} from '../backgroundProject'

const DIR = '/p'
const BGS = `${DIR}/.worldsea/backgrounds`
const OUT = '/out'
const NEW = '/new'

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  files.clear()
  dirs.clear()
  invokeMock.mockClear()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('normalizeProjectBackgroundPath', () => {
  it('拒绝绝对路径、反斜杠与目录穿越', () => {
    expect(normalizeProjectBackgroundPath('C:/x.webp')).toBeNull()
    expect(normalizeProjectBackgroundPath('.worldsea/backgrounds/a.webp')).toBe('.worldsea/backgrounds/a.webp')
    expect(normalizeProjectBackgroundPath('.worldsea/backgrounds/../a.webp')).toBeNull()
    expect(normalizeProjectBackgroundPath('.worldsea\\backgrounds\\a.webp')).toBeNull()
    expect(normalizeProjectBackgroundPath('assets/a.webp')).toBeNull()
  })

  it('拒绝空值、空段与目录前缀本身', () => {
    expect(normalizeProjectBackgroundPath('')).toBeNull()
    expect(normalizeProjectBackgroundPath('.worldsea/backgrounds/')).toBeNull()
    expect(normalizeProjectBackgroundPath('.worldsea/backgrounds//a.webp')).toBeNull()
    expect(normalizeProjectBackgroundPath('/.worldsea/backgrounds/a.webp')).toBeNull()
  })

  it('前缀常量与 backgroundRelativePath 一致', () => {
    expect(PROJECT_BACKGROUND_PREFIX).toBe('.worldsea/backgrounds/')
  })
})

describe('项目背景配置读写', () => {
  it('写入后读回同一 JSON', async () => {
    await writeProjectBackground(DIR, { version: 1, targets: { canvas: { enabled: true } } })
    await expect(readProjectBackground(DIR)).resolves.toEqual({ version: 1, targets: { canvas: { enabled: true } } })
    expect(files.has(`${DIR}/.worldsea/background.json`)).toBe(true)
  })

  it('读缺失配置返回 null 且不抛错', async () => {
    await expect(readProjectBackground(DIR)).resolves.toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('配置损坏时告警并返回 null', async () => {
    files.set(`${DIR}/.worldsea/background.json`, '{ 不是 JSON')
    await expect(readProjectBackground(DIR)).resolves.toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('删除配置，文件不存在时静默', async () => {
    await writeProjectBackground(DIR, { version: 1, targets: {} })
    await deleteProjectBackground(DIR)
    expect(files.has(`${DIR}/.worldsea/background.json`)).toBe(false)
    await expect(deleteProjectBackground(DIR)).resolves.toBeUndefined()
  })
})

describe('resolveProjectBackgroundAssets', () => {
  it('存在的 ref 返回 convertFileSrc，缺失与非法 path 记 missing', async () => {
    files.set(`${BGS}/background-canvas-light-1.webp`, 'bin')
    const { srcs, missing } = await resolveProjectBackgroundAssets(DIR, [
      { target: 'canvas', theme: 'light', path: '.worldsea/backgrounds/background-canvas-light-1.webp' },
      { target: 'canvas', theme: 'dark', path: '.worldsea/backgrounds/gone.webp' },
      { target: 'home', theme: 'light', path: 'C:/evil.webp' },
      { target: 'home', theme: 'dark', path: '' },
    ])

    expect(srcs.canvas.light).toBe('asset:///p/.worldsea/backgrounds/background-canvas-light-1.webp')
    expect(missing.canvas.light).toBe(false)
    expect(srcs.canvas.dark).toBeNull()
    expect(missing.canvas.dark).toBe(true)
    expect(srcs.home.light).toBeNull()
    expect(missing.home.light).toBe(true)
    // 空路径 = 未配置，不算缺失
    expect(srcs.home.dark).toBeNull()
    expect(missing.home.dark).toBe(false)
  })

  it('srcs / missing 覆盖全部五个目标与两个主题键', async () => {
    const { srcs, missing } = await resolveProjectBackgroundAssets(DIR, [])
    const expected = ['canvas', 'content', 'home', 'sidebar', 'titlebar']
    expect(Object.keys(srcs).sort()).toEqual(expected)
    expect(Object.keys(missing).sort()).toEqual(expected)
    for (const target of expected) {
      expect(Object.keys(srcs[target]).sort()).toEqual(['dark', 'light'])
      expect(Object.keys(missing[target]).sort()).toEqual(['dark', 'light'])
    }
  })
})

describe('cleanupProjectBackgroundOrphans', () => {
  it('只删未引用且前缀匹配的文件，被引用文件/其他文件/子目录保留', async () => {
    files.set(`${BGS}/background-canvas-light-1.webp`, 'keep')
    files.set(`${BGS}/background-canvas-light-2.webp`, 'drop')
    files.set(`${BGS}/workspace-1.webp`, 'drop')
    files.set(`${BGS}/notes.txt`, 'keep')
    files.set(`${BGS}/sub/background-canvas-light-3.webp`, 'keep')

    await cleanupProjectBackgroundOrphans(DIR, ['.worldsea/backgrounds/background-canvas-light-1.webp'])

    expect(files.has(`${BGS}/background-canvas-light-1.webp`)).toBe(true)
    expect(files.has(`${BGS}/background-canvas-light-2.webp`)).toBe(false)
    expect(files.has(`${BGS}/workspace-1.webp`)).toBe(false)
    expect(files.has(`${BGS}/notes.txt`)).toBe(true)
    expect(files.has(`${BGS}/sub/background-canvas-light-3.webp`)).toBe(true)
  })

  it('引用集合可以是延迟求值的回调', async () => {
    files.set(`${BGS}/background-a.webp`, 'keep')
    files.set(`${BGS}/background-b.webp`, 'drop')
    const referenced = vi.fn(() => ['.worldsea/backgrounds/background-a.webp'])

    await cleanupProjectBackgroundOrphans(DIR, referenced)

    expect(referenced).toHaveBeenCalled()
    expect(files.has(`${BGS}/background-a.webp`)).toBe(true)
    expect(files.has(`${BGS}/background-b.webp`)).toBe(false)
  })

  it('目录不存在时静默返回', async () => {
    await expect(cleanupProjectBackgroundOrphans('/nope', [])).resolves.toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('exportProjectBackgrounds', () => {
  const config = {
    version: 1,
    targets: {
      canvas: {
        enabled: true,
        paths: { light: '.worldsea/backgrounds/background-canvas-light-1.webp', dark: '' },
      },
      home: {
        enabled: true,
        paths: { light: '.worldsea/backgrounds/gone.webp', dark: 'C:/evil.webp' },
      },
    },
  }

  it('复制被引用文件与配置，缺失源文件跳过并告警', async () => {
    files.set(`${DIR}/.worldsea/background.json`, JSON.stringify(config))
    files.set(`${BGS}/background-canvas-light-1.webp`, 'bin')
    const progress = vi.fn()

    await exportProjectBackgrounds(DIR, OUT, progress)

    expect(files.get(`${OUT}/.worldsea/backgrounds/background-canvas-light-1.webp`)).toBe('bin')
    expect(files.has(`${OUT}/.worldsea/backgrounds/gone.webp`)).toBe(false)
    expect(JSON.parse(files.get(`${OUT}/.worldsea/background.json`) ?? 'null')).toEqual(config)
    expect(progress).toHaveBeenCalled()
    expect(JSON.parse(files.get(`${OUT}/.worldsea/background.json`) ?? 'null').targets.home.paths.dark).toBe('C:/evil.webp')
  })

  it('无项目配置时静默跳过（旧数据包）', async () => {
    await exportProjectBackgrounds(DIR, OUT)
    expect([...files.keys()].filter((key) => key.startsWith(OUT))).toEqual([])
  })
})

describe('importProjectBackgrounds', () => {
  const config = {
    version: 1,
    targets: {
      canvas: {
        enabled: true,
        paths: {
          light: '.worldsea/backgrounds/background-canvas-light-1.webp',
          dark: '.worldsea/backgrounds/gone.webp',
        },
      },
      home: { enabled: true, paths: { light: '.worldsea/backgrounds/also-gone.webp', dark: '' } },
      sidebar: { enabled: true, paths: { light: 'C:/evil.webp', dark: '' } },
    },
  }

  it('复制存在文件、置空缺失槽位并剔除无图目标', async () => {
    files.set(`/pkg/.worldsea/background.json`, JSON.stringify(config))
    files.set('/pkg/.worldsea/backgrounds/background-canvas-light-1.webp', 'bin')
    const progress = vi.fn()

    await importProjectBackgrounds('/pkg', NEW, progress)

    expect(files.get(`${NEW}/.worldsea/backgrounds/background-canvas-light-1.webp`)).toBe('bin')
    const written = JSON.parse(files.get(`${NEW}/.worldsea/background.json`) ?? 'null')
    expect(written.version).toBe(1)
    expect(written.targets).toEqual({
      canvas: {
        enabled: true,
        paths: {
          light: '.worldsea/backgrounds/background-canvas-light-1.webp',
          dark: '',
        },
      },
    })
    expect(progress).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('源包无背景配置时静默跳过', async () => {
    await importProjectBackgrounds('/pkg', NEW)
    expect(files.has(`${NEW}/.worldsea/background.json`)).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })
})
