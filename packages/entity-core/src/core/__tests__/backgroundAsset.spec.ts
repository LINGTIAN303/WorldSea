import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../pickLocalFiles', () => ({
  pickLocalFiles: vi.fn(async () => ({ items: [], cancelled: true, reasons: [], paths: [] })),
}))
vi.mock('../StorageBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../StorageBackend')>()),
  isTauri: () => true,
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
}))
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => 'C:/AppData'),
  join: vi.fn(async (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')),
}))

import { invoke } from '@tauri-apps/api/core'
import { pickLocalFiles } from '../pickLocalFiles'
import {
  BACKGROUND_MAX_EDGE,
  backgroundFileName,
  backgroundRelativePath,
  cleanupBackgroundOrphans,
  cleanupGlobalBackgroundOrphans,
  fitLongEdge,
  pickAndSaveBackground,
  resolveBackgroundSrc,
} from '../backgroundAsset'

describe('backgroundAsset 纯函数', () => {
  it('小图不放大', () => {
    expect(fitLongEdge(1280, 720)).toEqual({ width: 1280, height: 720 })
  })

  it('横图长边压到 2560', () => {
    expect(fitLongEdge(3840, 2160)).toEqual({ width: 2560, height: 1440 })
  })

  it('竖图按高边压', () => {
    expect(fitLongEdge(2160, 3840)).toEqual({ width: 1440, height: 2560 })
  })

  it('文件名只保留安全扩展名', () => {
    expect(backgroundFileName('canvas', 'light', 'webp', 123)).toBe('background-canvas-light-123.webp')
    expect(backgroundFileName('canvas', 'light', 'exe', 123)).toBe('background-canvas-light-123.webp')
  })

  it('扩展名缺失回退 webp', () => {
    expect(backgroundFileName('canvas', 'light', undefined as unknown as string, 1)).toBe('background-canvas-light-1.webp')
    expect(backgroundFileName('canvas', 'light', null as unknown as string, 1)).toBe('background-canvas-light-1.webp')
  })

  it('项目相对路径契约', () => {
    expect(backgroundRelativePath('background-canvas-light-1.webp')).toBe('.worldsea/backgrounds/background-canvas-light-1.webp')
    expect(backgroundRelativePath(backgroundFileName('Canvas/../', 'LIGHT!', 'png', 1))).toBe('.worldsea/backgrounds/background-canvas-light-1.png')
  })

  it('文件名带目标与主题', () => {
    expect(backgroundFileName('canvas', 'light', 'webp', 123)).toBe('background-canvas-light-123.webp')
    expect(backgroundFileName('titlebar', 'dark', 'exe', 123)).toBe('background-titlebar-dark-123.webp')
  })

  it('文件名清洗目标与主题中的非法字符', () => {
    expect(backgroundFileName('Canvas/../', 'LIGHT!', 'png', 1)).toBe('background-canvas-light-1.png')
  })

  it('上限为 2560', () => {
    expect(BACKGROUND_MAX_EDGE).toBe(2560)
  })
})

describe('pickAndSaveBackground', () => {
  beforeEach(() => {
    vi.mocked(pickLocalFiles).mockReset()
  })

  it('全局范围取消返回 null', async () => {
    vi.mocked(pickLocalFiles).mockResolvedValue({ items: [], cancelled: true, reasons: [], paths: [] })
    await expect(pickAndSaveBackground({ scope: 'global', target: 'canvas', theme: 'light' })).resolves.toBeNull()
  })

  it('全局范围没有文件时返回原因', async () => {
    vi.mocked(pickLocalFiles).mockResolvedValue({ items: [], cancelled: false, reasons: ['超限'], paths: [] })
    await expect(pickAndSaveBackground({ scope: 'global', target: 'canvas', theme: 'light' }))
      .resolves.toEqual({ ok: false, reason: '超限' })
  })

  it('项目范围缺 projectDir 返回原因', async () => {
    await expect(pickAndSaveBackground({
      scope: 'project', target: 'canvas', theme: 'light',
    })).resolves.toEqual({ ok: false, reason: '未打开项目' })
    expect(pickLocalFiles).not.toHaveBeenCalled()
  })
})

describe('resolveBackgroundSrc', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.useRealTimers()
  })

  it('瞬时失败重试后成功', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error('busy'))
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce({})
    const pending = resolveBackgroundSrc('C:/bg.webp')
    await vi.advanceTimersByTimeAsync(750)
    await expect(pending).resolves.toBe('asset://C:/bg.webp')
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    vi.useRealTimers()
  })

  it('三次都失败返回 null 并告警', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(invoke).mockRejectedValue(new Error('missing'))
    const pending = resolveBackgroundSrc('C:/gone.webp')
    await vi.advanceTimersByTimeAsync(750)
    await expect(pending).resolves.toBeNull()
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    vi.useRealTimers()
  })
})

describe('cleanupGlobalBackgroundOrphans', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('只删除未引用且前缀匹配的文件', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'cmd_fs_list') {
        return [
          { name: 'workspace-1.webp', path: 'C:/AppData/worldsea/backgrounds/workspace-1.webp', isDir: false },
          { name: 'workspace-2.webp', path: 'C:/AppData/worldsea/backgrounds/workspace-2.webp', isDir: false },
          { name: 'notes.txt', path: 'C:/AppData/worldsea/backgrounds/notes.txt', isDir: false },
          { name: 'sub', path: 'C:/AppData/worldsea/backgrounds/sub', isDir: true },
        ]
      }
      return undefined
    })
    await cleanupGlobalBackgroundOrphans(['C:\\AppData\\worldsea\\backgrounds\\WORKSPACE-1.webp'])
    expect(invoke).toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/AppData/worldsea/backgrounds/workspace-2.webp' })
    expect(invoke).not.toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/AppData/worldsea/backgrounds/workspace-1.webp' })
    expect(invoke).not.toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/AppData/worldsea/backgrounds/notes.txt' })
    expect(invoke).not.toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/AppData/worldsea/backgrounds/sub' })
  })

  it('目录读取失败时静默返回', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('no dir'))
    await expect(cleanupGlobalBackgroundOrphans([])).resolves.toBeUndefined()
  })
})

describe('cleanupBackgroundOrphans', () => {
  const entries = [
    { name: 'background-canvas-light-1.webp', path: 'C:/bg/background-canvas-light-1.webp', isDir: false },
    { name: 'background-titlebar-dark-2.webp', path: 'C:/bg/background-titlebar-dark-2.webp', isDir: false },
    { name: 'workspace-3.webp', path: 'C:/bg/workspace-3.webp', isDir: false },
    { name: 'notes.txt', path: 'C:/bg/notes.txt', isDir: false },
    { name: 'sub', path: 'C:/bg/sub', isDir: true },
  ]

  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === 'cmd_fs_list' ? entries : undefined))
  })

  it('只删除未引用且前缀匹配的背景文件', async () => {
    await cleanupBackgroundOrphans('C:/bg', ['C:\\bg\\BACKGROUND-CANVAS-LIGHT-1.webp'])
    expect(invoke).toHaveBeenCalledWith('cmd_fs_list', { path: 'C:/bg', recursive: false })
    expect(invoke).toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/bg/background-titlebar-dark-2.webp' })
    expect(invoke).toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/bg/workspace-3.webp' })
    expect(invoke).not.toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/bg/background-canvas-light-1.webp' })
    expect(invoke).not.toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/bg/notes.txt' })
    expect(invoke).not.toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/bg/sub' })
  })

  it('引用回调按调用结果保留', async () => {
    const referenced = vi.fn(() => ['C:/bg/workspace-3.webp'])
    await cleanupBackgroundOrphans('C:/bg', referenced)
    expect(referenced).toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/bg/workspace-3.webp' })
    expect(invoke).toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/bg/background-canvas-light-1.webp' })
  })

  it('目录读取失败时静默返回', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('no dir'))
    await expect(cleanupBackgroundOrphans('C:/bg', [])).resolves.toBeUndefined()
  })

  it('空目录参数直接返回，不列目录', async () => {
    await cleanupBackgroundOrphans('', [])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('项目配置相对路径按目录归一后保留在用文件', async () => {
    const dir = 'C:/p/.worldsea/backgrounds'
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === 'cmd_fs_list'
      ? [
        { name: 'keep.webp', path: `${dir}/keep.webp`, isDir: false },
        { name: 'background-keep.webp', path: `${dir}/background-keep.webp`, isDir: false },
        { name: 'workspace-drop.webp', path: `${dir}/workspace-drop.webp`, isDir: false },
      ]
      : undefined))
    await cleanupBackgroundOrphans(dir, [
      '.worldsea/backgrounds/keep.webp',
      backgroundRelativePath('background-keep.webp'),
    ])
    expect(invoke).not.toHaveBeenCalledWith('cmd_fs_delete', { path: `${dir}/keep.webp` })
    expect(invoke).not.toHaveBeenCalledWith('cmd_fs_delete', { path: `${dir}/background-keep.webp` })
    expect(invoke).toHaveBeenCalledWith('cmd_fs_delete', { path: `${dir}/workspace-drop.webp` })
  })

  it('大写扩展名 PNG 也按背景文件匹配删除', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === 'cmd_fs_list'
      ? [{ name: 'WORKSPACE-OLD.PNG', path: 'C:/bg/WORKSPACE-OLD.PNG', isDir: false }]
      : undefined))
    await cleanupBackgroundOrphans('C:/bg', [])
    expect(invoke).toHaveBeenCalledWith('cmd_fs_delete', { path: 'C:/bg/WORKSPACE-OLD.PNG' })
  })
})
